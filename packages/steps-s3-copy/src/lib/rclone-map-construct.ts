import { Construct } from "constructs";
import { JitterType, JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { S3CsvDistributedMap } from "./s3-csv-distributed-map";
import { RcloneRunTaskConstruct } from "./rclone-run-task-construct";
import { IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { Cluster } from "aws-cdk-lib/aws-ecs";
import {
  DESTINATION_BUCKET_FIELD_NAME,
  DESTINATION_PREFIX_KEY_FIELD_NAME,
  MAX_ITEMS_PER_BATCH_FIELD_NAME,
  SOURCE_FILES_CSV_KEY_FIELD_NAME,
} from "../steps-s3-copy-input";
import { Duration } from "aws-cdk-lib";
import {Role} from "aws-cdk-lib/aws-iam";

type Props = {
  vpc: IVpc;
  vpcSubnetSelection: SubnetType;

  writerRole: Role;

  workingBucket: string;
  workingBucketPrefixKey: string;
};

export class RcloneMapConstruct extends Construct {
  public readonly distributedMap: S3CsvDistributedMap;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const cluster = new Cluster(this, "FargateCluster", {
      vpc: props.vpc,
      enableFargateCapacityProviders: true,
    });

    const rcloneRunTask = new RcloneRunTaskConstruct(
      this,
      "RcloneFargateTask",
      {
        writerRole: props.writerRole,
        fargateCluster: cluster,
        vpcSubnetSelection: props.vpcSubnetSelection,
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

    // these names are internal only - but we pull out as a const to make sure
    // they are consistent
    const bucketColumnName = "b";
    const keyColumnName = "k";

    // {
    //   "BatchInput": {
    //     "rcloneDestination": "s3:cpg-cardiac-flagship-transfer/optionalpath"
    //   },
    //   "Items": [
    //     {
    //       "rcloneSource": "s3:bucket/1.fastq.gz"
    //     },
    //     {
    //       "rcloneSource": "s3:bucket/2.fastq.gz"
    //     },
    // }

    this.distributedMap = new S3CsvDistributedMap(this, "RcloneMap", {
      toleratedFailurePercentage: 25,
      batchMaxItemsPath: `$.${MAX_ITEMS_PER_BATCH_FIELD_NAME}`,
      itemReaderCsvHeaders: [bucketColumnName, keyColumnName],
      itemReader: {
        Bucket: props.workingBucket,
        "Key.$": JsonPath.format(
          "{}{}",
          props.workingBucketPrefixKey,
          JsonPath.stringAt(`$.${SOURCE_FILES_CSV_KEY_FIELD_NAME}`),
        ),
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
          JsonPath.stringAt(`$.${DESTINATION_BUCKET_FIELD_NAME}`),
          JsonPath.stringAt(`$.${DESTINATION_PREFIX_KEY_FIELD_NAME}`),
        ),
      },
      iterator: rcloneRunTask,
      resultWriter: {
        Bucket: props.workingBucket,
        "Prefix.$": JsonPath.format(
          "{}{}",
          props.workingBucketPrefixKey,
          JsonPath.stringAt(`$.${SOURCE_FILES_CSV_KEY_FIELD_NAME}`),
        ),
      },
      resultSelector: {
        "manifestAbsoluteKey.$": "$.ResultWriterDetails.Key",
      },
      resultPath: `$.rcloneResults`,
    });
  }
}
