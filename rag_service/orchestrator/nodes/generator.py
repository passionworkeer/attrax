#!/usr/bin/env python3
"""
generator.py - Report generation node

Wraps ReportGenerator and updates state with generation text.
"""
from rag_service.orchestrator.state import GraphState

_generator_instance = None


def set_generator(generator):
    global _generator_instance
    _generator_instance = generator


def generator_node(state: GraphState) -> dict:
    """Generate compliance report from retrieved documents."""
    import time
    start_time = time.time()

    query = state.get("query", "")
    product = state.get("product", "产品")
    markets = state.get("markets", ["EU"])
    documents = state.get("documents", [])
    user_docs = state.get("user_documents", [])

    if not _generator_instance:
        return {
            "generation": "错误：报告生成器未初始化",
            "agent_trace": state.get("agent_trace", []) + [{"node": "generator", "error": "no_generator"}],
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
    else:
        try:
            generation = _generator_instance.generate(
                query=query,
                product=product,
                market=", ".join(markets),
                chunks=documents,
                doc_context=doc_context,
            )
        except Exception as e:
            generation = f"报告生成失败: {e}"

    duration_ms = int((time.time() - start_time) * 1000)

    trace_entry = {
        "node": "generate",
        "chunks_count": len(documents),
        "generation_length": len(generation),
        "duration_ms": duration_ms,
    }

    return {
        "generation": generation,
        "agent_trace": state.get("agent_trace", []) + [trace_entry],
    }
