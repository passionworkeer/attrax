# 火鹰合规 RAG 系统架构文档 v3

> 文档版本：3.0
> 创建时间：2026-05-05
> 状态：当前实现（已验证）
> 替代：RAG-ARCHITECTURE-v2-LEGACY.md（v2.0 旧版，保留参考）

---

## 概述

本系统是一个基于 LangGraph 的多市场合规报告生成 RAG 管道。核心流程：用户上传产品图片 → Vision 分析 → 混合检索（FAISS + BM25）→ LLM 生成 → 引用验证 → 合规报告。

**技术栈要点（与 v2 的关键差异）：**

| 项目 | v2（LEGACY） | v3（当前） |
|------|-------------|-----------|
| 向量存储 | Qdrant / Infinity | FAISS 本地索引（data/faiss/） |
| Embedding | Cohere API | Ollama nomic-embed-text（本地）+ ModelScope Qwen3-Embedding-0.6B（云端） |
| 文档解析 | Docling | pdfplumber（主要） |
| Reranker | Cohere Rerank API | **未接入**（cohere_reranker.py 存在但未在管线中使用） |
| 引用验证 | 硬门（≥3 验证通过） | **软门**（attribution_score 0.9/0.5/0） |
| LLM | Claude Sonnet | mimoTalk mimo-v2.5 |
| 会话持久化 | PostgreSQL | **无**（in-memory only） |

---

## 1. 系统架构

### 1.1 数据流

```
用户上传图片 + 选择市场/分类
         │
         ▼
┌──────────────────────────────────────────────────────┐
│  vision 节点（mimoTalk 多模态）                       │
│  → 提取产品类型、认证标志、铭牌参数                    │
│  → 合并到 query                                       │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│  query_planner 节点                                  │
│  → 分解为多市场子查询（EU/US/UK/CN/JP/AU/BR/SA/AE）  │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│  fan_out 节点（Send() 派发到每个市场）                │
└────────────────────────┬─────────────────────────────┘
       ┌─────────────────┼─────────────────┐
       ▼                 ▼                 ▼
  [EU 检索]        [US 检索]        [CN 检索] ...
       │                 │                 │
       ▼                 ▼                 ▼
┌──────────────────────────────────────────────────────┐
│  synthesis 节点                                      │
│  → 合并多市场检索结果                                │
│  → RRF (k=25) 融合                                  │
│  → must_check 强制注入                               │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│  generate 节点（mimoTalk mimo-v2.5）                 │
│  → 带引用的合规报告生成                              │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│  verify 节点（CitationVerifier NLI）                 │
│  → 软门：attribution_score ≥ 0.9 → PASS              │
│  → attribution_score ≥ 0.5 → WARN                     │
│  → contradiction → REJECTED                          │
└────────────────────────┬─────────────────────────────┘
                         │
               ┌─────────┴──────────┐
               ▼                   ▼
           [PASS]         [WARN / REJECTED]
                               │
                               ▼
                    refine 节点（重新规划查询）
                               │
                               ▼
                      query_planner（循环）
```

### 1.2 文件结构

```
rag_service/
├── main.py                         # FastAPI 入口，/scan + /health
├── config.py                       # settings（从环境变量读取）
├── orchestrator/
│   ├── graph.py                    # LangGraph StateGraph 装配（8 个节点）
│   ├── state.py                    # GraphState 数据结构 + initial_state()
│   └── nodes/
│       ├── vision.py               # VisionAnalyzer（mimoTalk 多模态）
│       ├── query_planner.py        # 查询规划 + 分解
│       ├── retriever.py            # fan_out + retrieve 节点
│       ├── synthesis.py             # RRF 融合 + must_check
│       ├── generator.py             # 报告生成（mimoTalk）
│       ├── verifier.py             # 验证 + should_regenerate 路由
│       └── refiner.py              # 重新规划（HyDE 风格）
├── retrieval/
│   ├── faiss_retriever.py          # FAISS 本地向量检索（IndexFlatIP）
│   ├── bm25_retriever.py           # BM25（jieba 中文分词 + 英文词项保护）
│   ├── hybrid_retriever.py         # FAISS + BM25 混合检索
│   ├── ollama_embedder.py          # Ollama nomic-embed-text 本地嵌入
│   ├── modelScope_embedder.py      # ModelScope Qwen3-Embedding-0.6B 云端嵌入
│   └── cohere_reranker.py          # ⚠️ 存在但未接入管线（未使用）
├── verify/
│   └── citation_verifier.py        # NLI 引用验证（DeBERTa-v3-large-mnli）
├── generate/
│   └── report_generator.py          # mimoTalk 报告生成器
└── chunker/
    └── legal_chunker.py            # 按法律条款边界分块（Parent-Child）

data/
├── faiss/                          # FAISS 索引文件（data/faiss/legal_chunks.index）
├── corpus/                         # 预处理语料（JSON）
│   ├── eu/  us/  cn/  gcc/        # 各市场法规语料
│   └── processed/                  # 已处理文件
├── 全部法规/                        # ⚠️ 冗余副本，待清理
└── 合规/                           # ⚠️ 冗余副本，待清理
```

---

## 2. 检索管线

### 2.1 三层 Embedding 架构

```
文本输入
    │
    ├─→ Ollama nomic-embed-text（本地，768 维）
    │    优点：无需 API Key，CPU 可跑，延迟低
    │    触发：Ollama 服务在 localhost:11434 运行
    │
    ├─→ ModelScope Qwen3-Embedding-0.6B（云端，1024 维）
    │    优点：国产模型，中文语义更优，API 调用
    │    触发：Ollama 不可用时降级至此
    │
    └─→ 降级：纯 BM25（无向量检索）
         触发：上述两者均不可用
```

### 2.2 BM25 检索（必走层）

jieba 分词策略：
- 中文：精确模式（`jieba.lcut(text, cut_all=False)`）
- 英文：按字母数字串提取，保留 Article 编号（Article 22）、CAS 号（CAS 7439-92-1）、法规缩写（REACH、RoHS、GPSR）
- 法律术语已注册到 jieba 词典（防止错误分词）

### 2.3 RRF 融合（k=25）

多路召回结果按 Reciprocal Rank Fusion 融合：

```
score(d) = Σ 1 / (k + rank_i(d))
```

### 2.4 must_check 强制注入

按产品类别强制注入必须检查的法规条款（即使向量召回未命中）。`retrieval/must_check.py`（或集成在 synthesis 节点中）。

### 2.5 Parent-Child 分块

- **Child Chunk**：按法律条款（Article / 第X条 / § Section）边界切分，用于向量检索入口
- **Parent Chunk**：2-4 个相邻 Child 合并，用于 LLM 生成时的完整上下文

---

## 3. 引用验证（软门，非硬门）

### 3.1 验证逻辑（citation_verifier.py）

```python
# 软门判断（非 v2 的 ≥3 硬门）
attribution_score = (entailed / total) * citation_coverage

if contradicted > 0:
    status = "REJECTED"
elif attribution_score >= 0.9:
    status = "PASS"        # 高置信度
elif attribution_score >= 0.5:
    status = "WARN"        # 中等置信度（允许展示）
else:
    status = "WARN"        # 低置信度（仍允许展示）
```

### 3.2 状态语义

| 状态 | attribution_score | 含义 | 报告行为 |
|------|------------------|------|---------|
| PASS | ≥ 0.9 | 高置信度，引用充分验证 | 正常展示 |
| WARN | 0.5 - 0.9 | 中等置信度，部分引用未验证 | 展示 + 警告横幅 |
| REJECTED | 有 contradiction | 有矛盾引用 | 不展示报告 |

### 3.3 验证流程

1. 提取报告中的引用标记（`[法规名 Article X]` / `(source: filename)`）
2. 解析 doc_name + article_no
3. 在 chunks 中做词边界匹配（防止 Article 22 匹配到 Article 999）
4. 有 NLI 模型时做 DeBERTa 蕴含判断；无模型时降级到文本重叠率

---

## 4. LangGraph 8 节点详解

| 节点 | 功能 | 关键文件 |
|------|------|---------|
| `vision` | mimoTalk 多模态图像分析 | `orchestrator/nodes/vision.py` |
| `query_planner` | 查询规划 + 多市场分解 | `orchestrator/nodes/retriever.py` |
| `fan_out` | Send() 派发到每个市场 | `orchestrator/nodes/retriever.py`（`fan_out_markets`） |
| `retrieve` | FAISS + BM25 混合检索（并行） | `orchestrator/nodes/retriever.py`（`retriever_node`） |
| `synthesis` | RRF 融合 + must_check 注入 | `orchestrator/nodes/synthesis.py` |
| `generate` | mimoTalk 报告生成 | `orchestrator/nodes/generator.py` |
| `verify` | NLI 引用验证 + 软门判断 | `orchestrator/nodes/verifier.py`（`verifier_node`） |
| `refine` | 重新规划查询（循环到 query_planner）| `orchestrator/nodes/refiner.py` |

### 4.1 条件路由

```
verify 节点输出 → should_regenerate 条件函数
    ├── "end"             → 结束（报告通过）
    ├── "refine"         → refine 节点（重新规划）
    └── "force_generate" → generate 节点（强制重新生成）
```

---

## 5. 组件细节

### 5.1 FAISS 本地向量存储

- **文件**：`data/faiss/legal_chunks.index` + `legal_chunks_meta.json`
- **索引类型**：`IndexFlatIP`（内积）+ L2 归一化 = 等效 cosine 相似度
- **维度**：运行时自动探测（Ollama 768 / ModelScope 1024）
- **优点**：无需 Docker，轻量，CPU 可跑

### 5.2 mimoTalk（LLM 调用）

所有 LLM 调用（Vision 图像分析、报告生成）统一使用 mimoTalk：
- API Key：`MIMOTALK_API_KEY`
- Base URL：`MIMOTALK_BASE_URL`（`https://token-plan-sgp.xiaomimimo.com/anthropic/v1`）
- Model：`mimo-v2.5`
- 代理已禁用（`NO_PROXY=*`）

### 5.3 Ollama 本地嵌入

- 模型：`nomic-embed-text`（768 维）
- 地址：`http://localhost:11434`
- 用途：primary embedding（轻量，无需 API 费用）
- 降级：Ollama 不可用时 → ModelScope Qwen3-Embedding-0.6B

### 5.4 ModelScope 云端嵌入

- 模型：`Qwen3-Embedding-0.6B`
- API Key：`MODELSCOPE_API_KEY`
- 用途：Ollama 不可用时的降级 embedding
- 向量维度：1024

### 5.5 未接入组件（待集成）

| 组件 | 状态 | 说明 |
|------|------|------|
| Cohere Reranker | ⚠️ 存在，未接入 | `cohere_reranker.py` 已实现，但管线中未调用 |
| Docling | ❌ 未使用 | 文档解析使用 pdfplumber |
| Qdrant | ❌ 未使用 | 向量存储使用 FAISS |
| 会话持久化 | ❌ 无 | 状态 in-memory，无 PostgreSQL 存储 |

---

## 6. API 合约

### 6.1 POST /scan

**主入口**（main.py）

```python
class ScanRequest(BaseModel):
    query: str = ""          # 用户查询
    product: str = ""        # 产品名称
    category: str = ""        # 产品分类（electronics/toy/...）
    markets: list[str] = ["EU"]  # 目标市场
    vision_result: Optional[dict] = None  # 预计算的 Vision 结果

class ScanResponse(BaseModel):
    status: str              # PASS / WARN / REJECTED
    report: str              # Markdown 报告文本
    agent_trace: list[dict]  # 各节点执行轨迹
    loop_count: int          # 循环次数（refine 触发）
    documents: Optional[list[dict]] = None  # 检索到的 chunks
```

### 6.2 GET /health

```json
{
  "status": "ok",
  "version": "0.2.0",
  "faiss_index": "loaded" | "not_found",
  "vector_count": 0
}
```

---

## 7. 环境变量

### .env.local（attrax 根目录）

```env
MIMOTALK_API_KEY=...
MIMOTALK_BASE_URL=https://token-plan-sgp.xiaomimimo.com/anthropic/v1
MIMOTALK_MODEL=mimo-v2.5
MODELSCOPE_API_KEY=...
NO_PROXY=*
DEMO_MODE=false
RAG_SERVICE_URL=http://localhost:8000
```

### rag_service/.env

```env
MIMOTALK_API_KEY=...
MIMOTALK_BASE_URL=...
MIMOTALK_MODEL=mimo-v2.5
MODELSCOPE_API_KEY=...
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
DAILY_FREE_SCAN_LIMIT=3
DEMO_MODE=false
RAG_SERVICE_URL=http://localhost:8000
```

---

## 8. 版本历史

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| 1.0 - 2.1 | 2026-04 | 初版至 v2 LEGACY（Cohere API / Qdrant / Docling 路线） |
| **3.0** | **2026-05-05** | **当前实现**：Ollama 本地嵌入 + ModelScope 降级 + FAISS 本地索引 + pdfplumber + mimoTalk + 软门引用验证 |

---

*文档终*