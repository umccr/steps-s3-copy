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
import {
  DESTINATION_BUCKET_FIELD_NAME,
  MAX_ITEMS_PER_BATCH_FIELD_NAME,
  SOURCE_FILES_CSV_KEY_FIELD_NAME,
} from "../steps-s3-copy-input";
import { Duration } from "aws-cdk-lib";
import { IRole } from "aws-cdk-lib/aws-iam";
import { S3JsonlDistributedMap } from "./s3-jsonl-distributed-map";

type Props = {
  readonly cluster: ICluster;
  readonly clusterVpcSubnetSelection: SubnetType;

  readonly writerRole: IRole;

  readonly inputPath: string;

  readonly maxItemsPerBatch: number;

  readonly taskDefinition: TaskDefinition;
  readonly containerDefinition: ContainerDefinition;
};

export class CopyMapConstruct extends Construct {
  public readonly distributedMap: S3JsonlDistributedMap;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    // Rate of tasks launched by a service on AWS Fargate
    // Each supported Region:
    // 500
    // Adjustable
    // No
    // The maximum number of tasks that can be provisioned per service per minute on Fargate by the Amazon ECS service scheduler.

    // we put some leeway in the launch number as we don't really know what else is happening in the account
    const TASK_LAUNCH_NUMBER = 500 - 50;
    const TASK_LAUNCH_PER_SECONDS = 60;

    const delayStep = Wait.jsonata(this, id + "StartJitterDelay", {
      time: WaitTime.seconds(
        `{% $floor($random() * ${TASK_LAUNCH_PER_SECONDS}) %}`,
      ),
    });

    const copyRunTask = new CopyRunTaskConstruct(this, id + "CopyFargateTask", {
      writerRole: props.writerRole,
      fargateCluster: props.cluster,
      vpcSubnetSelection: props.clusterVpcSubnetSelection,
      taskDefinition: props.taskDefinition,
      containerDefinition: props.containerDefinition,
    }).ecsRunTask;

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

    const graph = new StateGraph(delayStep, `Map ${id} Iterator`);

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
        maxItemsPerBatchPath: `$invokeArguments.${MAX_ITEMS_PER_BATCH_FIELD_NAME}`,
        batchInput: {
          "rcloneDestination.$": JsonPath.format(
            "s3:{}/{}",
            JsonPath.stringAt(
              `$invokeArguments.${DESTINATION_BUCKET_FIELD_NAME}`,
            ),
            //JsonPath.stringAt(
            //    `$invokeArguments.${DESTINATION_FOLDER_KEY_FIELD_NAME}`,
            //),
          ),
        },
      }),
      resultWriterV2: new ResultWriterV2({
        // bucket: JsonPath.stringAt("$invokeSettings.workingBucket"),
        prefix: JsonPath.format(
          "{}{}",
          JsonPath.stringAt("$invokeSettings.workingBucketPrefixKey"),
          JsonPath.stringAt(
            `$invokeArguments.${SOURCE_FILES_CSV_KEY_FIELD_NAME}`,
          ),
        ),
        writerConfig: new WriterConfig({
          transformation: Transformation.FLATTEN,
          outputType: OutputType.JSONL,
        }),
      }),
    });

    this.distributedMap = new S3JsonlDistributedMap(this, id + "CopyMap", {
      toleratedFailurePercentage: 0,
      maxItemsPerBatch: props.maxItemsPerBatch,
      maxConcurrency: TASK_LAUNCH_NUMBER,
      batchInput: undefined,
      inputPath: props.inputPath,
      itemReader: {
        "Bucket.$": `$.bucket`,
        "Key.$": `$.key`,
      },
      itemSelector: {
        "s.$": JsonPath.format(
          "s3://{}/{}",
          JsonPath.stringAt(`$$.Map.Item.Value.sourceBucket`),
          JsonPath.stringAt(`$$.Map.Item.Value.sourceKey`),
        ),
        "d.$": JsonPath.format(
          "s3://{}/{}",
          JsonPath.stringAt(
            `$invokeArguments.${DESTINATION_BUCKET_FIELD_NAME}`,
          ),
          JsonPath.stringAt(`$$.Map.Item.Value.destinationKey`),
        ),
      },
      iterator: graph,
      // we want to write out the data to S3 as it could be larger than fits in steps payloads
      resultWriter: {
        "Bucket.$": "$invokeSettings.workingBucket",
        "Prefix.$": JsonPath.format(
          "{}{}",
          JsonPath.stringAt("$invokeSettings.workingBucketPrefixKey"),
          JsonPath.stringAt(
            `$invokeArguments.${SOURCE_FILES_CSV_KEY_FIELD_NAME}`,
          ),
        ),
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
