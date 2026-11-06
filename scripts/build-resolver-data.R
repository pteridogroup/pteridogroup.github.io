# Build data files for the in-browser name resolver (resolve.qmd).
#
# Runs as a Quarto pre-render step (see _quarto.yml), so it re-runs on every
# build, including the daily scheduled one, and the resolver always tracks the
# latest PPG release.
#
# Output (resolver-data/, copied into the site via `resources:`):
#   meta.json      PPG release tag, DOI, build date
#   genera.json    sorted array of every genus name in PPG (incl. synonym
#                  genera); used for genus-typo suggestions
#   genus/<G>.csv  one self-contained shard per genus, with columns
#                  taxonID, acceptedNameUsageID, taxonomicStatus,
#                  scientificName (authorship included), canonical (name
#                  without authorship, used to match author-less queries). Each shard holds all
#                  names in that genus plus the accepted-name rows that its
#                  synonyms point to, so the browser only has to fetch the
#                  shards for the genera in the user's query.
#
# Sharding by genus is lossless for taxastand: every match key embeds the
# genus, and fuzzy matching only compares names within the same genus.

source("scripts/ppg-release.R")

out_dir <- "resolver-data"
# Bump when the output format changes, to force a rebuild.
schema <- 2L

# Release tag and DOI ----------------------------------------------------

release <- get_ppg_release()
tag <- release$tag

# Skip the rebuild if the output is already for this release ---------------

if (already_built(out_dir, tag, schema, required = "genus")) {
  message("resolver-data already built for PPG ", tag, "; skipping")
  quit(save = "no", status = 0)
}

# Read and slim the reference ---------------------------------------------

ppg <- read_ppg(tag)

has_auth <- !is.na(ppg$scientificNameAuthorship) &
  ppg$scientificNameAuthorship != ""
ref <- data.frame(
  taxonID = ppg$taxonID,
  taxonRank = ppg$taxonRank,
  acceptedNameUsageID = ppg$acceptedNameUsageID,
  taxonomicStatus = ppg$taxonomicStatus,
  scientificName = ifelse(
    has_auth,
    paste(ppg$scientificName, ppg$scientificNameAuthorship),
    ppg$scientificName
  ),
  canonical = ppg$scientificName,
  stringsAsFactors = FALSE
)

# Genus of a name: first word, without a leading hybrid sign.
# NB: resolve.qmd must use the same rule in JavaScript.
genus_of <- function(x) {
  sub(" .*$", "", sub("^\\s*×\\s*", "", x))
}
ref$genus <- genus_of(ref$scientificName)

# taxastand can only parse binomials and below; genus-and-above names would
# just trigger parse warnings. They are still kept in `ref` so that
# acceptedNameUsageID lookups work, but get no shards of their own.
species_ranks <- c(
  "species", "subspecies", "variety", "subvariety", "form", "subform",
  "lusus", "prole", "unranked"
)
is_sp <- ref$taxonRank %in% species_ranks

# Shards ------------------------------------------------------------------

genera <- sort(unique(ref$genus[is_sp]))
# Shard files are named by genus; keep to safe file names.
safe <- grepl("^[A-Za-z-]+$", genera)
if (!all(safe)) {
  warning(
    "Skipping genera with unsafe file names: ",
    paste(genera[!safe], collapse = ", ")
  )
  genera <- genera[safe]
}

unlink(file.path(out_dir, "genus"), recursive = TRUE)
dir.create(file.path(out_dir, "genus"), recursive = TRUE, showWarnings = FALSE)

by_genus <- split(which(is_sp), ref$genus[is_sp])
id_row <- match(ref$acceptedNameUsageID, ref$taxonID)

cols <- c(
  "taxonID", "acceptedNameUsageID", "taxonomicStatus", "scientificName",
  "canonical"
)
for (g in genera) {
  rows <- by_genus[[g]]
  targets <- id_row[rows]
  rows <- sort(unique(c(rows, targets[!is.na(targets)])))
  utils::write.csv(
    ref[rows, cols],
    file.path(out_dir, "genus", paste0(g, ".csv")),
    row.names = FALSE,
    na = "NA",
    fileEncoding = "UTF-8"
  )
}

# Index and metadata ------------------------------------------------------

jsonlite::write_json(genera, file.path(out_dir, "genera.json"))
jsonlite::write_json(
  list(
    schema = schema,
    tag = tag,
    doi = release$doi,
    doi_url = release$doi_url,
    n_names = sum(is_sp),
    n_genera = length(genera),
    built = format(Sys.time(), "%Y-%m-%d", tz = "UTC")
  ),
  file.path(out_dir, "meta.json"),
  auto_unbox = TRUE,
  pretty = TRUE
)

message("Built resolver-data for PPG ", tag, ": ", length(genera), " genera")
