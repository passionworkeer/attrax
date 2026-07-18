#!/usr/bin/env python3
"""
verifier.py - Citation verification node

Wraps CitationVerifier and updates state with generation_score + missing_citations.
"""
import logging

from rag_service.orchestrator.state import GraphState
from rag_service.verify.citation_verifier import CitationVerifier


_verifier_instance = None
logger = logging.getLogger(__name__)


def set_verifier(verifier: CitationVerifier):
    global _verifier_instance
    _verifier_instance = verifier


def verifier_node(state: GraphState) -> dict:
    """Verify current generation against retrieved documents."""
    generation = state.get("generation", "")
    documents = state.get("documents", [])

    if not generation:
        return {"generation_score": "not_generated", "missing_citations": []}

    if not _verifier_instance:
        # P0-3a: Previously this returned "supported", silently PASSing the
        # report whenever no verifier was wired in. That hid the fact that no
        # NLI / overlap check actually ran. Return an explicit "unverified"
        # sentinel so downstream routing and traces cannot mistake the absence
        # of verification for a positive verification result.
        return {
            "generation_score": "unverified",
            "verification_mode": "unavailable",
            "missing_citations": [],
            "agent_trace": [{
                "node": "verifier",
                "status": "UNVERIFIED",
                "verification_mode": "unavailable",
                "attribution_score": 0.0,
                "entailed": 0,
                "contradicted": 0,
                "error": "no_verifier_wired",
            }],
        }

    result = _verifier_instance.verify_citations(generation, documents)

    # Map VerificationResult.status to generation_score strings
    score_map = {
        "PASS": "supported",
        "ENTAILED": "supported",
        "WARN": "not_supported",
        "REJECTED": "not_supported",
    }
    generation_score = score_map.get(result.status, "not_supported")

    # Extract missing citations
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


def should_regenerate(state: GraphState) -> str:
    """Route after verification: end / refine / force_generate."""
    score = state.get("generation_score", "")

    # Map generation_score to routing decision
    if score in ("supported", "PASS", "ENTAILED"):
        return "end"

    # Corrective retrieval/generation is evidence-driven and only useful when
    # a full NLI verifier can judge whether the new draft improved. The
    # text-overlap fallback is intentionally disclosed as degraded; in
    # production it cannot reliably tokenize Chinese claims or match every
    # citation form, so using it to drive retries caused three sequential LLM
    # generations with the same rejected verdict. Preserve that verdict, but
    # do not spend two more model calls on an unmeasurable correction loop.
    verification_mode = state.get("verification_mode", "unavailable")
    if verification_mode != "nli":
        logger.info(
            "Skipping corrective generation: verification_mode=%s score=%s",
            verification_mode,
            score or "unknown",
        )
        return "end"

    loop_count = state.get("loop_count", 0)
    # Single source of truth: max_attempts lives in initial_state (default 2).
    # Previously this read .get("max_attempts", 2) which silently fell back to 2
    # even when initial_state set it to 1 — causing the two values to disagree
    # and producing nondeterministic refine-vs-end behaviour. We still keep a
    # 2 fallback here only for the rare case where state is constructed
    # directly (e.g. tests) without going through initial_state.
    max_attempts = state.get("max_attempts", 2)
    missing = state.get("missing_citations", [])

    # Force end once we've exhausted attempts, regardless of missing citations.
    # Hard cap prevents any infinite refine loop even if other invariants slip.
    if loop_count >= max_attempts:
        return "end"
    if missing:
        return "refine"

    # No missing citations and below max — end (no force_generate in current
    # implementation; supported/warn handled by score branch above).
    return "end"
