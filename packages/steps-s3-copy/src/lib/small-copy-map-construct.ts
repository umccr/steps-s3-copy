import { Construct } from "constructs";
import { JsonPath, StateGraph } from "aws-cdk-lib/aws-stepfunctions";
import {
  DESTINATION_BUCKET_FIELD_NAME,
  SOURCE_FILES_CSV_KEY_FIELD_NAME,
} from "../steps-s3-copy-input";
import { IRole } from "aws-cdk-lib/aws-iam";
import { S3JsonlDistributedMap } from "./s3-jsonl-distributed-map";
import { SmallObjectsCopyLambdaStepConstruct } from "./small-copy-lambda-step-construct";

type Props = {
  readonly writerRole: IRole;
  readonly inputPath: string;
  readonly maxItemsPerBatch: number;
  readonly lambdaStateName: string;
};

/**
 * A construct that creates a Steps Distributed Map for performing
 * copies of small files
 */
export class SmallObjectsCopyMapConstruct extends Construct {
  public readonly distributedMap: S3JsonlDistributedMap;
  public readonly lambdaStep: SmallObjectsCopyLambdaStepConstruct;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    this.lambdaStep = new SmallObjectsCopyLambdaStepConstruct(
      this,
      "LambdaStep",
      props,
    );

    const graph = new StateGraph(
      this.lambdaStep.invocableLambda,
      `Map ${id} Iterator`,
    );

    this.distributedMap = new S3JsonlDistributedMap(this, id, {
      toleratedFailurePercentage: 0,
      maxItemsPerBatch: 128,
      batchInput: {},
      inputPath: props.inputPath,
      itemReader: {
        "Bucket.$": `$.bucket`,
        "Key.$": `$.key`,
      },
      iterator: graph,
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
