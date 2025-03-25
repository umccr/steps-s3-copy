import { Construct } from "constructs";
import { JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { S3CsvDistributedMap } from "./s3-csv-distributed-map";
import { ThawObjectsLambdaStepConstruct } from "./thaw-objects-lambda-step-construct";
import { Duration } from "aws-cdk-lib";
import { SOURCE_FILES_CSV_KEY_FIELD_NAME } from "../steps-s3-copy-input";

type Props = {
  readonly workingBucket: string;
  readonly workingBucketPrefixKey: string;

  readonly aggressiveTimes?: boolean;
};

export class ThawObjectsMapConstruct extends Construct {
  public readonly distributedMap: S3CsvDistributedMap;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const thawObjectsLambdaStep = new ThawObjectsLambdaStepConstruct(
      this,
      "LambdaStep",
      {},
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

    // these names are internal only - but we pull out as a const to make sure
    // they are consistent
    const bucketColumnName = "b";
    const keyColumnName = "k";

    this.distributedMap = new S3CsvDistributedMap(this, "ThawObjectsMap", {
      // we use this phase to detect errors early - and if so we want to fail the entire run
      toleratedFailurePercentage: 0,
      itemReaderCsvHeaders: [bucketColumnName, keyColumnName],
      itemReader: {
        Bucket: props.workingBucket,
        "Key.$": JsonPath.format(
          "{}{}",
          props.workingBucketPrefixKey,
          JsonPath.stringAt(`$.${SOURCE_FILES_CSV_KEY_FIELD_NAME}`),
        ),
      },
      itemSelector: {
        "bucket.$": JsonPath.stringAt(`$$.Map.Item.Value.${bucketColumnName}`),
        "key.$": JsonPath.stringAt(`$$.Map.Item.Value.${keyColumnName}`),
      },
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
      iterator: thawObjectsLambdaStep.invocableLambda,
      resultPath: JsonPath.DISCARD,
    });
  }
}
