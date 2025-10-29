import { Construct } from "constructs";
import { IRole } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { join } from "node:path";
import { QueryLanguage, TaskInput } from "aws-cdk-lib/aws-stepfunctions";

type SummariseCopyLambdaStepProps = {
  writerRole: IRole;
};

/**
 * A construct for a Steps orchestration that collates
 * the distributed map results from a steps execution
 * (SUCCEEDED_0.json etc) into a text file
 * that is then written to the destination sourceBucket to show what
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

    const lambdaRoot = join(
      __dirname,
      "..",
      "..",
      "lambda",
      "summarise-copy-lambda",
    );

    const summariseCopyLambda = new NodejsFunction(
      this,
      "SummariseCopyFunction",
      {
        role: props.writerRole,
        entry: join(lambdaRoot, "summarise-copy-lambda.ts"),
        depsLockFilePath: join(lambdaRoot, "package-lock.json"),
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.X86_64,
        handler: "handler",
        bundling: {
          // we don't exactly need the performance benefits of minifying, and it is easier to debug without
          minify: false,
          // because we install node_modules we want to force the installation in a lambda compatible env
          forceDockerBundling: true,
          // and these are the modules we need to install
          nodeModules: ["csv-stringify"],
          commandHooks: {
            beforeBundling(inputDir: string, outputDir: string) {
              // inputDir === packages/steps-s3-copy/lambda/summarise-copy-lambda (mounted as /asset-input)
              // outputDir === /asset-output
              return [
                `cp "${inputDir}/report_template.html" "${outputDir}/report_template.html"`,
              ];
            },
            afterBundling() {
              return [];
            },
            beforeInstall() {
              return [];
            },
          },
        },
        // in practice we hit the limits when using default values here - so we have set these to very generous
        // amounts
        timeout: Duration.minutes(5),
        memorySize: 4096,
      },
    );

    this.invocableLambda = new LambdaInvoke(this, `Summarise Copy Results`, {
      lambdaFunction: summariseCopyLambda,
      queryLanguage: QueryLanguage.JSONATA,
      payload: TaskInput.fromObject({
        invokeArguments: "{% $invokeArguments %}",
        invokeSettings: "{% $invokeSettings %}",
        destinationBucket: "{% $invokeArguments.destinationBucket %}",
        destinationPrefixKey: "{% $invokeArguments.destinationFolderKey %}",
        destinationEndCopyRelativeKey:
          "{% $invokeArguments.destinationEndCopyRelativeKey %}",
        workingBucket: "{% $invokeSettings.workingBucket %}",
        rcloneResultsSmall: "{% $states.input[type='Small'] %}",
        rcloneResultsLarge: "{% $states.input[type='Large'] %}",
        rcloneResultsNeedThawSmall: "{% $states.input[type='NeedThawSmall'] %}",
        rcloneResultsNeedThawLarge: "{% $states.input[type='NeedThawLarge'] %}",
      }),
      payloadResponseOnly: true,
    });
  }
}
