import { Construct } from "constructs";
import { JsonPath, StateGraph } from "aws-cdk-lib/aws-stepfunctions";
import {
  DESTINATION_BUCKET_FIELD_NAME,
  COPY_INSTRUCTIONS_KEY_FIELD_NAME,
} from "../steps-s3-copy-input";
import { IRole } from "aws-cdk-lib/aws-iam";
import { S3JsonlDistributedMap } from "./s3-jsonl-distributed-map";
import { State } from "aws-cdk-lib/aws-stepfunctions";
import { ThawObjectsLambdaStepConstruct } from "./thaw-lambda-step-construct";
import { Duration } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import {
  DockerImageCode,
  DockerImageFunction,
  Architecture,
  Function,
} from "aws-cdk-lib/aws-lambda";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { JitterType } from "aws-cdk-lib/aws-stepfunctions";
import { join } from "path";

type Props = {
  readonly writerRole: IRole;
  readonly inputPath: string;
  readonly maxItemsPerBatch: number;
  readonly addThawStep?: boolean;
  readonly aggressiveTimes?: boolean;
};

/**
 * A construct that creates a Steps Distributed Map for performing
 * copies of small files
 */
export class SmallObjectsCopyMapConstruct extends Construct {
  public readonly distributedMap: S3JsonlDistributedMap;
  public readonly stateName: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);
    this.stateName = id + "Copy";

    const copyStep = new SmallCopyLambdaConstruct(
      this,
      id + "CopyLambda",
      props,
    );

    /**
     * Adds a thawing step if needed, with retries on IsThawingError.
     * Otherwise, skips straight to the delay step before copying.
     */

    let entryState: State;

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

      thawStep.invocableLambda.next(copyStep.invocableLambda);

      entryState = thawStep.invocableLambda;
    } else {
      entryState = copyStep.invocableLambda;
    }

    const graph = new StateGraph(entryState, `Map ${id} Iterator`);

    this.distributedMap = new S3JsonlDistributedMap(this, id, {
      toleratedFailurePercentage: 0,
      maxItemsPerBatch: props.maxItemsPerBatch,
      batchInput: {
        "thawParams.$": "$invokeArguments.thawParams",
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
            `$invokeArguments.${COPY_INSTRUCTIONS_KEY_FIELD_NAME}`,
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
/**
 */
export class SmallCopyLambdaConstruct extends Construct {
  public readonly invocableLambda;
  public readonly lambda: Function;
  public readonly stateName: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);
    this.stateName = id;

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
      // our pre-made role will have the ability to read source objects
      role: props.writerRole,
      code: code,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      // we can theoretically need to loop through lots of objects - and those object Heads etc may
      // be doing back-off/retries because of all the concurrent activity
      // so we give ourselves plenty of time
      timeout: Duration.minutes(15),
    });

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
