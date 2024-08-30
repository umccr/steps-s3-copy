
/**
 * A designated area in our working bucket that is where we can find the list
 * of objects to copy - and other working files. We introduce a prefix
 * here so that we can test out that our prefix mechanisms work.
 *
 * NOTE: this is not where the source or destination files are located.
 */
export const TEST_BUCKET_WORKING_PREFIX = "a-working-folder/";
