/**
 * Size threshold for determining small vs large object.
 * Set to 5 MiB as that is the definitional minimum size of a multipart part.
 */
export const SIZE_THRESHOLD_BYTES = 5 * 1024 * 1024;

/**
 * Storage classes that require thawing/restoration before copying.
 */
export const COLD_STORAGE_CLASSES = [
  "GLACIER",
  "DEEP_ARCHIVE",
  "INTELLIGENT_TIERING_ARCHIVE_ACCESS",
  "INTELLIGENT_TIERING_DEEP_ARCHIVE_ACCESS",
] as const;
