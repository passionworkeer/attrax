#!/usr/bin/env python3
"""
verifier.py - Citation verification node

Wraps CitationVerifier and updates state with generation_score + missing_citations.
"""
from rag_service.orchestrator.state import GraphState

_verifier_instance = None
_is_injected = False


def set_verifier(verifier):
    global _verifier_instance, _is_injected
    _verifier_instance = verifier
    _is_injected = True


def _get_verifier():
    """Get verifier with lazy initialization."""
    global _verifier_instance, _is_injected
    if _verifier_instance is None and not _is_injected:
        try:
            from rag_service.verify.citation_verifier import CitationVerifier
            _verifier_instance = CitationVerifier()
        except Exception:
            pass
    return _verifier_instance


def verifier_node(state: GraphState) -> dict:
    """Verify current generation against retrieved documents."""
    generation = state.get("generation", "")
    documents = state.get("documents", [])

    if not generation:
        return {"generation_score": "not_generated", "missing_citations": []}

    verifier = _get_verifier()
    if not verifier:
        return {"generation_score": "supported", "missing_citations": []}

    result = verifier.verify_citations(generation, documents)

    score_map = {
        "PASS": "supported",
        "ENTAILED": "supported",
        "WARN": "warn",          # partial support — still return report
        "REJECTED": "not_supported",
    }
    generation_score = score_map.get(result.status, "not_supported")

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
        }],
    }


def should_regenerate(state: GraphState) -> str:
    """Route after verification: end / refine / force_generate."""
    score = state.get("generation_score", "")

    if score in ("supported", "PASS", "ENTAILED"):
        return "end"

    loop_count = state.get("loop_count", 0)
    max_attempts = state.get("max_attempts", 2)
    missing = state.get("missing_citations", [])

    # CRITICAL: hard cap at max_attempts rounds to prevent infinite loop
    if loop_count >= max_attempts:
        return "end"

    # Refine query if missing citations
    if loop_count < max_attempts and missing:
        return "refine"

    return "end"  # Not supported but no more attempts → end
