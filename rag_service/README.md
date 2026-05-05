# 火鹰合规 RAG Service

Agentic RAG 合规扫描后端服务，基于 FastAPI + LangGraph。

## 架构

```
用户上传 → Vision AI → Query Planner
                          │
               多市场并行检索（LangGraph Send fan-out）
               EU / US / CN
                          │
                    Synthesis + Must-Check
                          │
                    mimoTalk 报告生成
                          │
               NLI 引用验证硬门（CitationVerifier）
                          │
              PASS / WARN / REJECTED + 最终报告
```

## 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| HTTP 框架 | FastAPI 0.109 | ASGI 服务 |
| LLM | mimoTalk (mimo-v2.5) | 报告生成 |
| Embedding | Ollama → Local Qwen → ModelScope API | 三级降级 |
| 向量检索 | FAISS | 本地向量索引 |
| 稀疏检索 | BM25 + jieba | 中文分词 |
| 编排 | LangGraph 1.1 | Agent 状态机 |
| 验证 | CitationVerifier (NLI) | 引用硬门 |

## 快速开始

### 1. 安装依赖

```bash
.venv\Scripts\python.exe -m pip install -r rag_service/requirements.txt
```

### 2. 配置环境变量

```bash
cp rag_service/.env.example rag_service/.env
# 编辑 rag_service/.env，填入必要的 API Key
```

必需配置：
- `MIMOTALK_API_KEY` — mimoTalk LLM（报告生成）

可选配置（按降级顺序自动探测）：
- `OLLAMA_BASE_URL` — Ollama 本地 embedding（需 `ollama pull nomic-embed-text`）
- `MODELSCOPE_API_KEY` — ModelScope API embedding 降级

### 3. 准备 FAISS 索引

FAISS 索引默认读取 `C:/temp/faiss_index/legal_chunks.index`。

如需构建索引：

```bash
.venv\Scripts\python.exe scripts/build_faiss.py
```

### 4. 启动服务

```bash
# 方式 A：批处理脚本
scripts\start_rag.bat

# 方式 B：手动启动
.venv\Scripts\python.exe -m uvicorn rag_service.main:app --reload --port 8000
```

服务地址：`http://localhost:8000`

---

## API

### `POST /scan` — 合规扫描

**请求：**
```json
{
  "query": "充电宝出口欧盟需要哪些认证？",
  "product": "USB 充电宝",
  "category": "electronics",
  "markets": ["EU", "US"],
  "vision_result": {}
}
```

**响应：**
```json
{
  "status": "PASS",
  "report": "## 合规要求\n\n根据 [REACH Article 22]...",
  "agent_trace": [
    {"node": "query_planner", "sub_queries_count": 3},
    {"node": "synthesis", "total_docs": 20, "unique_docs": 15},
    {"node": "generate", "chunks_count": 15},
    {"node": "verify", "status": "PASS", "attribution_score": 0.95}
  ],
  "loop_count": 0
}
```

### `GET /health` — 健康检查

```json
{
  "status": "ok",
  "version": "0.2.0",
  "faiss_index": "loaded",
  "vector_count": 15342
}
```

---

## 状态码

| 状态 | 含义 |
|------|------|
| `PASS` | >= 3 条引用通过 NLI 验证 |
| `WARN` | 1-2 条引用通过 |
| `REJECTED` | 引用不足，拒绝生成，防止幻觉 |

---

## 测试

```bash
.venv\Scripts\python.exe -m pytest rag_service/tests/ -v
```

---

## 项目结构

```
rag_service/
├── main.py              # FastAPI 入口，/scan + /health
├── config.py            # Settings（从 .env 加载）
├── parser/              # HTML/DOCX/PDF 解析器
├── chunker/             # LegalChunker（Parent-Child 分块）
├── retrieval/          # 检索管线
│   ├── faiss_retriever.py      # FAISS 向量检索
│   ├── bm25_retriever.py       # BM25 稀疏检索
│   ├── hybrid_retriever.py      # 混合检索（RRF 融合）
│   ├── ollama_embedder.py      # Ollama 本地 embedding
│   ├── local_embedder.py       # 本地 Qwen3 embedding
│   └── modelScope_embedder.py  # ModelScope API embedding
├── verify/              # NLI 引用验证
├── generate/           # 报告生成（mimoTalk）
└── orchestrator/       # LangGraph Agent 编排
    ├── state.py        # GraphState 定义
    ├── graph.py        # StateGraph 组装
    └── nodes/          # 7 个 Graph Node
        ├── vision.py         # Vision 分析
        ├── query_planner.py  # 查询规划
        ├── retriever.py      # 检索节点
        ├── synthesis.py      # 多市场结果汇聚
        ├── generator.py      # 报告生成
        ├── verifier.py       # NLI 验证
        └── refiner.py       # HyDE 查询精化

scripts/
├── build_faiss.py     # 构建 FAISS 索引
├── build_corpus.py    # 批量构建语料库
└── start_rag.bat      # 服务启动脚本

data/corpus/processed/  # 96 个已处理 JSON 文件
data/faiss/             # FAISS 索引文件
```

---

**版本**：0.2.0
**最后更新**：2026-05-05
