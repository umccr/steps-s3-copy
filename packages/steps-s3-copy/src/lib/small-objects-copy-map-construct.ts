import { Construct } from "constructs";
import {
  JitterType,
  JsonPath,
  StateGraph,
} from "aws-cdk-lib/aws-stepfunctions";
import { Duration } from "aws-cdk-lib";
import {
  DESTINATION_BUCKET_FIELD_NAME,
  SOURCE_FILES_CSV_KEY_FIELD_NAME,
} from "../steps-s3-copy-input";
import { IRole } from "aws-cdk-lib/aws-iam";
import { S3JsonlDistributedMap } from "./s3-jsonl-distributed-map";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { join } from "node:path";
import {
  Architecture,
  DockerImageCode,
  DockerImageFunction,
  Function,
} from "aws-cdk-lib/aws-lambda";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";

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

export class SmallObjectsCopyLambdaStepConstruct extends Construct {
  public readonly invocableLambda;
  public readonly lambda: Function;
  public readonly lambdaFunction: Function;
  public readonly stateName: string;

  constructor(
    scope: Construct,
    id: string,
    props: Props & { lambdaStateName: string },
  ) {
    super(scope, id);

    const code = DockerImageCode.fromImageAsset(
      join(__dirname, "..", "..", "docker", "copy-batch-docker-image"),
      {
        target: "lambda",
        platform: Platform.LINUX_ARM64,
        buildArgs: {
          provenance: "false",
        },
      },
    );

    this.lambda = new DockerImageFunction(this, "SmallObjectsCopyFunction", {
      role: props.writerRole,
      code: code,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.minutes(15),
    });

    this.lambdaFunction = this.lambda;
    this.stateName = props.lambdaStateName;

    this.invocableLambda = new LambdaInvoke(this, this.stateName, {
      lambdaFunction: this.lambda,
      payloadResponseOnly: true,
    });

    this.invocableLambda.addRetry({
      errors: ["SlowDown"],
      maxAttempts: 5,
      backoffRate: 2,
      interval: Duration.seconds(30),
      jitterStrategy: JitterType.FULL,
      maxDelay: Duration.minutes(2),
    });
  }
}
