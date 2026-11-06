# Shared helpers for the build scripts that turn the latest PPG release into
# static data for in-browser tools (build-resolver-data.R, build-browser-data.R).
# Source with: source("scripts/ppg-release.R") (scripts run from project root).

# GitHub and Zenodo occasionally fail on the first try; retry (as in ppg.qmd).
fetch_json <- function(url, tries = 5, pause = 5) {
  for (i in seq_len(tries)) {
    result <- tryCatch(jsonlite::fromJSON(url), error = function(e) e)
    if (!inherits(result, "error")) {
      return(result)
    }
    if (i < tries) Sys.sleep(pause)
  }
  stop(result)
}

# Latest PPG release: list(tag, doi, doi_url)
get_ppg_release <- function() {
  release <- fetch_json(
    "https://api.github.com/repos/pteridogroup/ppg/releases/latest"
  )
  tag <- release$tag_name

  zenodo_versions <- fetch_json(
    "https://zenodo.org/api/records?q=conceptrecid:22760360&all_versions=true"
  )$hits$hits
  match_idx <- which(zenodo_versions$metadata$version == tag)
  zenodo <- if (length(match_idx) > 0) {
    zenodo_versions[match_idx[1], ]
  } else {
    zenodo_versions[
      which.max(as.Date(zenodo_versions$metadata$publication_date)),
    ]
  }
  list(tag = tag, doi = zenodo$doi, doi_url = zenodo$links$doi)
}

# TRUE if `out_dir` already holds output of this `schema` for release `tag`
# (and every path in `required` exists inside it).
already_built <- function(out_dir, tag, schema, required = character()) {
  meta_path <- file.path(out_dir, "meta.json")
  if (!file.exists(meta_path)) {
    return(FALSE)
  }
  old <- tryCatch(jsonlite::read_json(meta_path), error = function(e) NULL)
  !is.null(old) &&
    identical(old$tag, tag) &&
    identical(old$schema, schema) &&
    all(file.exists(file.path(out_dir, required)))
}

# Read ppg.csv for a release tag; all columns as character.
read_ppg <- function(tag) {
  utils::read.csv(
    sprintf(
      "https://raw.githubusercontent.com/pteridogroup/ppg/refs/tags/%s/data/ppg.csv",
      tag
    ),
    colClasses = "character",
    na.strings = "NA",
    encoding = "UTF-8"
  )
}
