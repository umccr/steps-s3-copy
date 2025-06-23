import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { IRole } from "aws-cdk-lib/aws-iam";
import { JsonPath, StateGraph } from "aws-cdk-lib/aws-stepfunctions";
import { S3JsonlDistributedMap } from "./s3-jsonl-distributed-map";
import { ThawObjectsLambdaStepConstruct } from "./thaw-lambda-step-construct";
import { SmallObjectsCopyLambdaStepConstruct } from "./small-copy-lambda-step-construct";

type Props = {
  readonly writerRole: IRole;
  readonly workingBucket: string;
  readonly workingBucketPrefixKey: string;
  readonly aggressiveTimes?: boolean;
  readonly inputPath: string;
  readonly mapStateName: string;
};

export class SmallThawCopyMapConstruct extends Construct {
  public readonly distributedMap: S3JsonlDistributedMap;
  public readonly lambdaStep: ThawObjectsLambdaStepConstruct;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const thawStep = new ThawObjectsLambdaStepConstruct(this, "ThawStep", {
      writerRole: props.writerRole,
    });

    this.lambdaStep = thawStep;

    thawStep.invocableLambda.addRetry({
      errors: ["IsThawingError"],
      interval: props.aggressiveTimes ? Duration.minutes(1) : Duration.hours(1),
      backoffRate: 1,
      maxAttempts: props.aggressiveTimes ? 3 : 50,
    });

    const copyStep = new SmallObjectsCopyLambdaStepConstruct(this, "CopyStep", {
      writerRole: props.writerRole,
      lambdaStateName: "CopySmallObject",
    });

    const startState = thawStep.invocableLambda;
    startState.next(copyStep.invocableLambda);

    const graph = new StateGraph(startState, `Map ${id} Iterator`);

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
