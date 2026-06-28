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
from rag_service.orchestrator.state import GraphState, initial_state

from rag_service.orchestrator.nodes.query_planner import query_planner_node
from rag_service.orchestrator.nodes.retriever import fan_out_markets, retriever_node
from rag_service.orchestrator.nodes.synthesis import synthesis_node
from rag_service.orchestrator.nodes.verifier import verifier_node, should_regenerate
from rag_service.orchestrator.nodes.refiner import refiner_node
from rag_service.orchestrator.nodes.generator import generator_node
from rag_service.orchestrator.nodes import vision as vision_node


def build_compliance_graph() -> StateGraph:
    g = StateGraph(GraphState)

    # ── Nodes ────────────────────────────────────────────────
    g.add_node("vision",        vision_node.vision_analysis_node)
    g.add_node("query_planner", query_planner_node)
    g.add_node("fan_out",       lambda state: None)  # Pure Send dispatcher
    g.add_node("retrieve",       retriever_node)
    g.add_node("synthesis",      synthesis_node)
    g.add_node("generate",       generator_node)
    g.add_node("verify",        verifier_node)
    g.add_node("refine",         refiner_node)

    # ── Entry ─────────────────────────────────────────────────
    g.set_entry_point("vision")

    # ── Vision → Query Planner ──────────────────────────────────
    g.add_edge("vision", "query_planner")

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
    # should_regenerate only ever returns "end" or "refine". An earlier
    # implementation also had a "force_generate" branch that routed back to
    # the generate node, but no code path produces that value, making it a
    # dead branch that misleads readers. Removed.
    g.add_conditional_edges(
        "verify",
        should_regenerate,
        {
            "end":            END,
            "refine":         "refine",
        },
    )

    # ── Refine → back to query_planner (HyDE-style loop) ───────
    g.add_edge("refine", "query_planner")

    return g


_compiled_graph: "CompiledStateGraph | None" = None


def get_compiled_graph() -> "CompiledStateGraph":
    """Singleton compiled graph — avoids recompiling on every invoke."""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = compile_graph()
    return _compiled_graph


def compile_graph() -> "CompiledStateGraph":
    """Compile the graph. recursion_limit is passed at invoke time, not compile."""
    graph = build_compliance_graph()
    return graph.compile(debug=False)


def run_compliance_graph(
    query: str,
    product: str = "",
    category: str = "",
    markets: list[str] = None,
    vision_result: dict = None,
    images: list[dict] = None,
    documents: list[dict] = None,
) -> dict:
    """
    Run the full compliance graph.

    Args:
        query: user query
        product: product name
        category: product category (electronics/toy/etc.)
        markets: target markets (EU/US/UK/CN)
        vision_result: pre-computed vision analysis result
        images: list of {"buffer": bytes, "mime_type": str} for vision analysis

    Returns:
        dict with final_report, status, agent_trace, documents
    """
    if markets is None:
        markets = ["EU"]
    if vision_result is None:
        vision_result = {}
    if images is None:
        images = []
    if documents is None:
        documents = []

    compiled = get_compiled_graph()

    initial = initial_state(
        query=query,
        product=product,
        category=category,
        markets=markets,
        vision_result=vision_result,
        images=images,
        documents=documents,
    )

    # recursion_limit caps graph steps (including refine → query_planner loops
    # and per-market Send() fan-out). HyDE refinement can recurse:
    # query_planner → fan_out → retrieve → synthesis → generate → verify →
    # refine → query_planner ...; with max_attempts=2 plus multi-market
    # fan-out, 50 is a safe upper bound that prevents infinite loops without
    # blocking legitimate workflows. LangGraph 1.1.6 honours recursion_limit
    # via the config dict passed to invoke (not at compile time).
    result = compiled.invoke(initial, config={"recursion_limit": 50})

    # Build final output
    final_report = result.get("generation", "") or result.get("final_report", "")
    status = result.get("generation_score", "UNKNOWN")

    # Map to final status
    if status in ("supported", "PASS", "ENTAILED"):
        final_status = "PASS"
    elif status in ("warn", "WARN"):
        final_status = "WARN"
    else:
        final_status = "REJECTED"

    return {
        "final_report": final_report,
        "status": final_status,
        "agent_trace": result.get("agent_trace", []),
        "retrieved_chunks": result.get("documents", []),
        "report_package": result.get("report_package", {}),
        "loop_count": result.get("loop_count", 0),
    }
