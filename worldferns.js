// World Ferns comparison: WF vs PPG at genus level and above, shown with Tabulator.
//
// Data (built by scripts/build-wf-data.R) lives in wf-data/:
//   meta.json, wf.json ({columns: [{field, title}], data: [{row}, ...]})
import { toCSV, csvSafe } from "./resolver-lib.js";

const TABULATOR_VERSION = "6.3.0";
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/tabulator/${TABULATOR_VERSION}`;

const $ = (id) => document.getElementById(id);
const el = {
  version: $("wf-version"),
  status: $("wf-status"),
  toggle: $("wf-toggle"),
  count: $("wf-count"),
  reset: $("wf-reset"),
  download: $("wf-download"),
};

function setStatus(msg, kind = "secondary") {
  el.status.className = `alert alert-${kind} py-2`;
  el.status.textContent = msg;
  el.status.hidden = !msg;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

function loadCSS(href) {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  document.head.appendChild(l);
}

async function main() {
  const [meta, wf] = await Promise.all([
    fetch("wf-data/meta.json").then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
    fetch("wf-data/wf.json").then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
    (async () => {
      loadCSS(`${CDN}/css/tabulator.min.css`);
      await loadScript(`${CDN}/js/tabulator.min.js`);
    })(),
  ]);

  el.version.textContent =
    `World Ferns version: ${meta.wf_version ?? "unknown"} | ` +
    `PPG version: ${meta.ppg_version ?? "unknown"}`;

  // wf.json rows are an array of objects (null -> "")
  const rows = wf.data.map((r) => {
    const o = {};
    for (const { field } of wf.columns) o[field] = r[field] ?? "";
    return o;
  });
  const n = rows.length;

  const columns = wf.columns.map(({ field, title }) => ({
    title,
    field,
    headerFilter: "input",
    headerFilterFunc: "like",
    headerFilterPlaceholder: "All",
    headerFilterLiveFilter: true,
    minWidth: field === "taxon" ? 160 : 110,
  }));

  const hasSameTreatment = wf.columns.some((c) => c.field === "same_treatment");
  let diffOnly = hasSameTreatment; // default: only taxa treated differently

  const table = new Tabulator("#wf-table", {
    data: rows,
    columns,
    layout: "fitDataStretch",
    height: "70vh",
    pagination: true,
    paginationSize: 25,
    paginationSizeSelector: [10, 25, 50, 100, 250],
    paginationCounter: "rows",
    headerFilterLiveFilterDelay: 300,
    initialSort: [{ column: "taxon", dir: "asc" }],
  });

  function applyFilters() {
    if (diffOnly) table.setFilter((d) => d.same_treatment === "FALSE");
    else table.clearFilter();
    el.toggle.textContent = diffOnly
      ? "Show All Taxa"
      : "Show Different Treatment Only";
  }

  function updateCount() {
    el.count.textContent = `${table.getDataCount("active").toLocaleString()} of ${n.toLocaleString()} taxa`;
  }

  table.on("renderComplete", updateCount);
  table.on("tableBuilt", () => {
    applyFilters();
    el.toggle.disabled = !hasSameTreatment;
    el.reset.disabled = false;
    el.download.disabled = false;
    setStatus("");
  });

  el.toggle.addEventListener("click", () => {
    diffOnly = !diffOnly;
    applyFilters();
  });

  el.reset.addEventListener("click", () => {
    table.clearHeaderFilter();
    diffOnly = hasSameTreatment;
    applyFilters();
  });

  el.download.addEventListener("click", () => {
    const active = table.getData("active");
    const body = active.map((r) => wf.columns.map(({ field }) => csvSafe(r[field])));
    const csv = toCSV([wf.columns.map((c) => c.title), ...body]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `wf_ppg_comparison_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

main().catch((e) => {
  console.error(e);
  setStatus(`Could not load the data: ${e.message}`, "danger");
});
