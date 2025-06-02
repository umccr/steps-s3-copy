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
   * The relative path name (relative to the `workingBucketPrefixKey` of the CDK construct)
   * to a JSONL of "copy instructions". Each "copy instruction" is a JSONL line
   * according to a
   *
   * TODO: NOTE: we need to rename this field!!!
   */
  readonly sourceFilesCsvKey: string;

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
};

export type CopyOutStateMachineInputKeys = keyof StepsS3CopyInvokeArguments;

// this odd construct just makes sure that the JSON paths we specify
// here correspond with fields in the master "input" schema for the
// overall Steps function
export const SOURCE_FILES_CSV_KEY_FIELD_NAME: CopyOutStateMachineInputKeys =
  "sourceFilesCsvKey";

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
