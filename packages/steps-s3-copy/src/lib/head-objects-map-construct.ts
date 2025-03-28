import { Construct } from "constructs";
import { JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { Duration } from "aws-cdk-lib";
import { SOURCE_FILES_CSV_KEY_FIELD_NAME } from "../steps-s3-copy-input";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { IRole } from "aws-cdk-lib/aws-iam";
import { S3JsonlDistributedMap } from "./s3-jsonl-distributed-map";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { join } from "node:path";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";

type Props = {
  readonly writerRole: IRole;

  readonly workingBucket: string;
  readonly workingBucketPrefixKey: string;

  readonly aggressiveTimes?: boolean;
};

/**
 * A construct that creates a Steps Distributed Map for performing HEAD
 * on a set of S3 object keys.
 */
export class HeadObjectsMapConstruct extends Construct {
  public readonly distributedMap: S3JsonlDistributedMap;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const headObjectsLambdaStep = new HeadObjectsLambdaStepConstruct(
      this,
      "LambdaStep",
      props,
    );

    this.distributedMap = new S3JsonlDistributedMap(this, "HeadObjectsMap", {
      // this phase is used to detect errors so we have zero tolerance for files being missing (for instance)
      toleratedFailurePercentage: 0,
      batchMaxItems: 128,
      itemReader: {
        Bucket: props.workingBucket,
        "Key.$": JsonPath.format(
          "{}{}",
          props.workingBucketPrefixKey,
          JsonPath.stringAt(`$.${SOURCE_FILES_CSV_KEY_FIELD_NAME}`),
        ),
      },
      iterator: headObjectsLambdaStep.invocableLambda,
      resultWriter: {
        Bucket: props.workingBucket,
        "Prefix.$": JsonPath.format(
          "{}{}",
          props.workingBucketPrefixKey,
          JsonPath.stringAt(`$.${SOURCE_FILES_CSV_KEY_FIELD_NAME}`),
        ),
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

  constructor(scope: Construct, id: string, _props: Props) {
    super(scope, id);

    const headObjectsLambda = new NodejsFunction(this, "HeadObjectsFunction", {
      // our pre-made role will have the ability to read objects
      role: _props.writerRole,
      entry: join(
        __dirname,
        "..",
        "..",
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
      // we can theoretically need to loop through 1000s of objects - and those object Heads etc may
      // be doing back-off/retries because of all the concurrent activity
      // so we give ourselves plenty of time
      timeout: Duration.minutes(15),
    });

    this.invocableLambda = new LambdaInvoke(
      this,
      `Head Objects and Expand Wildcards`,
      {
        lambdaFunction: headObjectsLambda,
        outputPath: "$.Payload",
      },
    );
  }
}
