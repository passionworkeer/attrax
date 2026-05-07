# IMPLEMENTATION-PLAN-v3.md — 已归档

> **状态**：已归档
> **归档时间**：2026-05-07
> **归档原因**：本文档描述的 Cohere/Qdrant/Docling 技术路线未按计划实现，已变更为 Ollama/FAISS/pdfplumber 路线。

## 归档说明

本文档（`docs/IMPLEMENTATION-PLAN-v3.md`）描述的原始计划如下：

- **向量 Embedding**：Cohere API（embed-multilingual-v3）
- **向量存储**：Qdrant（Docker 部署）
- **文档解析**：Docling
- **LLM**：Claude Sonnet
- **引用验证**：硬门（≥3 验证通过）

## 实际实现

上述路线**未按计划实现**，实际技术栈见：

**[RAG-ARCHITECTURE-v3.md](../RAG-ARCHITECTURE-v3.md)**

| 原计划 | 实际实现 |
|--------|---------|
| Cohere API | Ollama nomic-embed-text（本地）+ ModelScope Qwen3-Embedding-0.6B（云端降级） |
| Qdrant | FAISS 本地索引 |
| Docling | pdfplumber + python-docx + BeautifulSoup |
| 硬门验证 | NLI 软门验证（attribution_score） |
| Claude Sonnet | mimoTalk mimo-v2.5 |

## 归档文件

- `IMPLEMENTATION-PLAN-v3-ARCHIVED.md` — 本文件，指向当前实现文档
- `IMPLEMENTATION-PLAN-v3.md` — 原计划文档，已更新头部注明"未按计划实现"并添加"实际完成情况"对照表
- `RAG-ARCHITECTURE-v3.md` — **当前实现文档（v3.1）**，描述 Ollama/FAISS/pdfplumber 路线的完整架构

## 进一步阅读

- [RAG-ARCHITECTURE-v3.md](../RAG-ARCHITECTURE-v3.md) — 当前系统架构
- [DOCUMENT-PIPELINE.md](../DOCUMENT-PIPELINE.md) — 文档解析管线设计（部分实现）
