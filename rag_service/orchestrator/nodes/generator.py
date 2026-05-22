#!/usr/bin/env python3
"""
generator.py - Report generation node

Wraps ReportGenerator and updates state with generation text.
"""
import logging

from rag_service.orchestrator.state import GraphState

logger = logging.getLogger(__name__)

_generator_instance = None
_is_injected = False


def set_generator(generator):
    global _generator_instance, _is_injected
    _generator_instance = generator
    _is_injected = True


def _get_generator():
    """Get the report generator, preferring injected instances over lazy init."""
    global _generator_instance, _is_injected
    if _generator_instance is not None:
        return _generator_instance
    if _is_injected:
        return None

    try:
        from rag_service.config import settings
        from rag_service.generate.report_generator import ReportGenerator

        api_key = settings.mimotalk_api_key or None
        if not api_key:
            return None
        _generator_instance = ReportGenerator(api_key=api_key)
    except Exception as e:
        logger.warning("Report generator lazy init failed: %s", e)
        return None

    return _generator_instance


def generator_node(state: GraphState) -> dict:
    """Generate compliance report from retrieved documents."""
    import time
    start_time = time.time()

    query = state.get("query", "")
    product = state.get("product", "产品")
    markets = state.get("markets", ["EU"])
    documents = state.get("documents", [])
    user_docs = state.get("user_documents", [])

    generator = _get_generator()
    provider = getattr(generator, "provider", None) if generator else None

    if not generator:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "generation": "错误：报告生成器未初始化",
            "agent_trace": state.get("agent_trace", []) + [{
                "node": "generate",
                "provider": provider,
                "status": "error",
                "error": "no_generator",
                "duration_ms": duration_ms,
            }],
        }

    # Build document context from user-uploaded documents
    doc_context = ""
    if user_docs:
        doc_parts = []
        for doc in user_docs:
            name = doc.get("name", "未知文档")
            text = doc.get("text", "").strip()
            if text:
                doc_parts.append(f"【{name}】\n{text[:3000]}")
        if doc_parts:
            doc_context = (
                "\n\n## 用户上传的产品文档内容\n"
                + "\n\n---\n\n".join(doc_parts)
                + "\n\n请结合以上产品文档内容，评估合规要求。"
            )

    if not documents:
        generation = "错误：未找到合规信息。请确保语料库已加载。"
        status = "no_documents"
        report_package = {}
    else:
        try:
            if getattr(generator, "supports_report_package", False) is True:
                report_package = generator.generate_report_package(
                    query=query,
                    product=product,
                    market=", ".join(markets),
                    chunks=documents,
                    doc_context=doc_context,
                )
                generation = report_package.get("complianceReport", "") or "错误：报告内容为空"
            else:
                report_package = {}
                generation = generator.generate(
                    query=query,
                    product=product,
                    market=", ".join(markets),
                    chunks=documents,
                    doc_context=doc_context,
                )
            status = "success"
        except Exception as e:
            generation = f"报告生成失败: {e}"
            status = "error"
            report_package = {}

    duration_ms = int((time.time() - start_time) * 1000)

    trace_entry = {
        "node": "generate",
        "provider": provider,
        "status": status,
        "package_scenes": len(report_package) if report_package else 0,
        "chunks_count": len(documents),
        "generation_length": len(generation),
        "duration_ms": duration_ms,
    }

    result = {
        "generation": generation,
        "agent_trace": state.get("agent_trace", []) + [trace_entry],
    }
    if report_package:
        result["report_package"] = report_package
    return result
