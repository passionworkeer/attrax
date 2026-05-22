#!/usr/bin/env python3
"""
state.py - GraphState definition for Agentic RAG

Uses Annotated[list, operator.add] for automatic multi-round document merging.
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
    # Annotated[list, operator.add] → multiple Send() results auto-merge
    sub_queries: list[dict]                            # QueryPlanner output
    documents: Annotated[list[dict], operator.add]    # Accumulated across rounds
    generation: str                                   # Current draft report
    report_package: dict                              # Four-scene generated content package
    relevance_score: str                               # "relevant" | "not_relevant"
    generation_score: str                               # "supported" | "not_supported"
    missing_citations: list[str]                       # Unverified citations
    loop_count: int                                   # Retry counter

    # === Configuration ===
    max_attempts: int                                 # Max retrieval rounds (default 1, disable loop)
    hyde_query: str                                   # HyDE hypothetical query (optional)

    # === Output ===
    final_report: str
    status: str                                       # PASS | WARN | REJECTED
    agent_trace: list[dict]                           # Node execution trace for frontend


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
        missing_citations=[],
        loop_count=0,
        max_attempts=1,
        hyde_query="",
        final_report="",
        status="PENDING",
        agent_trace=[],
    )
