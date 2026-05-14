import { Construct } from "constructs";
import {
  JitterType,
  JsonPath,
  StateGraph,
} from "aws-cdk-lib/aws-stepfunctions";
import { Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { IRole } from "aws-cdk-lib/aws-iam";
import { S3JsonlDistributedMap } from "./s3-jsonl-distributed-map";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { join } from "node:path";
import { Architecture, Function, Runtime } from "aws-cdk-lib/aws-lambda";

type Props = {
  readonly writerRole: IRole;

  readonly aggressiveTimes?: boolean;
};

/**
 * A construct that creates a Steps Distributed Map for performing HEAD
 * on a set of S3 object keys.
 */
export class HeadObjectsMapConstruct extends Construct {
  public readonly distributedMap: S3JsonlDistributedMap;
  public readonly lambdaStep: HeadObjectsLambdaStepConstruct;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    this.lambdaStep = new HeadObjectsLambdaStepConstruct(
      this,
      "LambdaStep",
      props,
    );

    const graph = new StateGraph(
      this.lambdaStep.invocableLambda,
      `Map ${id} Iterator`,
    );

    this.distributedMap = new S3JsonlDistributedMap(this, "HeadObjectsMap", {
      // this phase is used to detect errors so we have zero tolerance for files being missing (for instance)
      toleratedFailurePercentage: 0,
      // our main danger is the _results_ of the head operations exceeding our Steps/lambda limits
      // some simple maths - the "head" data for a single object is a maximum of 1k(ish)
      // so that means we can fit 256 of them in the standard Steps result payload (256kb)
      maxItemsPerBatch: 1,
      batchInput: {
        "destinationPrefix.$": JsonPath.stringAt(
          "$invokeArguments.destinationPrefix",
        ),
        maximumExpansion: 256,
        "bucketDefinitions.$": JsonPath.stringAt(
          "$invokeArguments.bucketDefinitions",
        ),
      },
      itemReader: {
        "Bucket.$": "$invokeSettings.workingBucket",
        "Key.$": JsonPath.format(
          "{}{}{}",
          JsonPath.stringAt("$invokeSettings.workingBucketPrefix"),
          JsonPath.stringAt("$invokeArguments.instructionsPrefix"),
          JsonPath.stringAt("$invokeArguments.instructionsKey"),
        ),
      },
      iterator: graph,
      resultWriter: {
        "Bucket.$": "$invokeSettings.workingBucket",
        "Prefix.$": "$mapResultWriterPrefix",
      },
      assign: {
        headObjectsResults: {
          "manifestBucket.$": "$.ResultWriterDetails.Bucket",
          "manifestAbsoluteKey.$": "$.ResultWriterDetails.Key",
        },
      },
      resultPath: JsonPath.DISCARD,
    });
  }
}

/**
 */
export class HeadObjectsLambdaStepConstruct extends Construct {
  public readonly invocableLambda;
  public readonly lambda: Function;
  public readonly stateName: string = `Head Objects and Expand Wildcards`;

  constructor(scope: Construct, id: string, _props: Props) {
    super(scope, id);

    const packageRoot = join(__dirname, "..", "..");

    this.lambda = new NodejsFunction(this, "HeadObjectsFunction", {
      // our pre-made role will have the ability to read source objects
      role: _props.writerRole,
      entry: join(
        packageRoot,
        "lambda",
        "head-objects-lambda",
        "head-objects-lambda.ts",
      ),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      handler: "handler",
      bundling: {
        // for a small method it is sometimes easier if it can be viewed
        // in the AWS console un-minified
        minify: false,
      },
      memorySize: 128,
      // we can theoretically need to loop through 1000s of objects - and those object Heads etc may
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
