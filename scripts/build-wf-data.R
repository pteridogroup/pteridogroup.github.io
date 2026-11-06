# Build the data file for the in-browser World Ferns comparison (world-ferns.qmd).
#
# Runs as a Quarto pre-render step (see _quarto.yml). The comparison table is
# produced by the pteridogroup/ppg-import pipeline (it needs a private World
# Ferns file), which publishes the finished CSVs to a public GitHub release.
# This script downloads them and reshapes them for the page.
#
# Output (wf-data/, copied into the site via `resources:`):
#   meta.json  World Ferns / PPG versions compared, build date
#   wf.json    {"columns": [{"field", "title"}...], "data": [{row}, ...]}
#              Missing values are null or absent.
#
# If the release can't be fetched (e.g. not published yet), this script warns
# and leaves any existing output alone rather than failing the whole site build;
# the page then shows a "could not load" message.

source("scripts/ppg-release.R")

out_dir <- "wf-data"
# WF_DATA_BASE_URL overrides the source (e.g. a file:// dir, for local testing)
release_url <- Sys.getenv(
  "WF_DATA_BASE_URL",
  "https://github.com/pteridogroup/ppg-import/releases/download/latest-comparison/"
)

read_release_csv <- function(file) {
  utils::read.csv(
    paste0(release_url, file),
    colClasses = "character",
    na.strings = c("NA", ""),
    encoding = "UTF-8"
  )
}

result <- tryCatch(
  list(
    dat = read_release_csv("wf_ppg_genus_plus.csv"),
    versions = tryCatch(
      read_release_csv("wf_ppg_data_versions.csv"),
      error = function(e) NULL
    )
  ),
  error = function(e) e
)

if (inherits(result, "error")) {
  warning(
    "Could not fetch the World Ferns comparison from ", release_url, ": ",
    conditionMessage(result), "\nSkipping wf-data build.",
    call. = FALSE
  )
  quit(save = "no", status = 0)
}

dat <- result$dat

# Blank a higher-rank column on rows of that same rank (it would just repeat
# the taxon name). Same as hide_redundant_rank_values() in ppg-import/app.R.
rank_norm <- tolower(trimws(dat$rank))
higher_ranks <- c(
  "tribe", "subfamily", "family", "suborder", "order", "subclass", "class"
)
for (r in higher_ranks) {
  same_rank <- !is.na(rank_norm) & rank_norm == r
  for (col in grep(paste0("^", r, "_(wf|ppg)$"), names(dat), value = TRUE)) {
    dat[[col]][same_rank] <- NA_character_
  }
}

# Normalise logical-ish same_treatment to "TRUE" / "FALSE" / NA
if ("same_treatment" %in% names(dat)) {
  x <- tolower(trimws(dat$same_treatment))
  dat$same_treatment <- ifelse(
    x %in% c("true", "t", "1", "yes"), "TRUE",
    ifelse(x %in% c("false", "f", "0", "no"), "FALSE", NA_character_)
  )
}

# Column labels, as in the Shiny app: "family_wf" -> "Family (WF)"
titles <- names(dat)
titles <- sub("_wf$", " (WF)", titles)
titles <- sub("_ppg$", " (PPG)", titles)
titles <- gsub("_", " ", titles)
titles <- gsub("(^|\\s)([a-z])", "\\1\\U\\2", titles, perl = TRUE)
titles <- sub("\\(Wf\\)", "(WF)", titles)
titles <- sub("\\(Ppg\\)", "(PPG)", titles)

version_of <- function(source_name) {
  v <- result$versions
  if (is.null(v)) return(NA_character_)
  hit <- v$version[tolower(trimws(v$source)) == source_name]
  if (length(hit) && !is.na(hit[1]) && nzchar(hit[1])) hit[1] else NA_character_
}

dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
jsonlite::write_json(
  list(
    columns = data.frame(field = names(dat), title = titles),
    data = dat
  ),
  file.path(out_dir, "wf.json"),
  dataframe = "rows",
  na = "null",
  auto_unbox = FALSE,
  digits = NA
)
jsonlite::write_json(
  list(
    wf_version = version_of("world ferns"),
    ppg_version = version_of("ppg"),
    n_rows = nrow(dat),
    built = format(Sys.time(), "%Y-%m-%d", tz = "UTC")
  ),
  file.path(out_dir, "meta.json"),
  auto_unbox = TRUE,
  na = "null",
  pretty = TRUE
)

message("Built wf-data: ", nrow(dat), " rows")
