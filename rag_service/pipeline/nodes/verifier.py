#!/usr/bin/env python3
"""
verifier.py — Deterministic citation verification node (De-RAG §7.4/§7.7).

Runs `quote_matcher.match_citations` over `report_package.citations`,
populating `quote_span` + `match_status` on each entry and building the
deduplicated `evidencePack`. No LLM, no network — pure string matching
against the regulation library.

The legacy `CitationVerifier` (NLI / text-overlap) and its `set_verifier`
injection hook are deleted with the orchestrator; this node has exactly
one code path.

Cache staleness guard (plan 2026-09-14 J08): the underlying keys are
`(doc_id, article_id)`, which do not change when a regulation YAML is
re-edited on disk (e.g. the 2026-09-14 governance pass rewrote EU-2009-48
articles). Without a guard, this process would keep matching new quotes
against the OLD article text. `_sync_article_cache()` therefore compares
`article_loader.cache_generation()` (a counter that ticks whenever the
loader rebuilds because a file's mtime/size changed) against the
generation the cache was filled at, and drops the whole cache on a
mismatch. The (doc_id, article_id) key contract inside quote_matcher is
left untouched.
"""
import logging

from rag_service.pipeline.state import GraphState
from rag_service.retrieval.article_loader import cache_generation
from rag_service.verify.quote_matcher import (
    build_evidence_pack,
    match_citations,
)

logger = logging.getLogger(__name__)

# Per-process cache of `(doc_id, article_id) -> article_text` so the
# verify node doesn't hit the YAML loader once per citation. Invalidated
# wholesale when the regulation library changes on disk (see module
# docstring); a process restart always re-reads the files.
_ARTICLE_TEXT_CACHE: dict[tuple[str, str], str | None] = {}
_ARTICLE_TEXT_CACHE_GENERATION: int = -1


def _sync_article_cache() -> int:
    """Drop the article-text cache if the regulation library changed.

    Returns the (possibly updated) generation the cache is now valid for.

    Semantics: the first call in a process ADOPTS the current generation
    without clearing — the cache starts empty in production, and tests
    legitimately pre-populate `_ARTICLE_TEXT_CACHE` as their fixture
    before invoking `verifier_node`. Any later generation tick (library
    edited / `invalidate_cache()` called) clears the cache so quotes are
    re-matched against the new article text.
    """
    global _ARTICLE_TEXT_CACHE_GENERATION
    current = cache_generation()
    if _ARTICLE_TEXT_CACHE_GENERATION == -1:
        _ARTICLE_TEXT_CACHE_GENERATION = current
    elif _ARTICLE_TEXT_CACHE_GENERATION != current:
        if _ARTICLE_TEXT_CACHE:
            logger.info(
                "regulation library changed (generation %s -> %s); "
                "article text cache cleared",
                _ARTICLE_TEXT_CACHE_GENERATION,
                current,
            )
        _ARTICLE_TEXT_CACHE.clear()
        _ARTICLE_TEXT_CACHE_GENERATION = current
    return current


def _attach_canonical_excerpts(citations: list[dict]) -> int:
    """Attach canonical article excerpts for fallback citations without overwriting LLM quotes.

    When a citation resolves to a known regulation article but the LLM quote
    cannot be verified verbatim (fallback_article_only), we attach a canonical
    excerpt as reference metadata. We NEVER overwrite the LLM's original quote,
    nor do we forge the match_status into 'matched'.
    """
    attached = 0
    for entry in citations:
        if not isinstance(entry, dict) or entry.get("match_status") != "fallback_article_only":
            continue
        doc_id = str(entry.get("doc_id") or "").strip()
        article_id = str(entry.get("article_id") or "").strip()
        article_text = _ARTICLE_TEXT_CACHE.get((doc_id, article_id))
        excerpt = str(article_text or "").strip()[:700]
        if not excerpt:
            continue
        entry["canonical_excerpt"] = excerpt
        entry["quote_provenance"] = "llm_paraphrase_unverified"
        attached += 1
    return attached


def verifier_node(state: GraphState) -> dict:
    """Quote-match every citation in `report_package.citations`."""
    report_package = state.get("report_package") or {}
    citations = report_package.get("citations") or []

    if not citations:
        return {
            "report_package": report_package,
            "agent_trace": [{
                "node": "verify",
                "status": "no_citations",
                "duration_ms": 0,
            }],
        }

    # Library may have changed on disk (governance edit / redeploy) —
    # drop stale article texts before matching.
    _sync_article_cache()
    match_citations(citations, cache=_ARTICLE_TEXT_CACHE)

    # Attach canonical excerpts for audit & reference without falsifying the quote or match status
    attached_excerpts = _attach_canonical_excerpts(citations)

    report_package = dict(report_package)
    report_package["citations"] = citations
    report_package["evidencePack"] = build_evidence_pack(citations)

    matched = sum(1 for c in citations if c.get("match_status") == "matched")
    fallback = sum(1 for c in citations if c.get("match_status") == "fallback_article_only")
    unmatched = sum(1 for c in citations if c.get("match_status") == "unmatched")
    audit = dict(report_package.get("auditMetadata") or {})
    audit["verificationMode"] = "kb_exact_quote"
    audit["canonicalQuoteAttachedCount"] = attached_excerpts
    report_package["auditMetadata"] = audit

    return {
        "report_package": report_package,
        "agent_trace": [{
            "node": "verify",
            "status": "success",
            "matched": matched,
            "fallback_article_only": fallback,
            "unmatched": unmatched,
            "total_citations": len(citations),
            "canonical_quote_attached_count": attached_excerpts,
        }],
    }
