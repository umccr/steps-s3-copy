import { Construct } from "constructs";
import { Effect, IRole, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { join } from "node:path";

type Props = {
  readonly writerRole: IRole;
};

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
  public readonly lambdaFunction;

  constructor(scope: Construct, id: string, _props: Props) {
    super(scope, id);

    const thawObjectsLambda = new NodejsFunction(this, "ThawObjectsFunction", {
      // our pre-made role will have the ability to read objects
      role: _props.writerRole,
      entry: join(
        __dirname,
        "..",
        "..",
        "lambda",
        "can-read-objects-lambda",
        "can-read-objects-lambda.ts",
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
      timeout: Duration.minutes(5),
    });

    this.lambdaFunction = thawObjectsLambda;

    thawObjectsLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:GetObject", "s3:RestoreObject"],
        resources: ["*"],
      }),
    );

    this.invocableLambda = new LambdaInvoke(this, id, {
      lambdaFunction: thawObjectsLambda,
      // Keep only the Lambda return value (the original event) to pass the next step
      outputPath: "$.Payload",
    });
  }
}
