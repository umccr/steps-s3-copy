/**
 * Size threshold for determining small vs large object.
 * Set to 5 MiB as that is the definitional minimum size of a multipart part.
 */
export const SIZE_THRESHOLD_BYTES = 5 * 1024 * 1024;

/**
 * Chunk size (in bytes) used for S3 multipart upload "partSize".
 * Set to 5 MiB, which is the minimum allowed S3 multipart part size.
 * (usefd to control both multipart upload behavior and cost estimation)
 */

export const MULTIPART_CHUNK_SIZE = 5 * 1024 * 1024;

/**
 * Determines whether an S3 object is in cold storage (i.e. requires restoration
 * before it can be copied).
 *
 * GLACIER and DEEP_ARCHIVE are always cold. INTELLIGENT_TIERING is only cold
 * when the object has been moved to an archive tier, indicated by the
 * ArchiveStatus header returned by HeadObject.
 */
export function checkColdStorage(
  storageClass: string,
  archiveStatus?: string,
): boolean {
  if (storageClass === "GLACIER" || storageClass === "DEEP_ARCHIVE")
    return true;
  if (storageClass === "INTELLIGENT_TIERING" && archiveStatus) return true;
  return false;
}

// -----------------------------------------------------------------
// PRICING
// -----------------------------------------------------------------

// The key under which pricing data is stored in S3 by the FetchPricingDataLambda
export const PRICING_DATA_FILENAME = "pricing-data.json";

// -------------
// Read from packages/steps-s3-copy/src/steps-s3-copy-construct.ts
// TODO: cosider to use theses constans here defined
// in packages/steps-s3-copy/src/steps-s3-copy-construct.ts
export const FARGATE_MIN_BILLING_SECONDS = 60;
export const FARGATE_MEMORY_MB = 512;
export const FARGATE_CPU_VCPU = 0.25;
export const DEFAULT_FARGATE_OVERHEAD_SEC = 8;

// Read from packages/steps-s3-copy/src/lib/small-copy-map-construct.ts
// TODO: cosider to use theses constans here defined
// in packages/steps-s3-copy/src/lib/small-copy-map-construct.ts
export const LAMBDA_MEMORY_MB = 128;
// Typical assumed copy speed for compute cost estimation (MiB/s)
export const DEFAULT_COPY_SPEED_MIBPS = 40;
export const DEFAULT_LAMBDA_OVERHEAD_SEC = 20;

/**
 * Estimate copy duration (seconds) from size and speed.
 */
export function defaultCopyDurationSeconds(
  sizeBytes: number,
  speedMiBps: number = DEFAULT_COPY_SPEED_MIBPS,
): number {
  return sizeBytes / (speedMiBps * 1024 * 1024);
}

// -----------------------------------------------------------------
// UTILITIES
// -----------------------------------------------------------------
export function bytesToGB(bytes: number): number {
  return bytes / 1024 ** 3;
}

export function getThawParams(
  storageClass: string,
  archiveStatus?: string,
  thawParams?: {
    glacierFlexibleRetrievalThawDays?: number;
    glacierFlexibleRetrievalThawSpeed?: string;
    glacierDeepArchiveThawDays?: number;
    glacierDeepArchiveThawSpeed?: string;
    intelligentTieringArchiveThawDays?: number;
    intelligentTieringArchiveThawSpeed?: string;
    intelligentTieringDeepArchiveThawDays?: number;
    intelligentTieringDeepArchiveThawSpeed?: string;
  },
): { retrievalSpeed: string; restoreWindowDays: number } {
  switch (storageClass) {
    case "GLACIER":
      return {
        retrievalSpeed: thawParams?.glacierFlexibleRetrievalThawSpeed ?? "Bulk",
        restoreWindowDays: thawParams?.glacierFlexibleRetrievalThawDays ?? 1,
      };
    case "DEEP_ARCHIVE":
      return {
        retrievalSpeed: thawParams?.glacierDeepArchiveThawSpeed ?? "Bulk",
        restoreWindowDays: thawParams?.glacierDeepArchiveThawDays ?? 1,
      };
    case "INTELLIGENT_TIERING":
      if (archiveStatus === "ARCHIVE_ACCESS") {
        return {
          retrievalSpeed:
            thawParams?.intelligentTieringArchiveThawSpeed ?? "Bulk",
          restoreWindowDays: thawParams?.intelligentTieringArchiveThawDays ?? 1,
        };
      }
      if (archiveStatus === "DEEP_ARCHIVE_ACCESS") {
        return {
          retrievalSpeed:
            thawParams?.intelligentTieringDeepArchiveThawSpeed ?? "Bulk",
          restoreWindowDays:
            thawParams?.intelligentTieringDeepArchiveThawDays ?? 1,
        };
      }
    default:
      return { retrievalSpeed: "Bulk", restoreWindowDays: 1 };
  }
}
