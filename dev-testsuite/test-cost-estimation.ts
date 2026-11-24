import { writeFile, readFile } from "node:fs/promises";
import * as fs from "fs";
import * as path from "path";
import {
  SIZE_THRESHOLD_BYTES,
  checkColdStorage,
} from "../packages/steps-s3-copy/lambda/common/constants";

import type {
  CostEstimate,
  ColdStorageRetrievalCosts,
  CrossRegionCosts,
  EgressCosts,
  ComputeCosts,
} from "../packages/steps-s3-copy/lambda//common/cost-estimation";

import {
  fetchColdStorageRetrievalCosts,
  estimateColdStorageRetrievalCost,
  fetchCrossRegionCosts,
  estimateCrossRegionCost,
  fetchEgressCosts,
  estimateEgressCost,
  fetchComputeCosts,
  estimateComputeCost,
} from "../packages/steps-s3-copy/lambda//common/cost-estimation";

// -----------------------------------------------------------------------------
// If pricingFile (pricing-data.json) doesn't exist, fetch cost data from API for
//  source region Syd (ap-southeast-2) and write it.
// -----------------------------------------------------------------------------
const pricingFile = path.resolve(__dirname, "pricing-data.json");
const pricingFileExists = fs.existsSync(pricingFile);

if (!pricingFileExists) {
  const sourceRegion = "ap-southeast-1";
  const destinationRegion = "ap-southeast-2";

  const coldStorageCosts = await fetchColdStorageRetrievalCosts(sourceRegion);
  const crossRegionCosts = await fetchCrossRegionCosts(
    sourceRegion,
    destinationRegion,
  );
  const egressCosts = await fetchEgressCosts(sourceRegion);
  const computeCosts = await fetchComputeCosts(sourceRegion);

  const fetchedPricingData = {
    coldStorageCosts,
    crossRegionCosts,
    egressCosts,
    computeCosts,
    fetchedAt: new Date().toISOString(),
  };

  await writeFile(
    pricingFile,
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

// -----------------------------------------------------------------------------
// Read the pricing data
// -----------------------------------------------------------------------------

const raw = await readFile("./pricing-data.json", "utf8");
const pricingData = JSON.parse(raw);

// -----------------------------------------------------------------------------
// Set Mock metadata for testing
// -----------------------------------------------------------------------------

type TestCase = {
  name: string;
  sizeBytes: number;
  isCrossRegion: boolean;
  isOutsideAws?: boolean;
  storageClass: string;
  archiveStatus?: string;
  retrievalSpeed: string;
  restoreWindowDays: number;
};

// Definitions of dofferent test cases
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
    name: "Small file, outside AWS",
    sizeBytes: 100 * 1024 * 1024,
    isCrossRegion: false,
    isOutsideAws: true,
    storageClass: "STANDARD",
    retrievalSpeed: "Standard",
    restoreWindowDays: 7,
  },
  {
    name: "Egress tier 2 (>10TB), outside AWS",
    sizeBytes: 11 * 1024 * 1024 * 1024 * 1024,
    isCrossRegion: false,
    isOutsideAws: true,
    storageClass: "STANDARD",
    retrievalSpeed: "Standard",
    restoreWindowDays: 7,
  },
  {
    name: "Egress tier 3 (>50TB), outside AWS",
    sizeBytes: 52 * 1024 * 1024 * 1024 * 1024,
    isCrossRegion: false,
    isOutsideAws: true,
    storageClass: "STANDARD",
    retrievalSpeed: "Standard",
    restoreWindowDays: 7,
  },
  {
    name: "Egress tier 4 (>150TB), outside AWS",
    sizeBytes: 155 * 1024 * 1024 * 1024 * 1024,
    isCrossRegion: false,
    isOutsideAws: true,
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
    archiveStatus: "ARCHIVE_ACCESS",
    retrievalSpeed: "Expedited",
    restoreWindowDays: 7,
  },
  {
    name: "Intelligent Tiering Deep Archive, cross-region",
    sizeBytes: 5 * 1024 * 1024 * 1024,
    isCrossRegion: true,
    storageClass: "INTELLIGENT_TIERING",
    archiveStatus: "DEEP_ARCHIVE_ACCESS",
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

function calculateCostEstimate(
  testCase: TestCase,
  coldStorageRetrievalCosts: ColdStorageRetrievalCosts,
  crossRegionCosts: CrossRegionCosts,
  egressCosts: EgressCosts,
  computeCosts: ComputeCosts,
): CostEstimate {
  return {
    crossRegionCostUSD: estimateCrossRegionCost(
      testCase.isCrossRegion,
      crossRegionCosts,
      testCase.sizeBytes,
    ),
    egressCostUSD: estimateEgressCost(
      testCase.isOutsideAws ?? false,
      egressCosts,
      testCase.sizeBytes,
    ),
    coldStorageRetrievalCostUSD: estimateColdStorageRetrievalCost(
      checkColdStorage(testCase.storageClass, testCase.archiveStatus),
      testCase.sizeBytes,
      testCase.storageClass,
      testCase.archiveStatus,
      testCase.retrievalSpeed,
      testCase.restoreWindowDays,
      coldStorageRetrievalCosts,
    ),
    computeCostUSD: estimateComputeCost(testCase.sizeBytes, computeCosts),
  };
}

// For each test case, calculate costs and build a summary row
const rows = testCases.map((testCase) => {
  const costEstimate = calculateCostEstimate(
    testCase,
    pricingData.coldStorageCosts,
    pricingData.crossRegionCosts,
    pricingData.egressCosts,
    pricingData.computeCosts,
  );

  return {
    name: testCase.name,
    crossRegionCostUSD: costEstimate.crossRegionCostUSD,
    egressCostUSD: costEstimate.egressCostUSD,
    coldStorageRetrievalCostUSD: costEstimate.coldStorageRetrievalCostUSD,
    computeCostUSD: costEstimate.computeCostUSD,
    totalCostUSD:
      costEstimate.crossRegionCostUSD +
      costEstimate.egressCostUSD +
      costEstimate.coldStorageRetrievalCostUSD +
      costEstimate.computeCostUSD,
  };
});

// Print the cost estimate summary as a formatted table
console.table(rows);
