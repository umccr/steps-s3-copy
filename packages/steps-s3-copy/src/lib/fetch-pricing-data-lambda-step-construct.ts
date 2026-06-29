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

export class PricingDataLambdaStepConstruct extends Construct {
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
      "fetch-pricing-data-lambda",
    );

    this.stateName = "Fetch Pricing Data";

    this.lambda = new NodejsFunction(this, "FetchPricingDataFunction", {
      role: props.writerRole,
      entry: join(lambdaFolder, "fetch-pricing-data-lambda.ts"),
      runtime: Runtime.NODEJS_22_X,
      handler: "handler",
      bundling: { minify: false },
      timeout: Duration.seconds(60),
    });

    this.invocableLambda = new LambdaInvoke(this, this.stateName, {
      lambdaFunction: this.lambda,
      timeout: Duration.seconds(60),
      queryLanguage: QueryLanguage.JSONATA,
      payload: TaskInput.fromObject({
        invokeArguments: "{% $invokeArguments %}",
        invokeSettings: "{% $invokeSettings %}",
      }),
    });
  }
}
