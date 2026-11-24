import { Construct } from "constructs";
import { JsonPath, StateGraph } from "aws-cdk-lib/aws-stepfunctions";
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
import { invokeArg, invokeSetting, Performance } from "../steps-s3-copy-input";

export type LambdaCopyMapProps = {
  readonly writerRole: IRole;
  readonly inputPath: string;
  /**
   * Memory in MiB of the copy Lambda. Note that Lambda network bandwidth scales with memory.
   */
  readonly memorySize: number;
  /**
   * Performance invoke argument that holds the batch size.
   */
  readonly batchSizeArg: keyof Performance;
  /**
   * Performance invoke argument that holds the concurrency.
   */
  readonly concurrencyArg: keyof Performance;
  readonly addThawStep?: boolean;
  readonly aggressiveTimes?: boolean;
};

/**
 * A template construct that creates a Steps Distributed Map for performing
 * copies using a Lambda. The size classes of objects (small, medium) extend this
 * to set their own memory, batch size and concurrency.
 *
 * The Lambda is deliberately not in a VPC as the scalable network bandwidth only
 * applies to Lambdas outside a VPC.
 */
export class LambdaCopyMapConstruct extends Construct {
  public readonly distributedMap: S3JsonlDistributedMap;
  public readonly stateName: string;

  constructor(scope: Construct, id: string, props: LambdaCopyMapProps) {
    super(scope, id);
    this.stateName = id + "Copy";

    const copyStep = new LambdaCopyFunctionConstruct(
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
      maxItemsPerBatchPath: invokeArg.performance(props.batchSizeArg),
      maxConcurrencyPath: invokeArg.performance(props.concurrencyArg),
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
/**
 */
export class LambdaCopyFunctionConstruct extends Construct {
  public readonly invocableLambda;
  public readonly lambda: Function;
  public readonly stateName: string;

  constructor(scope: Construct, id: string, props: LambdaCopyMapProps) {
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
      memorySize: props.memorySize,
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
