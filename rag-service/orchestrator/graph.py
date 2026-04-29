#!/usr/bin/env python3
"""
graph.py - LangGraph StateGraph assembly

Complete agentic RAG graph with:
- Multi-market Send() fan-out
- Agent loop with max_attempts
- NLI verification + conditional routing
- HyDE query refinement
"""
from langgraph.graph import StateGraph, END
from langgraph.types import Send
from orchestrator.state import GraphState, initial_state

from orchestrator.nodes.query_planner import query_planner_node
from orchestrator.nodes.retriever import fan_out_markets, retriever_node
from orchestrator.nodes.synthesis import synthesis_node
from orchestrator.nodes.verifier import verifier_node, should_regenerate
from orchestrator.nodes.refiner import refiner_node
from orchestrator.nodes.generator import generator_node


def build_compliance_graph() -> StateGraph:
    g = StateGraph(GraphState)

    # ── Nodes ────────────────────────────────────────────────
    g.add_node("query_planner", query_planner_node)
    g.add_node("fan_out",       lambda state: None)  # Pure Send dispatcher
    g.add_node("retrieve",       retriever_node)
    g.add_node("synthesis",      synthesis_node)
    g.add_node("generate",       generator_node)
    g.add_node("verify",        verifier_node)
    g.add_node("refine",         refiner_node)

    # ── Entry ─────────────────────────────────────────────────
    g.set_entry_point("query_planner")

    # ── Fixed edges ──────────────────────────────────────────
    g.add_edge("query_planner", "fan_out")

    # ── Conditional fan-out to retrieve per market ───────────
    g.add_conditional_edges(
        "fan_out",
        fan_out_markets,
    )

    # ── After all retrievals complete → synthesis ────────────
    g.add_edge("retrieve", "synthesis")
    g.add_edge("synthesis", "generate")
    g.add_edge("generate", "verify")

    # ── Conditional routing after verification ────────────────
    g.add_conditional_edges(
        "verify",
        should_regenerate,
        {
            "end":            END,
            "refine":         "refine",
            "force_generate": "generate",  # Re-generate without re-retrieval (WARN status)
        },
    )

    # ── Refine → back to fan_out ─────────────────────────────
    g.add_edge("refine", "fan_out")

    return g


def compile_graph() -> "CompiledStateGraph":
    """Compile with safety limits."""
    graph = build_compliance_graph()
    return graph.compile(
        recursion_limit=15,
        debug=False,
    )


def run_compliance_graph(
    query: str,
    product: str = "",
    category: str = "",
    markets: list[str] = None,
    vision_result: dict = None,
) -> dict:
    """
    Run the full compliance graph.

    Returns:
        dict with final_report, status, agent_trace, documents
    """
    if markets is None:
        markets = ["EU"]
    if vision_result is None:
        vision_result = {}

    compiled = compile_graph()

    initial = initial_state(
        query=query,
        product=product,
        category=category,
        markets=markets,
        vision_result=vision_result,
    )

    result = compiled.invoke(initial)

    # Build final output
    final_report = result.get("generation", "") or result.get("final_report", "")
    status = result.get("generation_score", "UNKNOWN")

    # Map to final status
    if status in ("PASS", "ENTAILED", "supported"):
        final_status = "PASS"
    elif status in ("WARN", "force_generate"):
        final_status = "WARN"
    else:
        final_status = "REJECTED"

    return {
        "final_report": final_report,
        "status": final_status,
        "agent_trace": result.get("agent_trace", []),
        "documents": result.get("documents", []),
        "loop_count": result.get("loop_count", 0),
    }
