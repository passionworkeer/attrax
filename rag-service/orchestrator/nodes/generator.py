#!/usr/bin/env python3
"""
generator.py - Report generation node

Wraps ReportGenerator and updates state with generation text.
"""
from orchestrator.state import GraphState

_generator_instance = None


def set_generator(generator):
    global _generator_instance
    _generator_instance = generator


def generator_node(state: GraphState) -> dict:
    """Generate compliance report from retrieved documents."""
    query = state.get("query", "")
    product = state.get("product", "产品")
    markets = state.get("markets", ["EU"])
    documents = state.get("documents", [])

    if not _generator_instance:
        return {
            "generation": "错误：报告生成器未初始化",
            "agent_trace": state.get("agent_trace", []) + [{"node": "generator", "error": "no_generator"}],
        }

    if not documents:
        generation = "错误：未找到合规信息。请确保语料库已加载。"
    else:
        try:
            generation = _generator_instance.generate(
                query=query,
                product=product,
                market=", ".join(markets),
                chunks=documents,
            )
        except Exception as e:
            generation = f"报告生成失败: {e}"

    trace_entry = {
        "node": "generate",
        "chunks_count": len(documents),
        "generation_length": len(generation),
    }

    return {
        "generation": generation,
        "agent_trace": state.get("agent_trace", []) + [trace_entry],
    }
