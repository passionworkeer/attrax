"""EU Publications Office Cellar SPARQL collector.

EU Cellar exposes a public SPARQL endpoint at
``https://publications.europa.eu/webapi/rdf/sparql``. The watchdog queries
it for works whose CELEX identifier matches a given year prefix (e.g.
``32023R*`` for 2023 Regulations) so the state store gets a stable digest
of recently-published EU legislation without polling Cellar RDF for every
known CELEX.

This is a *discovery* source — it surfaces new regulations; it is not a
verbatim regulation-text source. The Cellar RDF fetch path (``eu_celex``)
is what the auto-ingest mapper turns into regulation YAML. The SPARQL
collector here produces an evidence-only signal that an ingestion
candidate exists.

Endpoint:
    POST https://publications.europa.eu/webapi/rdf/sparql
        Content-Type: application/sparql-query
        Accept:        application/sparql-results+json

CDM predicates (Common Data Model):
    cdm:work_id_document            — value is "celex:32023R0988" (with prefix)
    cdm:work_date_document         — publication date literal
    cdm:resource_legal_id_celex    — same CELEX without prefix

Why POST and not GET: long SPARQL queries exceed practical URL length;
GET also strips query parameters past 4 KiB on some intermediaries.

``min_bytes=16`` — a small SPARQL response is not necessarily an error
(empty result set is a valid response); the small-body guard from
fetch_url would otherwise reject "no matches" as suspicious.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request

from scripts.watchdog.collectors.base import (
    DEFAULT_RETRIES,
    DEFAULT_TIMEOUT,
    RETRY_BACKOFF_SECONDS,
    USER_AGENT,
    WAFChallengeBlockedException,
    _BROWSER_LIKE_HEADERS,
    _FALLBACK_USER_AGENT,
    RegulationUpdate,
)
from scripts.watchdog.registry import register
from scripts.watchdog.state import normalize_text, text_hash

CELLAR_SPARQL_ENDPOINT = "https://publications.europa.eu/webapi/rdf/sparql"

# CELEX year prefix (3YYYY for sector "3" = EU). e.g. "32023" matches all
# 2023 EU instruments regardless of type (R/L/D).
_CELEX_YEAR_RE = re.compile(r"^3(\d{4})$")


def _build_query(celex_year_prefix: str, limit: int = 100) -> str:
    """Construct the SPARQL query that finds works for a CELEX year prefix.

    Uses CDM with a year regex filter so the same query handles any year.
    Returns a SELECT of (celex, date, title) — title is OPTIONAL because
    not every work has a dc:title literal in the queried graph.
    """
    return f"""PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?celex ?date ?title WHERE {{
  ?work cdm:resource_legal_id_celex ?celex .
  FILTER(STRSTARTS(STR(?celex), "{celex_year_prefix}"))
  OPTIONAL {{ ?work cdm:work_date_document ?date . }}
  OPTIONAL {{ ?work <http://purl.org/dc/elements/1.1/title> ?title . FILTER(LANG(?title) = "en") }}
}}
ORDER BY DESC(?date) ?celex
LIMIT {limit}
"""


def _row_sort_key(row: dict) -> tuple[str, str]:
    """Stable ordering: (date, celex). Date first so newest days are
    adjacent in the normalized digest — easier for humans reading the
    evidence pack. Ties broken by CELEX."""
    return (str(row.get("date") or ""), str(row.get("celex") or ""))


def _post_sparql(query: str, *, min_bytes: int = 16) -> tuple[bytes, str | None]:
    """POST the SPARQL query string to Cellar and return (body, last_modified).

    Mirrors ``fetch_url``'s GET helper shape (UA fallback + WAF detection
    + small-body guard + retries) so a Cellar WAF chokepoint doesn't break
    the daily schedule. POST is needed here because SPARQL queries exceed
    practical URL length.
    """
    last_error: Exception | None = None
    for attempt in range(1, DEFAULT_RETRIES + 1):
        ua = USER_AGENT if attempt == 1 else _FALLBACK_USER_AGENT
        headers = {
            "User-Agent": ua,
            "Accept": "application/sparql-results+json",
            "Content-Type": "application/sparql-query",
        }
        if attempt > 1:
            headers.update(_BROWSER_LIKE_HEADERS)
        request = urllib.request.Request(
            CELLAR_SPARQL_ENDPOINT,
            data=query.encode("utf-8"),
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=DEFAULT_TIMEOUT) as response:
                body = response.read()
                if len(body) < min_bytes:
                    raise urllib.error.URLError(
                        f"suspiciously small SPARQL response ({len(body)} bytes)"
                    )
                lower_body = body[:2048].lower()
                if (
                    b"challenge-platform" in lower_body
                    or b"<title>just a moment..." in lower_body
                    or b"cf-browser-verification" in lower_body
                    or b"enable javascript and cookies to continue" in lower_body
                ):
                    raise WAFChallengeBlockedException(
                        "Cellar WAF challenge detected"
                    )
                return body, response.headers.get("Last-Modified")
        except urllib.error.HTTPError as exc:
            if 400 <= exc.code < 500 and exc.code != 429:
                raise
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc

        if attempt < DEFAULT_RETRIES:
            time.sleep(RETRY_BACKOFF_SECONDS * attempt)

    assert last_error is not None
    raise last_error


@register("eu_cellar_sparql")
def collect_eu_cellar_sparql(entry: dict) -> RegulationUpdate:
    """Fetch a Cellar SPARQL result set and return a stable, sorted digest.

    Required entry fields:
        - ``celex_year_prefix`` (str): e.g. ``"32023"`` for 2023 EU
          instruments. Defaults to ``"32024"`` (the most recent completed
          year) if absent — this avoids accidentally scanning all of EU
          history on first register.
    """
    celex_year_prefix = str(entry.get("celex_year_prefix") or "32024")
    if not _CELEX_YEAR_RE.match(celex_year_prefix):
        raise ValueError(
            f"celex_year_prefix must match 3YYYY (got {celex_year_prefix!r})"
        )

    query = _build_query(celex_year_prefix, limit=int(entry.get("limit") or 100))
    body, last_modified = _post_sparql(query)

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Cellar SPARQL JSON decode failed ({len(body)} bytes): {exc}"
        ) from exc

    bindings = payload.get("results", {}).get("bindings", [])
    if not isinstance(bindings, list):
        raise ValueError(
            f"Cellar SPARQL response missing results.bindings[] ({len(body)} bytes)"
        )

    rows: list[dict] = []
    for b in bindings:
        if not isinstance(b, dict):
            continue
        # SPARQL JSON result: each variable maps to {"type": ..., "value": ...}
        celex = str(b.get("celex", {}).get("value") or "").strip()
        if not celex:
            continue
        date = str(b.get("date", {}).get("value") or "").strip()
        title = str(b.get("title", {}).get("value") or "").strip()[:200]
        rows.append({"celex": celex, "date": date[:10], "title": title})

    rows.sort(key=_row_sort_key)
    normalized = normalize_text(
        "\n".join(f"{r['date']} | {r['celex']} | {r['title']}" for r in rows)
    )

    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "EU"),
        source_type="eu_cellar_sparql",
        source_url=CELLAR_SPARQL_ENDPOINT,
        title=entry.get("title", f"EU Cellar SPARQL {celex_year_prefix}"),
        text=normalized,
        content_hash=text_hash(normalized),
        last_modified=last_modified,
        metadata={
            "celexYearPrefix": celex_year_prefix,
            "matchedCount": len(rows),
            "mode": "cellar_sparql",
        },
    )