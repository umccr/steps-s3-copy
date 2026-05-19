import {
  fetchColdStorageRetrievalCosts,
  estimateColdStorageRetrievalCost,
  fetchCrossRegionCosts,
  estimateCrossRegionCost,
  fetchComputeCosts,
  estimateComputeCost,
} from "../packages/steps-s3-copy/lambda//common/cost-estimation";
import { writeFile, readFile } from "node:fs/promises";

import {
  SIZE_THRESHOLD_BYTES,
  COLD_STORAGE_CLASSES,
} from "../packages/steps-s3-copy/lambda/common/constants";
import type {
  CostEstimate,
  ColdStorageRetrievalCosts,
  CrossRegionCosts,
  ComputeCosts,
} from "../packages/steps-s3-copy/lambda//common/cost-estimation";

// -----------------------------------------------------------------------------
// Fetch cost data from API for source region Syd (ap-southeast-2) and
// write it locally
// -----------------------------------------------------------------------------
const shouldFetchPricing = process.argv.includes("--fetch-pricing");

if (shouldFetchPricing) {
  const sourceRegion = "ap-southeast-1";

  const coldStorageCosts = await fetchColdStorageRetrievalCosts(sourceRegion);
  const crossRegionCosts = await fetchCrossRegionCosts(sourceRegion);
  const computeCosts = await fetchComputeCosts(sourceRegion);

  const fetchedPricingData = {
    coldStorageCosts,
    crossRegionCosts,
    computeCosts,
    fetchedAt: new Date().toISOString(),
  };

  await writeFile(
    "./pricing-data.json",
    JSON.stringify(
      fetchedPricingData,
      (_, value) =>
        typeof value === "number" && !Number.isFinite(value)
          ? "Infinity"
          : value,
      2,
    ),
    "utf8",
  );

  console.log("Saved pricing data to ./pricing-data.json");
}

// Read the pricing data

const raw = await readFile("./pricing-data.json", "utf8");
const pricingData = JSON.parse(raw);

// -----------------------------------------------------------------------------
// Set Mock metadata for testing
// -----------------------------------------------------------------------------

type TestCase = {
  name: string;
  sizeBytes: number;
  isCrossRegion: boolean;
  storageClass: string;
  retrievalSpeed: string;
  restoreWindowDays: number;
};

// Test Scenarios
const testCases: TestCase[] = [
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

const regions = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-south-1",
  "eu-west-1",
  "eu-west-2",
  "eu-central-1",
  "ca-central-1",
  "sa-east-1",
];

function calculateCostEstimate(
  testCase: TestCase,
  coldStorageRetrievalCosts: ColdStorageRetrievalCosts,
  crossRegionCosts: CrossRegionCosts,
  computeCosts: ComputeCosts,
): CostEstimate {
  return {
    crossRegionCostUSD: estimateCrossRegionCost(
      testCase.isCrossRegion,
      crossRegionCosts,
      testCase.sizeBytes,
    ),
    coldStorageRetrievalCostUSD: estimateColdStorageRetrievalCost(
      COLD_STORAGE_CLASSES.includes(
        testCase.storageClass as (typeof COLD_STORAGE_CLASSES)[number],
      ),
      testCase.sizeBytes,
      testCase.storageClass,
      testCase.retrievalSpeed,
      testCase.restoreWindowDays,
      coldStorageRetrievalCosts,
    ),
    computeCostUSD: estimateComputeCost(testCase.sizeBytes, computeCosts),
  };
}

const rows = testCases.map((testCase) => {
  const costEstimate = calculateCostEstimate(
    testCase,
    pricingData.coldStorageCosts,
    pricingData.crossRegionCosts,
    pricingData.computeCosts,
  );

  return {
    name: testCase.name,
    crossRegionCostUSD: costEstimate.crossRegionCostUSD,
    coldStorageRetrievalCostUSD: costEstimate.coldStorageRetrievalCostUSD,
    computeCostUSD: costEstimate.computeCostUSD,
    totalCostUSD:
      costEstimate.crossRegionCostUSD +
      costEstimate.coldStorageRetrievalCostUSD +
      costEstimate.computeCostUSD,
  };
});

console.table(rows);
