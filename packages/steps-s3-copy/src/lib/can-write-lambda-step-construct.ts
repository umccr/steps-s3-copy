import { Construct } from "constructs";
import { IRole } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Runtime, Function } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { join } from "node:path";
import { QueryLanguage, TaskInput } from "aws-cdk-lib/aws-stepfunctions";

type Props = {
  readonly writerRole: IRole;
};

/**
 * A construct for a Steps function that tests whether an S3
 * bucket exists, is in the correct region, and is writeable
 * by us. Throws an exception if any of these conditions is not met.
 */
export class CanWriteLambdaStepConstruct extends Construct {
  public readonly invocableLambda;
  public readonly lambda: Function;
  public readonly stateName: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const lambdaFolder = join(
      __dirname,
      "..",
      "..",
      "lambda",
      "can-write-lambda",
    );

    this.stateName = `Can Write To Destination Bucket?`;

    this.lambda = new NodejsFunction(this, "CanWriteFunction", {
      role: props.writerRole,
      entry: join(lambdaFolder, "can-write-lambda.ts"),
      runtime: Runtime.NODEJS_22_X,
      handler: "handler",
      bundling: {
        minify: false,
      },
      // this seems like plenty of seconds to do a few API calls to S3
      timeout: Duration.seconds(30),
    });

    this.invocableLambda = new LambdaInvoke(this, this.stateName, {
      lambdaFunction: this.lambda,
      queryLanguage: QueryLanguage.JSONATA,
      payload: TaskInput.fromObject({
        invokeArguments: "{% $invokeArguments %}",
        invokeSettings: "{% $invokeSettings %}",
      }),
      payloadResponseOnly: true,
    });
  }
}
