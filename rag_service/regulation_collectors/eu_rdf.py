"""Shared EU Publications Office / EUR-Lex resolution helper.

Used by ``scripts/collect_official_sources_from_registry.py`` (and, historically,
the removed one-shot collectors) to resolve a CELEX number to its Cellar XHTML
representation, with optional EUR-Lex HTML fallback when Cellar DOC_1 endpoints
are unreachable.
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rag_service.regulation_collectors.base import BaseCollector


EU_CELLAR_VARIANTS_FULL: tuple[str, ...] = (
    "0006.03",
    "0006.02",
    "0001.03",
    "0001.02",
    "0002.03",
    "0002.02",
    "0003.03",
    "0003.02",
    "0004.03",
    "0004.02",
)
EU_CELLAR_VARIANTS_SHORT: tuple[str, ...] = (
    "0006.03",
    "0006.02",
    "0001.03",
    "0001.02",
    "0002.03",
    "0002.02",
    "0003.03",
    "0003.02",
)

CELLAR_UUID_PATTERN = re.compile(
    r'<rdf:Description rdf:about="http://publications\.europa\.eu/resource/cellar/([^"]+)">(.*?)</rdf:Description>',
    re.S,
)

# M18 (2026-09-18): the registry generator hands us up to 80 variant slots
# (20 numbered slots x 4 suffixes). Probing all of them sequentially shares a
# single per-source fetch budget, so one unreachable EU source can pin its
# worker for a very long time and never succeed. Real captures land in the
# first few slots (the newest Cellar representation), so only the first
# ``MAX_CELLAR_VARIANT_PROBES`` are tried before falling back to EUR-Lex.
MAX_CELLAR_VARIANT_PROBES = 10


def ensure_eu_text(
    collector: "BaseCollector",
    entry: dict,
    celex: str,
    rdf_rel: str,
    xhtml_rel: str,
    *,
    min_bytes_for_rdf: int = 500,
    variants: tuple[str, ...] = EU_CELLAR_VARIANTS_FULL,
    use_eurlex_fallback: bool = True,
) -> None:
    """Resolve a CELEX to its Cellar XHTML (and optional EUR-Lex HTML fallback).

    Mirrors the original ``Collector.ensure_eu_text`` behaviour: downloads the
    Publications Office RDF, extracts the Cellar UUID, then probes each variant
    of ``cellar/<uuid>.<variant>/DOC_1`` — at most ``MAX_CELLAR_VARIANT_PROBES``
    of them (M18) — before optionally falling back to the EUR-Lex legal-content
    HTML endpoint.

    Failures are recorded via ``collector.record_failure``.
    """
    rdf_path = collector.supplement_dir / rdf_rel
    if not rdf_path.exists() or rdf_path.stat().st_size < min_bytes_for_rdf:
        collector.download(
            f"https://publications.europa.eu/resource/celex/{celex}",
            rdf_rel,
            min_bytes=min_bytes_for_rdf,
        )

    if not rdf_path.exists() or rdf_path.stat().st_size < min_bytes_for_rdf:
        collector.record_failure(
            url="",
            file=rdf_rel,
            error=f"missing EU RDF for {celex}",
            entry_id=entry["id"],
        )
        return

    rdf_text = rdf_path.read_text(encoding="utf-8", errors="ignore")
    cellar_uuid = None
    same_as = f'owl:sameAs rdf:resource="http://publications.europa.eu/resource/celex/{celex}"'
    for match in CELLAR_UUID_PATTERN.finditer(rdf_text):
        if same_as in match.group(2):
            cellar_uuid = match.group(1)
            break

    if not cellar_uuid:
        collector.record_failure(
            url=entry["source_url"],
            file=xhtml_rel,
            error=f"could not resolve Cellar UUID for {celex}",
        )
        return

    for variant in variants[:MAX_CELLAR_VARIANT_PROBES]:
        content_url = f"https://publications.europa.eu/resource/cellar/{cellar_uuid}.{variant}/DOC_1"
        result = collector.download(
            content_url,
            xhtml_rel,
            force=not (collector.supplement_dir / xhtml_rel).exists(),
            min_bytes=1000,
            curl_fallback=False,
            record_failure=False,
        )
        if result["status"] in {"downloaded", "existing"}:
            entry["content_url"] = content_url
            if xhtml_rel not in entry["files"]:
                entry["files"].append(xhtml_rel)
            return

    if use_eurlex_fallback:
        eurlex_url = f"https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:{celex}"
        result = collector.download(
            eurlex_url,
            xhtml_rel,
            force=not (collector.supplement_dir / xhtml_rel).exists(),
            min_bytes=1000,
            curl_fallback=True,
            record_failure=False,
        )
        if result["status"] in {"downloaded", "existing"}:
            entry["content_url"] = eurlex_url
            entry["content_note"] = (
                "EUR-Lex legal-content HTML fallback used because Cellar DOC_1 XHTML was not reachable."
            )
            if xhtml_rel not in entry["files"]:
                entry["files"].append(xhtml_rel)
            return

    collector.record_failure(
        url=entry["source_url"],
        file=xhtml_rel,
        error=f"could not download XHTML for {celex} cellar {cellar_uuid}",
    )