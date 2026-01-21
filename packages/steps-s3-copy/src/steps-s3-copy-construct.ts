import { Construct } from "constructs";
import {
  CompositePrincipal,
  Effect,
  IRole,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {
  ChainDefinitionBody,
  Fail,
  Parallel,
  Pass,
  QueryLanguage,
  StateMachine,
  Succeed,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
import { Duration, Stack } from "aws-cdk-lib";
import { CanWriteLambdaStepConstruct } from "./lib/can-write-lambda-step-construct";
import { ValidateThawParamsLambdaStepConstruct } from "./lib/validate-thaw-params-lambda-step-construct";
import {
  DRY_RUN_KEY_FIELD_NAME,
  INCLUDE_COPY_REPORT_FIELD_NAME,
  RETAIN_COPY_REPORT_S3_URI_FIELD_NAME,
  StepsS3CopyInvokeArguments,
} from "./steps-s3-copy-input";
import { CopyMapConstruct } from "./lib/copy-map-construct";
import { StepsS3CopyConstructProps } from "./steps-s3-copy-construct-props";
import { HeadObjectsMapConstruct } from "./lib/head-objects-map-construct";
import { CoordinateCopyLambdaStepConstruct } from "./lib/coordinate-copy-lambda-step-construct";
import { SummariseCopyLambdaStepConstruct } from "./lib/summarise-copy-lambda-step-construct";
import {
  AssetImage,
  AwsLogDriverMode,
  Cluster,
  CpuArchitecture,
  FargateTaskDefinition,
  LinuxParameters,
  LogDriver,
} from "aws-cdk-lib/aws-ecs";
import { join } from "path";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { SmallObjectsCopyMapConstruct } from "./lib/small-copy-map-construct";

export { StepsS3CopyConstructProps } from "./steps-s3-copy-construct-props";
export { SubnetType } from "aws-cdk-lib/aws-ec2";

export type StepsS3CopyInvokeSettings = {
  readonly workingBucket: string;
  readonly workingBucketPrefixKey: string;
};

/**
 * A construct that makes a state machine for bulk copying large lists of
 * large objects from one bucket to another.
 */
export class StepsS3CopyConstruct extends Construct {
  // we have a variety of constructs which we want to be able to test externally (deploying the CDK
  // and then using TestState) - but we don't particularly want to expose the actual objects. So
  // we store them private readonly and have some get() accessors for the value we want to use for testing.
  private readonly _stateMachine: StateMachine;
  private readonly _workingRole: IRole;
  private readonly _canWriteLambdaStep: CanWriteLambdaStepConstruct;
  private readonly _headObjectsMap: HeadObjectsMapConstruct;

  constructor(scope: Construct, id: string, props: StepsS3CopyConstructProps) {
    super(scope, id);

    // the working bucket prefix key must be undefined or "" which means use the root, or a key with
    // a trailing slash
    if (props.workingBucketPrefixKey)
      if (
        props.workingBucketPrefixKey !== "" &&
        !props.workingBucketPrefixKey.endsWith("/")
      )
        throw new Error(
          "If specified, the working bucket prefix key must end with a slash or be the empty string",
        );

    // we define a fargate cluster in which we will be spinning up all of our compute
    const cluster = new Cluster(this, "FargateCluster", {
      vpc: props.vpc,
      enableFargateCapacityProviders: true,
    });

    // we build a single role that is shared between the state machine and the lambda workers
    // we have some use cases where external parties want to trust a single named role and this
    // allows that scenario
    this._workingRole = this.createWorkingRole(
      props.writerRoleName,
      props.allowWriteToInstalledAccount,
    );

    const taskDefinition = new FargateTaskDefinition(this, "CopyTd", {
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
      },
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole: this._workingRole,
    });

    const linuxParams = new LinuxParameters(this, "LinuxParameters", {
      // because we want to support SPOT signals etc, we want it to run our main container entrypoint
      // with an initd
      initProcessEnabled: true,
      // want to also consider read only
      // https://stackoverflow.com/questions/68933848/how-to-allow-container-with-read-only-root-filesystem-writing-to-tmpfs-volume
      // DOESN'T WORK FOR FARGATE SO NEED TO THINK ABOUT THIS OTHER WAY
    });

    const containerDefinition = taskDefinition.addContainer("CopyContainer", {
      image: new AssetImage(
        join(__dirname, "..", "docker", "copy-batch-docker-image"),
        {
          platform: Platform.LINUX_ARM64,
          // our docker image can be built for use by either fargate or lambdas - we chose fargate here at build time
          target: "fargate",
        },
      ),
      linuxParameters: linuxParams,
      readonlyRootFilesystem: true,
      logging: LogDriver.awsLogs({
        mode: AwsLogDriverMode.NON_BLOCKING,
        streamPrefix: "steps-s3-copy",
        logRetention: RetentionDays.ONE_WEEK,
        // optimal size suggested from
        // https://aws.amazon.com/blogs/containers/preventing-log-loss-with-non-blocking-mode-in-the-awslogs-container-log-driver/
        // HOWEVER - we now that our tool has very minimal output to stdout/stderr so we do not need to change from the default of 1 MiB
        // maxBufferSize: Size.mebibytes(25),
      }),
      // set the stop timeout to the maximum allowed under Fargate Spot
      // potentially this will let us finish our copy operation (!!! - we don't actually try to let copy finish - see Docker image - we should)
      stopTimeout: Duration.seconds(120),
    });

    const success = new Succeed(this, "Succeed");
    const fail = new Fail(this, "Fail Wrong Bucket Region");

    const invalidThawParamsFail = new Fail(this, "Fail Invalid Thaw Params", {
      error: "InvalidThawParamsError",
      cause:
        'Invalid thaw parameters (unsupported restore tier). See the "Validate Thaw Params" task failure details for the specific field and value.',
    });

    // jsonata representing all input values to the state machine but with defaults for absent fields
    const jsonataInvokeArgumentsWithDefaults: {
      [K in keyof StepsS3CopyInvokeArguments]: string;
    } = {
      // out of the box - the copy requires both source and destination buckets to be in the
      // same region as the deployed software. This minimises the chance of large egress
      // fees
      // the expected region can be altered in the input to the copy
      // specifying an empty string for either of these will allow *any* region
      sourceRequiredRegion: `{% [ $states.input.sourceRequiredRegion, "${
        Stack.of(this).region
      }" ][0] %}`,
      destinationRequiredRegion: `{% [ $states.input.destinationRequiredRegion, "${
        Stack.of(this).region
      }" ][0] %}`,

      maxItemsPerBatch:
        "{% [ $number($states.input.maxItemsPerBatch), 8 ][0] %}",
      copyConcurrency:
        "{% [ $number($states.input.copyConcurrency), 80 ][0] %}",

      sourceFilesCsvKey: `{% $exists($states.input.sourceFilesCsvKey) ? $states.input.sourceFilesCsvKey : $error("Missing sourceFilesCsvKey") %}`,
      destinationBucket: `{% $exists($states.input.destinationBucket) ? $states.input.destinationBucket : $error("Missing destinationBucket") %}`,
      // set a slash terminated folder to copy into, or by default we just copy into the top level of the destination bucket
      destinationFolderKey: `{% [ $states.input.destinationFolderKey, "" ][0] %}`,

      // these are the default objects that will be created in the destination prefix area
      destinationStartCopyRelativeKey: `{% [ $states.input.destinationStartCopyRelativeKey, "STARTED_COPY.txt" ][0] %}`,
      destinationEndCopyRelativeKey: `{% [ $states.input.destinationEndCopyRelativeKey, "ENDED_COPY.csv" ][0] %}`,
      // if thawParams is not passed in, we use an empty object
      thawParams: `{% $exists($states.input.thawParams) ? $states.input.thawParams : {} %}`,

      // typecast any input to a boolean, if left blank or not passed in, we will end up with false
      [DRY_RUN_KEY_FIELD_NAME]: `{% [ $states.input.${DRY_RUN_KEY_FIELD_NAME}, false ][0] %}`,

      // if not passed, default to false
      [INCLUDE_COPY_REPORT_FIELD_NAME]: `{% [ $states.input.${INCLUDE_COPY_REPORT_FIELD_NAME}, false ][0] %}`,

      // if not passed, default to ""
      [RETAIN_COPY_REPORT_S3_URI_FIELD_NAME]: `{% [ $states.input.${RETAIN_COPY_REPORT_S3_URI_FIELD_NAME}, "" ][0] %}`,
    };
    const jsonataInvokeSettings: {
      [K in keyof StepsS3CopyInvokeSettings]: string;
    } = {
      workingBucket: props.workingBucket,
      // note: if undefined we instead use an empty string to mean "no leading prefix" in the working bucket
      workingBucketPrefixKey: props.workingBucketPrefixKey ?? "",
    };

    const assignInputsAndApplyDefaults = new Pass(
      this,
      "Assign Inputs to State and Apply Defaults",
      {
        queryLanguage: QueryLanguage.JSONATA,
        // assign our inputs into the states machine state - whilst also providing
        // defaults
        assign: {
          invokeArguments: jsonataInvokeArgumentsWithDefaults,
          invokeSettings: jsonataInvokeSettings,
        },
      },
    );

    this._canWriteLambdaStep = new CanWriteLambdaStepConstruct(
      this,
      "CanWrite",
      {
        writerRole: this._workingRole,
      },
    );

    const validateThawParamsStep = new ValidateThawParamsLambdaStepConstruct(
      this,
      "ValidateThawParams",
      { writerRole: this._workingRole },
    );

    validateThawParamsStep.invocableLambda.addCatch(invalidThawParamsFail, {
      errors: ["InvalidThawParamsError"],
    });

    const canWriteStep = this._canWriteLambdaStep.invocableLambda;

    // when choosing times remember
    // AWS Step Functions has a hard quota of 25,000 entries in the execution event history
    // so if a copy takes 1 month say (very worst case)... that's 30x24x60 minutes = 43,000
    // so waiting every 10 minutes would end up with 4,300 execution events - which is well
    // inside the limit

    const waitCanWriteStep = new Wait(
      this,
      "Wait X Minutes For Writeable Bucket",
      {
        time: WaitTime.duration(
          props.aggressiveTimes ? Duration.seconds(30) : Duration.minutes(10),
        ),
      },
    );

    //const waitIsThawedStep = new Wait(this, "Wait X Minutes For Thawed Objects", {
    //  time: WaitTime.duration(
    //    props.aggressiveTimes ? Duration.seconds(30) : Duration.minutes(10),
    //  ),
    //});

    canWriteStep.addCatch(waitCanWriteStep.next(canWriteStep), {
      errors: ["AccessDeniedError"],
    });

    canWriteStep.addCatch(fail, { errors: ["WrongRegionError"] });

    this._headObjectsMap = new HeadObjectsMapConstruct(this, "HeadObjects", {
      writerRole: this._workingRole,
      aggressiveTimes: props.aggressiveTimes,
    });

    const coordinateCopyLambdaStep = new CoordinateCopyLambdaStepConstruct(
      this,
      "CoordinateCopy",
      {
        writerRole: this._workingRole,
      },
    );

    const smallCopierMap = new SmallObjectsCopyMapConstruct(this, "Small", {
      // for small items we use a value that is much bigger than what will work
      // - this let steps batch them up itself
      // to the max that can fit in its payload limit
      // this means that each invoke will for instance be copying 10-20 small items
      //maxItemsPerBatch: 16,
      //cluster: cluster,
      //clusterVpcSubnetSelection: props.vpcSubnetSelection,
      writerRole: this._workingRole,
      maxItemsPerBatch: 128,
      inputPath: "$coordinateCopyResults.copySets.small",
      //taskDefinition: taskDefinition,
      //containerDefinition: containerDefinition,
    });

    const largeCopierMap = new CopyMapConstruct(this, "Large", {
      // for larger items - designate a single copy at a time - gaining concurrency
      // via the distributed map itself
      maxItemsPerBatch: 1,
      maxConcurrency: 2000,
      cluster: cluster,
      clusterVpcSubnetSelection: props.vpcSubnetSelection,
      writerRole: this._workingRole,
      inputPath: "$coordinateCopyResults.copySets.large",
      taskDefinition: taskDefinition,
      containerDefinition: containerDefinition,
    });

    // Objects that are in deep glacier need to be thawed before copying
    const thawSmallCopierMap = new SmallObjectsCopyMapConstruct(
      this,
      "NeedThawSmall",
      {
        addThawStep: true,
        aggressiveTimes: props.aggressiveTimes,
        writerRole: this._workingRole,
        inputPath: "$coordinateCopyResults.copySets.smallThaw",
        maxItemsPerBatch: 128,
      },
    );

    const thawLargeCopierMap = new CopyMapConstruct(this, "NeedThawLarge", {
      addThawStep: true,
      aggressiveTimes: props.aggressiveTimes,
      maxItemsPerBatch: 1,
      maxConcurrency: 2000,
      cluster: cluster,
      clusterVpcSubnetSelection: props.vpcSubnetSelection,
      writerRole: this._workingRole,
      inputPath: "$coordinateCopyResults.copySets.largeThaw",
      taskDefinition: taskDefinition,
      containerDefinition: containerDefinition,
    });

    const summariseCopyLambdaStep = new SummariseCopyLambdaStepConstruct(
      this,
      "SummariseCopy",
      {
        writerRole: this._workingRole,
      },
    );

    // we construct a set of independent copiers that handle different types of objects
    // we can tune the copiers for their object types
    const copiers = new Parallel(this, "CopyParallel", {}).branch(
      smallCopierMap.distributedMap,
      largeCopierMap.distributedMap,
      thawSmallCopierMap.distributedMap,
      thawLargeCopierMap.distributedMap,
    );

    const definition = ChainDefinitionBody.fromChainable(
      assignInputsAndApplyDefaults
        .next(validateThawParamsStep.invocableLambda)
        .next(canWriteStep)
        .next(this._headObjectsMap.distributedMap)
        .next(coordinateCopyLambdaStep.invocableLambda)
        .next(copiers)
        .next(summariseCopyLambdaStep.invocableLambda)
        .next(success),
    );

    // NOTE: we use a technique here to allow optional input parameters to the state machine
    // by defining defaults and then JsonMerging them with the actual input params
    this._stateMachine = new StateMachine(this, "StateMachine", {
      // we opt-in to the better Jsonata query language
      // queryLanguage: QueryLanguage.JSONATA,
      definitionBody: definition,
      // we might be thawing objects from S3 deep glacier (24-48 hrs)
      // we also give people a window of time in which to create the destination sourceBucket - so this
      // could run a long time
      timeout: props.aggressiveTimes ? Duration.days(7) : Duration.days(30),
    });

    this._headObjectsMap.distributedMap.grantNestedPermissions(
      this._stateMachine,
    );
    thawSmallCopierMap.distributedMap.grantNestedPermissions(
      this._stateMachine,
    );
    smallCopierMap.distributedMap.grantNestedPermissions(this._stateMachine);
    largeCopierMap.distributedMap.grantNestedPermissions(this._stateMachine);
    thawLargeCopierMap.distributedMap.grantNestedPermissions(
      this._stateMachine,
    );

    // first policy is we need to let the state machine access our CSV list
    // of objects to copy, and write back to record the status of the copies
    // i.e. perms needed for result writing from distributed map (from AWS docs)
    // https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultwriter.html#resultwriter-iam-policies
    this._stateMachine.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListMultipartUploadParts",
          "s3:AbortMultipartUpload",
        ],
        resources: [
          "*",
          //`arn:aws:s3:::${props.workingBucket}/${
          //  props.workingBucketPrefixKey ?? ""
          //}*`,
        ],
      }),
    );
  }

  public get stateMachine(): StateMachine {
    return this._stateMachine;
  }

  public get canWriteLambdaAslStateName(): string {
    return this._canWriteLambdaStep.stateName;
  }

  public get headObjectsLambdaAslStateName(): string {
    return this._headObjectsMap.lambdaStep.stateName;
  }

  public get workerRoleArn(): string {
    return this._workingRole.roleArn;
  }

  /**
   * Create a role that is responsible for most of the "work" done by this steps orchestration. That is, the
   * role needs to be able to write into destination buckets, read from source buckets and do other
   * activities performed by the lambdas. IT IS NOT THE ROLE of the actual steps orchestration
   * state machine itself.
   *
   * @param forcedRoleName
   * @param allowWriteIntoInstalledAccount
   */
  public createWorkingRole(
    forcedRoleName: string | undefined,
    allowWriteIntoInstalledAccount: boolean | undefined,
  ): IRole {
    const writerRole = new Role(this, "WriterRole", {
      // in some circumstances we want to force the name of this role so we can give instructions to
      // data recipients about an explicit named role to "trust"
      roleName: forcedRoleName,
      // note: this role is used by *all* the "work" bits of the orchestration - so both ECS tasks and lambdas
      // AND for using the TestState API where we simulate stages of the state machine
      // HENCE we need a composite principal for the assumed by
      assumedBy: new CompositePrincipal(
        new ServicePrincipal("ecs-tasks.amazonaws.com"),
        new ServicePrincipal("lambda.amazonaws.com"),
      ),
    });

    // the role is assigned to lambdas - so they need enough permissions to execute
    writerRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole",
      ),
    );

    // Allow the task definition role ecr access to the guardduty agent
    // https://docs.aws.amazon.com/guardduty/latest/ug/prereq-runtime-monitoring-ecs-support.html#before-enable-runtime-monitoring-ecs
    // Which is in another account - 005257825471.dkr.ecr.ap-southeast-2.amazonaws.com/aws-guardduty-agent-fargate
    writerRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy",
      ),
    );

    // TODO: because we have given S3FUllAccess this policy is essentially ignored
    // we need to use this in conjunction with a tightened equiv for the "copier"
    writerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "s3:PutObject",
          "s3:PutObjectTagging",
          "s3:PutObjectVersionTagging",
        ],
        resources: ["*"],
        // yes - that's right - we want to give this lambda the ability to attempt the writes anywhere
        // EXCEPT where we are deployed
        // (under the assumption that buckets outside our account must be giving us explicit write permission,
        //  whilst within our account we get implicit access - in this case we don't want that ability)
        conditions: allowWriteIntoInstalledAccount
          ? undefined
          : {
              StringNotEquals: {
                "s3:ResourceAccount": [Stack.of(this).account],
              },
            },
      }),
    );

    // we need to give the rclone task the ability to do the copy out in S3
    // TODO can we limit this to reading from our designated buckets and writing out
    // NOTES: we need
    // Get, Restore, Tagging?
    writerRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"),
    );

    // allow sending of state messages to signify task aborts etc from ECS Fargate
    writerRole.addToPolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: [
          "states:SendTaskSuccess",
          "states:SendTaskFailure",
          "states:SendTaskHeartbeat",
        ],
      }),
    );

    return writerRole;
  }
}
