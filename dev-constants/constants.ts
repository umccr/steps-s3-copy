/**
 * A designated area in our working bucket that is where we can find the list
 * of objects to copy - and other working files. We introduce a prefix
 * here so that we can test out that our prefix mechanisms work.
 */
export const TEST_BUCKET_WORKING_PREFIX = "a-working-folder/";

/**
 * A designated area in our working bucket that we know will auto
 * delete test objects quickly.
 */
export const TEST_BUCKET_ONE_DAY_PREFIX = "1day/";
