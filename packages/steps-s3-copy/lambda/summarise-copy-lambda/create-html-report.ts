import { readFileSync } from "fs";
import { join } from "path";

// Load the HTML template
const REPORT_TEMPLATE = readFileSync(
  join(__dirname, "report_template.html"),
  "utf8",
);

export type TransferStatus = "ERROR" | "ALREADYCOPIED" | "COPIED";

export interface FileResult {
  name: string;
  status: TransferStatus;
  speed: number;
  message: string | number;
  destination: string;
  bytesTransferred?: number;
  elapsedSeconds?: number;
}

export interface CostEstimate {
  getCostAUD: number;
  putCostAUD: number;
  coldStorageRetrievalCostAUD: number;
  computeCostAUD: number;
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

// Format seconds as HH:MM:SS
const secondsToHMS = (sec?: number) => {
  if (sec == null) return "-";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s / 60) % 60);
  const r = s % 60;
  return [h, m, r]
    .map((v, i) => (i === 0 ? String(v) : String(v).padStart(2, "0")))
    .join(":");
};

/* ---------- Stable, URL-safe row IDs ---------- */
function djb2(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  // force unsigned 32-bit
  return h >>> 0;
}
function rowIdFor(r: FileResult) {
  // Use destination if present, else name; base36 keeps it compact
  return `row-${djb2((r.destination || r.name || "").toLowerCase()).toString(
    36,
  )}`;
}

/* ---- Simple directry tree ---- */

type TreeNode = {
  name: string;
  children: Map<string, TreeNode>;
  files: { name: string; rowId: string }[];
};

const makeNode = (name: string): TreeNode => ({
  name,
  children: new Map(),
  files: [],
});

const insertPath = (root: TreeNode, parts: string[], rowId: string) => {
  let node = root;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    const isFile = i === parts.length - 1;
    if (isFile) {
      node.files.push({ name: seg, rowId });
    } else {
      if (!node.children.has(seg)) node.children.set(seg, makeNode(seg));
      node = node.children.get(seg)!;
    }
  }
};

/**
 * destinationRoot is like "s3://a-bucket/a/give/path/"
 * items[].destination is like "s3://a-bucket/a/give/path/fastq/…/file.fastq"
 * We:
 *   - label the root as destinationRoot without trailing slash
 *   - strip destinationRoot from each destination
 *   - insert remaining relative segments
 */

function buildDestinationTree(
  items: { destination: string; rowId: string }[],
  destinationRoot: string,
): TreeNode {
  const rootLabel = destinationRoot.slice(0, -1);
  const root = makeNode(rootLabel);

  const prefix = destinationRoot;
  for (const it of items) {
    const full = it.destination;
    if (!full.startsWith(prefix)) continue;
    const rel = full.slice(prefix.length);
    if (!rel) continue;

    const parts = rel.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    insertPath(root, parts, it.rowId);
  }

  return root;
}

function renderTree(node: TreeNode): string {
  const files = node.files
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (f) => `
      <li class="file">
        <a class="file-link" href="#${f.rowId}" data-target="${f.rowId}">
          <span class="file-name">${f.name}</span>
        </a>
      </li>`,
    )
    .join("");

  const folders = Array.from(node.children.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (ch) => `
      <li class="folder">
        <details open>
          <summary>
            <i class="bi bi-folder-fill folder-closed"></i>
            <i class="bi bi-folder-fill folder-open"></i>
            <span class="folder-name">${ch.name}</span>
          </summary>
          <ul>${renderTree(ch)}</ul>
        </details>
      </li>`,
    )
    .join("");

  return `${folders}${files}`;
}

/** Render including the root line (bucket/prefix) */
function renderTreeRooted(root: TreeNode): string {
  return `
    <ul class="tree">
      <li class="folder">
        <details open>
          <summary><span class="folder-name">${root.name}</span></summary>
          <ul>${renderTree(root)}</ul>
        </details>
      </li>
    </ul>`.trim();
}

// Template filling: replaces {{TOKENS}} (UPPERCASE letters, digits, underscores) with values from `vars`
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => vars[k] ?? "");
}

// Create the HTML report
export function createHtmlReport(opts: {
  title: string;
  records: FileResult[];
  destinationBucket: string;
  destinationFolderKey: string;
  costsSmall?: CostEstimate;
  costsLarge?: CostEstimate;
  costsSmallThaw?: CostEstimate;
  costsLargeThaw?: CostEstimate;
}): string {
  const { title, records, destinationBucket, destinationFolderKey } = opts;

  // Precompute IDs once
  const rows = records.map((r) => ({ ...r, rowId: rowIdFor(r) }));

  const total = rows.length;
  const copied = rows.filter((r) => r.status === "COPIED").length;
  const already = rows.filter((r) => r.status === "ALREADYCOPIED").length;
  const errors = rows.filter((r) => r.status === "ERROR").length;
  const totalBytes = rows.reduce((a, r) => a + (r.bytesTransferred ?? 0), 0);
  const avgSpeed = total
    ? rows.reduce((a, r) => a + (r.speed || 0), 0) / total
    : 0;

  // Calculate total costs
  const totalGetCost =
    (opts.costsSmall?.getCostAUD || 0) +
    (opts.costsLarge?.getCostAUD || 0) +
    (opts.costsSmallThaw?.getCostAUD || 0) +
    (opts.costsLargeThaw?.getCostAUD || 0);
  const totalPutCost =
    (opts.costsSmall?.putCostAUD || 0) +
    (opts.costsLarge?.putCostAUD || 0) +
    (opts.costsSmallThaw?.putCostAUD || 0) +
    (opts.costsLargeThaw?.putCostAUD || 0);
  const totalColdCost =
    (opts.costsSmall?.coldStorageRetrievalCostAUD || 0) +
    (opts.costsLarge?.coldStorageRetrievalCostAUD || 0) +
    (opts.costsSmallThaw?.coldStorageRetrievalCostAUD || 0) +
    (opts.costsLargeThaw?.coldStorageRetrievalCostAUD || 0);
  const totalComputeCost =
    (opts.costsSmall?.computeCostAUD || 0) +
    (opts.costsLarge?.computeCostAUD || 0) +
    (opts.costsSmallThaw?.computeCostAUD || 0) +
    (opts.costsLargeThaw?.computeCostAUD || 0);
  const totalCost =
    totalGetCost + totalPutCost + totalColdCost + totalComputeCost;

  const costHtml = `
  <div class="row align-items-start">
<!-- Left: Cost values -->
<div class="col-lg-3 col-md-4 mb-3 d-flex flex-column">
  <ul class="list-unstyled mb-0 flex-grow-1 d-flex flex-column justify-content-center">
    <li class="mb-2">
      <span style="display: inline-block; width: 12px; height: 12px; background-color: #527FFF; border-radius: 2px; margin-right: 8px;"></span>
      <strong>GET requests:</strong>
      <span class="text-muted">$${totalGetCost.toFixed(4)} AUD</span>
    </li>
    <li class="mb-2">
      <span style="display: inline-block; width: 12px; height: 12px; background-color: #FF9900; border-radius: 2px; margin-right: 8px;"></span>
      <strong>PUT requests:</strong>
      <span class="text-muted">$${totalPutCost.toFixed(4)} AUD</span>
    </li>
    <li class="mb-2">
      <span style="display: inline-block; width: 12px; height: 12px; background-color: #1EA591; border-radius: 2px; margin-right: 8px;"></span>
      <strong>Cold storage retrieval:</strong>
      <span class="text-muted">$${totalColdCost.toFixed(4)} AUD</span>
    </li>
    <li class="mb-2">
      <span style="display: inline-block; width: 12px; height: 12px; background-color: #687078; border-radius: 2px; margin-right: 8px;"></span>
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
            <strong>GET:</strong>
            <code>XXX</code> per 1k requests + <code>XXX</code> per GB retrieved
          </li>
          <li class="mb-2">
            <strong>PUT:</strong>
            <code>XXX</code> per 1k requests
          </li>
          <li class="mb-2">
            <strong>Cold storage:</strong>
            <code>XXX</code> per GB for Glacier retrieval
          </li>
          <li class="mb-2">
            <strong>Compute:</strong>
            <code>XXX</code> per GB-second × memory × duration
          </li>
        </ul>
        <p class="small text-muted fst-italic mb-0 mt-3">
          Estimates based on AWS pricing (ap-southeast-2). Actual costs may vary.
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
        labels: ['GET Requests', 'PUT Requests', 'Cold Storage Retrieval', 'Compute'],
        datasets: [{
          data: [${totalGetCost}, ${totalPutCost}, ${totalColdCost}, ${totalComputeCost}],
          backgroundColor: ['#527FFF', '#FF9900', '#1EA591', '#687078'],
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            display: false  // Hide the legend
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
  const copyTable = `
<div class="table-responsive">
  <table id="copy-results" class="table table-sm table-hover align-middle table-fixed">
    <colgroup>
      <col style="width:32ch;">  <!-- Object -->
      <col style="width:14ch;">  <!-- Status -->
      <col style="width:18ch;">  <!-- Transfer speed (MiB/s) -->
      <col style="width:14ch;">  <!-- Size -->
      <col style="width:22ch;">  <!-- Elapsed time (hh:mm:ss) -->
      <col style="width:22ch;">  <!-- Message -->
      <col style="width:80ch;">  <!-- Destination path-->
    </colgroup>
    <thead>
      <tr>
        <th>Object</th>
        <th>Status</th>
        <th class="text-center">Transfer speed (MiB/s)</th>
        <th class="text-center">Size</th>
        <th class="text-center">Elapsed time (hh:mm:ss)</th>
        <th>Message</th>
        <th>Destination path</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .slice()
        .sort(
          (a, b) =>
            a.destination.localeCompare(b.destination) ||
            a.name.localeCompare(b.name),
        )
        .map(
          (r) => `
          <tr id="${r.rowId}">
            <td class="cell-scroll">
              <div class="cell-inner" title="${r.name}">${r.name}</div>
            </td>
<td class="text-center">
  <span class="badge ${
    r.status === "COPIED"
      ? "text-bg-success"
      : r.status === "ALREADYCOPIED"
        ? "text-bg-warning"
        : "text-bg-danger"
  }">
    ${
      r.status === "COPIED"
        ? "Copied"
        : r.status === "ALREADYCOPIED"
          ? "Already exists"
          : "Error"
    }
  </span>
</td>

            <td class="text-center">${(r.speed ?? 0).toFixed(2)}</td>
            <td class="text-center">${formatBytes(r.bytesTransferred)}</td>
            <td class="text-center">${secondsToHMS(r.elapsedSeconds)}</td>

            <td class="cell-scroll">
              <div class="cell-inner" title="${String(r.message ?? "")}">
                ${String(r.message ?? "")}
              </div>
            </td>

            <td class="cell-scroll">
              <div class="cell-inner" title="${r.destination}">
                ${r.destination}
              </div>
            </td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>
</div>`;

  // Build destination tree HTML
  const treeHtml = `<ul class="tree">${renderTree(
    buildDestinationTree(
      rows.map((r) => ({ destination: r.destination, rowId: r.rowId })),
      "s3://" + destinationBucket + "/" + destinationFolderKey,
    ),
  )}</ul>`;

  return fill(REPORT_TEMPLATE, {
    TITLE: title,
    SUMMARY_TOTAL: String(total),
    SUMMARY_TOTAL_BYTES: formatBytes(totalBytes),
    SUMMARY_AVG_SPEED: avgSpeed.toFixed(2),
    SUMMARY_COPIED: String(copied),
    SUMMARY_ALREADY: String(already),
    SUMMARY_ERRORS: String(errors),
    TREE_HTML: treeHtml,
    COPY_TABLE: copyTable,
    S3_DESTINATION_PATH:
      "s3://" + destinationBucket + "/" + destinationFolderKey,
    COST_HTML: costHtml,
  });
}
