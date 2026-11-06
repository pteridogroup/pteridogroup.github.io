// Pure helper functions for the name resolver (no DOM, no webR), so they can
// be unit-tested in Node.

// Genus of a name: first word, without a leading hybrid sign (×).
// NB: must match genus_of() in scripts/build-resolver-data.R.
export function genusOf(name) {
  return name.replace(/^\s*×\s*/, "").replace(/ .*$/, "");
}

// Tidy a query name: trim, collapse whitespace, and give the genus a leading
// capital (lower case elsewhere), e.g. "asplenium Rhizophorum" ->
// "Asplenium Rhizophorum". Returns "" for empty input.
export function normaliseName(raw) {
  let s = String(raw ?? "")
    .replace(/[ \s]+/g, " ")
    .trim();
  if (!s) return "";
  const hybrid = /^×\s*/.test(s);
  s = s.replace(/^×\s*/, "");
  const sp = s.indexOf(" ");
  const genus = sp === -1 ? s : s.slice(0, sp);
  const rest = sp === -1 ? "" : s.slice(sp);
  const g = genus.charAt(0).toUpperCase() + genus.slice(1).toLowerCase();
  return (hybrid ? "×" : "") + g + rest;
}

// A name taxastand can parse needs at least genus + epithet.
export function hasEpithet(name) {
  return name.replace(/^×\s*/, "").trim().split(" ").length >= 2;
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

// Closest genera (case-insensitive) within `maxDist`, nearest first.
export function suggestGenera(genus, genera, maxDist = 2, limit = 3) {
  const g = genus.toLowerCase();
  return genera
    .map((x) => ({ genus: x, dist: levenshtein(g, x.toLowerCase()) }))
    .filter((x) => x.dist <= maxDist)
    .sort((a, b) => a.dist - b.dist || a.genus.localeCompare(b.genus))
    .slice(0, limit);
}

// Minimal RFC 4180 CSV/TSV parser. Returns an array of rows (arrays).
export function parseDelimited(text, delimiter = ",") {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// Serialise rows (array of arrays) to CSV.
export function toCSV(rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

// Guard against spreadsheet formula injection in downloaded CSV cells.
export function csvSafe(v) {
  const s = v == null ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
