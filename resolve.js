// Name Resolver: resolve species names against the latest PPG release with
// taxastand, running in the browser via webR.
//
// Data (built by scripts/build-resolver-data.R) lives in resolver-data/:
//   meta.json, genera.json, genus/<Genus>.csv
import {
  genusOf,
  normaliseName,
  hasEpithet,
  suggestGenera,
  parseDelimited,
  toCSV,
  csvSafe,
} from "./resolver-lib.js";

const WEBR_URL = "https://webr.r-wasm.org/v0.6.0/webr.mjs";
const REPOS = ["https://joelnitta.r-universe.dev", "https://repo.r-wasm.org"];
const MAX_NAMES = 2000;

const $ = (id) => document.getElementById(id);
const el = {
  version: $("resolver-version"),
  status: $("resolver-status"),
  input: $("resolver-input"),
  file: $("resolver-file"),
  columnBox: $("resolver-column-box"),
  column: $("resolver-column"),
  noauth: $("opt-noauth"),
  genus: $("opt-genus"),
  dist: $("opt-dist"),
  run: $("resolver-run"),
  download: $("resolver-download"),
  summary: $("resolver-summary"),
  table: $("resolver-table"),
  progress: $("resolver-progress"),
  showAll: $("opt-showall"),
  showAllBox: $("resolver-showall-box"),
};

let meta = null;
let genera = [];
let generaSet = new Set();
let webR = null;
let ready = false;
let busy = false;
let lastRows = null;
let uploaded = null; // { rows, hasHeader }
const loadedShards = new Set(); // genera already written to the webR file system

function setStatus(text, kind = "secondary", spinning = false) {
  el.status.className = `alert alert-${kind} py-2`;
  el.status.replaceChildren();
  if (spinning) {
    const sp = document.createElement("span");
    sp.className = "spinner-border spinner-border-sm me-2";
    sp.setAttribute("aria-hidden", "true");
    el.status.append(sp);
  }
  el.status.append(text);
}

// Progress bar: pass a fraction 0-1, or null to hide it.
function setProgress(fraction) {
  if (fraction == null) {
    el.progress.hidden = true;
    return;
  }
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  el.progress.hidden = false;
  el.progress.setAttribute("aria-valuenow", String(pct));
  el.progress.firstElementChild.style.width = `${pct}%`;
  el.progress.firstElementChild.textContent = `${pct}%`;
}

function updateRunButton() {
  el.run.disabled = !ready || busy;
}

async function fetchOrThrow(url, what) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${what} (HTTP ${res.status})`);
  return res;
}

// ---- Startup ---------------------------------------------------------------

async function start() {
  try {
    const [m, g] = await Promise.all([
      fetchOrThrow("resolver-data/meta.json", "PPG version").then((r) => r.json()),
      fetchOrThrow("resolver-data/genera.json", "genus list").then((r) => r.json()),
    ]);
    meta = m;
    genera = g;
    generaSet = new Set(g);
    el.version.replaceChildren(
      "Resolving against PPG ",
      Object.assign(document.createElement("strong"), { textContent: meta.tag }),
      " (",
      Object.assign(document.createElement("a"), {
        href: meta.doi_url,
        textContent: meta.doi,
      }),
      `; ${meta.n_names.toLocaleString()} names)`,
    );

    setStatus("Loading R in your browser (first visit can take a minute)…", "secondary", true);
    const { WebR } = await import(/* @vite-ignore */ WEBR_URL);
    webR = new WebR();
    await webR.init();
    setStatus("Installing taxastand…", "secondary", true);
    await webR.installPackages(["taxastand"], { repos: REPOS, quiet: true });
    await webR.evalRVoid('library(taxastand); dir.create("/ref", showWarnings = FALSE)');
    ready = true;
    setStatus("Ready. Enter or upload names, then click “Resolve names”.", "success");
  } catch (err) {
    console.error(err);
    setStatus(`Could not start the resolver: ${err.message}`, "danger");
  }
  updateRunButton();
}

// ---- Input -----------------------------------------------------------------

el.file.addEventListener("change", async () => {
  const f = el.file.files[0];
  uploaded = null;
  el.columnBox.hidden = true;
  if (!f) return;
  const text = await f.text();
  const delim = /\.tsv$/i.test(f.name) || (!/\.csv$/i.test(f.name) && text.split("\n", 1)[0].includes("\t")) ? "\t" : ",";
  const isTable = /\.(csv|tsv)$/i.test(f.name);
  if (!isTable) {
    el.input.value = text.split(/\r?\n/).filter((l) => l.trim()).join("\n");
    return;
  }
  const rows = parseDelimited(text, delim);
  if (!rows.length) return;
  const header = rows[0];
  if (header.length === 1) {
    // Single column: treat as a plain list (skip a header-like first line)
    const names = rows.map((r) => r[0]);
    const first = names[0].trim().toLowerCase();
    const skip = ["name", "names", "species", "scientificname", "scientific_name", "query", "taxon"].includes(first);
    el.input.value = (skip ? names.slice(1) : names).join("\n");
    return;
  }
  uploaded = { rows };
  el.column.replaceChildren(
    ...header.map((h, i) => Object.assign(document.createElement("option"), { value: String(i), textContent: h || `(column ${i + 1})` })),
  );
  const guess = header.findIndex((h) => /name|species|taxon/i.test(h));
  el.column.value = String(guess >= 0 ? guess : 0);
  el.columnBox.hidden = false;
  fillFromColumn();
});

function fillFromColumn() {
  if (!uploaded) return;
  const i = Number(el.column.value);
  el.input.value = uploaded.rows
    .slice(1)
    .map((r) => (r[i] ?? "").trim())
    .filter(Boolean)
    .join("\n");
}
el.column.addEventListener("change", fillFromColumn);

// ---- Resolving -------------------------------------------------------------

async function loadShards(wanted) {
  const todo = [...wanted].filter((g) => !loadedShards.has(g));
  const enc = new TextEncoder();
  await Promise.all(
    todo.map(async (g) => {
      const text = await fetchOrThrow(`resolver-data/genus/${encodeURIComponent(g)}.csv`, `PPG data for ${g}`).then((r) => r.text());
      await webR.FS.writeFile(`/ref/${g}.csv`, enc.encode(text));
      loadedShards.add(g);
    }),
  );
}

function clampDist(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : 3;
}

let helpersLoaded = false;

async function runTaxastand(queries, genusList, maxDist, noAuth) {
  if (!helpersLoaded) {
    const code = await fetchOrThrow("resolve.R", "resolver code").then((r) => r.text());
    await webR.evalRVoid(code);
    helpersLoaded = true;
  }
  const enc = new TextEncoder();
  await webR.FS.writeFile("/q.txt", enc.encode(queries.join("\n") + "\n"));
  await webR.FS.writeFile("/genera.txt", enc.encode(genusList.join("\n") + "\n"));
  // maxDist is clamped to an integer and noAuth is a boolean, so interpolating
  // them into R code is safe; names go through files, not code.
  await webR.evalRVoid(`
    res <- resolve_names(
      unique(readLines("/q.txt", encoding = "UTF-8")),
      readLines("/genera.txt", encoding = "UTF-8"),
      max_dist = ${maxDist}, match_no_auth = ${noAuth ? "TRUE" : "FALSE"})
    write_resolved(res, "/out.csv")
  `);
  const bytes = await webR.FS.readFile("/out.csv");
  const rows = parseDelimited(new TextDecoder().decode(bytes));
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

async function resolve() {
  if (busy || !ready) return;
  busy = true;
  updateRunButton();
  el.download.disabled = true;
  el.table.hidden = true;
  el.summary.textContent = "";
  try {
    const original = el.input.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!original.length) {
      setStatus("Please enter at least one name.", "warning");
      return;
    }
    const unique = [...new Set(original)];
    if (unique.length > MAX_NAMES) {
      setStatus(`Please resolve at most ${MAX_NAMES.toLocaleString()} distinct names at a time (you gave ${unique.length.toLocaleString()}).`, "warning");
      return;
    }

    const tryGenus = el.genus.checked;
    const plan = unique.map((orig) => {
      const norm = normaliseName(orig);
      const item = { orig, norm, send: null, note: "", outcome: "", prefix: "" };
      if (!norm || !hasEpithet(norm)) {
        item.outcome = "unparseable";
        item.note = "Could not parse: need genus and species epithet";
        return item;
      }
      const g = genusOf(norm);
      if (generaSet.has(g)) {
        item.send = norm;
        return item;
      }
      const sugg = suggestGenera(g, genera);
      const unambiguous = sugg.length && (sugg.length === 1 || sugg[0].dist < sugg[1].dist);
      if (tryGenus && unambiguous) {
        item.send = norm.replace(/^(×\s*)?[^ ]+/, (_, h) => (h ? "×" : "") + sugg[0].genus);
        item.prefix = "genus_corrected:";
        item.note = `Genus corrected from ${g} to ${sugg[0].genus}`;
      } else {
        item.outcome = "genus not found";
        item.note = sugg.length ? `Genus not found in PPG. Did you mean: ${sugg.map((s) => s.genus).join(", ")}?` : "Genus not found in PPG";
      }
      return item;
    });

    const toSend = plan.filter((p) => p.send);
    const hitsByQuery = new Map();
    if (toSend.length) {
      const byGenus = new Map();
      for (const p of toSend) {
        const g = genusOf(p.send);
        if (!byGenus.has(g)) byGenus.set(g, new Set());
        byGenus.get(g).add(p.send);
      }
      setProgress(0);
      setStatus(`Loading PPG data for ${byGenus.size} genus/genera…`, "secondary", true);
      await loadShards(new Set(byGenus.keys()));
      // Resolve one genus at a time: matching never crosses genera, and this
      // lets us report real progress.
      const total = toSend.length;
      let done = 0;
      const maxDist = clampDist(el.dist.value);
      for (const [g, qs] of byGenus) {
        setStatus(`Resolving ${g} (${done.toLocaleString()} of ${total.toLocaleString()} names done)…`, "secondary", true);
        // let the browser repaint before the (long) R call
        await new Promise((r) => setTimeout(r, 0));
        const out = await runTaxastand([...qs], [g], maxDist, el.noauth.checked);
        for (const r of out) {
          if (!hitsByQuery.has(r.query)) hitsByQuery.set(r.query, []);
          hitsByQuery.get(r.query).push(r);
        }
        done += qs.size;
        setProgress(done / total);
      }
    }

    const byOrig = new Map();
    for (const p of plan) {
      const g = { query: p.orig, outcome: p.outcome, note: p.note, resolved_name: "", resolved_status: "", match_type: "", hits: [] };
      if (p.send) {
        const rows = hitsByQuery.get(p.send);
        if (!rows) {
          g.outcome = "unparseable";
          g.note = "Could not parse as a scientific name";
        } else if (rows.every((r) => r.match_type === "no_match")) {
          g.outcome = "no match";
        } else {
          g.hits = rows.map((r) => ({
            matched_name: r.matched_name,
            matched_status: r.matched_status,
            match_type: p.prefix + r.match_type,
            resolved_name: r.hit_resolved_name,
            resolved_status: r.hit_resolved_status,
          }));
          g.match_type = g.hits[0].match_type;
          if (rows[0].pass === "2") g.note = [g.note, "Matched ignoring authors"].filter(Boolean).join("; ");
          if (rows[0].resolved_name) {
            g.outcome = "resolved";
            g.resolved_name = rows[0].resolved_name;
            g.resolved_status = rows[0].resolved_status;
            if (rows.length > 1) g.note = [g.note, `${rows.length} matched names, all resolving to the same accepted name`].filter(Boolean).join("; ");
          } else if (rows.length === 1) {
            g.outcome = "no match";
            g.note = [g.note, "Matched name has no accepted name in PPG"].filter(Boolean).join("; ");
          } else {
            g.outcome = "multiple hits";
            g.note = [g.note, "Matches several different accepted names"].filter(Boolean).join("; ");
          }
        }
      }
      byOrig.set(p.orig, g);
    }
    lastRows = original.map((o) => byOrig.get(o));
    render(lastRows);
    setStatus("Done.", "success");
  } catch (err) {
    console.error(err);
    setStatus(`Something went wrong: ${err.message}`, "danger");
  } finally {
    busy = false;
    setProgress(null);
    updateRunButton();
  }
}

// ---- Output ----------------------------------------------------------------

function td(text, opts = {}) {
  const c = document.createElement("td");
  if (opts.em) {
    const i = document.createElement("em");
    i.textContent = text;
    c.append(i);
  } else {
    c.textContent = text;
  }
  return c;
}

function setExpanded(btn, rows, open) {
  btn.setAttribute("aria-expanded", String(open));
  btn.textContent = `${open ? "Hide" : "Show all"} ${rows.length} hits`;
  for (const r of rows) r.hidden = !open;
}

function render(rows) {
  const tbody = el.table.querySelector("tbody");
  tbody.replaceChildren();
  const counts = { resolved: 0, "multiple hits": 0, other: 0 };
  for (const g of rows) {
    const tr = document.createElement("tr");
    const multi = g.hits.length > 1;
    if (g.outcome === "resolved") {
      counts.resolved++;
      if (g.hits.some((h) => h.match_type.includes("fuzzy")) || g.match_type.startsWith("genus_corrected")) tr.className = "row-fuzzy";
    } else if (g.outcome === "multiple hits") {
      counts["multiple hits"]++;
      tr.className = "row-multi";
    } else {
      counts.other++;
      tr.className = "row-unresolved";
    }
    const first = g.hits[0];
    tr.append(
      td(g.query),
      g.outcome === "multiple hits" ? td(`multiple hits (${g.hits.length})`, { em: true }) : td(g.resolved_name),
    );
    const matchedCell = document.createElement("td");
    tr.append(matchedCell);
    tr.append(
      td(g.outcome === "resolved" ? g.resolved_status : ""),
      td(first && !multi ? first.matched_status : ""),
      td(first && !multi ? first.match_type : multi ? [...new Set(g.hits.map((h) => h.match_type))].join(", ") : ""),
      td(g.note),
    );
    tbody.append(tr);

    if (multi) {
      const detail = g.hits.map((h) => {
        const d = document.createElement("tr");
        d.className = "hit-row";
        d.hidden = true;
        d.append(td(""), td(h.resolved_name), td(h.matched_name), td(h.resolved_status), td(h.matched_status), td(h.match_type), td(""));
        d.firstChild.className = "text-muted";
        d.firstChild.textContent = "↳";
        return d;
      });
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm btn-outline-secondary";
      btn.addEventListener("click", () => setExpanded(btn, detail, btn.getAttribute("aria-expanded") !== "true"));
      matchedCell.append(btn);
      setExpanded(btn, detail, el.showAll.checked);
      tr.expand = (open) => setExpanded(btn, detail, open);
      tbody.append(...detail);
    } else {
      matchedCell.textContent = first ? first.matched_name : "";
    }
    tr.dataset.multi = multi ? "1" : "";
  }
  el.table.hidden = false;
  el.showAllBox.hidden = !rows.some((g) => g.hits.length > 1);
  el.summary.textContent =
    `${rows.length.toLocaleString()} name(s): ${counts.resolved.toLocaleString()} resolved, ` +
    `${counts["multiple hits"].toLocaleString()} with multiple hits, ${counts.other.toLocaleString()} unresolved. ` +
    "Yellow rows are fuzzy or genus-corrected matches, blue rows have multiple hits, and red rows are unresolved.";
  el.download.disabled = false;
}

el.showAll.addEventListener("change", () => {
  for (const tr of el.table.querySelectorAll("tbody tr")) if (tr.expand) tr.expand(el.showAll.checked);
});

const CSV_COLS = ["query", "outcome", "resolved_name", "matched_name", "resolved_status", "matched_status", "match_type", "n_hits", "note"];

el.download.addEventListener("click", () => {
  if (!lastRows) return;
  const body = [];
  for (const g of lastRows) {
    const hits = g.hits.length ? g.hits : [null];
    for (const h of hits) {
      const multiple = g.outcome === "multiple hits";
      body.push([
        csvSafe(g.query),
        g.outcome,
        // for multiple hits, each row shows the accepted name of that hit
        multiple ? h.resolved_name : g.resolved_name,
        h ? h.matched_name : "",
        multiple ? h.resolved_status : g.resolved_status,
        h ? h.matched_status : "",
        h ? h.match_type : "",
        g.hits.length,
        g.note,
        meta.tag,
        meta.doi,
      ]);
    }
  }
  const blob = new Blob([toCSV([[...CSV_COLS, "ppg_version", "ppg_doi"], ...body])], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ppg-${meta.tag}-resolved-names.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
});

el.run.addEventListener("click", resolve);

start();
