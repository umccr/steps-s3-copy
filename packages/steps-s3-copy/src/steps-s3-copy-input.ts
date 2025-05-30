/**
 * The type that matches our expected input to the state machine.
 * This is more for internal consistency - it is not directly
 * used to define the "schema" of the state machine.
 */
export type StepsS3CopyInvokeArguments = {
  readonly sourceRequiredRegion?: string;
  readonly destinationRequiredRegion?: string;

  readonly sourceFilesCsvKey: string;

  readonly copyConcurrency: number;
  readonly maxItemsPerBatch: number;

  readonly destinationBucket: string;
  readonly destinationFolderKey: string;

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
