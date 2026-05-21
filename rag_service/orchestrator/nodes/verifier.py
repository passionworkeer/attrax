#!/usr/bin/env python3
"""
verifier.py - Citation verification node

Wraps CitationVerifier and updates state with generation_score + missing_citations.
"""
from rag_service.orchestrator.state import GraphState
from rag_service.verify.citation_verifier import CitationVerifier


_verifier_instance = None


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
        # Fallback: skip verification, assume supported
        return {"generation_score": "supported", "missing_citations": []}

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
        "missing_citations": missing,
        "agent_trace": state.get("agent_trace", []) + [{
            "node": "verifier",
            "status": result.status,
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

    loop_count = state.get("loop_count", 0)
    max_attempts = state.get("max_attempts", 2)
    missing = state.get("missing_citations", [])

    if loop_count < max_attempts and missing:
        return "refine"

    # Max attempts reached → end (no force_generate in current implementation)
    return "end"
