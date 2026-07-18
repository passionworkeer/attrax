"""New tests covering orchestrator correctness fixes in this change set.

Scope:
1. GraphState Annotated reducers (operator.add) on sub_queries / agent_trace /
   documents — these were plain lists before, so LangGraph Send() fan-out
   branches silently overwrote each other.
2. refiner dedups sub_queries so HyDE loops don't grow the list unboundedly.
3. should_regenerate honours max_attempts as single source of truth (no
   silent fallback that disagrees with initial_state).
4. initial_state default max_attempts is 2 (was 1, which disabled refinement).
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import operator
from typing import get_type_hints

from rag_service.orchestrator.state import GraphState, initial_state
from rag_service.orchestrator.nodes.refiner import refiner_node
from rag_service.orchestrator.nodes.verifier import should_regenerate


# ── 1. Reducers on multi-branch merge keys ──────────────────────────────────

def test_sub_queries_has_operator_add_reducer():
    """sub_queries must merge (not overwrite) across Send() branches."""
    hints = get_type_hints(GraphState, include_extras=True)
    meta = hints["sub_queries"]
    # Annotated[X, reducer] carries metadata in __metadata__.
    reducers = getattr(meta, "__metadata__", ())
    assert operator.add in reducers, (
        "sub_queries missing operator.add reducer — Send() fan-out will clobber "
        "per-market sub-queries instead of concatenating them."
    )


def test_agent_trace_has_operator_add_reducer():
    """agent_trace must merge across branches (frontend relies on this)."""
    hints = get_type_hints(GraphState, include_extras=True)
    meta = hints["agent_trace"]
    reducers = getattr(meta, "__metadata__", ())
    assert operator.add in reducers


def test_documents_reducer_preserved():
    """documents already had operator.add — guard against regression."""
    hints = get_type_hints(GraphState, include_extras=True)
    meta = hints["documents"]
    reducers = getattr(meta, "__metadata__", ())
    assert operator.add in reducers


# ── 2. refiner dedup ────────────────────────────────────────────────────────

def test_refiner_dedups_identical_sub_queries_after_expansion():
    """Repeated refine rounds must not accumulate duplicate sub-queries."""
    state = {
        "query": "REACH compliance",
        # Two sub-queries that, after appending the same regulatory terms,
        # would collapse to the same expanded query string.
        "sub_queries": [
            {"market": "EU", "query": "REACH compliance Article 5"},
            {"market": "US", "query": "REACH compliance Article 5"},
        ],
        "missing_citations": ["REACH Article 5"],
        "loop_count": 0,
        "agent_trace": [],
    }
    result = refiner_node(state)
    queries = [sq["query"] for sq in result["sub_queries"]]
    assert len(queries) == len(set(queries)), "duplicate sub_queries after refine"
    # Both inputs expand to the same text -> one survivor.
    assert len(result["sub_queries"]) == 1


def test_refiner_loop_count_uses_immutable_increment():
    """loop_count returned as a new value, not mutated in place."""
    state = {
        "query": "test",
        "sub_queries": [{"market": "EU", "query": "test"}],
        "missing_citations": ["Article 1"],
        "loop_count": 4,
        "agent_trace": [],
    }
    result = refiner_node(state)
    assert result["loop_count"] == 5
    # Original state unchanged.
    assert state["loop_count"] == 4


# ── 3. should_regenerate respects max_attempts as single source of truth ────

def test_should_regenerate_forces_end_when_loop_count_reaches_max():
    state = {
        "generation_score": "not_supported",
        "loop_count": 2,
        "max_attempts": 2,
        "missing_citations": ["some missing"],
    }
    # Even with missing citations, hitting max_attempts ends the loop.
    assert should_regenerate(state) == "end"


def test_should_regenerate_refines_when_below_max_and_missing():
    state = {
        "generation_score": "not_supported",
        "verification_mode": "nli",
        "loop_count": 1,
        "max_attempts": 2,
        "missing_citations": ["Article 9"],
    }
    assert should_regenerate(state) == "refine"


def test_should_regenerate_ends_when_verification_is_degraded():
    """A weak fallback must not drive expensive corrective generations."""
    state = {
        "generation_score": "not_supported",
        "verification_mode": "text_overlap",
        "loop_count": 0,
        "max_attempts": 2,
        "missing_citations": ["Article 9"],
    }
    assert should_regenerate(state) == "end"


def test_should_regenerate_ends_on_supported_score():
    state = {
        "generation_score": "supported",
        "loop_count": 0,
        "max_attempts": 2,
        "missing_citations": [],
    }
    assert should_regenerate(state) == "end"


# ── 4. initial_state max_attempts default ───────────────────────────────────

def test_initial_state_default_max_attempts_is_two():
    """Refinement needs at least one round; default 1 disabled the loop."""
    s = initial_state(
        query="CE marking",
        product="power bank",
        category="electronics",
        markets=["EU"],
        vision_result={},
    )
    assert s["max_attempts"] == 2
