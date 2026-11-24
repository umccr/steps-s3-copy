import type { BucketDefinition } from "../../src/steps-s3-copy-input";

/**
 * Size thresholds that split objects into copy tiers (each bound is inclusive):
 *
 * - small:  up to SMALL_SIZE_THRESHOLD_BYTES, copied by a low memory Lambda (many per invocation).
 * - medium: above small, up to MEDIUM_SIZE_THRESHOLD_BYTES, copied by a high memory Lambda.
 * - large:  above medium, copied by Fargate.
 *
 * SMALL is 5 MiB as that is the definitional minimum size of a multipart part.
 * MEDIUM is a starting value expected to be tuned from real runs. It is bound by the
 * 15 minute Lambda timeout together with the network bandwidth available to the Lambda.
 */
export const SMALL_SIZE_THRESHOLD_BYTES = 5 * 1024 * 1024;
export const MEDIUM_SIZE_THRESHOLD_BYTES = 10 * 1024 * 1024 * 1024;

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

/**
 * Returns true if the source and destination buckets are in different AWS regions.
 * A region set for a bucket in its bucket definition takes precedence over the
 * required region from the input.
 */
export function checkCrossRegion(
  sourceBucket: string,
  sourceRequiredRegion: string,
  destinationBucket: string,
  destinationRequiredRegion: string,
  bucketDefinitions: Record<string, BucketDefinition> | undefined,
): boolean {
  const sourceRegion =
    bucketDefinitions?.[sourceBucket]?.region ?? sourceRequiredRegion;
  const destinationRegion =
    bucketDefinitions?.[destinationBucket]?.region ?? destinationRequiredRegion;

  return sourceRegion !== destinationRegion;
}

/**
 * Returns true if the destination bucket lives outside AWS, i.e. it has a custom endpoint URL
 * that does not point to an AWS host.
 */
export function checkOutsideAws(
  destinationBucket: string,
  bucketDefinitions: Record<string, BucketDefinition> | undefined,
): boolean {
  const endpointUrl = bucketDefinitions?.[destinationBucket]?.endpointUrl;
  if (!endpointUrl) return false;

  const hostname = new URL(endpointUrl).hostname;
  return !hostname.endsWith(".amazonaws.com");
}

// -----------------------------------------------------------------
// PRICING
// -----------------------------------------------------------------

// The key under which pricing data is stored in S3 by the FetchPricingDataLambda
export const PRICING_DATA_FILENAME = "pricing-data.json";

// -------------
// The compute values below are copies of the real deployed settings, used only for cost
// estimation. Keep them in sync with their source (TODO: import them instead).

// Fargate: src/steps-s3-copy-construct.ts
export const FARGATE_MIN_BILLING_SECONDS = 60;
export const FARGATE_MEMORY_MB = 512;
export const FARGATE_CPU_VCPU = 0.25;
export const DEFAULT_FARGATE_OVERHEAD_SEC = 8;

// Small Lambda memory: DEFAULT_SMALL_COPY_MEMORY_SIZE_MIB in src/lib/small-copy-map-construct.ts
export const SMALL_LAMBDA_MEMORY_MB = 128;

// Medium Lambda memory: DEFAULT_MEDIUM_COPY_MEMORY_SIZE_MIB in src/lib/medium-copy-map-construct.ts
export const MEDIUM_LAMBDA_MEMORY_MB = 10240;

// Assumed copy speed (MiB/s) and Lambda start-up overhead for compute cost estimation
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
