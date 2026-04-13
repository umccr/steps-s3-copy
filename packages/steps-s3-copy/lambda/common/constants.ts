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

// -----------------------------------------------------------------
// PRICING CONSTANTS (BASED on tge offical AWS page COST_CHECK_URL)
// -----------------------------------------------------------------

// --- Metadata for Cost Estimate Reporting ---
export const COST_LAST_UPDATED = "12-02-2026"; // Update this date when constants change!
export const COST_CHECK_URL = "https://aws.amazon.com/s3/pricing/"; // Link to AWS official pricing page

// -- Cross-region S3 copy (may need to update periodically) --
export const S3_CROSS_REGION_COPY_COST_PER_GB_AUD = 0.14; // AUD per GB transferred

// -- Lambda (Sydney, AUD) --
export const LAMBDA_GB_SECOND_COST_AUD = 0.00001964; // per GB-second
export const LAMBDA_INVOCATION_COST_AUD = 0.00000027; // per event

// -- Fargate (Sydney, AUD) --
export const FARGATE_VCPU_COST_PER_HOUR_AUD = 0.071;
export const FARGATE_MEMORY_COST_PER_HOUR_AUD = 0.008;
export const FARGATE_MIN_BILLING_SECONDS = 60;

// -------------
// Read from packages/steps-s3-copy/src/steps-s3-copy-construct.ts
// TODO: cosider to use theses constans here defined in
// packages/steps-s3-copy/src/steps-s3-copy-construct.ts

export const FARGATE__MEMORY_MB = 512;
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

// -------------
// COST ESTIMATION FUNCTIONS
// -------------

/**
 * Estimate copy duration (seconds) from size and speed.
 */
export function defaultCopyDurationSeconds(
  sizeBytes: number,
  speedMiBps: number = DEFAULT_COPY_SPEED_MIBPS,
): number {
  return sizeBytes / (speedMiBps * 1024 * 1024);
}

/**
 * Estimate Lambda compute cost (AUD) based on memory and object size.
 */
export function estimateComputeCostLambda(
  memoryMb: number,
  sizeBytes: number,
  assumedCopySpeedMiBps: number = DEFAULT_COPY_SPEED_MIBPS,
): number {
  const seconds = defaultCopyDurationSeconds(sizeBytes, assumedCopySpeedMiBps);
  const gbSeconds = (memoryMb / 1024) * seconds;
  return gbSeconds * LAMBDA_GB_SECOND_COST_AUD + LAMBDA_INVOCATION_COST_AUD;
}

/**
 * Estimate Fargate compute cost (AUD) based on CPU, memory, and object size.
 */
export function estimateComputeCostFargate(
  cpuVcpu: number,
  memGb: number,
  sizeBytes: number,
  assumedCopySpeedMiBps: number = DEFAULT_COPY_SPEED_MIBPS,
): number {
  const seconds = defaultCopyDurationSeconds(sizeBytes, assumedCopySpeedMiBps);
  const billedSeconds = Math.max(seconds, FARGATE_MIN_BILLING_SECONDS);
  const hourFraction = billedSeconds / 3600;
  const cpuCost = cpuVcpu * FARGATE_VCPU_COST_PER_HOUR_AUD * hourFraction;
  const memCost = memGb * FARGATE_MEMORY_COST_PER_HOUR_AUD * hourFraction;
  return cpuCost + memCost;
}

/**
 * Estimate compute cost based on object size.
 * Uses Lambda for 'small' objects (<= SIZE_THRESHOLD_BYTES), Fargate for 'large' objects.
 */
export function estimateComputeCost(sizeBytes: number): number {
  if (sizeBytes <= SIZE_THRESHOLD_BYTES) {
    // Use Lambda for small objects
    return estimateComputeCostLambda(LAMBDA_MEMORY_MB, sizeBytes);
  } else {
    // Use Fargate for large objects
    // (Divide memory by 1024 to convert MB → GB)
    return estimateComputeCostFargate(
      FARGATE_CPU_VCPU,
      FARGATE__MEMORY_MB / 1024,
      sizeBytes,
    );
  }
}
