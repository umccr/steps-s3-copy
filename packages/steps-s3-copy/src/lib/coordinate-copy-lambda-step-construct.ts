import { Construct } from "constructs";
import { IRole } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { join } from "node:path";
import { QueryLanguage, TaskInput } from "aws-cdk-lib/aws-stepfunctions";

type Props = {
  readonly writerRole: IRole;
};

/**
 */
export class CoordinateCopyLambdaStepConstruct extends Construct {
  public readonly invocableLambda;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const packageRoot = join(__dirname, "..", "..");
    const lambdaFolder = join(packageRoot, "lambda", "coordinate-copy-lambda");

    // nodejs-polars ships architecture-specific native .node binaries, so it is
    // kept out of the esbuild bundle which would fail. It uses a docker bundler
    // instead.
    const coordinateCopyLambda = new NodejsFunction(
      this,
      "CoordinateCopyFunction",
      {
        projectRoot: packageRoot,
        role: props.writerRole,
        entry: join(lambdaFolder, "coordinate-copy-lambda.ts"),
        depsLockFilePath: join(packageRoot, "bun.lock"),
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        handler: "handler",
        bundling: {
          minify: false,
          forceDockerBundling: true,
          nodeModules: ["nodejs-polars", "tmp", "@aws-sdk/lib-storage"],
          platform: "linux/arm64",
        },
        // possibly this function needs to load some larger (GiB?) manifest files so we give it plenty
        // of time, though I expect it till not need this most of the time
        timeout: Duration.minutes(5),
        // similarly for memory, it may have to put an entire (GiB?) manifest in memory
        memorySize: 8192,
      },
    );

    this.invocableLambda = new LambdaInvoke(
      this,
      `Coordinate Inputs into Copy Sets`,
      {
        lambdaFunction: coordinateCopyLambda,
        queryLanguage: QueryLanguage.JSONATA,
        payload: TaskInput.fromObject({
          invokeArguments: "{% $invokeArguments %}",
          invokeSettings: "{% $invokeSettings %}",
          headObjectsResults: "{% $headObjectsResults %}",
        }),
        // note we use payloadResponseOnly so that $states.result is the data we want to store
        payloadResponseOnly: true,
        assign: {
          coordinateCopyResults: "{% $states.result %}",
        },
      },
    );
  }
}
