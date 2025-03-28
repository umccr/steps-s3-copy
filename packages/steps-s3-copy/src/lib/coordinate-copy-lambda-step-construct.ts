import { Construct } from "constructs";
import { Role } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { join } from "node:path";
import { JsonPath, TaskInput } from "aws-cdk-lib/aws-stepfunctions";

type Props = {
  readonly writerRole: Role;

  readonly workingBucket: string;
  readonly workingBucketPrefixKey: string;
};

/**
 */
export class CoordinateCopyLambdaStepConstruct extends Construct {
  public readonly invocableLambda;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const lambdaFolder = join(
      __dirname,
      "..",
      "..",
      "lambda",
      "coordinate-copy-lambda",
    );

    const coordinateCopyLambda = new NodejsFunction(
      this,
      "CoordinateCopyFunction",
      {
        role: props.writerRole,
        entry: join(lambdaFolder, "coordinate-copy-lambda.ts"),
        // note we need to specify this or else it attempts to use the top-level pnpm lock files
        depsLockFilePath: join(lambdaFolder, "package-lock.json"),
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        // possibly this function needs to load some larger (GiB?) manifest files so we give it plenty
        // of time, though I expect it till not need this most of the time
        timeout: Duration.seconds(30),
        // similarly for memory, it may have to put an entire (GiB?) manifest in memory
        memorySize: 8192,
        handler: "handler",
        bundling: {
          minify: false,
          // because we install node_modules we want to force the installation in a lambda compatible env
          forceDockerBundling: true,
          // we have difficulty bundling nodejs-polars due to esbuild not understanding
          // *.node binary files in the dependent arch/platform builds - so we
          // declare the parent npm package to be external *and* a module to install
          // this means that the reference to nodejs-polars is left unchanged by esbuild, *and*
          // we npm install nodejs-polars which brings in the large platform dependent binaries
          externalModules: ["nodejs-polars"],
          nodeModules: ["nodejs-polars"],
        },
        environment: {
          WORKING_BUCKET: props.workingBucket,
          WORKING_BUCKET_PREFIX_KEY: props.workingBucketPrefixKey,
        },
      },
    );

    this.invocableLambda = new LambdaInvoke(
      this,
      `Coordinate Inputs into Copy Sets`,
      {
        lambdaFunction: coordinateCopyLambda,
        payload: TaskInput.fromJsonPathAt("$headObjectsResults"),
        assign: {
          "coordinateCopyResults.$": "$.Payload",
        },
        resultPath: JsonPath.DISCARD,
      },
    );
  }
}
