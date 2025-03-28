import { Construct } from "constructs";
import {
  CompositePrincipal,
  Effect,
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
import { ThawObjectsMapConstruct } from "./lib/thaw-objects-map-construct";
import { StepsS3CopyInput } from "./steps-s3-copy-input";
import { RcloneMapConstruct } from "./lib/rclone-map-construct";
import { StepsS3CopyConstructProps } from "./steps-s3-copy-construct-props";
import { SummariseCopyLambdaStepConstruct } from "./lib/summarise-copy-lambda-step-construct";
import { HeadObjectsMapConstruct } from "./lib/head-objects-map-construct";
import { CoordinateCopyLambdaStepConstruct } from "./lib/coordinate-copy-lambda-step-construct";
import {
  AssetImage,
  CpuArchitecture,
  FargateTaskDefinition,
  LogDriver,
} from "aws-cdk-lib/aws-ecs";
import { join } from "path";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { RetentionDays } from "aws-cdk-lib/aws-logs";

export { StepsS3CopyConstructProps } from "./steps-s3-copy-construct-props";
export { SubnetType } from "aws-cdk-lib/aws-ec2";

/**
 * A construct that makes a state machine for bulk copying large lists of
 * large objects from one bucket to another.
 */
export class StepsS3CopyConstruct extends Construct {
  private readonly _stateMachine: StateMachine;

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

    // we build a single role that is shared between the statemachine and the lambda workers
    // we have some use cases where external parties want to trust a single named role and this
    // allows that scenario
    const writerRole = new Role(this, "WriterRole", {
      roleName: props.writerRoleName ?? undefined,
      assumedBy: new CompositePrincipal(
        new ServicePrincipal("ecs-tasks.amazonaws.com"),
        new ServicePrincipal("lambda.amazonaws.com"),
      ),
    });

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
        conditions: props.allowWriteToInstalledAccount
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

    writerRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole",
      ),
    );

    // allow sending of state messages to signify task aborts etc
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

    const taskDefinition = new FargateTaskDefinition(this, "RcloneTd", {
      runtimePlatform: {
        // FARGATE_SPOT is only available for X86
        cpuArchitecture: CpuArchitecture.X86_64,
      },
      cpu: 256,
      // there is a warning in the rclone documentation about problems with mem < 1GB - but I think that
      // is mainly for large multi-file syncs... we do individual/small file copies so 512 should be fine
      memoryLimitMiB: 512,
      taskRole: writerRole,
    });

    const containerDefinition = taskDefinition.addContainer("RcloneContainer", {
      // set the stop timeout to the maximum allowed under Fargate Spot
      // potentially this will let us finish our rclone operation (!!! - we don't actually try to let rclone finish - see Docker image - we should)
      stopTimeout: Duration.seconds(120),
      image: new AssetImage(
        join(__dirname, "..", "docker", "rclone-batch-docker-image"),
        {
          // note we are forcing the X86 platform because we want to use Fargate spot which is only available intel/x86
          platform: Platform.LINUX_AMD64,
        },
      ),
      readonlyRootFilesystem: true,
      // https://stackoverflow.com/questions/68933848/how-to-allow-container-with-read-only-root-filesystem-writing-to-tmpfs-volume
      // DOESN'T WORK FOR FARGATE SO NEED TO THINK ABOUT THIS OTHER WAY
      // linuxParameters: linux,
      logging: LogDriver.awsLogs({
        streamPrefix: "steps-s3-copy",
        logRetention: RetentionDays.ONE_WEEK,
      }),
      // eg the equivalent of
      // RCLONE_CONFIG_S3_TYPE=s3 RCLONE_CONFIG_S3_PROVIDER=AWS RCLONE_CONFIG_S3_ENV_AUTH=true RCLONE_CONFIG_S3_REGION=ap-southeast-2 rclone copy src dest
      environment: {
        RCLONE_CONFIG_S3_TYPE: "s3",
        RCLONE_CONFIG_S3_PROVIDER: "AWS",
        RCLONE_CONFIG_S3_ENV_AUTH: "true",
        RCLONE_CONFIG_S3_REGION: Stack.of(this).region,
        // we already establish the sourceBucket exists - so we don't want rclone to also check on each copy
        RCLONE_S3_NO_CHECK_BUCKET: "true",
      },
    });

    const success = new Succeed(this, "Succeed");
    const fail = new Fail(this, "Fail Wrong Bucket Region");

    // jsonata representing all input values to the state machine but with defaults for absent fields
    const defaultsJsonata: { [K in keyof StepsS3CopyInput]: string } = {
      maxItemsPerBatch:
        "{% [ $number($states.input.maxItemsPerBatch), 8 ][0] %}",
      copyConcurrency:
        "{% [ $number($states.input.copyConcurrency), 80 ][0] %}",
      requiredRegion: `{% [ $states.input.requiredRegion, "${
        Stack.of(this).region
      }" ][0] %}`,

      sourceFilesCsvKey: "{% $states.input.sourceFilesCsvKey %}",
      destinationBucket: "{% $states.input.destinationBucket %}",
      // by default, we just copy into the top level of the destination sourceBucket
      destinationPrefixKey: `{% [ $states.input.destinationPrefixKey, "" ][0] %}`,

      workingBucket: props.workingBucket,
      workingPrefixKey: props.workingBucketPrefixKey ?? "",

      // these are the default objects that will be created in the destination prefix area
      destinationStartCopyRelativeKey: `{% [ $states.input.destinationStartCopyRelativeKey, "STARTED_COPY.txt" ][0] %}`,
      destinationEndCopyRelativeKey: `{% [ $states.input.destinationEndCopyRelativeKey, "ENDED_COPY.csv" ][0] %}`,
    };

    const assignInputsAndApplyDefaults = new Pass(
      this,
      "Assign Inputs to State and Apply Defaults",
      {
        queryLanguage: QueryLanguage.JSONATA,
        // assign our inputs into the states machine state - whilst also providing
        // defaults
        assign: defaultsJsonata,
      },
    );

    const canWriteLambdaStep = new CanWriteLambdaStepConstruct(
      this,
      "CanWrite",
      {
        writerRole: writerRole,
        requiredRegion: Stack.of(this).region,
      },
    );

    const canWriteStep = canWriteLambdaStep.invocableLambda;

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

    const headObjectsMap = new HeadObjectsMapConstruct(this, "HeadObjects", {
      writerRole: writerRole,
      workingBucket: props.workingBucket,
      workingBucketPrefixKey: props.workingBucketPrefixKey ?? "",
      aggressiveTimes: props.aggressiveTimes,
    });

    const coordinateCopyLambdaStep = new CoordinateCopyLambdaStepConstruct(
      this,
      "CoordinateCopy",
      {
        writerRole: writerRole,
        workingBucket: props.workingBucket,
        workingBucketPrefixKey: props.workingBucketPrefixKey ?? "",
      },
    );

    const smallRcloneMap = new RcloneMapConstruct(this, "Small", {
      vpc: props.vpc,
      vpcSubnetSelection: props.vpcSubnetSelection,
      writerRole: writerRole,
      workingBucket: props.workingBucket,
      workingBucketPrefixKey: props.workingBucketPrefixKey ?? "",
      inputPath: "$coordinateCopyResults.small",
      taskDefinition: taskDefinition,
      containerDefinition: containerDefinition,
    });

    const largeRcloneMap = new RcloneMapConstruct(this, "Large", {
      vpc: props.vpc,
      vpcSubnetSelection: props.vpcSubnetSelection,
      writerRole: writerRole,
      workingBucket: props.workingBucket,
      workingBucketPrefixKey: props.workingBucketPrefixKey ?? "",
      inputPath: "$coordinateCopyResults.large",
      taskDefinition: taskDefinition,
      containerDefinition: containerDefinition,
    });

    const thawObjectsMap = new ThawObjectsMapConstruct(this, "ThawObjects", {
      writerRole: writerRole,
      workingBucket: props.workingBucket,
      workingBucketPrefixKey: props.workingBucketPrefixKey ?? "",
      aggressiveTimes: props.aggressiveTimes,
    });

    const summariseCopyLambdaStep = new SummariseCopyLambdaStepConstruct(
      this,
      "SummariseCopy",
      {
        writerRole: writerRole,
        workingBucket: props.workingBucket,
        workingBucketPrefixKey: props.workingBucketPrefixKey ?? "",
      },
    );

    const rclones = new Parallel(this, "RcloneParallel", {}).branch(
      largeRcloneMap.distributedMap,
      smallRcloneMap.distributedMap,
    );

    const definition = ChainDefinitionBody.fromChainable(
      assignInputsAndApplyDefaults
        .next(canWriteStep)
        .next(headObjectsMap.distributedMap)
        .next(coordinateCopyLambdaStep.invocableLambda)
        .next(rclones)
        //.next(thawObjectsMap.distributedMap)
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

    headObjectsMap.distributedMap.grantNestedPermissions(this._stateMachine);
    thawObjectsMap.distributedMap.grantNestedPermissions(this._stateMachine);
    smallRcloneMap.distributedMap.grantNestedPermissions(this._stateMachine);
    largeRcloneMap.distributedMap.grantNestedPermissions(this._stateMachine);

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

  public get stateMachine() {
    return this._stateMachine;
  }
}
