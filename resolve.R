# R side of the name resolver (resolve.qmd / resolve.js); evaluated in webR.
# Expects the genus shards written to /ref/<Genus>.csv.
#
# resolve_names() returns one row per *hit* (matched name), with columns:
#   query, resolved_name, resolved_status   query-level result (NA if the query
#                                           is unresolved or has multiple hits)
#   matched_name, matched_status, match_type
#   hit_resolved_name, hit_resolved_status  accepted name this hit points to
#   pass                                    1 = full name, 2 = authors ignored
# A query with no match has a single row with match_type "no_match".

resolve_names <- function(queries, genera, max_dist, match_no_auth) {
  files <- file.path("/ref", paste0(genera, ".csv"))
  ref <- do.call(
    rbind,
    lapply(
      files, utils::read.csv,
      colClasses = "character", na.strings = "NA", encoding = "UTF-8"
    )
  )
  ref <- ref[!duplicated(ref$taxonID), ]

  # Accepted name/status each reference row points to (itself if accepted)
  acc_id <- ifelse(
    is.na(ref$acceptedNameUsageID) | ref$acceptedNameUsageID == "",
    ref$taxonID,
    ref$acceptedNameUsageID
  )
  acc_row <- match(acc_id, ref$taxonID)
  ref$acc_id <- acc_id
  ref$acc_name <- ref$scientificName[acc_row]
  ref$acc_status <- ref$taxonomicStatus[acc_row]

  # Pass 1: full names (with authors), straight through taxastand
  p1 <- suppressWarnings(taxastand::ts_resolve_names(
    queries, ref,
    max_dist = max_dist, match_no_auth = match_no_auth
  ))
  i <- match(p1$matched_name, ref$scientificName)
  p1$hit_resolved_name <- ref$acc_name[i]
  p1$hit_resolved_status <- ref$acc_status[i]
  p1$pass <- 1L

  # Pass 2: queries with no match at all are retried against names without
  # authors. Author strings count towards the edit distance, so a query given
  # without authors can otherwise never fuzzy-match (e.g. a one-letter typo).
  nm <- p1$query[p1$match_type == "no_match"]
  p2 <- NULL
  if (length(nm)) {
    m2 <- suppressWarnings(taxastand::ts_match_names(
      nm, unique(ref$canonical),
      max_dist = max_dist, match_no_auth = FALSE, simple = TRUE
    ))
    m2 <- m2[m2$match_type != "no_match" & !is.na(m2$reference), ]
    if (nrow(m2)) {
      rows <- lapply(seq_len(nrow(m2)), function(k) {
        h <- ref[ref$canonical == m2$reference[k], ]
        data.frame(
          query = m2$query[k],
          matched_name = h$scientificName,
          matched_status = h$taxonomicStatus,
          match_type = m2$match_type[k],
          hit_resolved_name = h$acc_name,
          hit_resolved_status = h$acc_status,
          acc_id = h$acc_id,
          stringsAsFactors = FALSE
        )
      })
      p2 <- do.call(rbind, rows)
      # Resolved only if all hits point to one accepted taxon
      n_acc <- tapply(p2$acc_id, p2$query, function(x) length(unique(x)))
      one <- p2$query %in% names(n_acc)[n_acc == 1]
      p2$resolved_name <- ifelse(one, p2$hit_resolved_name, NA_character_)
      p2$resolved_status <- ifelse(one, p2$hit_resolved_status, NA_character_)
      p2$acc_id <- NULL
      p2$pass <- 2L
    }
  }

  cols <- c(
    "query", "resolved_name", "resolved_status", "matched_name",
    "matched_status", "match_type", "hit_resolved_name",
    "hit_resolved_status", "pass"
  )
  if (!is.null(p2)) {
    p1 <- p1[!(p1$query %in% p2$query), ]
    p1 <- rbind(p1[, cols], p2[, cols])
  }
  p1[, cols]
}

write_resolved <- function(res, path) {
  utils::write.csv(res, path, row.names = FALSE, na = "", fileEncoding = "UTF-8")
}
