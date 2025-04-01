import { Construct } from "constructs";
import { JitterType, JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { RcloneRunTaskConstruct } from "./rclone-run-task-construct";
import { IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  ContainerDefinition,
  TaskDefinition,
} from "aws-cdk-lib/aws-ecs";
import {
  DESTINATION_BUCKET_FIELD_NAME,
  DESTINATION_PREFIX_KEY_FIELD_NAME,
  MAX_ITEMS_PER_BATCH_FIELD_NAME,
  SOURCE_FILES_CSV_KEY_FIELD_NAME,
} from "../steps-s3-copy-input";
import { Duration } from "aws-cdk-lib";
import { IRole } from "aws-cdk-lib/aws-iam";
import { S3JsonlDistributedMap } from "./s3-jsonl-distributed-map";

type Props = {
  vpc: IVpc;
  vpcSubnetSelection: SubnetType;

  writerRole: IRole;

  inputPath: string;
  assign: Readonly<Record<string, string | JsonPath>> | undefined;

  taskDefinition: TaskDefinition;
  containerDefinition: ContainerDefinition;
};

export class RcloneMapConstruct extends Construct {
  public readonly distributedMap: S3JsonlDistributedMap;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const cluster = new Cluster(this, "FargateCluster", {
      vpc: props.vpc,
      enableFargateCapacityProviders: true,
    });

    const rcloneRunTask = new RcloneRunTaskConstruct(
      this,
      id + "RcloneFargateTask",
      {
        writerRole: props.writerRole,
        fargateCluster: cluster,
        vpcSubnetSelection: props.vpcSubnetSelection,
        taskDefinition: props.taskDefinition,
        containerDefinition: props.containerDefinition,
      },
    ).ecsRunTask;

    // our task is an idempotent copy operation, so we can retry if we happen to get killed
    // (possible given we are using Spot fargate)
    rcloneRunTask.addRetry({
      errors: ["States.TaskFailed"],
      maxAttempts: 3,
      interval: Duration.minutes(1),
      jitterStrategy: JitterType.FULL,
      maxDelay: Duration.minutes(5),
    });

    const bucketColumnName = "sourceBucket";
    const keyColumnName = "sourceKey";

    // {
    //   "BatchInput": {
    //     "rcloneDestination": "s3:cpg-cardiac-flagship-transfer/optionalpath"
    //   },
    //   "Items": [
    //     {
    //       "rcloneSource": "s3:sourceBucket/1.fastq.gz"
    //     },
    //     {
    //       "rcloneSource": "s3:sourceBucket/2.fastq.gz"
    //     },
    // }

    /*const dm = new DistributedMap(this, id + "RcloneMap", {
      toleratedFailurePercentage: 25,
      itemBatcher: new ItemBatcher({
        maxItemsPerBatchPath: `$invokeArguments.${MAX_ITEMS_PER_BATCH_FIELD_NAME}`,
        batchInput: {
          "rcloneDestination.$": JsonPath.format(
              "s3:{}/{}",
              JsonPath.stringAt(
                  `$invokeArguments.${DESTINATION_BUCKET_FIELD_NAME}`,
              ),
              JsonPath.stringAt(
                  `$invokeArguments.${DESTINATION_PREFIX_KEY_FIELD_NAME}`,
              ),
          ),
        }
      }),
      itemReader: new ItemRe({

      })



    }) */

    this.distributedMap = new S3JsonlDistributedMap(this, id + "RcloneMap", {
      toleratedFailurePercentage: 25,
      batchMaxItemsPath: `$invokeArguments.${MAX_ITEMS_PER_BATCH_FIELD_NAME}`,
      inputPath: props.inputPath,
      itemReader: {
        "Bucket.$": `$.bucket`,
        "Key.$": `$.key`,
      },
      itemSelector: {
        "rcloneSource.$": JsonPath.format(
          // note: this is not an s3:// URL, it is the peculiar syntax used by rclone
          "s3:{}/{}",
          JsonPath.stringAt(`$$.Map.Item.Value.${bucketColumnName}`),
          JsonPath.stringAt(`$$.Map.Item.Value.${keyColumnName}`),
        ),
      },
      batchInput: {
        "rcloneDestination.$": JsonPath.format(
          "s3:{}/{}",
          JsonPath.stringAt(
            `$invokeArguments.${DESTINATION_BUCKET_FIELD_NAME}`,
          ),
          JsonPath.stringAt(
            `$invokeArguments.${DESTINATION_PREFIX_KEY_FIELD_NAME}`,
          ),
        ),
      },
      iterator: rcloneRunTask,
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
      assign: props.assign,
    });
  }
}
