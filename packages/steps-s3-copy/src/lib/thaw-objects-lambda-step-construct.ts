import { Construct } from "constructs";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { join } from "path";

type Props = {};

/**
 * A construct for a Steps function that tests if a set
 * of input files are available for copying (i.e. in active
 * storage) and if not, triggers a restore on them. Whenever
 * any input file is not available - this lambda throws a
 * IsThawingError (at the end of processing all of them).
 *
 * It can then be used in a loop waiting
 * for thawing to finish - by Retry/Catching this error.
 */
export class ThawObjectsLambdaStepConstruct extends Construct {
  public readonly invocableLambda;

  constructor(scope: Construct, id: string, _props: Props) {
    super(scope, id);

    const thawObjectsLambda = new NodejsFunction(this, "ThawObjectsFunction", {
      entry: join(
        __dirname,
        "..",
          "..",
        "lambda",
        "thaw-objects-lambda",
        "thaw-objects-lambda.ts",
      ),
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      bundling: {
        // for a small method it is sometimes easier if it can be viewed
        // in the AWS console un-minified
        minify: false,
      },
      // we can theoretically need to loop through 1000s of objects
      // so we give ourselves plenty of time
      timeout: Duration.seconds(60 * 5),
    });

    thawObjectsLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:GetObject", "s3:RestoreObject"],
        resources: ["*"],
      }),
    );

    this.invocableLambda = new LambdaInvoke(
      this,
      `Are The Objects Available To Copy?`,
      {
        lambdaFunction: thawObjectsLambda,
        resultPath: JsonPath.DISCARD,
      },
    );
  }
}
