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
   * The relative path (relative to `workingBucketPrefixKey`) to the copy-instructions input file.
   * This file is JSONL: one `CopyInstruction` per line.
   */
  readonly copyInstructionsKey: string;

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

  readonly destinationStartCopyRelativeKey: string;
  readonly destinationEndCopyRelativeKey: string;

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
};

export type CopyOutStateMachineInputKeys = keyof StepsS3CopyInvokeArguments;

// this odd construct just makes sure that the JSON paths we specify
// here correspond with fields in the master "input" schema for the
// overall Steps function
export const COPY_INSTRUCTIONS_KEY_FIELD_NAME: CopyOutStateMachineInputKeys =
  "copyInstructionsKey";

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

export const DRY_RUN_KEY_FIELD_NAME: CopyOutStateMachineInputKeys = "dryRun";

export const INCLUDE_COPY_REPORT_FIELD_NAME: CopyOutStateMachineInputKeys =
  "includeCopyReport";

export const RETAIN_COPY_REPORT_FIELD_NAME: CopyOutStateMachineInputKeys =
  "retainCopyReport";
