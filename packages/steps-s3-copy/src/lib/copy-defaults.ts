/**
 * Defaults for the copy on {@link StepsS3CopyConstructProps}.
 */

/**
 * Concurrent large-object copy tasks.
 */
export const DEFAULT_LARGE_COPY_MAX_CONCURRENCY = 96;

/**
 * Small objects per copy Lambda invocation.
 */
export const DEFAULT_SMALL_COPY_MAX_ITEMS_PER_BATCH = 128;

/**
 * Memory in MiB for the small-object copy Lambda.
 */
export const DEFAULT_SMALL_COPY_MEMORY_SIZE_MIB = 128;
