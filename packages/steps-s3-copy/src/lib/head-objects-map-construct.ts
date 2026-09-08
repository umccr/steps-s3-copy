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
import { invokeArg, invokeSetting } from "../steps-s3-copy-input";

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
      // per-execution concurrency limit for HEADing source objects (defaults to effectively
      // uncapped). Lower it via performance.headConcurrency to be gentle on the source system.
      maxConcurrencyPath: invokeArg.performance("headConcurrency"),
      // batch size is intentionally fixed at 1 and not exposed via performance:
      // our main danger is the _results_ of the head operations exceeding our Steps/lambda limits
      // some simple maths - the "head" data for a single object is a maximum of 1k(ish)
      // so that means we can fit 256 of them in the standard Steps result payload (256kb)
      maxItemsPerBatch: 1,
      batchInput: {
        "destinationPrefix.$": JsonPath.stringAt(
          invokeArg("destinationPrefix"),
        ),
        maximumExpansion: 256,
        "bucketDefinitions.$": JsonPath.stringAt(
          invokeArg("bucketDefinitions"),
        ),
        "sourceRequiredRegion.$": JsonPath.stringAt(
          "$invokeArguments.sourceRequiredRegion",
        ),
        "destinationRequiredRegion.$": JsonPath.stringAt(
          "$invokeArguments.destinationRequiredRegion",
        ),
        "workingBucket.$": JsonPath.stringAt("$invokeSettings.workingBucket"),
        "workingBucketPrefix.$": JsonPath.stringAt(
          "$invokeSettings.workingBucketPrefix",
        ),
        "instructionsPrefix.$": JsonPath.stringAt(
          "$invokeArguments.instructionsPrefix",
        ),
      },
      itemReader: {
        "Bucket.$": invokeSetting("workingBucket"),
        "Key.$": JsonPath.format(
          "{}{}{}",
          JsonPath.stringAt(invokeSetting("workingBucketPrefix")),
          JsonPath.stringAt(invokeArg("instructionsPrefix")),
          JsonPath.stringAt(invokeArg("instructionsKey")),
        ),
      },
      iterator: graph,
      resultWriter: {
        "Bucket.$": invokeSetting("workingBucket"),
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
