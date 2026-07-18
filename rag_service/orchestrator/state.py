#!/usr/bin/env python3
"""
state.py - GraphState definition for Agentic RAG

Annotated[list, operator.add] is REQUIRED on keys that receive contributions
from multiple LangGraph Send() fan-out branches. Without a reducer, the default
behaviour is overwrite: parallel branches (one per market) silently clobber
each other's sub_queries, documents, and agent_trace entries — losing data and
producing nondeterministic output. operator.add concatenates list contributions
from every branch so multi-market results are preserved.

NOTE (audit 2026-06-29): for agent_trace, nodes MUST return only their NEW
entry (e.g. {"agent_trace": [entry]}), never the accumulated list. Returning
state.get("agent_trace", []) + [entry] makes every fan-out branch re-append the
pre-fan-out trace, and operator.add then multiplies those copies (observed
32k+ entries at max_attempts=2). Nodes were fixed to return only new entries.
"""
from typing import TypedDict, Annotated
import operator
from typing import Optional


class GraphState(TypedDict, total=False):
    # === Input ===
    query: str
    product: str
    category: str
    markets: list[str]
    vision_result: dict
    images: list[dict]  # [{"buffer": bytes, "mime_type": str}]
    user_documents: list[dict]  # [{"name": str, "mime_type": str, "text": str}] user-uploaded docs

    # === Agent intermediate state ===
    # operator.add → multiple Send() results auto-merge across branches.
    # Without these reducers, parallel market branches overwrite each other.
    sub_queries: Annotated[list[dict], operator.add]       # QueryPlanner output
    documents: Annotated[list[dict], operator.add]         # Accumulated across rounds
    generation: str                                        # Current draft report
    report_package: dict                                   # Four-scene generated content package
    relevance_score: str                                   # "relevant" | "not_relevant"
    generation_score: str                                  # "supported" | "not_supported"
    verification_mode: str                                 # "nli" | "text_overlap" | "unavailable"
    missing_citations: list[str]                           # Unverified citations
    loop_count: int                                        # Retry counter

    # === Configuration ===
    # Default 2 (allow one refinement round). initial_state sets this explicitly
    # so callers can override; should_regenerate reads it as the single source of
    # truth. Was previously 1 here but 2 in should_regenerate's local fallback —
    # the disagreement made the agent loop nondeterministic (sometimes infinite,
    # sometimes disabled). Now both read from state.
    max_attempts: int
    hyde_query: str                                        # HyDE hypothetical query (optional)

    # === Output ===
    final_report: str
    status: str                                            # PASS | WARN | REJECTED
    agent_trace: Annotated[list[dict], operator.add]       # Node execution trace; nodes return ONLY new entries (audit 2026-06-29)


def initial_state(query: str, product: str, category: str,
                  markets: list[str], vision_result: dict,
                  images: list[dict] = None,
                  documents: list[dict] = None) -> GraphState:
    """Create initial GraphState."""
    return GraphState(
        query=query,
        product=product,
        category=category,
        markets=markets,
        vision_result=vision_result,
        images=images or [],
        user_documents=documents or [],  # renamed: user-uploaded docs (input)
        sub_queries=[],
        documents=[],
        generation="",
        report_package={},
        relevance_score="",
        generation_score="",
        verification_mode="unavailable",
        missing_citations=[],
        loop_count=0,
        max_attempts=2,
        hyde_query="",
        final_report="",
        status="PENDING",
        agent_trace=[],
    )
