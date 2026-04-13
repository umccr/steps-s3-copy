import { readFileSync } from "fs";
import { join } from "path";
import type { ReportMetadata } from "./summarise-copy-lambda.ts";
import {
  createCostEstimationBlock,
  createFilesTableBlock,
  createDestinationTreeBlock,
  formatBytes,
  fill_template,
} from "./html-report-utils.ts";

import { fetchThawingCosts } from "../common/pricing.ts";

// Load the HTML template
const REPORT_TEMPLATE = readFileSync(
  join(__dirname, "report_template.html"),
  "utf8",
);

/* ---------- Stable, URL-safe row IDs ---------- */
function djb2(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  // force unsigned 32-bit
  return h >>> 0;
}
function rowIdFor(r: ReportMetadata): string {
  return `row-${djb2(
    (r.copyResultMetadata.destination || "").toLowerCase(),
  ).toString(36)}`;
}

// Create the HTML report
export async function createHtmlReport(opts: {
  title: string;
  destinationBucket: string;
  destinationFolderKey: string;
  reportMetadata: ReportMetadata[];
  dryRun: boolean;
}): Promise<string> {
  const {
    title,
    destinationBucket,
    destinationFolderKey,
    reportMetadata = [],
    dryRun,
  } = opts;

  // Combine all FileSummary entries into one array for the report
  const rows: (ReportMetadata & { rowId: string })[] = reportMetadata.map(
    (f) => ({ ...f, rowId: rowIdFor(f) }),
  );

  const total = rows.length;
  const copied = rows.filter(
    (r) => r.copyResultMetadata.status === "COPIED",
  ).length;
  const already = rows.filter(
    (r) => r.copyResultMetadata.status === "ALREADYCOPIED",
  ).length;
  const errors = rows.filter(
    (r) => r.copyResultMetadata.status === "ERROR",
  ).length;
  const totalBytes = rows.reduce(
    (a, r) => a + (r.copyResultMetadata.bytesTransferred ?? 0),
    0,
  );
  const avgSpeed = total
    ? rows.reduce((a, r) => a + (r.copyResultMetadata.speed || 0), 0) / total
    : 0;

  // Calculate total costs using only reportMetadata
  const totalS3CrossRegionReadWriteCost = reportMetadata.reduce(
    (sum, s) =>
      sum + s.copySetsMetadata.FileCostEstimate.s3CrossRegionReadWriteCostAUD,
    0,
  );
  const totalColdCost = reportMetadata.reduce(
    (sum, s) =>
      sum + s.copySetsMetadata.FileCostEstimate.coldStorageRetrievalCostUSD,
    0,
  );
  const totalComputeCost = reportMetadata.reduce(
    (sum, s) => sum + s.copySetsMetadata.FileCostEstimate.computeCostAUD,
    0,
  );
  const totalCost =
    totalS3CrossRegionReadWriteCost + totalColdCost + totalComputeCost;

  // Create cost estimation block HTML

  // Fetch cost info from API - Cost estimation is for of each item
  const thawingCosts = await fetchThawingCosts("ap-southeast-2");

  const costEstimationBlock = createCostEstimationBlock(
    totalS3CrossRegionReadWriteCost,
    totalColdCost,
    totalComputeCost,
    totalCost,
    thawingCosts,
  );

  // Create files table block HTML
  const filesTableBlock = createFilesTableBlock(rows);

  // For dry run, we only estimate costs, so we hide the copy tree and summary sections.
  let destinationTreeBlock = "";
  let displayDestinationTree = "";
  let displayCopySummary = "";

  if (dryRun) {
    displayDestinationTree = "d-none";
    displayCopySummary = "d-none";
    destinationTreeBlock = "";
  } else {
    displayDestinationTree = "";
    displayCopySummary = "";
    destinationTreeBlock = createDestinationTreeBlock(
      rows,
      destinationBucket,
      destinationFolderKey,
    );
  }
  return fill_template(REPORT_TEMPLATE, {
    TITLE: title,
    SUMMARY_TOTAL: String(total),
    SUMMARY_TOTAL_BYTES: formatBytes(totalBytes),
    SUMMARY_AVG_SPEED: avgSpeed.toFixed(2),
    SUMMARY_COPIED: String(copied),
    SUMMARY_ALREADY: String(already),
    SUMMARY_ERRORS: String(errors),
    DESTINATION_TREE_BLOCK: destinationTreeBlock,
    FILES_TABLE_BLOCK: filesTableBlock,
    S3_DESTINATION_PATH:
      "s3://" + destinationBucket + "/" + destinationFolderKey,
    COST_ESTIMATION_BLOCK: costEstimationBlock,
    DISPLAY_DESTINATION_TREE: displayDestinationTree,
    DISPLAY_COPY_SUMMARY: displayCopySummary,
  });
}
