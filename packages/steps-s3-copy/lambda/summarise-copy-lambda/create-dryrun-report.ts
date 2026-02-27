import { readFileSync } from "fs";
import { join } from "path";
import {
  S3_CROSS_REGION_COPY_COST_PER_GB_AUD,
  GLACIER_RETRIEVAL_COSTS,
  LAMBDA_GB_SECOND_COST_AUD,
  LAMBDA_INVOCATION_COST_AUD,
  FARGATE_VCPU_COST_PER_HOUR_AUD,
  FARGATE_MEMORY_COST_PER_HOUR_AUD,
  FARGATE_MIN_BILLING_SECONDS,
  COST_LAST_UPDATED,
  COST_CHECK_URL,
} from "../common/constants";

// Load the HTML template
const REPORT_TEMPLATE = readFileSync(
  join(__dirname, "dryrun_report_template.html"),
  "utf8",
);

export interface FileSummary {
  name: string; // this is actually sourceKey, so need to filleter the valuer
  size: number;
  s3CrossRegionReadWriteCostAUD: number;
  coldStorageRetrievalCostAUD: number;
  computeCostAUD: number;
}

export interface DryRunReportInput {
  title: string;
  summSmall: FileSummary[];
  summLarge: FileSummary[];
  summSmallThaw: FileSummary[];
  summLargeThaw: FileSummary[];
}

// Convert number of bytes into human-readable format
function formatBytes(n?: number) {
  if (n === undefined) return "-";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0,
    v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)} ${units[i]}`;
}

function createFilesTable(...fileGroups: FileSummary[][]): string {
  // Flatten into one array
  const files: FileSummary[] = fileGroups.flat();
  // Now generate the table as before
  return `
    <div class="table-responsive">
      <table class="table table-sm table-hover align-middle table-fixed">
        <colgroup>
          <col style="width:40ch;">
          <col style="width:18ch;">
          <col style="width:22ch;">
          <col style="width:22ch;">
          <col style="width:22ch;">
        </colgroup>
        <thead>
          <tr>
            <th>Object</th>
            <th class="text-center">Size</th>
            <th class="text-center">S3 X-Region Cost (AUD)</th>
            <th class="text-center">Cold Storage Cost (AUD)</th>
            <th class="text-center">Compute Cost (AUD)</th>
          </tr>
        </thead>
        <tbody>
          ${files
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(
              (f) => `
                <tr>
                  <td class="cell-scroll">
                    <div class="cell-inner" title="${f.name}">${f.name}</div>
                  </td>
                  <td class="text-center">${formatBytes(f.size)}</td>
                  <td class="text-center">${f.s3CrossRegionReadWriteCostAUD.toFixed(
                    6,
                  )}</td>
                  <td class="text-center">${f.coldStorageRetrievalCostAUD.toFixed(
                    6,
                  )}</td>
                  <td class="text-center">${f.computeCostAUD.toFixed(6)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderCostSummaryBlock(
  totalS3CrossRegionReadWriteCost: number,
  totalColdCost: number,
  totalComputeCost: number,
  totalCost: number,
): string {
  return `
  <div class="row align-items-start">
    <!-- Left: Cost values -->
    <div class="col-lg-3 col-md-4 mb-3 d-flex flex-column">
      <ul class="list-unstyled mb-0 flex-grow-1 d-flex flex-column justify-content-center">
        <li class="mb-2">
          <span style="display: inline-block; width: 12px; height: 12px; background-color: #FF9900; border-radius: 2px; margin-right: 8px;"></span>
          <strong>S3 cross-region read/write:</strong>
          <span class="text-muted">$${totalS3CrossRegionReadWriteCost.toFixed(
            4,
          )} AUD</span>
        </li>
        <li class="mb-2">
          <span style="display: inline-block; width: 12px; height: 12px; background-color: #1EA591; border-radius: 2px; margin-right: 8px;"></span>
          <strong>Cold storage retrieval:</strong>
          <span class="text-muted">$${totalColdCost.toFixed(4)} AUD</span>
        </li>
        <li class="mb-2">
          <span style="display: inline-block; width: 12px; height: 12px; background-color: #527FFF; border-radius: 2px; margin-right: 8px;"></span>
          <strong>Compute:</strong>
          <span class="text-muted">$${totalComputeCost.toFixed(4)} AUD</span>
        </li>
        <li class="pt-2 mt-2 border-top">
          <strong class="h5">Total:</strong>
          <span class="h5 text-primary">$${totalCost.toFixed(4)} AUD</span>
        </li>
      </ul>
    </div>
    <!-- Center: Pie chart -->
    <div class="col-lg-4 col-md-4 mb-3 d-flex justify-content-center">
      <canvas id="costChart" style="max-width: 280px; max-height: 280px;"></canvas>
    </div>

    <!-- Right: Explanation -->
    <div class="col-lg-5 col-md-4 mb-3">
      <div class="p-3 bg-light rounded h-100">
        <h6 class="mb-3">
          <i class="bi bi-info-circle-fill text-info"></i>
          How are costs calculated?
        </h6>

        <ul class="small text-secondary mb-0 ps-3">
          <li class="mb-2">
              <strong>S3 cross-region read/write:</strong>
              <code>~$${S3_CROSS_REGION_COPY_COST_PER_GB_AUD} per GB transferred</code> between AWS regions (S3 in-region copies are free)
          </li>
          <li class="mb-2">
            <strong>Cold storage retrieval <span class="text-muted small">(varies by thaw speed and storage class):</span></strong>
            <ul class="mb-0 ps-3" style="font-family:monospace; font-size: 95%;">
              <li>
                <span style="color:#527FFF;"><strong>Glacier:</strong></span>
                Bulk $${GLACIER_RETRIEVAL_COSTS.GLACIER.Bulk}/GB,
                Standard $${GLACIER_RETRIEVAL_COSTS.GLACIER.Standard}/GB,
                Expedited $${GLACIER_RETRIEVAL_COSTS.GLACIER.Expedited}/GB
              </li>
              <li>
                <span style="color:#527FFF;"><strong>Deep Archive:</strong></span>
                Bulk $${GLACIER_RETRIEVAL_COSTS.DEEP_ARCHIVE.Bulk}/GB,
                Standard $${GLACIER_RETRIEVAL_COSTS.DEEP_ARCHIVE.Standard}/GB
              </li>
              <li>
                <span style="color:#527FFF;"><strong>Intelligent Tiering Archive Access:</strong></span>
                Bulk $${
                  GLACIER_RETRIEVAL_COSTS.INTELLIGENT_TIERING_ARCHIVE_ACCESS
                    .Bulk
                }/GB,
                Standard $${
                  GLACIER_RETRIEVAL_COSTS.INTELLIGENT_TIERING_ARCHIVE_ACCESS
                    .Standard
                }/GB,
                Expedited $${
                  GLACIER_RETRIEVAL_COSTS.INTELLIGENT_TIERING_ARCHIVE_ACCESS
                    .Expedited
                }/GB
              </li>
              <li>
                <span style="color:#527FFF;"><strong>Intelligent Tiering Deep Archive Access:</strong></span>
                Bulk $${
                  GLACIER_RETRIEVAL_COSTS
                    .INTELLIGENT_TIERING_DEEP_ARCHIVE_ACCESS.Bulk
                }/GB,
                Standard $${
                  GLACIER_RETRIEVAL_COSTS
                    .INTELLIGENT_TIERING_DEEP_ARCHIVE_ACCESS.Standard
                }/GB
              </li>
            </ul>
          </li>
          <li class="mb-2">
            <strong>Compute:</strong>
            <br>
            <code>
              Lambda: $${LAMBDA_GB_SECOND_COST_AUD} per GB-second × memory × duration, plus $${LAMBDA_INVOCATION_COST_AUD} per invocation<br>
              Fargate: $${FARGATE_VCPU_COST_PER_HOUR_AUD} per vCPU-hour, $${FARGATE_MEMORY_COST_PER_HOUR_AUD} per GB-hour (min ${FARGATE_MIN_BILLING_SECONDS}s)
            </code>
          </li>
        </ul>
        <p class="small text-muted fst-italic mb-0 mt-3">
          Based on official <a href="${COST_CHECK_URL}" target="_blank" rel="noopener">AWS pricing</a> (ap-southeast-2). Last updated: ${COST_LAST_UPDATED}.
        </p>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script>
    const ctx = document.getElementById('costChart').getContext('2d');
    new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ['S3 Cross-Region Read/Write', 'Cold Storage Retrieval', 'Compute'],
        datasets: [{
          data: [${totalS3CrossRegionReadWriteCost}, ${totalColdCost}, ${totalComputeCost}],
          backgroundColor: ['#FF9900', '#1EA591', '#527FFF'],
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.parsed || 0;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                return label + ': $' + value.toFixed(4) + ' AUD (' + percentage + '%)';
              }
            }
          }
        }
      }
    });
  </script>
`;
}

// Template filling: replaces {{TOKENS}} with values from vars.
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => vars[k] ?? "");
}

//

// Create the HTML report
export function createDryRunHtmlReport(opts: {
  title: string;
  summSmall?: FileSummary[];
  summLarge?: FileSummary[];
  summSmallThaw?: FileSummary[];
  summLargeThaw?: FileSummary[];
}): string {
  const {
    title,
    summSmall = [],
    summLarge = [],
    summSmallThaw = [],
    summLargeThaw = [],
  } = opts;

  // Combine all files for summary
  const allFiles = [
    ...summSmall,
    ...summLarge,
    ...summSmallThaw,
    ...summLargeThaw,
  ];

  // Calculate total costs (from all files)
  const totalS3CrossRegionReadWriteCost = allFiles.reduce(
    (sum, f) => sum + f.s3CrossRegionReadWriteCostAUD,
    0,
  );
  const totalColdCost = allFiles.reduce(
    (sum, f) => sum + f.coldStorageRetrievalCostAUD,
    0,
  );
  const totalComputeCost = allFiles.reduce(
    (sum, f) => sum + f.computeCostAUD,
    0,
  );
  const totalCost =
    totalS3CrossRegionReadWriteCost + totalColdCost + totalComputeCost;

  // Cost summary block
  const costHtml = renderCostSummaryBlock(
    totalS3CrossRegionReadWriteCost,
    totalColdCost,
    totalComputeCost,
    totalCost,
  );

  // Build tables for each group (only if non-empty)
  const filesTables = createFilesTable(
    summSmall,
    summLarge,
    summSmallThaw,
    summLargeThaw,
  );

  return fill(REPORT_TEMPLATE, {
    TITLE: title,
    COST_HTML: costHtml,
    FILES_TABLE: filesTables,
  });
}
