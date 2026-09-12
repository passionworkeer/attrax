"""EU Publications Office (EUR-Lex / Cellar) collector.

Mirrors the resolution strategy of ``rag_service/regulation_collectors/eu_rdf.py``
but standalone: resolve a CELEX number to the Cellar manifestation list, then
fetch the XHTML representation. When Cellar is unreachable, fall back to the
public EUR-Lex HTML page (its markup churn is normalized away by the state
store's whitespace collapsing + similarity threshold).
"""
from __future__ import annotations

import logging
import re

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.state import normalize_text, text_hash

logger = logging.getLogger("attrax.regwatch.collectors.eu")

CELLAR_BASE = "https://publications.europa.eu/resource/cellar"
CELEX_CELLAR_URL = "https://publications.europa.eu/resource/celex/{celex}"
EURLEX_HTML_URL = "https://eur-lex.europa.eu/legal-content/EN/TXT/?celex={celex}"

# Reuse the variant preference order proven out by the existing collector.
CELLAR_VARIANTS: tuple[str, ...] = (
    "0006.03",
    "0006.02",
    "0001.03",
    "0001.02",
    "0002.03",
    "0002.02",
)

CELLAR_UUID_PATTERN = re.compile(
    r'<rdf:Description[^>]+rdf:about="http://publications\.europa\.eu/resource/cellar/([^"/]+)',
)


def collect_eu_celex(entry: dict) -> RegulationUpdate:
    celex = entry.get("celex") or ""
    if not celex:
        # No CELEX recorded — degrade to the generic raw fetch.
        from scripts.watchdog.collectors.base import collect_generic

        return collect_generic(entry)

    text, source_url, last_modified, mode = _resolve_celex(celex)
    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "EU"),
        source_type="eu_celex",
        source_url=source_url,
        title=entry.get("title", celex),
        text=text,
        content_hash=text_hash(text),
        last_modified=last_modified,
        metadata={"celex": celex, "mode": mode},
    )


def _resolve_celex(celex: str) -> tuple[str, str, str | None, str]:
    """Return (normalized_text, resolved_url, last_modified, mode)."""
    # 1) Cellar manifestation list → first XHTML variant we can fetch.
    try:
        list_url = CELEX_CELLAR_URL.format(celex=celex)
        list_body, _ = fetch_url(
            list_url, accept="application/rdf+xml; q=1.0, application/xml; q=0.9, */*; q=0.5"
        )
        uuids = CELLAR_UUID_PATTERN.findall(list_body.decode("utf-8", errors="replace"))
        for uuid in dict.fromkeys(uuids):  # de-dup, keep order
            for variant in CELLAR_VARIANTS:
                url = f"{CELLAR_BASE}/{uuid}/{variant}"
                try:
                    body, last_modified = fetch_url(
                        url, accept="application/xhtml+xml; q=1.0, */*; q=0.5"
                    )
                    return (
                        normalize_text(body),
                        url,
                        last_modified,
                        "cellar_xhtml",
                    )
                except Exception as exc:  # noqa: BLE001 — try next variant
                    logger.debug("cellar variant %s failed: %s", variant, exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("cellar list fetch failed for %s: %s", celex, exc)

    # 2) Public EUR-Lex HTML fallback.
    html_url = EURLEX_HTML_URL.format(celex=celex)
    body, last_modified = fetch_url(html_url)
    return normalize_text(body), html_url, last_modified, "eurlex_html"
