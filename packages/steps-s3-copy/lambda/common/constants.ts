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

// The key under which pricing data is stored in S3 by the FetchPricingDataLambda
export const PRICING_DATA_FILENAME = "pricing-data.json";

// -----------------------------------------------------------------
// PRICING CONSTANTS (BASED on tge offical AWS page COST_CHECK_URL)
// -----------------------------------------------------------------

// -------------
// Read from packages/steps-s3-copy/src/steps-s3-copy-construct.ts
// TODO: cosider to use theses constans here defined in
// packages/steps-s3-copy/src/steps-s3-copy-construct.ts
export const FARGATE_MIN_BILLING_SECONDS = 60;

export const FARGATE_MEMORY_MB = 512;
export const FARGATE_CPU_VCPU = 0.25;

// Read from packages/steps-s3-copy/src/lib/small-copy-map-construct.ts
// This value is used for estimating Lambda compute costs for small object copy operations.
// TODO: cosider to use theses constans here defined
// in packages/steps-s3-copy/src/lib/small-copy-map-construct.ts

export const LAMBDA_MEMORY_MB = 128;

// Typical assumed copy speed for compute cost estimation (MiB/s)
export const DEFAULT_COPY_SPEED_MIBPS = 40;

// -------------
// UTILITIES
// -------------
export function bytesToGB(bytes: number): number {
  return bytes / 1024 ** 3;
}

export function getThawParams(
  storageClass: string,
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
      return {
        retrievalSpeed:
          thawParams?.intelligentTieringArchiveThawSpeed ?? "Bulk",
        restoreWindowDays: thawParams?.intelligentTieringArchiveThawDays ?? 1,
      };
    default:
      return { retrievalSpeed: "Bulk", restoreWindowDays: 1 };
  }
}

/**
 * Estimate copy duration (seconds) from size and speed.
 */
export function defaultCopyDurationSeconds(
  sizeBytes: number,
  speedMiBps: number = DEFAULT_COPY_SPEED_MIBPS,
): number {
  return sizeBytes / (speedMiBps * 1024 * 1024);
}
