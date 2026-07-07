import { Construct } from "constructs";
import {
  DistributedMap,
  ItemBatcher,
  JitterType,
  JsonPath,
  OutputType,
  ResultWriterV2,
  S3JsonLItemReader,
  StateGraph,
  Transformation,
  Wait,
  WaitTime,
  WriterConfig,
} from "aws-cdk-lib/aws-stepfunctions";
import { CopyRunTaskConstruct } from "./copy-run-task-construct";
import { SubnetType } from "aws-cdk-lib/aws-ec2";
import {
  ContainerDefinition,
  ICluster,
  TaskDefinition,
} from "aws-cdk-lib/aws-ecs";
import { Duration } from "aws-cdk-lib";
import { IRole } from "aws-cdk-lib/aws-iam";
import { S3JsonlDistributedMap } from "./s3-jsonl-distributed-map";
import { ThawObjectsLambdaStepConstruct } from "./thaw-lambda-step-construct";
import {
  CopyErrorName,
  invokeArg,
  invokeSetting,
} from "../steps-s3-copy-input";

type Props = {
  readonly cluster: ICluster;
  readonly clusterVpcSubnetSelection: SubnetType;

  readonly writerRole: IRole;

  readonly inputPath: string;

  readonly maxItemsPerBatch: number;
  readonly maxConcurrency: number;

  readonly taskDefinition: TaskDefinition;
  readonly containerDefinition: ContainerDefinition;

  readonly addThawStep?: boolean;
  readonly aggressiveTimes?: boolean;
};

export class CopyMapConstruct extends Construct {
  public readonly distributedMap: S3JsonlDistributedMap;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    // we are passed in a desired maxConcurrency in our props
    // however - we need to fit in with the limits imposed by ECS/Fargate regarding
    // launch rates. So we introduce our own jitter for starting/

    // Rate of tasks launched by a service on AWS Fargate
    // Each supported Region: 500
    // Adjustable: No
    // The maximum number of tasks that can be provisioned per service per minute on Fargate by the Amazon ECS service scheduler.

    const TASK_LAUNCH_NUMBER = 500.0;
    const TASK_LAUNCH_PER_SECONDS = 60;

    const waitWindow =
      Math.floor(
        (props.maxConcurrency / TASK_LAUNCH_NUMBER) * TASK_LAUNCH_PER_SECONDS,
      ) + 1;

    const delayStep = Wait.jsonata(this, id + "StartJitterDelay", {
      time: WaitTime.seconds(`{% $floor($random() * ${waitWindow}) %}`),
    });

    /**
     * Adds a thawing step if needed, with retries on IsThawingError.
     * Otherwise, skips straight to the delay step before copying.
     */

    let entryState;

    if (props.addThawStep) {
      const thawStep = new ThawObjectsLambdaStepConstruct(
        this,
        id + "ThawLambda",
        {
          writerRole: props.writerRole,
        },
      );

      const interval = props.aggressiveTimes
        ? Duration.minutes(1)
        : Duration.hours(1);
      const maxAttempts = props.aggressiveTimes ? 3 : 50;

      thawStep.invocableLambda.addRetry({
        errors: ["IsThawingError"],
        interval: interval,
        backoffRate: 1,
        maxAttempts: maxAttempts,
      });

      thawStep.invocableLambda.next(delayStep);

      entryState = thawStep.invocableLambda;
    } else {
      entryState = delayStep;
    }

    const copyRunTask = new CopyRunTaskConstruct(this, id + "CopyFargateTask", {
      writerRole: props.writerRole,
      fargateCluster: props.cluster,
      vpcSubnetSelection: props.clusterVpcSubnetSelection,
      taskDefinition: props.taskDefinition,
      containerDefinition: props.containerDefinition,
    }).ecsRunTask;

    // If the copy batch task returns an error, then this should not be retried.
    copyRunTask.addRetry({
      errors: [CopyErrorName],
      maxAttempts: 0,
    });

    // our task is an idempotent copy operation, so we can retry if we happen to get killed
    // (possible given we might be using Spot fargate)
    copyRunTask.addRetry({
      errors: ["States.TaskFailed"],
      backoffRate: 2,
      maxAttempts: 5,
      interval: Duration.minutes(1),
      jitterStrategy: JitterType.FULL,
      maxDelay: Duration.minutes(5),
    });

    // we have a transient issue that sometimes the parent task token seems to just disappear
    // so we cannot actually send back heart beats or results (despite the Task actually running
    // fine and generating logs)
    copyRunTask.addRetry({
      errors: ["States.Timeout"],
      backoffRate: 2,
      maxAttempts: 5,
      interval: Duration.minutes(1),
      jitterStrategy: JitterType.FULL,
      maxDelay: Duration.minutes(5),
    });

    const graph = new StateGraph(entryState, `Map ${id} Iterator`);

    delayStep.next(copyRunTask);
    copyRunTask.bindToGraph(graph);

    // NOTE
    // NOTE
    // NOT USED YET - WE WANT TO MOVE TO THIS ASAP - BUT CURRENTLY THE resultWriterV2
    // DOES NOT ALLOW JSONATA IN THE BUCKET
    new DistributedMap(this, id + "BetterMap", {
      toleratedFailurePercentage: 0,
      itemReader: new S3JsonLItemReader({
        bucketNamePath: JsonPath.stringAt("$.bucket"),
        key: JsonPath.stringAt("$.key"),
      }),
      itemBatcher: new ItemBatcher({
        maxItemsPerBatchPath: invokeArg("maxItemsPerBatch"),
        batchInput: {
          "rcloneDestination.$": JsonPath.format(
            "s3:{}/{}",
            JsonPath.stringAt(invokeArg("destinationBucket")),
          ),
        },
      }),
      resultWriterV2: new ResultWriterV2({
        // bucket: JsonPath.stringAt("$invokeSettings.workingBucket"),
        prefix: JsonPath.stringAt("$mapResultWriterPrefix"),
        writerConfig: new WriterConfig({
          transformation: Transformation.FLATTEN,
          outputType: OutputType.JSONL,
        }),
      }),
    });

    this.distributedMap = new S3JsonlDistributedMap(this, id, {
      toleratedFailurePercentage: 0,
      maxItemsPerBatch: props.maxItemsPerBatch,
      maxConcurrency: props.maxConcurrency,
      batchInput: {
        "thawParams.$": invokeArg("thawParams"),
        "bucketDefinitions.$": invokeArg("bucketDefinitions"),
        "continueOnError.$": invokeArg("continueOnError"),
      },
      inputPath: props.inputPath,
      itemReader: {
        "Bucket.$": `$.bucket`,
        "Key.$": `$.key`,
      },
      itemSelector: {
        "bucket.$": JsonPath.stringAt("$$.Map.Item.Value.sourceBucket"),
        "key.$": JsonPath.stringAt("$$.Map.Item.Value.sourceKey"),
        "s.$": JsonPath.format(
          "s3://{}/{}",
          JsonPath.stringAt(`$$.Map.Item.Value.sourceBucket`),
          JsonPath.stringAt(`$$.Map.Item.Value.sourceKey`),
        ),
        "d.$": JsonPath.format(
          "s3://{}/{}",
          JsonPath.stringAt(invokeArg("destinationBucket")),
          JsonPath.stringAt(`$$.Map.Item.Value.destinationKey`),
        ),
      },
      iterator: graph,
      // we want to write out the data to S3 as it could be larger than fits in steps payloads
      resultWriter: {
        "Bucket.$": invokeSetting("workingBucket"),
        "Prefix.$": "$mapResultWriterPrefix",
      },
      resultSelector: {
        type: id,
        "mapRunArn.$": "$.MapRunArn",
        "manifestBucket.$": "$.ResultWriterDetails.Bucket",
        "manifestKey.$": "$.ResultWriterDetails.Key",
      },
    });
  }
}
