"""EU Publications Office (EUR-Lex / Cellar) collector.

First-pass incident postmortem (2026-09-12 deploy):
- The uuid×variant probing strategy 404'd — the Cellar URI space doesn't
  serve ``/cellar/{uuid}/{variant}`` for direct GETs. The working path is
  the CELEX content-negotiation endpoint: ``GET /resource/celex/{celex}``
  with ``Accept: application/rdf+xml`` 303-redirects to the full RDF
  object and urllib follows it automatically (verified 200, ~9MB).
- The public EUR-Lex HTML fallback (``/legal-content/EN/TXT/?celex=…``)
  404s from this network — removed.

The RDF document embeds the legal text plus metadata, so textual changes
reliably move the hash. ~9MB per source is acceptable for a daily pass.
"""
from __future__ import annotations

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.registry import register
from scripts.watchdog.state import normalize_text, text_hash

CELEX_CELLAR_URL = "https://publications.europa.eu/resource/celex/{celex}"
# Only RDF negotiation is accepted by the Cellar endpoint (xhtml → 400).
CELLAR_ACCEPT = "application/rdf+xml"


@register("eu_celex")
def collect_eu_celex(entry: dict) -> RegulationUpdate:
    celex = entry.get("celex") or ""
    if not celex:
        # No CELEX recorded — degrade to the generic raw fetch.
        from scripts.watchdog.collectors.base import collect_generic

        return collect_generic(entry)

    url = CELEX_CELLAR_URL.format(celex=celex)
    body, last_modified = fetch_url(url, accept=CELLAR_ACCEPT)
    # Content-sanity guard (2026-09-13 postmortem, mirroring the eCFR lesson):
    # an interstitial/error page served with HTTP 200 must never become the
    # snapshot — otherwise the next real fetch reads as a "modified" change.
    if b"rdf:RDF" not in body[:4000] and not body.lstrip()[:100].startswith(b"<?xml"):
        raise ValueError(
            f"cellar response for {celex} is not RDF/XML "
            f"({len(body)} bytes, head={body[:80]!r})"
        )
    text = normalize_text(body)
    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "EU"),
        source_type="eu_celex",
        source_url=url,
        title=entry.get("title", celex),
        text=text,
        content_hash=text_hash(text),
        last_modified=last_modified,
        metadata={"celex": celex, "mode": "cellar_rdf"},
    )
