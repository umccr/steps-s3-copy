/**
 * Per-execution performance tuning for the copy stages.
 *
 * Before copying, a "head" stage reads every source object to gather its size and storage class.
 * The copy itself then splits objects into two stages by size, each backed by its own Step
 * Functions Distributed Map:
 *
 * - the "head" stage reads (HEADs) every source object. It touches the source system only.
 * - the "small" stage copies objects using a Lambda. Many small objects are batched into
 *   a single Lambda invocation to amortise start-up overhead, and parallelism comes from
 *   running many invocations at once.
 * - the "large" stage copies objects using a Fargate task, one object per task. Parallelism
 *   comes entirely from running many tasks at once, so there is deliberately no batch-size
 *   control for this stage (it is always one object per task).
 *
 * Only the concurrency and small-copy batch size are exposed here. The head and large stages
 * always use a batch size of 1 by design (the head stage to keep its result payload small, the
 * large stage to avoid serialising big copies within a single task), so those batch sizes are not
 * configurable.
 *
 * All fields are optional. Anything left undefined falls back to a default that preserves the
 * historical behaviour (tuned for AWS S3 as the destination).
 */
export type Performance = {
  /**
   * The maximum number of source objects to HEAD concurrently in the head stage. Lower this to
   * reduce read load on a source system that cannot sustain high concurrency.
   */
  readonly headConcurrency?: number;

  /**
   * The maximum number of small-object copy Lambdas to run concurrently.
   */
  readonly smallCopyConcurrency?: number;

  /**
   * The maximum number of small objects handed to a single small-object copy Lambda invocation.
   * Larger batches amortise Lambda start-up cost across more objects.
   */
  readonly smallCopyBatchSize?: number;

  /**
   * The maximum number of large-object copy Fargate tasks to run concurrently.
   *
   * Note there is intentionally no large-object batch size - each Fargate task copies exactly one
   * object so that large copies run in parallel rather than being serialised within a task.
   */
  readonly largeCopyConcurrency?: number;
};

/**
 * The type that matches our expected input to the state machine.
 * This is more for internal consistency - it is not directly
 * used to define the "schema" of the state machine.
 */
export type StepsS3CopyInvokeArguments = {
  /**
   * The region that source buckets MUST be in. If undefined, defaults to the region the
   * orchestration is installed in.
   */
  readonly sourceRequiredRegion?: string;

  /**
   * The region that the destination bucket MUST be in. If undefined, defaults to the region
   * the orchestration is installed in.
   */
  readonly destinationRequiredRegion?: string;

  /**
   * The destination bucket to copy the objects.
   */
  readonly destinationBucket: string;

  /**
   * A slash-terminated prefix in the destination bucket which copied objects are placed.
   * Use `""` to copy into the root of the bucket.
   */
  readonly destinationPrefix?: string;

  /**
   * A slash-terminated prefix, relative to `workingBucketPrefix` that holds the
   * input copy instructions JSONL. Distributed map result manifests and any retained
   * outputs are also written here. Use `""` to place at the root of `workingBucketPrefix`.
   */
  readonly instructionsPrefix: string;

  /**
   * The key, relative to `instructionsPrefix` of the JSONL copy instructions file. Defaults to
   * `INSTRUCTIONS.jsonl`.
   */
  readonly instructionsKey?: string;

  /**
   * The key, relative to `destinationPrefix` of the start copy marker. Defaults to
   * `STARTED_COPY.txt`.
   */
  readonly startMarkerKey?: string;

  /**
   * The key, relative to `destinationPrefix` of the end copy CSV summary. Defaults to
   * `ENDED_COPY.csv`.
   */
  readonly summaryCsvKey?: string;

  /**
   * The key, relative to `destinationPrefix` of the end copy HTML report, written when
   * `htmlReport` is true. Defaults to `ENDED_COPY_REPORT.html`.
   */
  readonly htmlReportKey?: string;

  /**
   * If true, generate and write the HTML report to `<destinationPrefix><htmlReportKey>` in the
   * destination bucket. Defaults to false.
   */
  readonly htmlReport?: boolean;

  /**
   * If true, also save the HTML report in the working bucket at
   * `<workingBucketPrefix><instructionsPrefix><htmlReportKey>`. This will work
   * for the working bucket even if `htmlReport` is false. Defaults to false.
   */
  readonly retainHtmlReport?: boolean;

  /**
   * If true, also save the end copy CSV in the working bucket at
   * `<workingBucketPrefix><instructionsPrefix><summaryCsvKey>`. Defaults to false.
   */
  readonly retainSummaryCsv?: boolean;

  /**
   * If true, go through the motions of doing a copy (including checking for existence of all the
   * objects) - but do not actually perform the copy. Defaults to false.
   */
  readonly dryRun?: boolean;

  /**
   * Controls how per-object copy errors are handled. By default, a copy fails on the first object
   * that errors, and the whole run is aborted. Set this to true to continue on a best effort basis,
   * where previously failed objects do not stop the state machine.
   */
  readonly continueOnError?: boolean;

  /**
   * Optional per-execution performance tuning for the copy stages. Use this to limit the load
   * placed on the source/destination systems - for example when copying to or from a system that
   * cannot sustain the very high concurrency that AWS S3 can.
   *
   * Any field left undefined falls back to a default chosen to preserve the historical behaviour
   * (tuned for AWS S3 as the destination).
   */
  readonly performance?: Performance;

  /**
   * Optional thawing parameters. Missing `thawParams` is normalised to `{}` by the state machine,
   * and per-field defaults are applied by the thaw step Lambda (`*ThawDays` = 1, `*ThawSpeed` = "Bulk").
   */
  readonly thawParams?: {
    readonly glacierFlexibleRetrievalThawDays?: number;
    readonly glacierFlexibleRetrievalThawSpeed?:
      | "Bulk"
      | "Standard"
      | "Expedited";

    readonly glacierDeepArchiveThawDays?: number;
    readonly glacierDeepArchiveThawSpeed?: "Bulk" | "Standard";

    readonly intelligentTieringArchiveThawDays?: number;
    readonly intelligentTieringArchiveThawSpeed?:
      | "Bulk"
      | "Standard"
      | "Expedited";

    readonly intelligentTieringDeepArchiveThawDays?: number;
    readonly intelligentTieringDeepArchiveThawSpeed?: "Bulk" | "Standard";
  };

  /**
   * When a source or destination bucket matches a key in this map, the `BucketDefinition` is used
   * to configure the credentials used to access the bucket. Settings here override
   * `sourceRequiredRegion`, `destinationRequiredRegion`, or `sourceNoSignRequest` for that bucket.
   */
  readonly bucketDefinitions?: Record<string, BucketDefinition>;
};

/**
 * Settings the construct bakes into the state machine at deploy time, as opposed to
 * `StepsS3CopyInvokeArguments` which are supplied per execution.
 */
export type StepsS3CopyInvokeSettings = {
  readonly workingBucket: string;
  readonly workingBucketPrefix: string;
};

/**
 * Builds a JSONPath reference into the `$invokeArguments` state variable.
 *
 * Nested groups are available as namespaced helpers, e.g.
 * `invokeArg.performance("largeCopyConcurrency")` -> `$invokeArguments.performance.largeCopyConcurrency`.
 */
export const invokeArg = Object.assign(
  (key: keyof StepsS3CopyInvokeArguments): string => `$invokeArguments.${key}`,
  {
    /**
     * Builds a JSONPath reference into a field of the normalised
     * `$invokeArguments.performance` object.
     */
    performance: (key: keyof Performance): string =>
      `$invokeArguments.performance.${key}`,
  },
);

/**
 * Builds a JSONPath reference into the `$invokeSettings` state variable.
 */
export const invokeSetting = (key: keyof StepsS3CopyInvokeSettings): string =>
  `$invokeSettings.${key}`;

/**
 * Builds a JSONata reference to a field of the raw caller `$states.input` variable.
 */
export const stateInput = (key: keyof StepsS3CopyInvokeArguments): string =>
  `$states.input.${key}`;

/**
 * Builds a JSONata reference to a field of the batch `$states.input.BatchInput.<key>` object.
 */
export const batchArg = (key: keyof StepsS3CopyInvokeArguments): string =>
  `$states.input.BatchInput.${key}`;

/**
 * The error name that copy-batch uses when it fails.
 */
export const CopyErrorName = "CopyError";

// Default file names used when the corresponding input override is not supplied.
export const DEFAULT_INSTRUCTIONS_KEY = "INSTRUCTIONS.jsonl";
export const DEFAULT_START_MARKER_KEY = "STARTED_COPY.txt";
export const DEFAULT_SUMMARY_CSV_KEY = "ENDED_COPY.csv";
export const DEFAULT_HTML_REPORT_KEY = "ENDED_COPY_REPORT.html";

/**
 * Common fields shared by all bucket definitions.
 */
type BaseBucketDefinition = {
  /**
   * The AWS region for this bucket.
   */
  readonly region?: string;

  /**
   * A custom S3 endpoint URL
   */
  readonly endpointUrl?: string;

  /**
   * Enables compatibility mode for S3-compatible endpoints.
   * Defaults to `true` when `endpointUrl` is set. Set explicitly to override this.
   */
  readonly s3Compatible?: boolean;
};

/**
 * Specifies how the copier should connect to a specific bucket.
 *
 * - `"default-environment"` - use the default SDK credential chain.
 * - `"no-credentials"` - no request signing.
 * - `"aws-secret"` - fetch credentials from an AWS Secrets Manager secret.
 *   The secret must contain JSON with `access_key_id`, `secret_access_key`,
 *   and optionally `session_token`.
 */
export type BucketDefinition = BaseBucketDefinition &
  (
    | { readonly credentialProvider?: "default-environment" | "no-credentials" }
    | { readonly credentialProvider: "aws-secret"; readonly secret: string }
  );
