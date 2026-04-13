import {
  S3_CROSS_REGION_COPY_COST_PER_GB_AUD,
  LAMBDA_GB_SECOND_COST_AUD,
  LAMBDA_INVOCATION_COST_AUD,
  FARGATE_VCPU_COST_PER_HOUR_AUD,
  FARGATE_MEMORY_COST_PER_HOUR_AUD,
  FARGATE_MIN_BILLING_SECONDS,
  COST_LAST_UPDATED,
  COST_CHECK_URL,
} from "../common/constants";

import type { ReportMetadata } from "./summarise-copy-lambda.ts";
import type { ThawingCosts } from "../common/pricing";

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

    <div class="tab-pane" id="costs" role="tabpanel" aria-labelledby="costs-tab" style="margin-left: 12.5px;">
      <div class="table-responsive">
        <table class="table table-sm table-hover align-middle table-fixed">
          <colgroup>
            <col style="width:15.5ch;">  <!-- Object -->
            <col style="width:14ch;">  <!-- Size -->
            <col style="width:18ch;">  <!-- S3 Cross-Region Cost -->
            <col style="width:18ch;">  <!-- Cold Storage Retrieval Cost -->
            <col style="width:18ch;">  <!-- Compute Cost -->
          </colgroup>
          <thead>
            <tr>
              <th>Object</th>
              <th class="text-center">Size</th>
              <th class="text-center">S3 Cross-Region Cost (AUD)</th>
              <th class="text-center">Cold Storage Retrieval Cost (AUD)</th>
              <th class="text-center">Compute Cost (AUD)</th>
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
                    r.copySetsMetadata.FileCostEstimate
                      ?.s3CrossRegionReadWriteCostAUD !== undefined
                      ? r.copySetsMetadata.FileCostEstimate.s3CrossRegionReadWriteCostAUD.toFixed(
                          6,
                        )
                      : "-"
                  }</td>
                  <td class="text-center">${
                    r.copySetsMetadata.FileCostEstimate
                      ?.coldStorageRetrievalCostUSD !== undefined
                      ? r.copySetsMetadata.FileCostEstimate.coldStorageRetrievalCostUSD.toFixed(
                          6,
                        )
                      : "-"
                  }</td>
                  <td class="text-center">${
                    r.copySetsMetadata.FileCostEstimate?.computeCostAUD !==
                    undefined
                      ? r.copySetsMetadata.FileCostEstimate.computeCostAUD.toFixed(
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
  totalS3CrossRegionReadWriteCost: number,
  totalColdCost: number,
  totalComputeCost: number,
  totalCost: number,
  thawingCosts: ThawingCosts,
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
					<!-- Cross Region Costs -->
					<li class="mb-2">
							<strong>S3 cross-region read/write:</strong>
							<code>~$${S3_CROSS_REGION_COPY_COST_PER_GB_AUD} per GB transferred</code> between AWS regions (S3 in-region copies are free)
					</li>

					<!-- Cold Storage Costs -->
          <li class="mb-2">
          <strong>Cold storage retrieval <span class="text-muted small">(varies by thaw speed and storage class):</span></strong>
          <ul class="mb-0 ps-3" style="font-family:monospace; font-size: 95%;">
            <li>
              <span style="color:#527FFF;"><strong>Glacier:</strong></span>
              Bulk $${thawingCosts.GLACIER.Bulk.perGB}/GB,
              Standard $${thawingCosts.GLACIER.Standard.perGB}/GB,
              Expedited $${thawingCosts.GLACIER.Expedited.perGB}/GB
            </li>
            <li>
              <span style="color:#527FFF;"><strong>Deep Archive:</strong></span>
              Bulk $${thawingCosts.DEEP_ARCHIVE.Bulk.perGB}/GB,
              Standard $${thawingCosts.DEEP_ARCHIVE.Standard.perGB}/GB
            </li>
            <li>
              <span style="color:#527FFF;"><strong>Intelligent Tiering Archive Access:</strong></span>
              Bulk $${
                thawingCosts.INTELLIGENT_TIERING_ARCHIVE_ACCESS.Bulk.perGB
              }/GB,
              Standard $${
                thawingCosts.INTELLIGENT_TIERING_ARCHIVE_ACCESS.Standard.perGB
              }/GB,
              Expedited $${
                thawingCosts.INTELLIGENT_TIERING_ARCHIVE_ACCESS.Expedited.perGB
              }/GB
            </li>
            <li>
              <span style="color:#527FFF;"><strong>Intelligent Tiering Deep Archive Access:</strong></span>
              Bulk $${
                thawingCosts.INTELLIGENT_TIERING_DEEP_ARCHIVE_ACCESS.Bulk.perGB
              }/GB,
              Standard $${
                thawingCosts.INTELLIGENT_TIERING_DEEP_ARCHIVE_ACCESS.Standard
                  .perGB
              }/GB
            </li>
          </ul>
          </li>

					<!-- Compute Costs -->
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

// <li class="mb-2">
// 	<strong>Cold storage retrieval <span class="text-muted small">(varies by thaw speed and storage class):</span></strong>
// 	<ul class="mb-0 ps-3" style="font-family:monospace; font-size: 95%;">
// 		<li>
// 			<span style="color:#527FFF;"><strong>Glacier:</strong></span>
// 			Bulk $${thawingCosts.GLACIER.Bulk}/GB,
// 			Standard $${thawingCosts.GLACIER.Standard}/GB,
// 			Expedited $${thawingCosts.GLACIER.Expedited}/GB
// 		</li>
// 		<li>
// 			<span style="color:#527FFF;"><strong>Deep Archive:</strong></span>
// 			Bulk $${thawingCosts.DEEP_ARCHIVE.Bulk}/GB,
// 			Standard $${thawingCosts.DEEP_ARCHIVE.Standard}/GB
// 		</li>
// 		<li>
// 			<span style="color:#527FFF;"><strong>Intelligent Tiering Archive Access:</strong></span>
// 			Bulk $${thawingCosts.INTELLIGENT_TIERING_ARCHIVE_ACCESS.Bulk}/GB,
// 			Standard $${
//         thawingCosts.INTELLIGENT_TIERING_ARCHIVE_ACCESS
//           .Standard
//       }/GB,
// 			Expedited $${
//         thawingCosts.INTELLIGENT_TIERING_ARCHIVE_ACCESS
//           .Expedited
//       }/GB
// 		</li>
// 		<li>
// 			<span style="color:#527FFF;"><strong>Intelligent Tiering Deep Archive Access:</strong></span>
// 			Bulk $${
//         thawingCosts
//           .INTELLIGENT_TIERING_DEEP_ARCHIVE_ACCESS.Bulk
//       }/GB,
// 			Standard $${
//         thawingCosts
//           .INTELLIGENT_TIERING_DEEP_ARCHIVE_ACCESS.Standard
//       }/GB
// 		</li>
// 	</ul>
// </li>
