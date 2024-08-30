/**
 * The type that matches our expected input to the state machine.
 * This is more for internal consistency - it is not directly
 * used to define the "schema" of the state machine.
 */
export type StepsS3CopyInput = {
  sourceFilesCsvKey: string;

  requiredRegion: string;

  copyConcurrency: number;
  maxItemsPerBatch: number;

  destinationBucket: string;
  destinationPrefixKey: string;

  destinationStartCopyRelativeKey: string;
  destinationEndCopyRelativeKey: string;
};

export type CopyOutStateMachineInputKeys = keyof StepsS3CopyInput;

// this odd construct just makes sure that the JSON paths we specify
// here correspond with fields in the master "input" schema for the
// overall Steps function
export const SOURCE_FILES_CSV_KEY_FIELD_NAME: CopyOutStateMachineInputKeys =
  "sourceFilesCsvKey";

export const MAX_ITEMS_PER_BATCH_FIELD_NAME: CopyOutStateMachineInputKeys =
  "maxItemsPerBatch";

export const DESTINATION_BUCKET_FIELD_NAME: CopyOutStateMachineInputKeys =
  "destinationBucket";
export const DESTINATION_PREFIX_KEY_FIELD_NAME: CopyOutStateMachineInputKeys =
  "destinationPrefixKey";

export const DESTINATION_START_COPY_RELATIVE_KEY_FIELD_NAME: CopyOutStateMachineInputKeys =
  "destinationStartCopyRelativeKey";
export const DESTINATION_END_COPY_RELATIVE_KEY_FIELD_NAME: CopyOutStateMachineInputKeys =
  "destinationEndCopyRelativeKey";
