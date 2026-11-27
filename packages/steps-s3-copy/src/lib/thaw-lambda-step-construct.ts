import { Construct } from "constructs";
import { Effect, IRole, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import {
  Choice,
  Condition,
  Fail,
  IChainable,
  State,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
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
 * storage) and if not, triggers a restore on them. It returns
 * the number of files still thawing as ThawingCount.
 *
 * Use buildWaitLoop() to wait for thawing to finish, by looping
 * (Wait then call again) while ThawingCount is above zero.
 */
export class ThawObjectsLambdaStepConstruct extends Construct {
  public readonly invocableLambda;
  public readonly lambdaFunction;

  /**
   * Chains this step to `next`, looping with a Wait while any objects are
   * still thawing. Fails the batch if it is still thawing after too many passes.
   *
   * @returns the state to use as the entry point
   */
  public buildWaitLoop(next: IChainable, aggressiveTimes?: boolean): State {
    const interval = aggressiveTimes ? Duration.minutes(1) : Duration.hours(1);
    // The slowest documented restore is Bulk on Deep Archive, within 48 hours (AWS S3 docs).
    // Objects over 5 TB restore more slowly, but S3 objects are limited to 5 TB, so we ignore that.
    // The cap is just over that, and it also guards against looping forever.
    const maxPasses = aggressiveTimes ? 3 : 50;

    const wait = new Wait(this, this.node.id + "WaitForThaw", {
      time: WaitTime.duration(interval),
    });
    const tooLong = new Fail(this, this.node.id + "ThawTimedOut", {
      error: "ThawTimedOut",
      cause: `Objects were still thawing after ${maxPasses} checks`,
    });
    const choice = Choice.jsonata(this, this.node.id + "StillThawing")
      .when(Condition.jsonata("{% $states.input.ThawingCount = 0 %}"), next)
      .when(
        Condition.jsonata(`{% $states.input.ThawPass >= ${maxPasses} %}`),
        tooLong,
      )
      .otherwise(wait);

    wait.next(this.invocableLambda);
    this.invocableLambda.next(choice);
    return this.invocableLambda;
  }

  constructor(scope: Construct, id: string, _props: Props) {
    super(scope, id);

    const packageRoot = join(__dirname, "..", "..");

    const lambdaFolder = join(packageRoot, "lambda", "can-read-objects-lambda");

    const thawObjectsLambda = new NodejsFunction(this, "ThawObjectsFunction", {
      // our pre-made role will have the ability to read objects
      role: _props.writerRole,
      entry: join(lambdaFolder, "can-read-objects-lambda.ts"),
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
