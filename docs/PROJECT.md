# 火鹰合规 (Blaze Hawks) - 项目描述文档

> "想出海？先烧毁。" — 跨境电商合规风险智能扫描平台

---

## 1. 项目概述

**火鹰合规** 是一个基于 **LangGraph Agentic RAG** 的跨境电商合规风险智能扫描平台。平台通过上传产品图片，AI 自动识别产品类别和目标市场，结合多市场法规知识库，生成带有精确法规引用的合规报告，帮助卖家在上架前发现并修复合规风险。

### 核心能力

```
上传产品图片 → AI 视觉分析 → 多市场法规检索 → 生成合规报告（含引用溯源）
```

### 目标用户

- 跨境电商卖家（亚马逊、eBay、速卖通、TikTok Shop）
- 品牌方合规负责人
- 工厂外贸业务员

### 支持市场

| 市场 | 法规覆盖 | 市场 | 法规覆盖 |
|------|----------|------|----------|
| **EU** | REACH, RoHS, GPSR, RED, DSA, DMA, GDPR, AI Act | **US** | FCC, CPSIA, TSCA, DOT, UL |
| **CN** | 出口管制法, 两用物项, 境外投资管理办法 | **AE** | 阿联酋合规要求 |
| **SA** | 沙特合规 | **UK** | UKCA, UK GDPR | **AU** | 澳大利亚合规 |

---

## 2. 技术架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         前端 (Next.js 16)                          │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐    │
│   │  上传页   │ → │ 扫描中页  │ → │ 结果展示  │ → │   报告导出    │    │
│   └──────────┘   └──────────┘   └──────────┘   └──────────────┘    │
│                                                                  │
│   Next.js App Router · TypeScript · Tailwind CSS · shadcn/ui    │
│   Framer Motion · Zod · Sonner · React Markdown                  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ POST /api/scan (FormData)
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      RAG 服务 (FastAPI + Python)                    │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │                 LangGraph Agent Orchestrator                  │  │
│   │                                                              │  │
│   │  vision → query_planner → fan_out → retrieval                │  │
│   │                                    ↓                         │  │
│   │                              synthesis → generate            │  │
│   │                                    ↓                         │  │
│   │                              verify → should_regenerate      │  │
│   │                                    ↓ (可选)                  │  │
│   │                                 refine → query_planner       │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│   mimoTalk (mimo-v2.5) · LangGraph 1.1.6 · FAISS 1.12 · jieba       │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         数据层                                      │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐   │
│   │ FAISS 向量库  │   │  BM25 索引    │   │     法规语料库        │   │
│   │  ~15,000 向量 │   │  (jieba分词)  │   │  96法规, 12M+字符    │   │
│   │  1024-dim    │   │               │   │  200+ 已解析JSON     │   │
│   └──────────────┘   └──────────────┘   └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 技术栈详解

### 3.1 前端技术栈

| 技术 | 版本 | 选型理由 |
|------|------|----------|
| **Next.js** | 16.2.4 | App Router + RSC，SSR/SSG 一体，全栈 TypeScript |
| **React** | 19.2.4 | 新一代 Concurrent Features，完整 Suspense 支持 |
| **TypeScript** | 5.x | 端到端类型安全，接口覆盖前后端 |
| **Tailwind CSS** | 4.x | 原子化 CSS，CSS 变量主题，JIT 编译 |
| **shadcn/ui** | 4.4.0 | 基于 Base UI，源码可控，快速定制 |
| **Framer Motion** | 12.38.0 | React 专用声明式动画，页面过渡流畅 |
| **Zod** | 4.3.6 | 运行时 Schema 验证，前后端共享类型 |
| **mammoth** | 1.12.0 | 浏览器端 DOCX 解析，用户文档提取 |
| **jspdf + docx** | - | 报告导出 PDF/Word 格式 |
| **Vitest + Playwright** | - | 单元测试 + E2E 测试 |

### 3.2 后端 RAG 服务技术栈

| 技术 | 版本 | 选型理由 |
|------|------|----------|
| **Python** | 3.10+ | AI/ML 生态核心，LangGraph/jieba/FAISS 均为 Python-first |
| **FastAPI** | 0.109 | 异步高性能，自动 Swagger 文档，Pydantic 深度集成 |
| **LangGraph** | 1.1.6 | 状态机 Agent 编排，支持条件分支/循环/Send 并行 |
| **FAISS** | 1.12 | Facebook 开源向量索引，CPU 高效，Inner Product 索引 |
| **jieba** | 0.42 | 中文 NLP 分词库，BM25 检索基础 |
| **Anthropic SDK** | 0.91 | 调用 mimoTalk（类 Anthropic 兼容 API） |
| **pdfplumber** | 0.11 | 服务端 PDF 文本提取 |

### 3.3 LLM/Embedding 模型

| 层级 | 模型 | 维度 | 说明 |
|------|------|------|------|
| **LLM (报告生成 + Vision)** | mimoTalk (mimo-v2.5) | - | Anthropic SDK 兼容，统一调用 |
| **Embedding 优先级 1** | Ollama (nomic-embed-text) | 768-dim | 本地 CPU，完全免费，零依赖 |
| **Embedding 优先级 2** | Qwen3-Embedding-0.6B | 1024-dim | 本地 GPU/CPU，可量化部署 |
| **Embedding 优先级 3** | ModelScope API | 云端 | 降级兜底，高质量 |

---

## 4. 核心技术亮点

### 亮点一：LangGraph Agentic 编排架构

**核心创新**：将合规扫描流程建模为状态机，实现复杂条件分支和多市场并行处理。

```python
# 状态图节点 (8 个)
vision_analyze → query_planner → fan_out → retrieve → synthesis → generate → verify → (refine | END)

# fan_out 多市场并行 (Send)
graph.add_node("fan_out", fan_out_retrieval)
graph.add_send(
    Send("retrieve", {"market": m, "query": q})
    for m, q in sub_queries
)

# 条件路由
def should_regenerate(state) -> str:
    if state["generation_score"] in ("PASS", "ENTAILED"):
        return "end"
    elif state["loop_count"] < MAX_LOOPS:
        return "refine"
    return "force_generate"
```

**优势**：
- 多市场并行检索：通过 `Send()` 将 EU/US/CN 等市场同时分发，节省时间
- 循环重检索：最多 2 轮检索循环，质量不达标自动重试
- 完整 Agent Trace：每个决策节点可追溯

---

### 亮点二：三级 Embedding 降级策略

**问题**：Embedding 是 RAG 的性能瓶颈，单一方案无法覆盖所有场景。

**解决方案**：

```
用户请求
    │
    ├──→ Ollama 本地 (nomic-embed-text, 768-dim)
    │         失败？↓
    │    ├──→ Qwen3-Embedding-0.6B (本地, 1024-dim)
    │         失败？↓
    │    └──→ ModelScope API (云端)
```

**效果**：
- 完全离线可用（Ollama）
- 支持 GPU 加速（Qwen3-Embedding）
- 云端兜底保障质量（ModelScope）

---

### 亮点三：混合检索管线 (Hybrid Retrieval)

**技术实现**：结合 Dense（语义）和 Sparse（关键词）两种检索方式，通过 RRF 融合提升召回率。

```
查询 "充电宝出口欧盟"
    │
    ├──→ FAISS 向量检索 (Embedding → Top-K)
    │
    ├──→ BM25 关键词检索 (jieba 分词 → Top-K)
    │
    ▼ RRF 融合 (k=25)
┌─────────────────────────┐
│ 最终 Top-K              │
│ (语义 + 关键词融合排序)   │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Must-Check 强制注入      │
│ (按 category 补充必查法规)│
└─────────────────────────┘
```

**RRF (Reciprocal Rank Fusion)**：
```python
def rrf_fusion(results_list, k=25):
    score = {}
    for results in results_list:
        for i, doc in enumerate(results):
            score[doc.id] += 1 / (k + i + 1)
    return sorted(score.items(), key=lambda x: -x[1])[:top_k]
```

---

### 亮点四：Parent-Child 双层分块

**问题**：法律条款有完整逻辑结构，盲目按固定长度分块会破坏条款完整性。

**解决方案**：

```
法规文档
├── Part I: REACH 基本要求 (Parent, 800-1000 tokens)
│   ├── 条款 1: 定义 (Child, 150-300 tokens)
│   ├── 条款 2: 适用范围 (Child, 150-300 tokens)
│   └── 条款 3: 豁免条件 (Child, 150-300 tokens)
└── Part II: 化学品限制 (Parent, 800-1000 tokens)
    ├── 条款 4: 限用物质 (Child, 150-300 tokens)
    └── ...
```

**效果**：
- 检索时定位到 Child（细粒度匹配）
- 引用时回溯到 Parent（法律完整性）
- 元数据保留：`doc_name`, `article_no`, `region`, `chunk_type`

---

### 亮点五：NLI 引用验证软门

**问题**：RAG 容易产生幻觉（Hallucination），必须验证生成内容是否真正来自检索结果。

```python
def verify_citation(chunk_content, claim):
    nli_result = nli_model.predict(
        premise=chunk_content,
        hypothesis=claim
    )
    return nli_result.score  # 0.0 ~ 1.0

# 归因分数软门
| 分数区间       | 结果       | 处理方式              |
|----------------|------------|----------------------|
| ≥ 0.9          | **PASS**   | 正常引用              |
| 0.5 - 0.9      | **WARN**   | 警告标记，用户自判    |
| < 0.5 或矛盾    | **REJECTED** | 移除或重检索        |
```

**降级机制**：无 NLI 模型时，使用 embedding 相似度 (>0.5 判定为 ENTAILED)。

---

### 亮点六：Must-Check 强制注入

**问题**：通用检索可能遗漏特定产品类别必须检查的法规项。

```python
MUST_CHECK_RULES = {
    "electronics": ["REACH Article 22", "RoHS Directive"],
    "toys": ["EN 71", "REACH Annex XVII"],
    "cosmetics": ["EU Cosmetics Regulation", "GMP"],
    "appliance": ["LVD Directive", "EMC Directive"],
}
```

**效果**：确保关键合规项不会被遗漏。

---

## 5. 前端架构

### 页面路由

```
/                       首页 (Landing)
├── /upload             图片/文档上传页
├── /burning/[sessionId] 扫描中页面 (实时轮询)
├── /result/[sessionId]  扫描结果页
└── /result/demo        Demo 结果页 (无需后端)
```

### 状态管理

- **Session Storage**：内存 Map 存储扫描状态，跨页面传递
- **Polling Hook**：`useScanPolling` 定时轮询 `/api/scan/{sessionId}`
- **Demo Mode**：`DEMO_MODE=true` 时，3 阶段动画模拟扫描流程

### 核心 API

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/scan` | 启动扫描任务，返回 sessionId |
| GET | `/api/scan/{sessionId}` | 获取扫描状态/结果 |

---

## 6. 后端 RAG 服务

### API 接口

```python
# POST /scan
class ScanRequest(BaseModel):
    query: str                    # 用户查询
    product: str                  # 产品名称
    category: str                 # 产品类别
    markets: list[str]            # 目标市场
    vision_result: Optional[dict] # 预计算 Vision 结果
    images: Optional[list[dict]]  # base64 图片
    documents: Optional[list[dict]] # {name, mime_type, text}

class ScanResponse(BaseModel):
    status: str                   # PASS / WARN / REJECTED
    report: str                   # 合规报告 (Markdown)
    agent_trace: list[dict]       # Agent 执行路径
    loop_count: int               # 重检索次数
    documents: Optional[list[dict]] # 检索到的法规片段
```

### 健康检查

```python
# GET /health
{
    "status": "ok",
    "version": "0.2.0",
    "faiss_index": "loaded",
    "vector_count": 15342
}
```

---

## 7. 数据规模

| 数据类型 | 数量 | 说明 |
|----------|------|------|
| 法规文件 | 96 个 | EU/US/CN/阿联酋/沙特/巴西等市场 |
| 字符总量 | 12M+ | 涵盖主要跨境市场法规 |
| 向量索引 | ~15,000 | FAISS Inner Product 索引 |
| 预解析语料 | 200+ JSON | 已完成清洗和分块 |
| 分块维度 | 1024-dim | Qwen3-Embedding / Ollama |

---

## 8. 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `MIMOTALK_API_KEY` | 是 | - | mimoTalk LLM API Key |
| `MIMOTALK_BASE_URL` | 否 | `https://token-plan-sgp.xiaomimimo.com/anthropic/v1` | API 端点 |
| `MIMOTALK_MODEL` | 否 | `mimo-v2.5` | 模型名称 |
| `MODELSCOPE_API_KEY` | 否 | - | ModelScope API Key |
| `OLLAMA_BASE_URL` | 否 | `http://localhost:11434` | Ollama 服务地址 |
| `OLLAMA_EMBED_MODEL` | 否 | `nomic-embed-text` | Embedding 模型 |
| `DEMO_MODE` | 否 | `false` | Demo 模式 |
| `RAG_SERVICE_URL` | 否 | `http://localhost:8001` | RAG Service 地址 |

---

## 9. 目录结构

```
attrak/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # 首页
│   ├── upload/page.tsx          # 上传页
│   ├── burning/[sessionId]/      # 扫描中页
│   ├── result/[sessionId]/       # 结果页
│   └── api/scan/route.ts        # 扫描 API
│
├── components/                   # UI 组件
│   ├── ui/                      # shadcn/ui 基础组件
│   ├── upload/                  # 上传相关
│   ├── burning/                 # 扫描中相关
│   └── result/                   # 结果展示
│
├── lib/                          # 核心库
│   ├── types.ts                 # TypeScript 类型定义
│   ├── schemas.ts               # Zod 验证 schema
│   ├── utils.ts                 # 工具函数
│   ├── hooks/                   # React Hooks
│   ├── mock/                    # Mock 数据
│   ├── pipeline/                # 扫描管线
│   │   ├── scan.ts             # 主扫描逻辑
│   │   └── session-store.ts    # 会话存储
│   └── vision/                  # Vision AI 封装
│
├── rag_service/                  # Python RAG 服务
│   ├── main.py                  # FastAPI 入口
│   ├── config.py                # 配置管理
│   ├── parser/                  # 文档解析
│   ├── chunker/                 # Parent-Child 分块
│   ├── retrieval/               # 混合检索管线
│   │   ├── hybrid_retriever.py
│   │   ├── bm25_retriever.py
│   │   └── faiss_retriever.py
│   ├── verify/                  # NLI 引用验证
│   ├── generate/                # 报告生成
│   ├── orchestrator/            # LangGraph Agent
│   │   ├── state.py           # GraphState 定义
│   │   ├── graph.py           # StateGraph 组装
│   │   └── nodes/             # 8 个 Graph Node
│   └── tests/                  # Python 单元测试
│
├── data/                         # 数据文件
│   ├── corpus/                 # 预解析语料库 (200+ JSON)
│   ├── faiss/                  # FAISS 向量索引
│   └── sessions/               # 会话存储
│
├── docs/                         # 文档
│   ├── PROJECT.md              # 本文档
│   ├── RAG-ARCHITECTURE-v3.md  # RAG 架构详解
│   └── ...
│
├── public/                      # 静态资源
│   ├── brand/                  # 品牌素材
│   ├── mock-fixtures/         # Mock 图片
│   └── uploads/               # 用户上传
│
├── package.json
├── tsconfig.json
├── next.config.ts
├── .env.local.example
└── CLAUDE.md
```

---

## 10. 版本信息

| 信息 | 值 |
|------|-----|
| 当前版本 | 0.2.0 |
| 最后更新 | 2026-05-07 |
| 架构状态 | 生产就绪 |

---

## 11. 已知限制

1. **无持久化存储**：会话存储在内存 Map，服务器重启丢失
2. **无用户系统**：匿名使用，无登录/注册
3. **Rerank 未接入**：cohere_reranker 已实现但未在管线中启用
4. **截图 PDF 待 OCR**：data/corpus/screenshot_pending/ 下约 20 个截图待处理

---

*文档版本: 2.0*
*最后更新: 2026-05-07*