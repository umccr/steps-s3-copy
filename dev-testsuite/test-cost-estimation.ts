import {
  fetchColdStorageRetrievalCosts,
  estimateColdStorageRetrievalCost,
  fetchCrossRegionCosts,
  estimateCrossRegionCost,
  fetchComputeCosts,
  estimateComputeCost,
} from "../packages/steps-s3-copy/lambda//common/cost-estimation";

import { SIZE_THRESHOLD_BYTES } from "../packages/steps-s3-copy/lambda/common/constants";
import type { CostEstimate } from "../packages/steps-s3-copy/lambda//common/cost-estimation";

// -----------------------------------------------------------------------------
// Set Mock metadata for testing
// -----------------------------------------------------------------------------

// Fetch cost data from API for source region Syd (ap-southeast-1)
const sourceRegion = "ap-southeast-1";

const ColdStorageRetrievalCosts =
  await fetchColdStorageRetrievalCosts(sourceRegion);
const crossRegionCosts = await fetchCrossRegionCosts(sourceRegion);
const computeCosts = await fetchComputeCosts(sourceRegion);

console.log("crossRegionCosts", JSON.stringify(crossRegionCosts, null, 2));

// Test Scenarios
const testScenarios = [
  {
    name: "Small file, same region, standard",
    sizeBytes: 100 * 1024 * 1024,
    isCrossRegion: false,
    storageClass: "STANDARD",
    retrievalSpeed: "Standard",
    restoreWindowDays: 7,
  },
  {
    name: "Small file, cross-region, standard",
    sizeBytes: 100 * 1024 * 1024,
    isCrossRegion: true,
    storageClass: "STANDARD",
    retrievalSpeed: "Standard",
    restoreWindowDays: 7,
  },
  {
    name: "10GB file, cross-region, standard",
    sizeBytes: 10 * 1024 * 1024 * 1024,
    isCrossRegion: true,
    storageClass: "STANDARD",
    retrievalSpeed: "Standard",
    restoreWindowDays: 7,
  },
  {
    name: "Egress tier 2 (>10TB), cross-region",
    sizeBytes: 11 * 1024 * 1024 * 1024 * 1024,
    isCrossRegion: true,
    storageClass: "STANDARD",
    retrievalSpeed: "Standard",
    restoreWindowDays: 7,
  },
  {
    name: "Egress tier 3 (>50TB), cross-region",
    sizeBytes: 52 * 1024 * 1024 * 1024 * 1024,
    isCrossRegion: true,
    storageClass: "STANDARD",
    retrievalSpeed: "Standard",
    restoreWindowDays: 7,
  },
  {
    name: "Egress tier 4 (>150TB), cross-region",
    sizeBytes: 155 * 1024 * 1024 * 1024 * 1024,
    isCrossRegion: true,
    storageClass: "STANDARD",
    retrievalSpeed: "Standard",
    restoreWindowDays: 7,
  },
  {
    name: "Glacier Bulk, same region",
    sizeBytes: 5 * 1024 * 1024 * 1024,
    isCrossRegion: false,
    storageClass: "GLACIER",
    retrievalSpeed: "Bulk",
    restoreWindowDays: 7,
  },
  {
    name: "Glacier Standard, same region",
    sizeBytes: 5 * 1024 * 1024 * 1024,
    isCrossRegion: false,
    storageClass: "GLACIER",
    retrievalSpeed: "Standard",
    restoreWindowDays: 7,
  },
  {
    name: "Glacier Expedited, same region",
    sizeBytes: 5 * 1024 * 1024 * 1024,
    isCrossRegion: false,
    storageClass: "GLACIER",
    retrievalSpeed: "Expedited",
    restoreWindowDays: 7,
  },
  {
    name: "Deep Archive Bulk, same region",
    sizeBytes: 5 * 1024 * 1024 * 1024,
    isCrossRegion: false,
    storageClass: "DEEP_ARCHIVE",
    retrievalSpeed: "Bulk",
    restoreWindowDays: 7,
  },
  {
    name: "Deep Archive Standard, same region",
    sizeBytes: 5 * 1024 * 1024 * 1024,
    isCrossRegion: false,
    storageClass: "DEEP_ARCHIVE",
    retrievalSpeed: "Standard",
    restoreWindowDays: 7,
  },
  {
    name: "Intelligent Tiering Archive Expedited, cross-region",
    sizeBytes: 5 * 1024 * 1024 * 1024,
    isCrossRegion: true,
    storageClass: "INTELLIGENT_TIERING",
    retrievalSpeed: "Expedited",
    restoreWindowDays: 7,
  },
  {
    name: "Intelligent Tiering Deep Archive, cross-region",
    sizeBytes: 5 * 1024 * 1024 * 1024,
    isCrossRegion: true,
    storageClass: "INTELLIGENT_TIERING",
    retrievalSpeed: "Bulk",
    restoreWindowDays: 7,
  },
  {
    name: "10GB Glacier Standard + cross-region (combined costs)",
    sizeBytes: 10 * 1024 * 1024 * 1024,
    isCrossRegion: true,
    storageClass: "GLACIER",
    retrievalSpeed: "Standard",
    restoreWindowDays: 14,
  },
  {
    name: "Lambda threshold - just below",
    sizeBytes: SIZE_THRESHOLD_BYTES - 1,
    isCrossRegion: false,
    storageClass: "STANDARD",
    retrievalSpeed: "Standard",
    restoreWindowDays: 7,
  },
];

// costEstimate: {
// crossRegionCostUSD: estimateCrossRegionCost(
//     iscrossRegion,
//     crossRegionCosts,
//     size,
// ),

// coldStorageRetrievalCostUSD: estimateColdStorageRetrievalCost(
//     isColdStorage,
//     size,
//     storageClass,
//     retrievalSpeed,
//     restoreWindowDays,
//     ColdStorageRetrievalCosts,
// ),
// computeCostUSD: estimateComputeCost(size, computeCosts),
// }
