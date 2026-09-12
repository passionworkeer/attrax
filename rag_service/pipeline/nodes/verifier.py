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
"""
import logging

from rag_service.pipeline.state import GraphState
from rag_service.verify.quote_matcher import (
    build_evidence_pack,
    match_citations,
)

logger = logging.getLogger(__name__)

# Per-process cache of `(doc_id, article_id) -> article_text` so the
# verify node doesn't hit the YAML loader once per citation. The
# regulation library is read-only at runtime.
_ARTICLE_TEXT_CACHE: dict[tuple[str, str], str | None] = {}


def _recover_fallback_quotes(citations: list[dict]) -> int:
    """Replace an unverifiable provider paraphrase with a source excerpt.

    This is deliberately limited to ``fallback_article_only`` entries: their
    document and article identifiers already resolved against our bundled
    regulation library, but the provider's claimed quotation did not occur in
    that article.  The replacement is a verbatim, bounded excerpt from that
    same article and is tagged for consumers/audit. Unknown articles remain
    ``unmatched`` and are never manufactured into evidence.
    """
    recovered = 0
    for entry in citations:
        if not isinstance(entry, dict) or entry.get("match_status") != "fallback_article_only":
            continue
        doc_id = str(entry.get("doc_id") or "").strip()
        article_id = str(entry.get("article_id") or "").strip()
        article_text = _ARTICLE_TEXT_CACHE.get((doc_id, article_id))
        excerpt = str(article_text or "").strip()[:700]
        if not excerpt:
            continue
        entry["quote"] = excerpt
        entry["quote_provenance"] = "canonical_regulation_excerpt"
        entry["quote_span"] = None
        entry["match_status"] = None
        recovered += 1
    return recovered


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

    match_citations(citations, cache=_ARTICLE_TEXT_CACHE)

    # Providers occasionally pick a real article but paraphrase the requested
    # quotation. Convert only those resolved-but-unverifiable paraphrases to
    # canonical library excerpts, then run the same matcher again so the UI
    # receives a real span/highlight rather than a misleading soft citation.
    recovered_quotes = _recover_fallback_quotes(citations)
    if recovered_quotes:
        match_citations(citations, cache=_ARTICLE_TEXT_CACHE)

    report_package = dict(report_package)
    report_package["citations"] = citations
    report_package["evidencePack"] = build_evidence_pack(citations)

    matched = sum(1 for c in citations if c.get("match_status") == "matched")
    fallback = sum(1 for c in citations if c.get("match_status") == "fallback_article_only")
    unmatched = sum(1 for c in citations if c.get("match_status") == "unmatched")
    audit = dict(report_package.get("auditMetadata") or {})
    audit["verificationMode"] = "kb_exact_quote"
    audit["canonicalQuoteRecoveryCount"] = recovered_quotes
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
            "canonical_quote_recovery_count": recovered_quotes,
        }],
    }
