import { Construct } from "constructs";
import { IRole } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { readFileSync } from "node:fs";
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

    const pkg = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    );
    const polarsVersion: string | undefined =
      pkg.devDependencies?.["nodejs-polars"] ??
      pkg.dependencies?.["nodejs-polars"];
    if (!polarsVersion) {
      throw new Error("nodejs-polars version not found in package.json");
    }

    // nodejs-polars has native .node binaries, so it is removed from esbuild bundle. It's also intentionally only
    // a devDependency, so that it doesn't need to be a bundledDependency according to jsii. This means that it won't
    // unnecessarily bundle all architectures, and the NodejsFunction bundler doesn't mind finding it in
    // devDependencies.
    const coordinateCopyLambda = new NodejsFunction(
      this,
      "CoordinateCopyFunction",
      {
        role: props.writerRole,
        entry: join(lambdaFolder, "coordinate-copy-lambda.ts"),
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        // Set projectRoot to lambda/ directory to enable bundling of shared modules from lambda/common/
        // for example allowing all lambdas to import the constant defined in ../common/constants
        projectRoot: join(__dirname, "..", "..", "lambda"),
        // possibly this function needs to load some larger (GiB?) manifest files so we give it plenty
        // of time, though I expect it till not need this most of the time
        timeout: Duration.minutes(5),
        // similarly for memory, it may have to put an entire (GiB?) manifest in memory
        memorySize: 8192,
        handler: "handler",
        bundling: {
          minify: false,
          // because we install node_modules we want to force the installation in a lambda compatible env
          forceDockerBundling: true,
          // we have difficulty bundling nodejs-polars due to esbuild not understanding
          // *.node binary files in the dependent arch/platform builds - so we
          // declare the parent npm package to be a module to install this means that the reference to
          // nodejs-polars is left unchanged by esbuild, *and* we npm install nodejs-polars which brings in
          // the large platform dependent binaries
          externalModules: ["@aws-sdk/*", "nodejs-polars"],
          commandHooks: {
            beforeBundling() {
              return [];
            },
            beforeInstall() {
              return [];
            },
            afterBundling(_inputDir: string, outputDir: string) {
              return [
                `cd "${outputDir}" && npm install --no-save --omit=dev nodejs-polars@${polarsVersion}`,
              ];
            },
          },
        },
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
