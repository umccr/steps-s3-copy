import { Construct } from "constructs";
import { Role} from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { join } from "path";

type CanWriteLambdaStepProps = {
  writerRole: Role,

  requiredRegion: string;

  /**
   * If true, will allow this CanWrite lambda to test a bucket that is
   * in the same account. Otherwise, and by default, the CanWrite lambda
   * is set up to not be able to test a bucket in the same account as it
   * is installed. This is a security mechanism as writes to buckets in the
   * same account is allowed implicitly but is dangerous. This should only
   * be set to true for development/testing.
   */
  allowWriteToThisAccount?: boolean;
};

/**
 * A construct for a Steps function that tests whether an S3
 * bucket exists, is in the correct region, and is writeable
 * by us. Throws an exception if any of these conditions is not met.
 */
export class CanWriteLambdaStepConstruct extends Construct {
  public readonly invocableLambda;

  constructor(scope: Construct, id: string, props: CanWriteLambdaStepProps) {
    super(scope, id);

    const canWriteLambda = new NodejsFunction(this, "CanWriteFunction", {
      role: props.writerRole,
      entry: join(
        __dirname,
        "..",
          "..",
        "lambda",
        "can-write-lambda",
        "can-write-lambda.ts",
      ),
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      bundling: {
        minify: false,
      },
      // this seems like plenty of seconds to do a few API calls to S3
      timeout: Duration.seconds(30),
    });

    /*canWriteLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:PutObject"],
        resources: ["*"],
        // yes - that's right - we want to give this lambda the ability to attempt the writes anywhere
        // EXCEPT where we are deployed
        // (under the assumption that buckets outside our account must be giving us explicit write permission,
        //  whilst within our account we get implicit access - in this case we don't want that ability)
        conditions: props.allowWriteToThisAccount
          ? undefined
          : {
              StringNotEquals: {
                "s3:ResourceAccount": [Stack.of(this).account],
              },
            },
      }),
    ); */

    this.invocableLambda = new LambdaInvoke(
      this,
      `Can Write To Destination Bucket?`,
      {
        lambdaFunction: canWriteLambda,
        resultPath: JsonPath.DISCARD,
      },
    );
  }
}
