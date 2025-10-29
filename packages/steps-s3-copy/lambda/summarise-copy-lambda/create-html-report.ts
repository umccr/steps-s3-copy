import { readFileSync } from "fs";
import { join } from "path";
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
 * destinationRoot is like "s3://umccr-temp-dev/fji/"
 * items[].destination is like "s3://umccr-temp-dev/fji/fastq/…/file.ext"
 * We:
 *   - label the root as destinationRoot without trailing slash
 *   - strip destinationRoot from each destination
 *   - insert remaining relative segments
 */

function buildDestinationTree(
  items: { destination: string; rowId: string }[],
  destinationRoot: string,
): TreeNode {
  const rootLabel = destinationRoot.replace(/\/+$/, "");
  const root = makeNode(rootLabel);

  const prefix = rootLabel + "/";
  for (const it of items) {
    const full = it.destination;
    if (!full.startsWith(prefix)) continue;
    const rel = full.slice(prefix.length); // "fastq/.../file.ext"
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
  });
}
