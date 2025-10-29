export const REPORT_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{TITLE}}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <!-- Bootstrap 5 (CSS + JS) -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <script defer src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">

  <style>
    /* Set the height of the top row */
    :root { --top-row-h: 300px; }

    /* fixed-height card with scrolling body */
    .card.fixed-height {
      height: var(--top-row-h);
      display: flex;
      flex-direction: column;
      overflow: hidden; /* prevent the card itself from growing */
    }

    .card.fixed-height .card-body {
      flex: 1 1 auto;
      min-height: 0;               /* crucial for flex scrolling */
      overflow-y: auto;            /* vertical scroll when needed */
      overflow-x: auto;            /* horizontal scroll when needed */
      -webkit-overflow-scrolling: touch;
      scrollbar-gutter: stable both-edges; /* avoids layout shift when scrollbars appear */
    }

    /* Make long tree lines scroll horizontally instead of wrapping */
    .card.fixed-height .card-body .tree,
    .card.fixed-height .card-body .tree * {
      white-space: nowrap; /* keep on one line */
    }

    /* Make the whole tree use a code/monospace font */
    .tree {
      list-style: none;
      margin: 0;
      padding-left: 0;
      font-size: .95rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    }

    /* Keep links and summary text inheriting the same font */
    .tree a.file-link,
    .tree summary { font: inherit; }

    /* Pretty file tree */
    .tree { list-style:none; margin:0; padding-left:0; font-size:.95rem; }
    .tree li { margin:.15rem 0; }
    .tree summary { cursor:pointer; user-select:none; display:inline-flex; align-items:center; gap:.35rem; }

    /* toggle open/closed folder icons */
    .tree summary .folder-open { display:none; }
    .tree details[open] > summary .folder-closed { display:none; }
    .tree details[open] > summary .folder-open { display:inline-block; }

    /* files keep their icon (align nicely) */
    .tree .file { margin:.1rem 0; }
    .tree .file .file-name::before{
      content:"📄";                /* keep your existing file icon */
      display:inline-block;
      width:1.1rem;
      margin-right:.25rem;
      line-height:1;
      text-align:center;
    }

    /* nested lists (indent, no bullets) */
    .tree ul { list-style:none; margin:.2rem 0 .2rem .75rem; padding-left:.75rem; }

    /* links look clean */
    .tree a.file-link { color:inherit; text-decoration:none; border-radius:.25rem; padding:.1rem .2rem; }
    .tree a.file-link:hover, .tree a.file-link:focus { background:rgba(0,0,0,0.06); outline:none; }

    /* Palette for tree icons */
    :root{
      --folder-closed: #064db7c6;  /* grey-600 */
      --folder-open:   #92bfe7ff;  /* bootstrap primary */
    }

    /* Colour the two folder icons (we already toggle display via CSS) */
    .tree summary .folder-closed { color: var(--folder-closed); }
    .tree summary .folder-open   { color: var(--folder-open); }

    /* Optional: a subtle hover highlight on folder rows */
    .tree summary:hover { background: rgba(13,110,253,.06); border-radius: .25rem; }

    /* keep long paths on one line so X-scroll works in the fixed-height card */
    .card.fixed-height .card-body .tree,
    .card.fixed-height .card-body .tree * { white-space:nowrap; }

    /* Destination bucket chip */
    .dest-chip{
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      background: #f8f9fa;
      border: 1px solid rgba(0,0,0,.08);
      padding: .1rem .4rem;
      border-radius: .25rem;
      font-size: .85rem;
      cursor: pointer;
    }
    .dest-chip-clip{
      max-width:45ch;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }

    /* Popover panel */
    .popover.dest-popover { max-width: min(80vw, 720px); }

    /* The full path inside the popover */
    .dest-pop-pre{
      white-space: nowrap;
      overflow-x: auto;
      overflow-y: hidden;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    }
    .dest-pop-pre::-webkit-scrollbar{ height: 8px; }
    .dest-pop-pre::-webkit-scrollbar-thumb{ background: rgba(0,0,0,.25); border-radius: 8px; }
    .dest-pop-pre::-webkit-scrollbar-track{ background: transparent; }

    /* Row highlight for table */
    .table tbody tr.hl > * {
      background-color: rgba(0,0,0,0.08) !important;
      transition: background-color .4s ease;
    }

    /* Fixed layout + no wrapping; container will scroll horizontally if needed */
    .table-fixed { table-layout: fixed; white-space: nowrap; }

    /* Optional: keep headers aligned to the right for numeric cols */
    th.text-end, td.text-end { text-align: right; }

    /* Per-cell horizontal scrolling (appears only when needed) */
    td.cell-scroll { overflow: hidden; }
    td.cell-scroll .cell-inner{
      display: block;
      white-space: nowrap;      /* keep one line */
      overflow-x: auto;         /* show horizontal scrollbar if needed */
      overflow-y: hidden;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;    /* Firefox */
    }
    /* Optional: small scrollbar look in WebKit */
    td.cell-scroll .cell-inner::-webkit-scrollbar{ height:8px; }
    td.cell-scroll .cell-inner::-webkit-scrollbar-thumb{ background:rgba(0,0,0,.25); border-radius:8px; }
    td.cell-scroll .cell-inner::-webkit-scrollbar-track{ background:transparent; }

    /* Disable Bootstrap table-hover effect (optional) */
    .table-hover > tbody > tr:hover > * {
      --bs-table-accent-bg: transparent;
    }

    /* Add horizontal breathing room per cell */
    #copy-results th,
    #copy-results td {
      padding-left: 1rem;
      padding-right: 1rem;
    }
  </style>
</head>

<body class="bg-light">
  <div class="container py-4">
    <header class="mb-3">
      <h1 class="h3 mb-0">{{TITLE}}</h1>
    </header>

    <!-- Top row: Summary (left) + Tree (right) -->
    <div class="row g-3">
      <!-- Summary -->
      <div class="col-12 col-md-6">
        <div class="card shadow-sm fixed-height">
          <div class="card-header bg-white border-0">
            <h2 class="h5 mb-3">Summary</h2>
          </div>
          <div class="card-body">
            <div class="d-flex flex-wrap align-items-baseline gap-2 mb-2">
              <span class="text-secondary">Total files</span>
              <span class="fw-semibold">{{SUMMARY_TOTAL}}</span>
              <span class="text-secondary">•</span>
              <span class="text-secondary">Total size</span>
              <span class="fw-semibold">{{SUMMARY_TOTAL_BYTES}}</span>
            </div>

            <div class="mb-3 text-secondary">
              <span>Avg speed</span>
              <span class="fw-semibold text-dark">{{SUMMARY_AVG_SPEED}} MiB/s</span>
            </div>

            <div class="d-flex flex-wrap gap-2">
              <span class="badge text-bg-success">Copied {{SUMMARY_COPIED}}</span>
              <span class="badge text-bg-warning">Already exists {{SUMMARY_ALREADY}}</span>
              <span class="badge text-bg-danger">Errors {{SUMMARY_ERRORS}}</span>
            </div>

            <p class="text-secondary small mb-0 mt-3">
              Speeds are per-object averages.
            </p>

          </div>
        </div>
      </div>

      <!-- Destination Tree -->
      <div class="col-12 col-md-6">
        <div class="card shadow-sm fixed-height">
          <div class="card-header bg-white border-0">
            <div class="d-flex align-items-center justify-content-between gap-2">
              <h2 class="h5 mb-0">S3 destination:</h2>
              <!-- Popover trigger -->
              <code
                id="dest-chip"
                class="dest-chip dest-chip-clip d-inline-block text-truncate"
                data-bs-toggle="popover"
                data-bs-trigger="focus"
                data-bs-container="body"
                data-bs-placement="bottom"
                data-bs-html="true"
                data-bs-custom-class="dest-popover"
                data-bs-content="<pre class='dest-pop-pre m-0'><code>{{S3_DESTINATION_PATH}}</code></pre>"
                tabindex="0"
                role="button"
                aria-label="Show full path">
                {{S3_DESTINATION_PATH}}
              </code>
            </div>
            <div class="text-secondary small mt-2">
              Copied folder tree:
            </div>
          </div>
          <div class="card-body">
            <div class="small">
              {{TREE_HTML}}
            </div>
          </div>
        </div>
      </div>

      <!-- Table full-width -->
      <div class="col-12">
        <div class="card shadow-sm">
          <div class="card-body">
            <h2 class="h5 mb-3">Per-object copy results</h2>
            <div class="small">
              {{COPY_TABLE}}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div> <!-- /container -->
</body>

<script>
  (function () {
    function highlightRow(id) {
      const row = document.getElementById(id);
      if (!row) return;
      row.classList.add('hl');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => row.classList.remove('hl'), 2000);
    }

    // Click on any file in the tree → highlight the matching row
    document.addEventListener('click', function (e) {
      const a = e.target.closest && e.target.closest('a.file-link');
      if (!a) return;
      e.preventDefault();
      const id = a.dataset.target || (a.getAttribute('href') || '').replace(/^#/, '');
      if (id) {
        highlightRow(id);
        history.replaceState(null, '', '#' + id);
      }
    }, { passive: false });

    // If page loads with a #hash, highlight that row
    if (location.hash) {
      const id = location.hash.slice(1);
      setTimeout(() => highlightRow(id), 50);
    }
  })();
</script>

<script>
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-bs-toggle="popover"]')
    .forEach(el => new bootstrap.Popover(el));
});
</script>

</html>`;
