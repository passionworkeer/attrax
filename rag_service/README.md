# 火鹰合规 RAG Service

新前端不再需要 Next.js BFF。公开 `/api/v1`、Bearer 轮询流程、错误码和生成类型方式见 [`docs/FRONTEND-BACKEND-INTEGRATION.md`](../docs/FRONTEND-BACKEND-INTEGRATION.md)。旧 `/scan` 与 `/scan-multipart` 仅为迁移兼容接口。

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
                    主模型报告生成
                          │
               NLI 引用验证软门（CitationVerifier）
                          │
              PASS / WARN / REJECTED + 最终报告
```

## 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| HTTP 框架 | FastAPI 0.115.6 | ASGI 服务 |
| LLM | Anthropic 兼容主模型 + DeepSeek 降级 | 报告生成与视觉分析 |
| Embedding | ModelScope API | API-only embedding |
| 向量检索 | FAISS | 本地向量索引 |
| 稀疏检索 | BM25 + jieba | 中文分词 |
| 编排 | LangGraph 1.1 | Agent 状态机 |
| 验证 | CitationVerifier (NLI) | 引用软门（attribution_score 0.9/0.5/0） |

## 快速开始

### 1. 安装依赖

```bash
.venv\Scripts\python.exe -m pip install -r rag_service/requirements-prod.txt
```

### 2. 配置环境变量

```bash
cp rag_service/.env.example rag_service/.env
# 编辑 rag_service/.env，填入必要的 API Key
```

必需配置：
- `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` — 报告生成与视觉分析；默认 MiniMax-M3，也可指向千问等 Anthropic 兼容模型。现有 `MINIMAX_*` 与旧 `MIMOTALK_*` 继续兼容。
- `MODELSCOPE_API_KEY` — ModelScope API embedding

### 3. 准备 FAISS 索引

FAISS 索引默认读取 `data/faiss/legal_chunks.index`（可通过环境变量 `FAISS_INDEX_DIR` 配置）。

如需构建索引：

```bash
.venv\Scripts\python.exe scripts/build_faiss.py
```

### 4. 启动服务

```bash
# 方式 A：批处理脚本
scripts\start_rag.bat

# 方式 B：手动启动
.venv\Scripts\python.exe -m uvicorn rag_service.main:app --reload --port 8001
```

服务地址：`http://localhost:8001`

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

### `POST /profit-report` — 合规成本与利润分析报告

生成含完整成本对比表的利润分析报告，支持充电宝和乒乓球拍（预置数据，无需 LLM）。

**请求：**
```json
{
  "product": "充电宝",
  "category": "",
  "markets": ["EU"]
}
```

**响应：**
```json
{
  "status": "SUCCESS",
  "report": "## [充电宝] 合规成本与利润分析报告\n\n### 一、成本对比表（合规模式 vs 裸奔模式）\n\n| 成本项 | 裸奔模式 | 合规模式 | 差异 |\n|--------|---------|---------|------|\n| 材料成本(BOM) | $9.20 | $13.50 | +$4.30 |\n...",
  "product": "充电宝",
  "market": "EU"
}
```

**产品支持：**

| 产品 | 数据来源 | LLM 调用 |
|------|---------|---------|
| 充电宝 | 预置数据（语料库提取） | 否 |
| 乒乓球拍 | 预置数据（语料库提取） | 否 |
| 其他产品 | 语料库检索 + LLM 填充 | 可选 |

**降级逻辑：** LLM 超时/不可用时返回基于语料库通用估算的 mock 报告，不崩溃。

### `GET /health` — 健康检查

```json
{
  "status": "ok",
  "version": "0.3.0",
  "faiss_index": "loaded",
  "vector_count": 15342
}
```

---

## 状态码

| 状态 | 含义 |
|------|------|
| `PASS` | 归因分数 >= 0.9，报告正常展示 |
| `WARN` | 归因分数 0.5-0.9，报告展示但有不确定性 |
| `REJECTED` | 存在矛盾引用，拒绝展示 |

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
│   ├── fusion.py                 # RRF 融合算法
│   └── modelScope_embedder.py  # ModelScope API embedding（生产路径）
├── verify/              # NLI 引用验证
├── generate/           # 报告生成（可配置主模型）
└── orchestrator/       # LangGraph Agent 编排
    ├── state.py        # GraphState 定义
    ├── graph.py        # StateGraph 组装
    └── nodes/          # 8 个 Graph Node
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

data/corpus/processed/  # 200+ 个已处理 JSON 文件
data/faiss/             # FAISS 索引文件
```

---

**版本**：0.3.0
**最后更新**：2026-05-07
