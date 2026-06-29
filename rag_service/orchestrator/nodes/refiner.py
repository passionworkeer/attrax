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

    terms_suffix = " ".join(set(regulatory_terms))

    # Build refined query
    refined_parts = [current_query]
    if regulatory_terms:
        # Append missing regulatory terms
        for term in set(regulatory_terms):
            if term not in current_query:
                refined_parts.append(term)

    refined_query = " ".join(refined_parts)

    # Create new sub-queries with expanded query.
    # Dedup by expanded query text so repeated refine rounds don't keep
    # accumulating identical sub_queries. state.sub_queries uses operator.add,
    # so without dedup the list grows unboundedly across HyDE iterations and
    # bloats both the next retriever call and downstream LLM context.
    new_sub_queries = []
    seen_queries: set[str] = set()
    for sq in sub_queries:
        expanded_q = f"{sq.get('query', '')} {terms_suffix}".strip()
        if expanded_q in seen_queries:
            continue
        seen_queries.add(expanded_q)
        new_sub_queries.append({**sq, "query": expanded_q})

    # loop_count: read fresh from state, return new value (immutable — never
    # mutate state in place).
    next_loop_count = loop_count + 1

    trace_entry = {
        "node": "query_refiner",
        "missing_count": len(missing_citations),
        "loop_count": next_loop_count,
        "refined_query": refined_query[:100],
    }

    return {
        "sub_queries": new_sub_queries,
        "query": refined_query,           # Update main query too
        "loop_count": next_loop_count,
        "agent_trace": [trace_entry],
    }
