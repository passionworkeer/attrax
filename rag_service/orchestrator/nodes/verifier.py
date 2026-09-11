#!/usr/bin/env python3
"""
verifier.py — Citation verification node (De-RAG §7.4)

Wraps `quote_matcher.match_citations` and fills
`report_package.citations[].quote_span` + `match_status`. The legacy
`CitationVerifier` (NLI/text-overlap) is no longer wired in — every
`report_package` reaches the front-end with deterministic
quote-matches OR an honest `fallback_article_only` / `unmatched`
state.

This module is preserved under its old name (`verifier_node`) so
`orchestrator/graph.py` imports keep working; the function body is
now a thin shim around `quote_matcher`.

The `should_regenerate` helper still exists for graph routing
backwards compatibility but always returns `"end"` — spec §7.4
removed the refine loop because no NLI is available in production
to drive corrections.
"""
import logging

from rag_service.orchestrator.state import GraphState
from rag_service.verify.quote_matcher import (
    build_evidence_pack,
    match_citations,
)

logger = logging.getLogger(__name__)

_verifier_instance = None

# Per-call cache of `(doc_id, article_id) -> article_text` so the
# verify node doesn't hit the YAML loader once per citation. The
# module-level cache lives for the process lifetime, which is fine
# because the regulation library is read-only at runtime.
_ARTICLE_TEXT_CACHE: dict[tuple[str, str], str | None] = {}


def set_verifier(verifier):
    """Inject a legacy `CitationVerifier` (NLI/text-overlap).

    The De-RAG pipeline (§7.4) prefers `quote_matcher.match_citations`
    in production, but tests still inject the legacy verifier via this
    hook to exercise the `verification_mode = "nli"` routing path. The
    node runs the injected verifier when present, falls back to the
    quote matcher otherwise.
    """
    global _verifier_instance
    _verifier_instance = verifier


def verifier_node(state: GraphState) -> dict:
    """Run the citation verification step.

    Two code paths:

    1. **Legacy (test-only)**: when `set_verifier` injected a
       `CitationVerifier`, run it and translate the result into the
       orchestrator's `generation_score` / `missing_citations` /
       `verification_mode` keys. This path is used by the existing
       refine-loop unit tests.

    2. **De-RAG (§7.4 default)**: run `quote_matcher.match_citations`
       against the regulation article library, populating
       `report_package.citations[].quote_span` + `match_status` and
       `report_package.evidencePack` (deduped). Production never
       injects a verifier, so this is what runs in deployed scans.
    """
    report_package = state.get("report_package") or {}

    if _verifier_instance is not None:
        return _run_legacy_verifier(state, report_package)

    return _run_quote_matcher(state, report_package)


def _run_legacy_verifier(state: GraphState, report_package: dict) -> dict:
    """Legacy path — kept for the NLI-driven refine-loop tests."""
    generation = state.get("generation", "")
    documents = state.get("documents", [])
    if not generation:
        return {"generation_score": "not_generated", "missing_citations": []}
    result = _verifier_instance.verify_citations(generation, documents)
    score_map = {
        "PASS": "supported",
        "ENTAILED": "supported",
        "WARN": "not_supported",
        "REJECTED": "not_supported",
    }
    generation_score = score_map.get(result.status, "not_supported")
    missing = [
        d["claim"] for d in result.details
        if d.get("status") in ("NEUTRAL", "UNVERIFIED")
    ]
    return {
        "generation_score": generation_score,
        "verification_mode": result.verification_mode,
        "missing_citations": missing,
        "agent_trace": [{
            "node": "verifier",
            "status": result.status,
            "verification_mode": result.verification_mode,
            "attribution_score": result.attribution_score,
            "entailed": result.entailed,
            "contradicted": result.contradicted,
        }],
    }


def _run_quote_matcher(state: GraphState, report_package: dict) -> dict:
    """De-RAG (§7.4) production path — quote-match over citations."""
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
    report_package = dict(report_package)
    report_package["citations"] = citations
    report_package["evidencePack"] = build_evidence_pack(citations)
    matched = sum(1 for c in citations if c.get("match_status") == "matched")
    fallback = sum(1 for c in citations if c.get("match_status") == "fallback_article_only")
    unmatched = sum(1 for c in citations if c.get("match_status") == "unmatched")
    return {
        "report_package": report_package,
        "agent_trace": [{
            "node": "verify",
            "status": "success",
            "matched": matched,
            "fallback_article_only": fallback,
            "unmatched": unmatched,
            "total_citations": len(citations),
        }],
    }


def should_regenerate(state: GraphState) -> str:
    """Routing decision after the verify node.

    Spec §7.4 step 4 says "no NLI means no refine". In production this
    is naturally satisfied because `verifier_node` above replaces the
    NLI/text-overlap verifier with `quote_matcher` and never reports
    `verification_mode = "nli"` — the routing below already returns
    "end" in that case. The legacy routing logic is kept so the unit
    tests that inject a stub `CitationVerifier` with `verification_mode
    = "nli"` still cover the rare path where a real NLI is wired up.
    """
    score = state.get("generation_score", "")
    if score in ("supported", "PASS", "ENTAILED"):
        return "end"

    # Corrective retrieval/generation is only useful when a full NLI
    # verifier can judge whether the new draft improved. The quote
    # matcher path (§7.4) never sets `verification_mode = "nli"`, so
    # this branch is the default in production and the loop is skipped.
    verification_mode = state.get("verification_mode", "unavailable")
    if verification_mode != "nli":
        logger.info(
            "Skipping corrective generation: verification_mode=%s score=%s",
            verification_mode,
            score or "unknown",
        )
        return "end"

    loop_count = state.get("loop_count", 0)
    max_attempts = state.get("max_attempts", 2)
    missing = state.get("missing_citations", [])
    if loop_count >= max_attempts:
        return "end"
    if missing:
        return "refine"
    return "end"