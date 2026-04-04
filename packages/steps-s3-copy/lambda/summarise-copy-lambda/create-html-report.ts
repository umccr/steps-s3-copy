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
export function createHtmlReport(opts: {
  title: string;
  destinationBucket: string;
  destinationFolderKey: string;
  reportMetadata: ReportMetadata[];
  dryRun: boolean;
}): string {
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
      sum + s.copySetsMetadata.FileCostEstimate.coldStorageRetrievalCostAUD,
    0,
  );
  const totalComputeCost = reportMetadata.reduce(
    (sum, s) => sum + s.copySetsMetadata.FileCostEstimate.computeCostAUD,
    0,
  );
  const totalCost =
    totalS3CrossRegionReadWriteCost + totalColdCost + totalComputeCost;

  // Create cost estimation block HTML
  const costEstimationBlock = createCostEstimationBlock(
    totalS3CrossRegionReadWriteCost,
    totalColdCost,
    totalComputeCost,
    totalCost,
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
    FILES_TABLE_TITLE: "Per-object copy results",
    FILES_TABLE_BLOCK: filesTableBlock,
    S3_DESTINATION_PATH:
      "s3://" + destinationBucket + "/" + destinationFolderKey,
    COST_ESTIMATION_BLOCK: costEstimationBlock,
    DISPLAY_DESTINATION_TREE: displayDestinationTree,
    DISPLAY_COPY_SUMMARY: displayCopySummary,
  });
}

// function createFilesTable(...fileGroups: ReportMetadata[][]): string {
//   // Flatten into one array
//   const files: ReportMetadata[] = fileGroups.flat();
//   // Now generate the table as before
//   return `
//     <div class="table-responsive">
//       <table class="table table-sm table-hover align-middle table-fixed">
//         <colgroup>
//           <col style="width:40ch;">
//           <col style="width:18ch;">
//           <col style="width:22ch;">
//           <col style="width:22ch;">
//           <col style="width:22ch;">
//         </colgroup>
//         <thead>
//           <tr>
//             <th>Object</th>
//             <th class="text-center">Size</th>
//             <th class="text-center">S3 X-Region Cost (AUD)</th>
//             <th class="text-center">Cold Storage Cost (AUD)</th>
//             <th class="text-center">Compute Cost (AUD)</th>
//           </tr>
//         </thead>
//         <tbody>
//           ${files
//             .slice()
//             .sort((a, b) => a.headObjectInfo.name.localeCompare(b.headObjectInfo.name))
//             .map(
//               (f) => `
//                 <tr>
//                   <td class="cell-scroll">
//                     <div class="cell-inner" title="${f.headObjectInfo.name}">${f.headObjectInfo.name}</div>
//                   </td>
//                   <td class="text-center">${formatBytes(f.headObjectInfo.size)}</td>
//                   <td class="text-center">${f.headObjectInfo.FileCostEstimate.s3CrossRegionReadWriteCostAUD.toFixed(
//                     6,
//                   )}</td>
//                   <td class="text-center">${f.headObjectInfo.FileCostEstimate.coldStorageRetrievalCostAUD.toFixed(
//                     6,
//                   )}</td>
//                   <td class="text-center">${f.headObjectInfo.FileCostEstimate.computeCostAUD.toFixed(6)}</td>
//                 </tr>
//               `,
//             )
//             .join("")}
//         </tbody>
//       </table>
//     </div>
//   `;
// }

// // Create the HTML report
// export function createDryRunHtmlReport(opts: {
//   title: string;
//   summSmall?: FileHeadObjectInfo[];
//   summLarge?: FileHeadObjectInfo[];
//   summSmallThaw?: FileHeadObjectInfo[];
//   summLargeThaw?: FileHeadObjectInfo[];
// }): string {
//   const {
//     title,
//     summSmall = [],
//     summLarge = [],
//     summSmallThaw = [],
//     summLargeThaw = [],
//   } = opts;

//   // Combine all files for summary
//   const allFiles = [
//     ...summSmall,
//     ...summLarge,
//     ...summSmallThaw,
//     ...summLargeThaw,
//   ];

//   // Calculate total costs (from all files)
//   const totalS3CrossRegionReadWriteCost = allFiles.reduce(
//     (sum, f) => sum + f.s3CrossRegionReadWriteCostAUD,
//     0,
//   );
//   const totalColdCost = allFiles.reduce(
//     (sum, f) => sum + f.coldStorageRetrievalCostAUD,
//     0,
//   );
//   const totalComputeCost = allFiles.reduce(
//     (sum, f) => sum + f.computeCostAUD,
//     0,
//   );
//   const totalCost =
//     totalS3CrossRegionReadWriteCost + totalColdCost + totalComputeCost;

//   // Cost summary block
//   const costEstimationBlock = renderCostSummaryBlock(
//     totalS3CrossRegionReadWriteCost,
//     totalColdCost,
//     totalComputeCost,
//     totalCost,
//   );

//   // Build tables for each group (only if non-empty)
//   const filesTables = createFilesTable(
//     summSmall,
//     summLarge,
//     summSmallThaw,
//     summLargeThaw,
//   );

//   return fill(REPORT_TEMPLATE, {
//     TITLE: title,
//     COST_ESTIMATION_BLOCK: costEstimationBlock,
//     FILES_TABLE_BLOCK: filesTables,
//     FILES_TABLE_TITLE: "Per-object estimated costs",
//     // For dry run, we only estimate costs, so we hide the copy tree and summary sections.
//     DISPLAY_DESTINATION_TREE: "d-none",
//     DISPLAY_COPY_SUMMARY: "d-none",
//   });
// }
