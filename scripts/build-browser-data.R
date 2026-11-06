# Build the data file for the in-browser Database Browser (databrowser.qmd).
#
# Runs as a Quarto pre-render step (see _quarto.yml), so the viewer always
# tracks the latest PPG release (rebuilt only when the release tag changes).
#
# Output (browser-data/, copied into the site via `resources:`):
#   meta.json  PPG release tag, DOI, build date
#   ppg.json   column-oriented JSON ({"col": [values...], ...}) of the PPG
#              table plus derived columns: acceptedNameUsage, parentNameUsage,
#              and higher taxonomy (class ... genus). NA is written as null.

source("scripts/ppg-release.R")

out_dir <- "browser-data"
# Bump when the output format changes, to force a rebuild.
schema <- 1L

release <- get_ppg_release()
tag <- release$tag

if (already_built(out_dir, tag, schema, required = "ppg.json")) {
  message("browser-data already built for PPG ", tag, "; skipping")
  quit(save = "no", status = 0)
}

ppg <- read_ppg(tag)

# Normalise missing values: empty string -> NA
for (col in names(ppg)) {
  ppg[[col]][!is.na(ppg[[col]]) & ppg[[col]] == ""] <- NA_character_
}

keep <- c(
  "taxonID", "scientificName", "scientificNameAuthorship", "taxonRank",
  "taxonomicStatus", "nomenclaturalStatus", "namePublishedIn",
  "acceptedNameUsageID", "parentNameUsageID", "modified"
)
ppg <- ppg[, keep]

# Names of accepted / parent taxa -------------------------------------------

accepted_row <- match(ppg$acceptedNameUsageID, ppg$taxonID)
parent_row <- match(ppg$parentNameUsageID, ppg$taxonID)
ppg$acceptedNameUsage <- ppg$scientificName[accepted_row]
ppg$parentNameUsage <- ppg$scientificName[parent_row]

# Higher taxonomy -------------------------------------------------------------
# Same logic as add_higher_taxonomy() in pteridogroup/shinyppg: each taxon gets
# the names of its ancestors at the target ranks (and its own name if it has
# one of those ranks); synonyms then inherit everything from their accepted
# name.

target_ranks <- c(
  "class", "subclass", "order", "suborder", "family", "subfamily", "genus"
)
higher <- stats::setNames(
  replicate(length(target_ranks), rep(NA_character_, nrow(ppg)), simplify = FALSE),
  target_ranks
)

# Own rank
for (r in target_ranks) {
  is_r <- !is.na(ppg$taxonRank) & ppg$taxonRank == r
  higher[[r]][is_r] <- ppg$scientificName[is_r]
}

# Walk up the parent chain, all rows at once. The depth cap guards against
# cycles in the parent links.
cur <- parent_row
for (step in seq_len(30)) {
  active <- which(!is.na(cur))
  if (length(active) == 0) break
  anc_rank <- ppg$taxonRank[cur[active]]
  for (r in target_ranks) {
    hit <- active[!is.na(anc_rank) & anc_rank == r]
    higher[[r]][hit] <- ppg$scientificName[cur[hit]]
  }
  cur[active] <- parent_row[cur[active]]
}

# Synonyms inherit from their accepted name
is_syn <- !is.na(accepted_row) & ppg$acceptedNameUsageID != ppg$taxonID
for (r in target_ranks) {
  higher[[r]][is_syn] <- higher[[r]][accepted_row[is_syn]]
}

ppg <- cbind(ppg, as.data.frame(higher, stringsAsFactors = FALSE))

# Write ---------------------------------------------------------------------

dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
jsonlite::write_json(
  as.list(ppg),
  file.path(out_dir, "ppg.json"),
  dataframe = "columns",
  na = "null",
  auto_unbox = FALSE,
  digits = NA
)
jsonlite::write_json(
  list(
    schema = schema,
    tag = tag,
    doi = release$doi,
    doi_url = release$doi_url,
    n_names = nrow(ppg),
    built = format(Sys.time(), "%Y-%m-%d", tz = "UTC")
  ),
  file.path(out_dir, "meta.json"),
  auto_unbox = TRUE,
  pretty = TRUE
)

message("Built browser-data for PPG ", tag, ": ", nrow(ppg), " names")
