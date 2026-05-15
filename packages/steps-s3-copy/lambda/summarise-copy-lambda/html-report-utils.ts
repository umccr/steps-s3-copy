import { FARGATE_MIN_BILLING_SECONDS } from "../common/constants";

import type { ReportMetadata } from "./summarise-copy-lambda.ts";
import type {
  ColdStorageRetrievalCosts,
  CrossRegionCosts,
  ComputeCosts,
} from "../common/cost-estimation";

export const COST_CHECK_URL = "https://aws.amazon.com/s3/pricing/"; // Link to AWS official pricing page

// Template filling: replaces {{TOKENS}} with values from vars.
export function fill_template(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => vars[k] ?? "");
}

// Convert number of bytes into human-readable format
export const formatBytes = (n?: number) => {
  if (n === undefined) return "-";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0,
    v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)} ${units[i]}`;
};

// Format seconds as HH:MM:SS
export const secondsToHMS = (sec?: number) => {
  if (sec == null) return "-";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s / 60) % 60);
  const r = s % 60;
  return [h, m, r]
    .map((v, i) => (i === 0 ? String(v) : String(v).padStart(2, "0")))
    .join(":");
};

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
    if (typeof seg !== "string") continue;
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
  return `${files}${folders}`;
}

export function createDestinationTreeBlock(
  rows: (ReportMetadata & { rowId: string })[],
  destinationBucket: string,
  destinationFolderKey: string,
): string {
  return `<ul class="tree">${renderTree(
    buildDestinationTree(
      rows.map((r) => ({
        destination: r.copyResultMetadata.destination,
        rowId: r.rowId,
      })),
      "s3://" + destinationBucket + "/" + destinationFolderKey,
    ),
  )}</ul>`;
}

/**
 * Creates the files table block as HTML, given an array of report metadata objects.
 */

export function createFilesTableBlock(
  rows: (ReportMetadata & { rowId: string })[],
): string {
  return `
<style>
  .nav-tabs .nav-link {
    color: #495057;
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    border-bottom: none;
    font-weight: 500;
    min-width: 160px;
    box-sizing: border-box;
    transition: color 0.2s, background 0.2s, font-weight 0.2s, border-color 0.2s;
  }
  .nav-tabs .nav-link.active {
    color: #212529;
    background: #fff;
    font-weight: bold;
    border-color: #dee2e6 #dee2e6 #fff;
    border-bottom: none;
    z-index: 2;
  }
  .table-scroll-y {
    max-height: 400px; /* or height: 400px */
    overflow-y: auto;
  }
</style>
<div>
  <ul class="nav nav-tabs" id="fileTableTabs" role="tablist">
    <li class="nav-item" role="presentation">
      <button class="nav-link active" id="results-tab" data-bs-toggle="tab" data-bs-target="#results" type="button" role="tab" aria-controls="results" aria-selected="true">Copy Results</button>
    </li>
    <li class="nav-item" role="presentation">
      <button class="nav-link" id="costs-tab" data-bs-toggle="tab" data-bs-target="#costs" type="button" role="tab" aria-controls="costs" aria-selected="false">Estimated Cost</button>
    </li>
  </ul>

  <div class="tab-content border border-top-0 p-2" id="fileTableTabsContent">
    <div class="tab-pane show active" id="results" role="tabpanel" aria-labelledby="results-tab">
      <div class="table-responsive">
        <table id="copy-results" class="table table-sm table-hover align-middle table-fixed">
          <colgroup>
            <col style="width:32ch;">  <!-- Object -->
            <col style="width:14ch;">  <!-- Size -->
            <col style="width:14ch;">  <!-- Status -->
            <col style="width:14ch;">  <!-- Transferred -->
            <col style="width:18ch;">  <!-- Transf. speed (MiB/s) -->
            <col style="width:22ch;">  <!-- Elapsed time (hh:mm:ss) -->
            <col style="width:22ch;">  <!-- Message -->
            <col style="width:80ch;">  <!-- Destination path-->
          </colgroup>
          <thead>
            <tr>
              <th>Object</th>
              <th class="text-center">Size</th>
              <th class="text-center">Status</th>
              <th class="text-center">Transferred</th>
              <th class="text-center">Transf. speed (MiB/s)</th>
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
                  a.copyResultMetadata.destination.localeCompare(
                    b.copyResultMetadata.destination,
                  ) ||
                  a.copyResultMetadata.name.localeCompare(
                    b.copyResultMetadata.name,
                  ),
              )
              .map(
                (r) => `
                <tr id="${r.rowId}">
                  <td class="cell-scroll">
                    <div class="cell-inner" title="${
                      r.copyResultMetadata.name
                    }">${r.copyResultMetadata.name}</div>
                  </td>
                  <td class="text-center">${formatBytes(
                    r.copySetsMetadata.size,
                  )}</td>
                  <td class="text-center">
                    <span class="badge ${
                      r.copyResultMetadata.status === "COPIED"
                        ? "text-bg-success"
                        : r.copyResultMetadata.status === "ALREADYCOPIED"
                          ? "text-bg-warning"
                          : r.copyResultMetadata.status === "ESTIMATED"
                            ? "text-bg-secondary"
                            : "text-bg-danger"
                    }">
                      ${
                        r.copyResultMetadata.status === "COPIED"
                          ? "Copied"
                          : r.copyResultMetadata.status === "ALREADYCOPIED"
                            ? "Already exists"
                            : r.copyResultMetadata.status === "ESTIMATED"
                              ? "Estimated"
                              : "Error"
                      }
                    </span>
                  </td>
                  <td class="text-center">${formatBytes(
                    r.copyResultMetadata.bytesTransferred,
                  )}</td>
                  <td class="text-center">${(
                    r.copyResultMetadata.speed ?? 0
                  ).toFixed(2)}</td>
                  <td class="text-center">${secondsToHMS(
                    r.copyResultMetadata.elapsedSeconds,
                  )}</td>
                  <td class="cell-scroll">
                    <div class="cell-inner" title="${String(
                      r.copyResultMetadata.message ?? "",
                    )}">
                      ${String(r.copyResultMetadata.message ?? "")}
                    </div>
                  </td>
                  <td class="cell-scroll">
                    <div class="cell-inner" title="${
                      r.copyResultMetadata.destination
                    }">
                      ${r.copyResultMetadata.destination}
                    </div>
                  </td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="tab-pane" id="costs" role="tabpanel" aria-labelledby="costs-tab">
      <div class="table-responsive">
        <table id="costs-table" class="table table-sm table-hover align-middle table-fixed">
          <colgroup>
            <col style="width:18.2ch;">  <!-- Object -->
            <col style="width:7.9ch;">  <!-- Size -->
            <col style="width:18ch;">  <!-- Cross-Region Cost -->
            <col style="width:18ch;">  <!-- Cold Storage Retrieval Cost -->
            <col style="width:18ch;">  <!-- Compute Cost -->
          </colgroup>
          <thead>
            <tr>
              <th>Object</th>
              <th class="text-center">Size</th>
              <th class="text-center">Cross-Region Cost (USD)</th>
              <th class="text-center">Cold Storage Retrieval Cost (USD)</th>
              <th class="text-center">Compute Cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .slice()
              .sort(
                (a, b) =>
                  a.copyResultMetadata.destination.localeCompare(
                    b.copyResultMetadata.destination,
                  ) ||
                  a.copyResultMetadata.name.localeCompare(
                    b.copyResultMetadata.name,
                  ),
              )
              .map(
                (r) => `
                <tr id="cost-${r.rowId}">
                  <td class="cell-scroll">
                    <div class="cell-inner" title="${
                      r.copyResultMetadata.name
                    }">${r.copyResultMetadata.name}</div>
                  </td>
                  <td class="text-center">${formatBytes(
                    r.copySetsMetadata.size,
                  )}</td>
                  <td class="text-center">${
                    r.copySetsMetadata.costEstimate?.crossRegionCostUSD !==
                    undefined
                      ? r.copySetsMetadata.costEstimate.crossRegionCostUSD.toFixed(
                          6,
                        )
                      : "-"
                  }</td>
                  <td class="text-center">${
                    r.copySetsMetadata.costEstimate
                      ?.coldStorageRetrievalCostUSD !== undefined
                      ? r.copySetsMetadata.costEstimate.coldStorageRetrievalCostUSD.toFixed(
                          6,
                        )
                      : "-"
                  }</td>
                  <td class="text-center">${
                    r.copySetsMetadata.costEstimate?.computeCostUSD !==
                    undefined
                      ? r.copySetsMetadata.costEstimate.computeCostUSD.toFixed(
                          6,
                        )
                      : "-"
                  }</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>`;
}

/**
 * Creates the cost estimation block as HTML, including the pie chart and cost breakdowns.
 */
export function createCostEstimationBlock(
  totalCrossRegionCost: number,
  totalColdCost: number,
  totalComputeCost: number,
  totalCost: number,
  coldStorageRetrievalCosts: ColdStorageRetrievalCosts,
  crossRegionCosts: CrossRegionCosts,
  computeCosts: ComputeCosts,
): string {
  return `
	<div class="row align-items-start">
		<!-- Left: Cost values and pie chart -->
		<div class="col-lg-5 col-md-4 mb-2 d-flex flex-column">
      <!-- Pie chart -->
      <div class="d-flex justify-content-center">
    	<canvas id="costChart" style="max-width: 280px; max-height: 280px;"></canvas>
      </div>
      <br>
      <br>
      <!-- Cost breakdown -->
			<ul class="list-unstyled mb-0 flex-grow-1 d-flex flex-column justify-content-center">
				<li class="mb-2">
					<span style="display: inline-block; width: 12px; height: 12px; background-color: #FF9900; border-radius: 2px; margin-right: 8px;"></span>
					<strong>Cross-region:</strong>
					<span class="text-muted">$${totalCrossRegionCost.toFixed(4)} USD</span>
				</li>
				<li class="mb-2">
					<span style="display: inline-block; width: 12px; height: 12px; background-color: #1EA591; border-radius: 2px; margin-right: 8px;"></span>
					<strong>Cold storage retrieval:</strong>
					<span class="text-muted">$${totalColdCost.toFixed(4)} USD</span>
				</li>
				<li class="mb-2">
					<span style="display: inline-block; width: 12px; height: 12px; background-color: #527FFF; border-radius: 2px; margin-right: 8px;"></span>
					<strong>Compute:</strong>
					<span class="text-muted">$${totalComputeCost.toFixed(4)} USD</span>
				</li>
				<li class="pt-2 mt-2 border-top">
					<strong class="h5">Total:</strong>
					<span class="h5 text-primary">$${totalCost.toFixed(4)} USD</span>
				</li>
			</ul>
		</div>

		<!-- Right: Explanation -->
		<div class="col-lg-7 col-md-4 mb-2">
			<div class="p-3 bg-light rounded h-100">
				<h6 class="mb-3">
					<i class="bi bi-info-circle-fill text-info"></i>
					How are costs calculated?
				</h6>

        <ul class="small text-secondary mb-0 ps-3">

          <!-- Cross Region Costs -->
          <li class="mb-2">
            <strong>Cross-region:</strong>
            <ul class="mt-1 ps-3">
              <li>
                <span style="color:#527FFF;"><strong>Egress (tiered, per GB):</strong></span>
                <ul class="ps-3" style="font-family:monospace; font-size: 95%;">
                  ${crossRegionCosts.egressPriceTiers
                    .map((t) =>
                      t.endRangeGb === Infinity
                        ? `<li><code>&gt;${t.beginRangeGb.toLocaleString()} GB</code> → <code>$${t.pricePerGbUsd.toFixed(
                            4,
                          )} USD/GB</code></li>`
                        : `<li><code>${t.beginRangeGb.toLocaleString()} – ${t.endRangeGb.toLocaleString()} GB</code> → <code>$${t.pricePerGbUsd.toFixed(
                            4,
                          )} USD/GB</code></li>`,
                    )
                    .join("")}
                </ul>
              </li>
              <li class="mt-1">
                <span style="color:#527FFF;"><strong>PUT requests:</strong></span> <code>$${crossRegionCosts.putPricePerRequest.toFixed(
                  6,
                )} USD/request</code>
              </li>
              <li class="mt-1 text-muted">S3 in-region copies are free.</li>
            </ul>
          </li>

          <!-- Cold Storage Costs -->
          <li class="mb-2">
            <strong>Cold storage retrieval <span class="text-muted fw-normal">(varies by thaw speed and storage class)</span></strong>
            <ul class="mt-1 ps-3" style="font-family:monospace; font-size: 95%;">
              <li>
                <span style="color:#527FFF;"><strong>Glacier:</strong></span>
                Bulk <code>$${
                  coldStorageRetrievalCosts.GLACIER.Bulk.perGB
                }/GB</code>,
                Standard <code>$${
                  coldStorageRetrievalCosts.GLACIER.Standard.perGB
                }/GB</code>,
                Expedited <code>$${
                  coldStorageRetrievalCosts.GLACIER.Expedited.perGB
                }/GB</code>
              </li>
              <li>
                <span style="color:#527FFF;"><strong>Deep Archive:</strong></span>
                Bulk <code>$${
                  coldStorageRetrievalCosts.DEEP_ARCHIVE.Bulk.perGB
                }/GB</code>,
                Standard <code>$${
                  coldStorageRetrievalCosts.DEEP_ARCHIVE.Standard.perGB
                }/GB</code>
              </li>
              <li>
                <span style="color:#527FFF;"><strong>Intelligent Tiering Archive:</strong></span>
                Bulk <code>$${
                  coldStorageRetrievalCosts.INTELLIGENT_TIERING_ARCHIVE_ACCESS
                    .Bulk.perGB
                }/GB</code>,
                Standard <code>$${
                  coldStorageRetrievalCosts.INTELLIGENT_TIERING_ARCHIVE_ACCESS
                    .Standard.perGB
                }/GB</code>,
                Expedited <code>$${
                  coldStorageRetrievalCosts.INTELLIGENT_TIERING_ARCHIVE_ACCESS
                    .Expedited.perGB
                }/GB</code>
              </li>
              <li>
                <span style="color:#527FFF;"><strong>Intelligent Tiering Deep Archive:</strong></span>
                Bulk <code>$${
                  coldStorageRetrievalCosts
                    .INTELLIGENT_TIERING_DEEP_ARCHIVE_ACCESS.Bulk.perGB
                }/GB</code>,
                Standard <code>$${
                  coldStorageRetrievalCosts
                    .INTELLIGENT_TIERING_DEEP_ARCHIVE_ACCESS.Standard.perGB
                }/GB</code>
              </li>
            </ul>
          </li>

          <!-- Compute Costs -->
          <li class="mb-2">
            <strong>Compute:</strong>
            <ul class="mt-1 ps-3" style="font-family:monospace; font-size: 95%;">
              <li>
                <span style="color:#527FFF;"><strong>Lambda:</strong></span>
                <code>$${
                  computeCosts.lambda.gbSecondPrice
                }</code> per GB-second × memory × duration,
                plus <code>$${
                  computeCosts.lambda.invocationPrice
                }</code> per invocation
              </li>
              <li>
                <span style="color:#527FFF;"><strong>Fargate:</strong></span>
                <code>$${
                  computeCosts.fargate.vCpuPricePerHour
                }</code> per vCPU-hour,
                <code>$${
                  computeCosts.fargate.memoryGbPricePerHour
                }</code> per GB-hour
                <span class="text-muted">(min ${FARGATE_MIN_BILLING_SECONDS}s)</span>
              </li>
            </ul>
          </li>

        </ul>


        <p class="small text-muted fst-italic mb-0 mt-3">
					Based on official <a href="${COST_CHECK_URL}" target="_blank" rel="noopener">AWS pricing</a> (ap-southeast-2).
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
				labels: ['Cross-Region', 'Cold Storage Retrieval', 'Compute'],
				datasets: [{
					data: [${totalCrossRegionCost}, ${totalColdCost}, ${totalComputeCost}],
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
								const value = context.parsed || 0;
								const total = context.dataset.data.reduce((a, b) => a + b, 0);
								const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
								return '  $' + value.toFixed(4) + ' USD (' + percentage + '%)';
							}
						}
					}
				}
			}
		});
	</script>
`;
}
