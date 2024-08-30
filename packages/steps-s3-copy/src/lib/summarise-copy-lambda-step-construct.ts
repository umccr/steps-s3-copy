import { Construct } from "constructs";
import { Role } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { join } from "node:path";

type SummariseCopyLambdaStepProps = {
  writerRole: Role;

  workingBucket: string;
  workingBucketPrefixKey: string;
};

/**
 * A construct for a Steps orchestration that collates
 * the distributed map results from a steps execution
 * (SUCCEEDED_0.json etc) into a text file
 * that is then written to the destination bucket to show what
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

    const summariseCopyLambda = new NodejsFunction(
      this,
      "SummariseCopyFunction",
      {
        role: props.writerRole,
        entry: join(
          __dirname,
          "..",
          "..",
          "lambda",
          "summarise-copy-lambda",
          "summarise-copy-lambda.ts",
        ),
        runtime: Runtime.NODEJS_20_X,
        handler: "handler",
        bundling: {
          // we don't exactly need the performance benefits of minifying, and it is easier to debug without
          minify: false,
        },
        environment: {
          WORKING_BUCKET: props.workingBucket,
          WORKING_BUCKET_PREFIX_KEY: props.workingBucketPrefixKey,
        },
        // this seems like plenty of seconds to do a few API calls to S3
        timeout: Duration.seconds(30),
      },
    );

    /*    summariseCopyLambda.addToRolePolicy(
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
    );

    // we need to be able to read the results created by Steps that it placed
    // in the working folder
    summariseCopyLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:*"],
        resources: ["*"],
        //[
        //`arn:aws:s3:::${props.workingBucket}/${
        //  props.workingBucketPrefixKey ?? ""
        //}*`,
        //],
      }),
    ); */

    this.invocableLambda = new LambdaInvoke(this, `Summarise Copy Results`, {
      lambdaFunction: summariseCopyLambda,
      resultPath: JsonPath.DISCARD,
    });
  }
}
