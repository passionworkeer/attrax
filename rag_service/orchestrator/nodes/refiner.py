#!/usr/bin/env python3
"""
refiner.py - Query refinement node with HyDE

When citations are insufficient, refine the query and re-retrieve.
"""
import re
from rag_service.orchestrator.state import GraphState


def refiner_node(state: GraphState) -> dict:
    """Refine query based on missing citations."""
    missing_citations = state.get("missing_citations", [])
    current_query = state.get("query", "")
    sub_queries = state.get("sub_queries", [])
    loop_count = state.get("loop_count", 0)

    # Extract regulatory terms from missing citations
    regulatory_terms = []
    for citation in missing_citations:
        # Extract article/section numbers from citation
        articles = re.findall(r'(Article|Annex|Art\.|§|Section|第\d+条)\s*[\dXIV]+', citation,
                              re.IGNORECASE)
        regulatory_terms.extend(articles)

    # Build refined query
    refined_parts = [current_query]
    if regulatory_terms:
        # Append missing regulatory terms
        for term in set(regulatory_terms):
            if term not in current_query:
                refined_parts.append(term)

    refined_query = " ".join(refined_parts)

    # Create new sub-queries with expanded query
    new_sub_queries = [
        {**sq, "query": sq.get("query", "") + " " + " ".join(set(regulatory_terms))}
        for sq in sub_queries
    ]

    trace_entry = {
        "node": "query_refiner",
        "missing_count": len(missing_citations),
        "loop_count": loop_count + 1,
        "refined_query": refined_query[:100],
    }

    return {
        "sub_queries": new_sub_queries,
        "query": refined_query,  # Update main query too
        "loop_count": loop_count + 1,  # Increment counter HERE
        "agent_trace": state.get("agent_trace", []) + [trace_entry],
    }
