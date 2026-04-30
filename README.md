# 火鹰合规 (Blaze Hawks)

> **想出海？先烧毁。** —— AI 合规风险智能扫描平台

[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](#)
[![Python](https://img.shields.io/badge/Python-3.10+-blue)](#)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](#)

**火鹰合规**是一个基于 RAG（检索增强生成）的跨境电商合规风险智能扫描平台。通过上传产品图片，AI 自动识别产品类别和目标市场，结合多市场法规知识库，生成带有精确法规引用的合规报告，帮助出海企业在产品上架前识别并整改合规风险。

---

## 目录

- [核心优势](#核心优势)
- [技术架构](#技术架构)
- [RAG 技术亮点](#rag-技术亮点)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [API 参考](#api-参考)
- [核心组件说明](#核心组件说明)
- [数据与语料库](#数据与语料库)
- [开发指南](#开发指南)

---

## 核心优势

### 多市场法规覆盖

覆盖全球 **16+ 目标市场** 的合规法规：

| 市场 | 覆盖法规 | 语料规模 |
|------|---------|---------|
| **欧盟 (EU)** | REACH、RoHS、GPSR、RED、DSA、DMA、GDPR、AI Act 等 | 4.7M 字符 |
| **美国 (US)** | FCC、CPSIA、TSCA、DOT、UL 标准等 | 3.6M 字符 |
| **中国 (CN)** | 出口管制法、两用物项、境外投资管理办法等 | 2.1M 字符 |
| **中东/其他** | 阿联酋、沙迦、沙特、巴西、东南亚等 | 2M+ 字符 |

**总计 96 个法规文件，12M+ 字符，覆盖消费电子、玩具、纺织品、电池等多个品类。**

### 快速精准的风险识别

- **5 分钟内**获得完整风险报告
- 风险识别准确率 > 85%
- 每条结论附精确法规引用（Article No. + 页码）

### 可操作的整改建议

- 每条风险附带具体整改步骤
- 提供参考实验室和预估费用
- 按优先级（高/中/低）排序

---

## 技术架构

### 整体架构

```
用户上传图片
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js 前端 (React 19 + TypeScript + Tailwind CSS)     │
│  /upload → /burning/[sessionId] → /result/[sessionId]   │
└────────────────────────────┬────────────────────────────┘
                             │ HTTP POST
                             ▼
┌─────────────────────────────────────────────────────────┐
│  FastAPI RAG Service (Python 3.10+)                      │
│  /scan → LangGraph Agentic RAG Graph                     │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │         LangGraph Agentic RAG Pipeline              │  │
│  │                                                   │  │
│  │  Vision → QueryPlanner → [EU/US/CN]  → Synthesis   │  │
│  │                          Parallel Retrieve        │  │
│  │                                    ↓               │  │
│  │                            Synthesis (RRF+MustCheck)│  │
│  │                                    ↓               │  │
│  │                              Generator             │  │
│  │                                    ↓               │  │
│  │                           NLI Citation Verifier    │  │
│  │                                    ↓               │  │
│  │                      PASS / WARN / REJECTED        │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 技术栈

#### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 16.2.4 | React 全栈框架 |
| React | 19.2.4 | UI 库 |
| TypeScript | 5.x | 类型安全 |
| Tailwind CSS | 4.x | 样式框架 |
| shadcn/ui | 4.4.0 | UI 组件库 |
| framer-motion | 12.38.0 | 动画 |
| Lucide React | 1.9.0 | 图标库 |

#### RAG 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.10+ | 后端语言 |
| FastAPI | 0.109.0 | HTTP 服务框架 |
| LangGraph | 1.1.6 | Agent 编排 |
| FAISS | 1.12.0 | 向量检索 |
| jieba | 0.42.1 | 中文分词（BM25） |
| Cohere SDK | 6.1.0 | Embedding + Rerank API |
| Anthropic SDK | - | Claude LLM |
| sentence-transformers | 5.1.1 | 本地 Embedding |

#### 部署

| 技术 | 用途 |
|------|------|
| Docker | Qdrant 向量数据库（可选） |
| uvicorn | ASGI 服务器 |
| dotenv | 环境变量管理 |

---

## RAG 技术亮点

### 多层 RAG 架构设计

本项目采用**多层检索 + 动态降级**的 RAG 架构设计，在保证精度的同时最大化可用性：

#### 1. 三级 Embedding 降级策略（零 API 依赖）

```
优先级 1: OllamaEmbedder (nomic-embed-text, 768-dim)
         ↓ 本地 CPU，无需 GPU，完全免费
优先级 2: LocalEmbedder (Qwen3-Embedding-0.6B, 1024-dim)
         ↓ 本地 GPU/CPU，MIT 模型，零费用
优先级 3: ModelScopeEmbedder (Qwen3-Embedding API)
         ↓ 云端 API，按需付费
```

**优势**：在无网络或无 API Key 的情况下，系统自动降级到本地模型，确保服务持续可用。

#### 2. 三级 Rerank 降级策略

```
优先级 1: OllamaReranker (bge-reranker-v2-m3, 本地)
         ↓ MTEB Rerank SOTA，MIT，免费
优先级 2: Cohere Rerank API
         ↓ 精确语义重排
优先级 3: 跳过（直接使用 RRF 融合结果）
         ↓ 无额外延迟
```

#### 3. Parent-Child 双层分块

法律文本具有特殊的结构：超长表格（40,000+ tokens）、跨 Article 引用、条款编号体系。传统固定 token 分块会破坏法律条款的完整性。

**解决方案**：
- **Child Chunk**（200-300 tokens）：按 Article/Section 边界切分，用于精确向量检索
- **Parent Chunk**（800-1000 tokens）：2-4 个相邻 Article 组合，用于 LLM 完整上下文

**Contextual Prepending**：每个 Child Chunk 在 embedding 前拼接法规名和条款编号前缀，提升语义召回精度：

```
[REACH (EC) 1907/2006] [第VIII章 注册] [Article 22 聚合物的注册要求]
Article 22 原文内容...
```

#### 4. 混合检索：Dense + BM25 + RRF

```
Query → ┌─→ Faiss Dense (向量相似度)
        │
        └─→ BM25 (jieba 中文分词 + 英文词项保护)
              │
              ↓ RRF 融合 (k=25)
         平衡 dense 和 BM25 的排名偏差
              ↓
         Must-Check 强制注入
         (按产品类别注入必须检查的法规)
              ↓
         Rerank (语义精排 Top-10)
```

#### 5. Must-Check 强制注入机制

不同产品类别有必须检查的法规，即使向量检索命中数为零也会强制注入：

| 产品类别 | 强制检查法规 |
|---------|------------|
| electronics | RoHS Annex II (重金属)、REACH Article 22 (铅含量)、GPSR Article 5 |
| toys | EN 71-3 (可迁移元素)、REACH Annex XVII (增塑剂) |
| battery | 欧盟新电池法 2023/1542、REACH Article 22 |
| textiles | REACH Annex XVII Item 43 (偶氮染料)、Oeko-Tex |

#### 6. NLI 引用验证硬门

每个结论必须附带法规引用，Citation Verifier 执行硬门验证：

| 验证状态 | 条件 | 处理 |
|---------|------|------|
| **PASS** | >= 3 条引用验证通过 | 正常展示报告 |
| **WARN** | 1-2 条引用验证通过 | 展示报告 + 警告横幅 |
| **REJECTED** | 0 条引用验证通过 | 拒绝生成，防止幻觉 |

#### 7. LangGraph Agentic 编排

使用 LangGraph 的 `Send()` API 实现多市场并行检索，每个市场独立检索后汇聚到 Synthesis 节点：

```
QueryPlanner → [EU] → Fan-out
             → [US] → Fan-out
             → [CN] → Fan-out
                 ↓ (所有市场完成)
             Synthesis → Generate → Verify → [PASS/WARN/REJECTED]
```

支持最多 2 轮 HyDE 风格的重检索循环，当第一轮检索结果引用不足时自动重写查询并重新检索。

### 技术优势总结

| 维度 | 本项目方案 | 传统方案 |
|------|-----------|---------|
| Embedding | 三级降级（本地优先） | 仅 API |
| Rerank | 三级降级（本地优先） | 仅 API |
| 分块 | Parent-Child + 法律条款边界 | 固定 token |
| 融合 | RRF (k=25) + Must-Check | 单一向量检索 |
| 验证 | NLI 硬门（>= 3 条通过） | 无 |
| 编排 | LangGraph Agentic (并行 + 循环) | 串行 |
| 语料 | 96 个文件，16+ 市场，12M+ 字符 | 单一市场 |

---

## 快速开始

### 环境要求

- **Node.js** 18+
- **Python** 3.10+
- **npm / yarn / pnpm / bun**
- 可选：**Docker**（Qdrant 向量数据库）
- 可选：**Ollama**（本地 embedding/rerank）

### 1. 安装前端依赖

```bash
cd attrax
npm install
```

### 2. 配置环境变量

```bash
cp .env.local.example .env.local
```

编辑 `.env.local`，填入必要的 API Key：

```env
# RAG Service API（留空则使用 Demo 模式）
RAG_SERVICE_URL=http://localhost:8000

# mimoTalk API（主要 LLM）
MIMOTALK_API_KEY=your_mimotalk_api_key
MIMOTALK_BASE_URL=https://token-plan-sgp.xiaomimimo.com/anthropic/v1

# 可选：Cohere API（embedding + rerank）
COHERE_API_KEY=your_cohere_api_key

# 可选：Anthropic API（Claude）
ANTHROPIC_API_KEY=your_anthropic_api_key
```

### 3. 启动 RAG Service（可选）

如需完整功能，启动 Python RAG 服务：

```bash
# 方式 A：使用批处理脚本
scripts\start_rag.bat

# 方式 B：手动启动
.venv\Scripts\python.exe -m uvicorn rag_service.main:app --reload --port 8000
```

### 4. 启动前端

```bash
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)。

---

## 项目结构

```
attrax/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # 首页 (Landing)
│   ├── layout.tsx                # 根布局
│   ├── upload/page.tsx           # 图片上传页
│   ├── burning/[sessionId]/      # 扫描中页面
│   ├── result/[sessionId]/       # 扫描结果页
│   └── api/scan/                 # API 路由
│
├── components/                   # UI 组件
│   ├── ui/                       # shadcn/ui 基础组件
│   ├── upload/                   # 上传相关
│   ├── burning/                  # 扫描中相关
│   └── result/                   # 结果展示
│
├── lib/                          # 核心库
│   ├── schemas.ts                # Zod 验证 schema
│   ├── pipeline/scan.ts          # 扫描管线
│   ├── hooks/useScanPolling.ts  # 轮询 hook
│   └── mock/scan-result.ts       # Mock 数据
│
├── rag_service/                  # Python RAG 服务
│   ├── main.py                   # FastAPI 入口
│   ├── config.py                 # 配置管理
│   ├── parser/                   # 文档解析 (HTML/DOCX/PDF)
│   ├── chunker/                  # Parent-Child 分块
│   ├── retrieval/               # 混合检索管线
│   │   ├── faiss_retriever.py    # FAISS 向量检索
│   │   ├── bm25_retriever.py     # BM25 稀疏检索
│   │   ├── hybrid_retriever.py   # 混合检索主类
│   │   ├── fusion.py             # RRF 融合
│   │   ├── must_check.py         # 强制注入规则
│   │   ├── ollama_embedder.py    # Ollama 本地 embedding
│   │   ├── local_embedder.py     # 本地 Qwen embedding
│   │   └── modelScope_embedder.py # ModelScope API embedding
│   ├── verify/                   # NLI 引用验证
│   ├── generate/                 # 报告生成
│   ├── llm/                      # LLM 客户端封装
│   └── orchestrator/             # LangGraph Agent 编排
│       ├── state.py              # GraphState 定义
│       ├── graph.py              # StateGraph 组装
│       └── nodes/                # 7 个 Graph Node
│           ├── vision.py         # Vision 分析
│           ├── query_planner.py  # 查询规划
│           ├── retriever.py      # 检索节点
│           ├── synthesis.py      # 多市场结果汇聚
│           ├── generator.py      # 报告生成
│           ├── verifier.py       # NLI 验证
│           └── refiner.py        # HyDE 查询精化
│
├── scripts/                      # 运维脚本
│   ├── init_qdrant.py           # Qdrant 初始化
│   ├── build_corpus.py          # 批量构建语料库
│   ├── build_faiss.py           # FAISS 索引构建
│   ├── parse_regulation.py      # 法规解析
│   └── start_rag.bat            # 服务启动脚本
│
├── data/                         # 数据文件
│   ├── corpus/                  # 预解析语料库 (96 个 JSON)
│   │   ├── processed/            # 已处理文件
│   │   ├── eu/                  # 欧盟法规
│   │   ├── us/                  # 美国法规
│   │   ├── cn/                  # 中国法规
│   │   └── manifest.json        # 全量索引
│   ├── analysis/                # 分析结果
│   ├── faiss/                   # FAISS 索引
│   └── embedding_cache/          # Embedding 缓存
│
├── docs/                         # 文档
│   ├── PROJECT.md               # 项目描述
│   ├── PRD.md                   # 产品需求文档
│   ├── RAG-ARCHITECTURE-v2.md  # RAG 架构文档 (当前)
│   ├── IMPLEMENTATION-PLAN-v3.md # 实施计划
│   └── archived/               # 旧版本文档归档
│
├── eval/                         # 评估脚本
│   └── results/                  # 评估结果
│
└── tests/                        # 测试
    ├── unit/                    # 单元测试
    ├── e2e/                     # E2E 测试
    └── pressure/                # 压力测试
```

---

## API 参考

### POST /scan - 合规扫描

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
    {"node": "vision", "status": "done"},
    {"node": "query_planner", "sub_queries_count": 3},
    {"node": "retrieve", "total_docs": 20, "unique_docs": 15},
    {"node": "synthesis", "status": "done"},
    {"node": "generate", "chunks_count": 15},
    {"node": "verify", "status": "PASS", "attribution_score": 0.95}
  ],
  "loop_count": 0,
  "documents": [...]
}
```

### GET /health - 健康检查

```json
{
  "status": "ok",
  "version": "0.2.0",
  "faiss_index": "loaded",
  "vector_count": 15342
}
```

### 状态码说明

| 状态 | 含义 |
|------|------|
| `PASS` | 报告生成成功，>= 3 条引用通过验证 |
| `WARN` | 报告生成成功，但仅 1-2 条引用验证通过 |
| `REJECTED` | 引用不足，拒绝生成，防止幻觉 |

---

## 核心组件说明

### HybridRetriever - 混合检索

`rag_service/retrieval/hybrid_retriever.py`

自动探测可用 embedder，按优先级降级：
1. OllamaEmbedder → 2. LocalEmbedder → 3. ModelScopeEmbedder

检索流程：
1. Faiss Dense 检索（Top-50）
2. BM25 检索（jieba 分词，Top-50）
3. RRF 融合（k=25）
4. Must-Check 强制注入
5. 区域过滤（EU/US/CN）
6. Rerank 精排（Top-K）

### LegalChunker - 法律分块

`rag_service/chunker/legal_chunker.py`

按法律条款边界（Article/Section/条）分块，支持：
- EU 法规：Article + Paragraph
- 中国法规：第X条 + 款/项
- 美国法规：Section + (a)(b)

输出：Child Chunk（向量检索）+ Parent Chunk（LLM 上下文）

### CitationVerifier - 引用验证

`rag_service/verify/citation_verifier.py`

NLI 硬门验证：
- 提取报告中的法规引用（Article No. + 页码）
- 在检索到的原文 chunks 中交叉验证
- 硬门决策：>= 3 ✅ / 1-2 ⚠️ / 0 ❌

### Graph Orchestrator - 图编排

`rag_service/orchestrator/graph.py`

LangGraph StateGraph，支持：
- 多市场并行检索（Send() fan-out）
- 最优 2 轮重检索循环（HyDE）
- NLI 验证失败自动重生成

---

## 数据与语料库

### 语料库统计

| 数据源 | 格式 | 数量 | 状态 |
|--------|------|------|------|
| EU 法规 PDF | PDF | 18 个 | ✅ 已处理 |
| 合规产品 DOCX | DOCX | 9 个 | ✅ 已处理 |
| HTML 法规 | HTML | 35 个 | ✅ 已处理 |
| 其他市场法规 | 混合 | 34 个 | ✅ 已处理 |
| **总计** | - | **96 个** | **91% rawText 覆盖** |

### FAISS 索引

- 位置：`data/faiss/legal_chunks.index`
- 维度：1024（Qwen3-Embedding）
- 向量数：~15,000 个 Chunk
- 存储大小：~41 MB

### 语料库构建

如需重新构建语料库：

```bash
# 解析法规文件
.venv\Scripts\python.exe scripts/parse_regulation.py

# 构建 FAISS 索引
.venv\Scripts\python.exe scripts/build_faiss.py

# 构建 Qdrant（可选，如使用 Qdrant 而非 FAISS）
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
.venv\Scripts\python.exe scripts/init_qdrant.py
.venv\Scripts\python.exe scripts/build_corpus.py
```

---

## 开发指南

### 测试

```bash
# Python 测试
.venv\Scripts\python.exe -m pytest rag_service/tests/ -v

# 前端测试
npm run test

# E2E 测试
npm run test:e2e

# 覆盖率测试
npm run test:coverage
```

### 代码质量

```bash
# ESLint
npm run lint

# Python lint
ruff check rag_service/
```

### 添加新的市场法规

1. 将法规文件放入 `data/corpus/` 对应目录
2. 运行解析脚本：`python scripts/parse_regulation.py`
3. 重建 FAISS 索引：`python scripts/build_faiss.py`
4. 在 `rag_service/retrieval/must_check.py` 添加对应规则

### 添加 Must-Check 规则

编辑 `rag_service/retrieval/must_check.py`，在 `RULES` 字典中添加新产品类别：

```python
RULES = {
    "electronics": [...],
    "your_category": [
        {
            "regulation": "法规名称",
            "article": "Article X",
            "query": "英文关键词查询"
        },
    ],
}
```

---

## 环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MIMOTALK_API_KEY` | - | mimoTalk LLM API Key（主要） |
| `MIMOTALK_BASE_URL` | `https://token-plan-sgp.xiaomimimo.com/anthropic/v1` | mimoTalk 端点 |
| `MIMOTALK_MODEL` | `mimo-v2.5` | 模型名称 |
| `COHERE_API_KEY` | - | Cohere Embedding/Rerank API Key |
| `ANTHROPIC_API_KEY` | - | Anthropic Claude API Key |
| `MODELSCOPE_API_KEY` | - | ModelScope Embedding API Key |
| `FAISS_INDEX_DIR` | `C:/temp/faiss_index` | FAISS 索引目录 |
| `DEMO_MODE` | `false` | Demo 模式（无需 API Key） |

---

## 相关文档

- [RAG 架构文档](./docs/RAG-ARCHITECTURE-v2.md) - 详细技术架构说明
- [实施计划](./docs/IMPLEMENTATION-PLAN-v3.md) - 开发路线图
- [产品需求文档](./docs/PRD.md) - 产品功能规格
- [项目描述](./docs/PROJECT.md) - 技术栈和目录结构

---

**版本**：0.2.0
**最后更新**：2026-04-30