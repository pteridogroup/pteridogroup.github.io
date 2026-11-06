// Database Browser: browse the latest PPG release in the browser with Tabulator.
//
// Data (built by scripts/build-browser-data.R) lives in browser-data/:
//   meta.json, ppg.json (column-oriented)
import { toCSV, csvSafe } from "./resolver-lib.js";

const TABULATOR_VERSION = "6.3.0";
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/tabulator/${TABULATOR_VERSION}`;

const $ = (id) => document.getElementById(id);
const el = {
  version: $("viewer-version"),
  status: $("viewer-status"),
  search: $("viewer-search"),
  count: $("viewer-count"),
  note: $("viewer-filter-note"),
  noteText: $("viewer-filter-text"),
  none: $("btn-select-none"),
  parent: $("btn-parent"),
  accepted: $("btn-accepted"),
  synonyms: $("btn-synonyms"),
  children: $("btn-children"),
  higher: $("btn-higher"),
  reset: $("btn-reset"),
  download: $("btn-download"),
};

const HIGHER = [
  "class", "subclass", "order", "suborder", "family", "subfamily", "genus",
];

// field -> display title, in table / CSV order
const COLUMNS = [
  ["scientificName", "Name"],
  ["scientificNameAuthorship", "Author"],
  ["taxonRank", "Rank"],
  ["nomenclaturalStatus", "Nomenclatural Status"],
  ["namePublishedIn", "Published In"],
  ["taxonomicStatus", "Taxonomic Status"],
  ["acceptedNameUsage", "Accepted Name"],
  ["parentNameUsage", "Parent Name"],
  ["class", "Class"],
  ["subclass", "Subclass"],
  ["order", "Order"],
  ["suborder", "Suborder"],
  ["family", "Family"],
  ["subfamily", "Subfamily"],
  ["genus", "Genus"],
  ["taxonID", "taxonID"],
  ["acceptedNameUsageID", "acceptedNameUsageID"],
  ["parentNameUsageID", "parentNameUsageID"],
  ["modified", "Modified"],
];
const HIDDEN = new Set([
  "taxonID", "acceptedNameUsageID", "parentNameUsageID", "modified", ...HIGHER,
]);
const LIST_COLS = new Set(["taxonRank", "taxonomicStatus", "nomenclaturalStatus"]);
const SEARCH_FIELDS = [
  "scientificName", "scientificNameAuthorship", "namePublishedIn",
  "acceptedNameUsage", "parentNameUsage",
];

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
  const [meta, cols] = await Promise.all([
    fetch("browser-data/meta.json").then((r) => r.json()),
    fetch("browser-data/ppg.json").then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
    (async () => {
      loadCSS(`${CDN}/css/tabulator.min.css`);
      await loadScript(`${CDN}/js/tabulator.min.js`);
    })(),
  ]);

  el.version.textContent = `PPG ${meta.tag} (DOI: `;
  el.version.append(
    Object.assign(document.createElement("a"), {
      href: meta.doi_url,
      textContent: meta.doi,
    }),
    ")",
  );

  // Column-oriented -> array of row objects (null -> "")
  const n = cols.taxonID.length;
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = {};
    for (const [f] of COLUMNS) r[f] = cols[f][i] ?? "";
    r._s = SEARCH_FIELDS.map((f) => r[f]).join("\t").toLowerCase();
    rows[i] = r;
  }

  // Indexes for navigation
  const byId = new Map(rows.map((r) => [r.taxonID, r]));
  const hasChildren = new Set();
  const hasSynonyms = new Set();
  for (const r of rows) {
    if (r.parentNameUsageID) hasChildren.add(r.parentNameUsageID);
    if (r.acceptedNameUsageID && r.acceptedNameUsageID !== r.taxonID) {
      hasSynonyms.add(r.acceptedNameUsageID);
    }
  }

  // Programmatic (navigation + search) filter state; header filters are
  // handled separately by Tabulator and combine with this one.
  let nav = null; // {field, value, text}
  let query = "";

  const columns = COLUMNS.map(([field, title]) => {
    const col = {
      title,
      field,
      visible: !HIDDEN.has(field),
      headerFilterPlaceholder: "All",
      headerFilterLiveFilter: true,
    };
    if (LIST_COLS.has(field)) {
      col.headerFilter = "list";
      col.headerFilterParams = { valuesLookup: true, clearable: true, sort: "asc" };
      col.headerFilterFunc = "=";
    } else {
      col.headerFilter = "input";
      col.headerFilterFunc = "like";
    }
    if (field === "scientificName") col.minWidth = 220;
    if (field === "namePublishedIn") col.minWidth = 200;
    if (field === "nomenclaturalStatus") col.minWidth = 135;
    if (field === "taxonomicStatus") col.minWidth = 115;
    if (field === "acceptedNameUsage" || field === "parentNameUsage") col.minWidth = 120;
    return col;
  });

  const table = new Tabulator("#viewer-table", {
    data: rows,
    index: "taxonID",
    columns,
    layout: "fitColumns",
    height: "70vh",
    pagination: true,
    paginationSize: 50,
    paginationSizeSelector: [10, 25, 50, 100, 250],
    paginationCounter: "rows",
    selectableRows: 1,
    selectableRowsPersistence: true,
    headerFilterLiveFilterDelay: 300,
    initialSort: [{ column: "scientificName", dir: "asc" }],
  });

  function applyFilters() {
    if (!nav && !query) {
      table.clearFilter();
    } else {
      table.setFilter(
        (d) =>
          (!nav || d[nav.field] === nav.value) &&
          (!query || d._s.includes(query)),
      );
    }
    el.note.hidden = !nav;
    el.noteText.textContent = nav ? nav.text : "";
  }

  function selected() {
    const r = table.getSelectedData();
    return r.length === 1 ? r[0] : null;
  }

  function updateButtons() {
    const d = selected();
    el.none.disabled = !d;
    el.parent.disabled = !(d && d.parentNameUsageID && byId.has(d.parentNameUsageID));
    el.accepted.disabled = !(
      d &&
      d.acceptedNameUsageID &&
      d.taxonomicStatus !== "accepted" &&
      byId.has(d.acceptedNameUsageID)
    );
    el.synonyms.disabled = !(
      d &&
      d.taxonomicStatus === "accepted" &&
      hasSynonyms.has(d.taxonID)
    );
    el.children.disabled = !(d && hasChildren.has(d.taxonID));
  }

  function updateCount(shown = n) {
    el.count.textContent = `${shown.toLocaleString()} of ${n.toLocaleString()} names`;
  }

  // Show one taxon: filter to its ID and select it.
  function jumpTo(id, label) {
    const target = byId.get(id);
    if (!target) return;
    table.clearHeaderFilter();
    nav = { field: "taxonID", value: id, text: `Showing ${label}: ${target.scientificName}. Use Reset to see all names.` };
    query = "";
    el.search.value = "";
    table.deselectRow();
    applyFilters();
    table.selectRow(id);
    updateButtons();
  }

  function showRelated(field, d, label) {
    table.clearHeaderFilter();
    nav = { field, value: d.taxonID, text: `Showing ${label} of ${d.scientificName}. Use Reset to see all names.` };
    query = "";
    el.search.value = "";
    table.deselectRow();
    applyFilters();
    updateButtons();
  }

  table.on("rowSelectionChanged", updateButtons);
  table.on("renderComplete", () => updateCount(table.getDataCount("active")));
  table.on("tableBuilt", () => {
    updateCount();
    updateButtons();
    for (const b of [el.reset, el.download, el.higher, el.search]) b.disabled = false;
    setStatus("");
  });

  let timer;
  el.search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = el.search.value.trim().toLowerCase();
      applyFilters();
    }, 300);
  });

  el.none.addEventListener("click", () => {
    table.deselectRow();
    updateButtons();
  });
  el.parent.addEventListener("click", () => {
    const d = selected();
    if (d) jumpTo(d.parentNameUsageID, "parent");
  });
  el.accepted.addEventListener("click", () => {
    const d = selected();
    if (d) jumpTo(d.acceptedNameUsageID, "accepted name");
  });
  el.synonyms.addEventListener("click", () => {
    const d = selected();
    if (d) showRelated("acceptedNameUsageID", d, "synonyms");
  });
  el.children.addEventListener("click", () => {
    const d = selected();
    if (d) showRelated("parentNameUsageID", d, "children");
  });

  let showHigher = false;
  el.higher.addEventListener("click", () => {
    showHigher = !showHigher;
    for (const f of HIGHER) showHigher ? table.showColumn(f) : table.hideColumn(f);
    el.higher.textContent = showHigher ? "Hide higher taxa" : "Show higher taxa";
  });

  el.reset.addEventListener("click", () => {
    nav = null;
    query = "";
    el.search.value = "";
    table.clearHeaderFilter();
    table.deselectRow();
    applyFilters();
    updateButtons();
  });

  el.download.addEventListener("click", () => {
    const active = table.getData("active");
    const body = active.map((r) => COLUMNS.map(([f]) => csvSafe(r[f])));
    const csv = toCSV([COLUMNS.map(([, t]) => t), ...body]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `ppg_data_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

main().catch((e) => {
  console.error(e);
  setStatus(`Could not load the data: ${e.message}`, "danger");
});
