# 火鹰合规 (Blaze Hawks)

> **想出海？先烧毁。** —— AI 合规风险智能扫描平台

[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](#)
[![Python](https://img.shields.io/badge/Python-3.10+-blue)](#)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](#)

**火鹰合规**是一个基于 LangGraph Agentic RAG 的跨境电商合规风险智能扫描平台。通过上传产品图片，AI 自动识别产品类别和目标市场，结合多市场法规知识库，生成带有精确法规引用的合规报告。

---

## 目录

- [核心优势](#核心优势)
- [技术架构](#技术架构)
- [RAG 技术亮点](#rag-技术亮点)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [API 参考](#api-参考)
- [前端扫描流程](#前端扫描流程)
- [环境变量](#环境变量)
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
                             │ HTTP POST http://localhost:8001/scan
                             ▼
┌─────────────────────────────────────────────────────────┐
│  FastAPI RAG Service (Python 3.10+, port 8001)          │
│  /scan → LangGraph Agentic RAG Graph                    │
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
│  │                           NLI Citation Verifier   │  │
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
| react-markdown | 10.1.0 | Markdown 渲染 |
| jspdf | 4.2.1 | PDF 导出 |
| docx | 9.6.1 | DOCX 导出 |
| zod | 4.3.6 | Schema 验证 |
| Vitest / Playwright | - | 单元测试 / E2E |
| Lucide React | 1.9.0 | 图标库 |

#### RAG 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.10+ | 后端语言 |
| FastAPI | 0.109.0 | HTTP 服务框架 |
| LangGraph | 1.1.6 | Agent 编排（Send fan-out 多市场并行） |
| FAISS | 1.12.0 | 本地向量检索（IndexFlatIP） |
| ModelScope Qwen3-Embedding | 0.6B | API Embedding（1024 维） |
| jieba | 0.42.1 | 中文分词（BM25） |
| Anthropic SDK | 0.91.0 | mimoTalk LLM（Vision + 生成） |
| pdfplumber | 0.11.8 | PDF 解析 |
| Docker + Docker Compose | - | 容器化部署 |

---

## RAG 技术亮点

### 多层 RAG 架构设计

本项目采用**多层检索 + 动态降级**的 RAG 架构设计，在保证精度的同时最大化可用性：

#### 1. API-only Embedding 策略

```
ModelScopeEmbedder (Qwen3-Embedding API)
         ↓ 云端 API，1024 维
BM25 fallback
         ↓ API 不可用时保持基础召回
```

**优势**：生产环境无需宿主机模型服务，部署路径统一，问题定位更直接。

#### 2. Parent-Child 双层分块

法律文本具有特殊的结构：超长表格（40,000+ tokens）、跨 Article 引用、条款编号体系。传统固定 token 分块会破坏法律条款的完整性。

**解决方案**：
- **Child Chunk**（200-300 tokens）：按 Article/Section 边界切分，用于精确向量检索
- **Parent Chunk**（800-1000 tokens）：2-4 个相邻 Article 组合，用于 LLM 完整上下文

**Contextual Prepending**：每个 Child Chunk 在 embedding 前拼接法规名和条款编号前缀，提升语义召回精度：

```
[REACH (EC) 1907/2006] [第VIII章 注册] [Article 22 聚合物的注册要求]
Article 22 原文内容...
```

#### 3. 混合检索：Dense + BM25 + RRF

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
         RRF 结果直接返回（cohere_reranker 已实现但未接入管线）
```

#### 4. Must-Check 强制注入机制

不同产品类别有必须检查的法规，即使向量检索命中数为零也会强制注入：

| 产品类别 | 强制检查法规 |
|---------|------------|
| electronics | RoHS Annex II (重金属)、REACH Article 22 (铅含量)、GPSR Article 5 |
| toys | EN 71-3 (可迁移元素)、REACH Annex XVII (增塑剂) |
| battery | 欧盟新电池法 2023/1542、REACH Article 22 |
| textiles | REACH Annex XVII Item 43 (偶氮染料)、Oeko-Tex |

#### 5. NLI 引用验证软门

每个结论必须附带法规引用，Citation Verifier 执行软门验证：

| 验证状态 | 条件 | 处理 |
|---------|------|------|
| **PASS** | 归因分数 >= 0.9 | 正常展示报告 |
| **WARN** | 归因分数 0.5-0.9 | 展示报告 + 警告横幅 |
| **REJECTED** | 存在矛盾内容 | 拒绝展示（触发重生成） |

> 注：归因分数 = (验证通过数 / 总引用数) × 引用覆盖率。当 NLI 模型不可用时，降级为文本重叠法。

#### 6. LangGraph Agentic 编排

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
| Embedding | ModelScope API-only + BM25 fallback | 仅 API |
| Rerank | 已实现但未接入管线（cohere_reranker.py 存在，未调用） | 单一向量检索 |
| 分块 | Parent-Child + 法律条款边界 | 固定 token |
| 融合 | RRF (k=25) + Must-Check | 单一向量检索 |
| 验证 | NLI 软门（归因分数 0.9/0.5/0） | 无 |
| 编排 | LangGraph Agentic (并行 + 循环) | 串行 |
| 语料 | 200+ 已处理文件，16+ 市场 | 单一市场 |

---

## 快速开始

### 环境要求

- **Node.js** 18+
- **Python** 3.10+
- **npm / yarn / pnpm / bun**
- 可选：**Docker + Docker Compose**（RAG Service 容器化）
- 必需：mimoTalk API Key + ModelScope API Key（非 Demo 模式）

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
# mimoTalk API（主要 LLM，用于 Vision 分析 + 报告生成）
MIMOTALK_API_KEY=your_mimotalk_api_key
MIMOTALK_BASE_URL=https://token-plan-sgp.xiaomimimo.com/anthropic/v1

# ModelScope API（API embedding）
MODELSCOPE_API_KEY=your_modelscope_api_key

# RAG Service（默认端口 8001）
RAG_SERVICE_URL=http://localhost:8001

# Demo 模式（无需 API Key，使用模拟数据）
DEMO_MODE=false

DAILY_FREE_SCAN_LIMIT=3
```

### 3. 启动 RAG Service（可选）

如需完整功能，启动 Python RAG 服务：

```bash
# 方式 A：使用批处理脚本
scripts\start_rag.bat

# 方式 B：手动启动
D:\python\python.exe -m uvicorn rag_service.main:app --reload --port 8001

# 方式 C：一键启动前端 + RAG
start-all.bat
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
│       ├── route.ts              # POST /api/scan — 创建扫描会话
│       └── [sessionId]/route.ts  # GET /api/scan/[sessionId] — 轮询状态
│
├── components/                   # UI 组件
│   ├── ui/                       # shadcn/ui 基础组件
│   ├── upload/                   # 上传相关
│   ├── burning/                  # 扫描中相关
│   └── result/                   # 结果展示
│
├── lib/                          # 核心库
│   ├── schemas.ts                # Zod 验证 schema（StartScanRequestSchema 等）
│   ├── types.ts                  # TypeScript 类型定义（Market, ProductCategory, ScanStatus）
│   ├── pipeline/
│   │   ├── scan.ts               # 扫描管线（调用 RAG 服务，端口 8001）
│   │   └── session-store.ts      # 会话存储（globalThis.__scanStore + 文件持久化，TTL 1小时）
│   ├── mock/
│   │   └── scan-result.ts        # Demo 模式模拟数据
│   └── hooks/
│       └── useScanPolling.ts     # 轮询 hook
│
├── rag_service/                  # Python RAG 服务（FastAPI，端口 8001）
│   ├── main.py                   # FastAPI 入口，/scan + /health
│   ├── config.py                 # 配置管理（settings）
│   ├── parser/                   # 文档解析
│   │   ├── docx_parser.py        # DOCX 解析
│   │   └── html_parser.py        # HTML 解析
│   ├── chunker/                  # Parent-Child 分块
│   │   └── legal_chunker.py      # 法律条款分块
│   ├── retrieval/                 # 混合检索管线
│   │   ├── faiss_retriever.py    # FAISS 向量检索
│   │   ├── bm25_retriever.py     # BM25 稀疏检索
│   │   ├── hybrid_retriever.py   # 混合检索主类（ModelScope API + BM25）
│   │   ├── fusion.py             # RRF 融合
│   │   ├── must_check.py        # 强制注入规则
│   │   ├── modelScope_embedder.py # ModelScope API embedding（生产路径）
│   │   └── cohere_reranker.py   # ⚠️ 已实现但未接入管线
│   ├── verify/                   # NLI 引用验证
│   │   └── citation_verifier.py  # 归因分数软门
│   ├── generate/                 # 报告生成
│   │   └── report_generator.py   # mimoTalk 报告生成器
│   ├── orchestrator/             # LangGraph Agent 编排
│   │   ├── state.py             # GraphState 定义
│   │   ├── graph.py             # StateGraph 组装
│   │   └── nodes/               # 8 个 Graph Node
│   │       ├── vision.py        # Vision 分析（mimoTalk 多模态）
│   │       ├── query_planner.py # 查询规划
│   │       ├── retriever.py     # fan_out + retrieve 节点
│   │       ├── synthesis.py     # RRF 融合 + must_check
│   │       ├── generator.py     # 报告生成
│   │       ├── verifier.py      # NLI 验证
│   │       ├── refiner.py       # HyDE 查询精化
│   │       └── __init__.py
│   └── tests/                    # Python 单元测试（pytest）
│
├── scripts/                      # 运维脚本
│   ├── build_corpus.py          # 批量构建语料库
│   ├── build_faiss.py           # FAISS 索引构建
│   ├── parse_regulation.py      # 法规解析
│   └── start_rag.bat            # RAG 服务启动脚本
│
├── data/                         # 数据文件
│   ├── faiss/                   # FAISS 索引
│   │   ├── legal_chunks.index   # 26MB 向量索引
│   │   └── legal_chunks_meta.json # 15MB 元数据
│   └── corpus/                  # 预解析语料库
│       ├── processed/           # 已处理文件（200+ JSON）
│       └── screenshot_pending/  # ⚠️ 待 OCR 处理（截屏 PDF）
│
├── docs/                         # 文档
│   ├── RAG-ARCHITECTURE-v3.md   # RAG 架构文档（当前）
│   ├── RAG-ARCHITECTURE-v2-LEGACY.md  # v2 旧版（已归档）
│   ├── IMPLEMENTATION-PLAN-v3.md # 实施计划
│   ├── PRD.md                   # 产品需求文档
│   ├── PROJECT.md               # 项目描述
│   └── PROJECT-STATUS.md        # 上线评估报告
│
├── tests/                        # 测试
│   ├── unit/                    # Vitest 单元测试
│   ├── e2e/                     # Playwright E2E 测试
│   └── smoke-tests.mjs         # Smoke 测试脚本
│
└── docker-compose.yml            # 容器化部署（8001:8000 端口映射）
```

---

## API 参考

### POST /scan - 合规扫描

**端点**：前端 `POST http://localhost:8001/scan`

**请求（ScanRequest）**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 用户查询文本 |
| `product` | string | 是 | 产品名称 |
| `category` | string | 是 | 产品分类（electronics / toys / battery / textiles 等） |
| `markets` | string[] | 是 | 目标市场列表（EU / US / UK / CN / AU / SA / AE 等） |
| `vision_result` | object | 否 | 预计算的 Vision 分析结果 |
| `images` | array | 否 | 图片数组（buffer: base64, mime_type, name） |
| `documents` | array | 否 | 文本文档数组（name, mime_type, text） |
| `pdfs` | array | 否 | PDF 文件数组（buffer: base64, name）—— 后端 pdfplumber 提取 |

```json
{
  "query": "充电宝出口欧盟需要哪些认证？",
  "product": "USB 充电宝 10000mAh",
  "category": "electronics",
  "markets": ["EU", "US"],
  "vision_result": {}
}
```

**响应（ScanResponse）**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | PASS / WARN / REJECTED（见状态码说明） |
| `report` | string | Markdown 格式合规报告 |
| `agent_trace` | array | 各节点执行轨迹（调试用） |
| `loop_count` | int | 重生成循环次数 |
| `documents` | array | 检索到的相关法规片段（最多 15 条） |

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
  "documents": [
    {
      "doc_name": "reach_regulation.json",
      "article_no": "Article 22",
      "chunk_id": "eu_reach_001",
      "text": "Article 22 聚合物的注册要求..."
    }
  ]
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

| 状态 | attribution_score | 含义 | 报告行为 |
|------|------------------|------|---------|
| `PASS` | >= 0.9 | 高置信度，引用充分验证 | 正常展示报告 |
| `WARN` | 0.5 - 0.9 | 中等置信度，部分引用未验证 | 展示报告 + 警告横幅 |
| `REJECTED` | 存在 contradiction | 有矛盾引用 | 拒绝展示，自动触发重生成 |

> 归因分数计算：`attribution_score = (验证通过数 / 总引用数) × 引用覆盖率`。当 NLI 模型不可用时，降级为文本重叠法。

---

## 核心组件说明

### HybridRetriever - 混合检索

`rag_service/retrieval/hybrid_retriever.py`

生产路径使用 ModelScope API embedding；API 不可用时向量分支降级，BM25 仍可召回。

检索流程：
1. Faiss Dense 检索（Top-50）
2. BM25 检索（jieba 分词，Top-50）
3. RRF 融合（k=25）
4. Must-Check 强制注入
5. 区域过滤（EU/US/CN 等）
6. RRF 结果直接作为 Top-K 返回（cohere_reranker 已实现但未接入管线）

### LegalChunker - 法律分块

`rag_service/chunker/legal_chunker.py`

按法律条款边界（Article/Section/条）分块，支持：
- EU 法规：Article + Paragraph
- 中国法规：第X条 + 款/项
- 美国法规：Section + (a)(b)

输出：Child Chunk（向量检索）+ Parent Chunk（LLM 上下文）

### CitationVerifier - 引用验证

`rag_service/verify/citation_verifier.py`

NLI 软门验证（归因分数）：
- 提取报告中的法规引用（Article No. + 页码）
- 在检索到的原文 chunks 中交叉验证
- 软门决策：归因 >= 0.9 ✅ PASS / 0.5-0.9 ⚠️ WARN / 有矛盾 ❌ REJECTED
- 无 NLI 模型时降级为文本重叠法

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
| HTML 法规 | HTML | 35+ 个 | ✅ 已处理 |
| 其他市场法规 | 混合 | ~40 个 | ✅ 已处理 |
| 截屏 PDF | PDF | ~20 个 | ⚠️ 待 OCR 处理 |
| **processed 目录** | JSON | **200+ 个** | ✅ 已完成 |

> ⚠️ `data/corpus/screenshot_pending/` 下约 20 个 PDF 截图为待 OCR 处理状态。
> ⚠️ `data/全部法规/` 和 `data/合规/` 为冗余副本，建议清理。

### FAISS 索引

- 位置：`data/faiss/legal_chunks.index`
- 维度：1024（ModelScope Qwen3-Embedding）
- 向量数：~15,000 个 Chunk
- 存储大小：~26 MB

### 语料库构建

如需重新构建语料库：

```bash
# 解析法规文件
D:\python\python.exe scripts/parse_regulation.py

# 构建 FAISS 索引
D:\python\python.exe scripts/build_faiss.py
```

---

## 前端扫描流程

前端实现三路由完整链路，支持 Demo 降级：

```
[首页 /] ──→ [上传页 /upload]
              ↓ POST /api/scan (FormData)
         [API Route: app/api/scan/route.ts]
              ├─ 解析图片 → base64
              ├─ 解析文档 (PDF→base64, DOCX→mammoth, HTML→文本)
              ├─ 创建 session → session-store.ts
              ├─ DEMO_MODE? → runDemoSimulation() [4.5s mock]
              └─ 否则 → runScan() → RAG Service (8001/scan)
              ↓ 返回 202 Accepted { sessionId }

         [扫描中页 /burning/[sessionId]]
              ↓ useScanPolling (800ms, ease-out 12%)
              ↓ GET /api/scan/[sessionId]
              ↓ displayProgress 动画 (requestAnimationFrame)
              ↓ status === "ready" → sessionStorage.setItem → router.push

         [结果页 /result/[sessionId]]
              ├─ sessionId === "demo" → mockScanResult (跳过 API)
              ├─ sessionStorage.getItem() → 优先缓存读取
              └─ GET /api/scan/[sessionId] → 后备
              ↓
              isComplianceReport()?
                  ├─ true → ComplianceReportView (markdown 报告 + Agent Trace 时间线 + 命中法规标签)
                  └─ false → LegacyResultView (JSON dump + 文档列表)
```

### 会话存储（双层架构）

- **内存 Map**：`globalThis.__scanStore` — 热读取，TTL 1 小时
- **文件持久化**：`data/sessions/{sessionId}.json` — 进程重启可恢复
- **过期清理**：启动时清理超过 SESSION_TTL_MS 的文件

### 关键代码位置

| 功能 | 文件 |
|------|------|
| 上传页面 | `app/upload/page.tsx` — 图片/文档选择，FormData 构建 |
| API Route | `app/api/scan/route.ts` — POST 创建 session，GET 查询状态 |
| 扫描管线 | `lib/pipeline/scan.ts` — 调用 RAG Service，超时 120s |
| 会话存储 | `lib/pipeline/session-store.ts` — create/update/getSession |
| 轮询 Hook | `lib/hooks/useScanPolling.ts` — 800ms 轮询 + ease-out 动画 |
| 扫描中页 | `app/burning/[sessionId]/page.tsx` — 进度条 + 阶段文字 |
| 结果页 | `app/result/[sessionId]/page.tsx` — ComplianceReportView + LegacyResultView |
| Mock 数据 | `lib/mock/scan-result.ts` — `mockScanResult` (USB 加湿器 Demo) |

### 评分等级映射

RAG Service 返回 `status` (PASS/WARN/REJECTED) → 前端映射为评分：

| RAG Status | 合规得分 | 评分等级 |
|-----------|---------|---------|
| PASS | 85 分 | B |
| WARN | 55 分 | C |
| REJECTED | 25 分 | D |

评分等级颜色：A=绿色 / B=蓝色 / C=黄色 / D=红色。

---

## 环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MIMOTALK_API_KEY` | - | mimoTalk LLM API Key（必填） |
| `MIMOTALK_BASE_URL` | `https://token-plan-sgp.xiaomimimo.com/anthropic/v1` | mimoTalk 端点 |
| `MIMOTALK_MODEL` | `mimo-v2.5` | 模型名称 |
| `MODELSCOPE_API_KEY` | - | ModelScope Embedding API Key（必填，非 Demo） |
| `RAG_SERVICE_URL` | `http://localhost:8001` | RAG 服务地址 |
| `DEMO_MODE` | `false` | Demo 模式（使用 Mock 数据，无需 API Key） |
| `DAILY_FREE_SCAN_LIMIT` | `3` | 每日免费扫描次数 |

---

## 开发指南

### 测试

```bash
# Python 测试
D:\python\python.exe -m pytest rag_service/tests/ -v

# 前端单元测试 (Vitest)
npm run test

# 前端覆盖率测试
npm run test:coverage

# E2E 测试 (Playwright)
npm run test:e2e
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

## 已知限制

| 限制 | 说明 |
|------|------|
| **无持久化** | 会话仅存储 1 小时（内存 + 文件 TTL），无数据库 |
| **无用户系统** | 无登录/注册/权限控制 |
| **cohere_reranker 未接入** | `cohere_reranker.py` 已实现，管线中未调用 |
| **截屏 PDF 待 OCR** | `data/corpus/screenshot_pending/` 下约 20 个截屏未处理 |
| **数据冗余** | `data/全部法规/` 和 `data/合规/` 为冗余副本 |

---

## 相关文档

- [RAG 架构文档 v3](./docs/RAG-ARCHITECTURE-v3.md) - 详细技术架构说明（当前版本）
- [RAG 架构文档 v2](./docs/RAG-ARCHITECTURE-v2-LEGACY.md) - 旧版架构（已归档）
- [实施计划](./docs/IMPLEMENTATION-PLAN-v3.md) - 开发路线图
- [产品需求文档](./docs/PRD.md) - 产品功能规格
- [项目描述](./docs/PROJECT.md) - 技术栈和目录结构
- [上线评估报告](./docs/PROJECT-STATUS.md) - 项目完成度评估

---

**版本**：0.2.0
**最后更新**：2026-05-07
