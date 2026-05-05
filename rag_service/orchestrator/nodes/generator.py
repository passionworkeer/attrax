#!/usr/bin/env python3
"""
generator.py - Report generation node

Wraps ReportGenerator and updates state with generation text.
"""
from rag_service.orchestrator.state import GraphState

_generator_instance = None
_is_injected = False


def set_generator(generator):
    global _generator_instance, _is_injected
    _generator_instance = generator
    _is_injected = True


def _get_generator():
    """Get generator. Prefers injected instance; falls back to lazy init from settings."""
    global _generator_instance, _is_injected
    if _generator_instance is not None:
        return _generator_instance

    if not _is_injected:
        try:
            from rag_service.config import settings
            from rag_service.generate.report_generator import ReportGenerator
            _generator_instance = ReportGenerator(api_key=settings.mimotalk_api_key or None)
        except Exception:
            pass

    return _generator_instance


def generator_node(state: GraphState) -> dict:
    """Generate compliance report from retrieved documents."""
    query = state.get("query", "")
    product = state.get("product", "产品")
    markets = state.get("markets", ["EU"])
    documents = state.get("documents", [])

    generator = _get_generator()

    if not generator:
        return {
            "generation": "错误：报告生成器未初始化",
            "agent_trace": state.get("agent_trace", []) + [{"node": "generator", "error": "no_generator"}],
        }

    if not documents:
        generation = "错误：未找到合规信息。请确保语料库已加载。"
    else:
        try:
            generation = generator.generate(
                query=query,
                product=product,
                market=", ".join(markets),
                chunks=documents,
            )
        except Exception as e:
            generation = f"报告生成失败: {e}"

    trace_entry = {
        "node": "generate",
        "provider": generator.provider if hasattr(generator, "provider") else "unknown",
        "chunks_count": len(documents),
        "generation_length": len(generation),
    }

    return {
        "generation": generation,
        "agent_trace": state.get("agent_trace", []) + [trace_entry],
    }