import { Construct } from "constructs";
import { Role } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { join } from "node:path";

type SummariseCopyLambdaStepProps = {
  writerRole: Role;

  workingBucket: string;
  workingBucketPrefixKey: string;
};

/**
 * A construct for a Steps orchestration that collates
 * the distributed map results from a steps execution
 * (SUCCEEDED_0.json etc) into a text file
 * that is then written to the destination bucket to show what
 * was copied.
 */
export class SummariseCopyLambdaStepConstruct extends Construct {
  public readonly invocableLambda;

  constructor(
    scope: Construct,
    id: string,
    props: SummariseCopyLambdaStepProps,
  ) {
    super(scope, id);

    const root = join(__dirname, "..", "..", "lambda", "summarise-copy-lambda");

    const summariseCopyLambda = new NodejsFunction(
      this,
      "SummariseCopyFunction",
      {
        role: props.writerRole,
        entry: join(root, "summarise-copy-lambda.ts"),
        depsLockFilePath: join(root, "package-lock.json"),
        runtime: Runtime.NODEJS_20_X,
        architecture: Architecture.ARM_64,
        handler: "handler",
        bundling: {
          // we don't exactly need the performance benefits of minifying, and it is easier to debug without
          minify: false,
          // because we install node_modules we want to force the installation in a lambda compatible env
          forceDockerBundling: true,
          // and these are the modules we need to install
          nodeModules: ["csv-stringify"],
          platform: "arm",
        },
        environment: {
          WORKING_BUCKET: props.workingBucket,
          WORKING_BUCKET_PREFIX_KEY: props.workingBucketPrefixKey,
        },
        // this seems like plenty of seconds to do a few API calls to S3
        timeout: Duration.seconds(30),
      },
    );

    this.invocableLambda = new LambdaInvoke(this, `Summarise Copy Results`, {
      lambdaFunction: summariseCopyLambda,
      resultPath: JsonPath.DISCARD,
    });
  }
}
