import { Construct } from "constructs";
import { ThawObjectsLambdaStepConstruct } from "./thaw-lambda-step-construct";
import { Duration } from "aws-cdk-lib";
import { IRole } from "aws-cdk-lib/aws-iam";
import { S3JsonlDistributedMap } from "./s3-jsonl-distributed-map";
import { JsonPath, StateGraph } from "aws-cdk-lib/aws-stepfunctions";

type Props = {
  readonly writerRole: IRole;
  readonly workingBucket: string;
  readonly workingBucketPrefixKey: string;
  readonly aggressiveTimes?: boolean;
  readonly inputPath: string;
  readonly mapStateName: string;
};

export class ThawObjectsMapConstruct extends Construct {
  public readonly distributedMap: S3JsonlDistributedMap;
  public readonly lambdaStep: ThawObjectsLambdaStepConstruct;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const thawObjectsLambdaStep = new ThawObjectsLambdaStepConstruct(
      this,
      `${id}_LambdaStep`,
      {
        writerRole: props.writerRole,
      },
    );

    this.lambdaStep = thawObjectsLambdaStep;

    const graph = new StateGraph(
      thawObjectsLambdaStep.invocableLambda,
      `Map ${id} Iterator`,
    );

    // for real deep glacier - we need to support retries up to 48 hours
    // (for dev work though we want to max out at 3 minutes in case we have a bug (our dev test files
    // are in faster glacier and are tiny so they restore very quickly)
    const interval = props.aggressiveTimes
      ? Duration.minutes(1)
      : Duration.hours(1);
    const backoffRate = props.aggressiveTimes ? 1 : 1;
    const maxAttempts = props.aggressiveTimes ? 3 : 50;

    thawObjectsLambdaStep.invocableLambda.addRetry({
      errors: ["IsThawingError"],
      interval: interval,
      backoffRate: backoffRate,
      maxAttempts: maxAttempts,
    });

    this.distributedMap = new S3JsonlDistributedMap(this, props.mapStateName, {
      toleratedFailurePercentage: 0,
      maxItemsPerBatch: 128,
      batchInput: {
        glacierFlexibleRetrievalThawDays: 1,
        glacierFlexibleRetrievalThawSpeed: props.aggressiveTimes
          ? "Expedited"
          : "Bulk",
        glacierDeepArchiveThawDays: 1,
        glacierDeepArchiveThawSpeed: props.aggressiveTimes
          ? "Expedited"
          : "Bulk",
        intelligentTieringArchiveThawDays: 1,
        intelligentTieringArchiveThawSpeed: props.aggressiveTimes
          ? "Standard"
          : "Bulk",
        intelligentTieringDeepArchiveThawDays: 1,
        intelligentTieringDeepArchiveThawSpeed: props.aggressiveTimes
          ? "Standard"
          : "Bulk",
      },
      inputPath: props.inputPath,
      itemReader: {
        "Bucket.$": "$.bucket",
        "Key.$": "$.key",
      },
      iterator: graph,
      itemSelector: {
        "bucket.$": JsonPath.stringAt("$$.Map.Item.Value.sourceBucket"),
        "key.$": JsonPath.stringAt("$$.Map.Item.Value.sourceKey"),
      },
      resultPath: JsonPath.DISCARD,
    });
  }
}
