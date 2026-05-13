/**
 * The type that matches our expected input to the state machine.
 * This is more for internal consistency - it is not directly
 * used to define the "schema" of the state machine.
 */

export type StepsS3CopyInvokeArguments = {
  /**
   * The region that source buckets MUST be in.
   *
   * If undefined, will default to the region that the orchestration is installed in.
   */
  readonly sourceRequiredRegion?: string;

  /**
   * The region that destination bucket MUST be in.
   *
   * If undefined, will default to the region that the orchestration is installed in.
   */
  readonly destinationRequiredRegion?: string;

  /**
   * The slash-terminated folder (relative to `workingBucketPrefixKey`) that contains the
   * copy-instructions JSONL input file. This directory is expected to contain a JSONL file
   * with the name of `copyInstructionsFileName`. Use `""` to place it at the root of
   * `workingBucketPrefixKey`.
   */
  readonly copyInstructionsFolder: string;

  /**
   * The name of the JSONL copy-instructions file inside `copyInstructionsFolder`. Defaults
   * to `INSTRUCTIONS.jsonl` if not specified.
   */
  readonly copyInstructionsFileName?: string;

  /**
   * The destination bucket to copy the objects.
   */
  readonly destinationBucket: string;

  /**
   * A slash terminated folder key in which to root the destination
   * objects, or "" to mean place objects in the root of the bucket.
   */
  readonly destinationFolderKey: string;

  readonly copyConcurrency: number;
  readonly maxItemsPerBatch: number;

  /**
   * Relative key (under `destinationFolderKey`) of the start copy marker. Defaults to `STARTED_COPY.txt`
   * if omitted.
   */
  readonly destinationStartCopyRelativeKey?: string;

  /**
   * Relative key (under `destinationFolderKey`) of the end copy CSV once the copy completes. Defaults
   * to `ENDED_COPY.csv` if omitted.
   */
  readonly destinationEndCopyRelativeKey?: string;

  /**
   * Relative key (under `destinationFolderKey`) of the end copy HTML report written  when `includeCopyReport`
   * is also set. Defaults to `ENDED_COPY_REPORT.html` if not specified.
   */
  readonly destinationEndCopyReportRelativeKey?: string;

  /**
   * If present and true, instructs the copier to go through the motions of
   * doing a copy (including checking for existence of all the objects) - but not
   * actually perform the copy.
   */
  readonly dryRun?: boolean;

  /**
   * If present and true, generate html copy report (COPY_REPORT.html)  in the destination.
   * If omitted, defaults to false.
   */
  readonly includeCopyReport?: boolean;

  /**
   * If set, also save a copy report (COPY_REPORT.html) in the same bucket and prefix as the source file.
   */
  readonly retainCopyReport?: boolean;

  /**
   * If set, also save the ended copy CSV to the working bucket alongside the copy instructions file.
   */
  readonly retainCopyCsv?: boolean;

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
   * When a source or destination bucket matches a key in this map, the `BucketDefinition` is used to
   * configure the credentials used to access the bucket.
   *
   * Settings here will override `sourceRequiredRegion`, `destinationRequiredRegion`, or `sourceNoSignRequest` if
   * using the no-credential `CredentialProvider`.
   */
  readonly bucketDefinitions?: Record<string, BucketDefinition>;
};

export type CopyOutStateMachineInputKeys = keyof StepsS3CopyInvokeArguments;

// this odd construct just makes sure that the JSON paths we specify
// here correspond with fields in the master "input" schema for the
// overall Steps function
export const COPY_INSTRUCTIONS_FOLDER_FIELD_NAME: CopyOutStateMachineInputKeys =
  "copyInstructionsFolder";

export const COPY_INSTRUCTIONS_FILE_NAME_FIELD_NAME: CopyOutStateMachineInputKeys =
  "copyInstructionsFileName";

export const DEFAULT_COPY_INSTRUCTIONS_FILE_NAME = "INSTRUCTIONS.jsonl";

export const MAX_ITEMS_PER_BATCH_FIELD_NAME: CopyOutStateMachineInputKeys =
  "maxItemsPerBatch";

export const DESTINATION_BUCKET_FIELD_NAME: CopyOutStateMachineInputKeys =
  "destinationBucket";
export const DESTINATION_FOLDER_KEY_FIELD_NAME: CopyOutStateMachineInputKeys =
  "destinationFolderKey";

export const DESTINATION_START_COPY_RELATIVE_KEY_FIELD_NAME: CopyOutStateMachineInputKeys =
  "destinationStartCopyRelativeKey";
export const DESTINATION_END_COPY_RELATIVE_KEY_FIELD_NAME: CopyOutStateMachineInputKeys =
  "destinationEndCopyRelativeKey";
export const DESTINATION_END_COPY_REPORT_RELATIVE_KEY_FIELD_NAME: CopyOutStateMachineInputKeys =
  "destinationEndCopyReportRelativeKey";

export const DEFAULT_DESTINATION_START_COPY_RELATIVE_KEY = "STARTED_COPY.txt";
export const DEFAULT_DESTINATION_END_COPY_RELATIVE_KEY = "ENDED_COPY.csv";
export const DEFAULT_DESTINATION_END_COPY_REPORT_RELATIVE_KEY =
  "ENDED_COPY_REPORT.html";

export const DRY_RUN_KEY_FIELD_NAME: CopyOutStateMachineInputKeys = "dryRun";

export const INCLUDE_COPY_REPORT_FIELD_NAME: CopyOutStateMachineInputKeys =
  "includeCopyReport";

export const RETAIN_COPY_REPORT_FIELD_NAME: CopyOutStateMachineInputKeys =
  "retainCopyReport";

export const RETAIN_COPY_CSV_FIELD_NAME: CopyOutStateMachineInputKeys =
  "retainCopyCsv";

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
