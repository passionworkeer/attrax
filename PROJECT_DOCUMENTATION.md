# 火鹰合规 (Attrax) - 完整项目文档

> 版本: 0.3.0 | 更新: 2026-05-12

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术架构](#2-技术架构)
3. [目录结构](#3-目录结构)
4. [核心模块详解](#4-核心模块详解)
5. [API 接口文档](#5-api-接口文档)
6. [数据流](#6-数据流)
7. [降级模式](#7-降级模式)
8. [部署指南](#8-部署指南)
9. [开发指南](#9-开发指南)
10. [故障排查](#10-故障排查)

---

## 1. 项目概述

### 1.1 项目简介

**火鹰合规 (Attrax)** 是一个基于 AI Agentic RAG 的跨境电商合规风险智能扫描平台。

用户上传产品图片，AI 自动：
1. 识别产品类别
2. 分析目标市场
3. 检索相关法规
4. 生成带精确引用的合规报告
5. 生成成本利润分析报告

### 1.2 核心功能

| 功能 | 描述 |
|------|------|
| 产品图片分析 | Vision AI 识别产品类型和属性 |
| 多市场合规检索 | 支持 EU/US/UK/CN/AU/SA/AE 等市场 |
| Agentic RAG | LangGraph 多轮检索-生成-验证 |
| 合规报告生成 | Markdown 格式，带法规引用 |
| 成本利润分析 | 合规 vs 非合规成本对比 |
| PDF/DOCX 导出 | 报告可下载 |

### 1.3 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16.2.4 + React 19.2.4 + TypeScript |
| 样式 | Tailwind CSS 4.x + shadcn/ui |
| 动画 | framer-motion 12.38.0 |
| 后端 | FastAPI + LangGraph 1.1.6 |
| 向量检索 | FAISS + BM25 |
| Embedding | Ollama nomic-embed-text / ModelScope Qwen3 |
| LLM | mimoTalk mimo-v2.5 |
| 测试 | Vitest + Playwright |

---

## 2. 技术架构

### 2.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户浏览器                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Next.js 前端 (3000)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Upload Page │→│ Burning Page │→│ Result Page │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└───────────────────────────┬─────────────────────────────────────┘
                            │ API 调用
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                FastAPI RAG 服务 (8001)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              LangGraph Agentic RAG Graph                  │   │
│  │  ┌──────┐   ┌──────────┐   ┌──────┐   ┌────────┐       │   │
│  │  │Vision│→  │QueryPlan │→  │Retrieve│→ │Generate│       │   │
│  │  └──────┘   └──────────┘   └──────┘   └────────┘       │   │
│  │                                       │                  │   │
│  │                              ┌────────▼────────┐         │   │
│  │                              │     Verify      │         │   │
│  │                              └────────┬────────┘         │   │
│  │                               ↓ pass / fail               │   │
│  │                         ┌─────────────┐                   │   │
│  │                         │    Refine   │ (可选循环)         │   │
│  │                         └─────────────┘                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │ HybridRetriever │  │ CitationVerify │  │ ReportGenerator │  │
│  │ FAISS + BM25    │  │ NLI 验证       │  │ mimoTalk LLM   │  │
│  └────────────────┘  └────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  Ollama  │  │ModelScope│  │  语料库   │
        │ (Embedding)│  │  (API)  │  │ (FAISS)  │
        └──────────┘  └──────────┘  └──────────┘
```

### 2.2 Agentic RAG 流程

```
用户查询
    │
    ▼
┌────────────────────────────────────────────────────────────┐
│ 1. Vision Node - 图片分析                                    │
│    输入: 产品图片 → 输出: 产品名称、属性、风险点              │
└────────────────────────────────────────────────────────────┘
    │
    ▼
┌────────────────────────────────────────────────────────────┐
│ 2. Query Planner - 查询规划                                  │
│    输入: 用户查询 + Vision 结果                              │
│    输出: 针对每个市场的子查询 (Send fan-out)                 │
└────────────────────────────────────────────────────────────┘
    │
    ▼  ← 多市场并行
┌────────────────────────────────────────────────────────────┐
│ 3. Retrieve Node - 混合检索                                  │
│    FAISS (向量) + BM25 (稀疏) → RRF 融合                    │
│    输出: 相关法规片段 + 评分                                  │
└────────────────────────────────────────────────────────────┘
    │
    ▼
┌────────────────────────────────────────────────────────────┐
│ 4. Synthesis Node - 检索结果综合                             │
│    合并多市场检索结果                                        │
└────────────────────────────────────────────────────────────┘
    │
    ▼
┌────────────────────────────────────────────────────────────┐
│ 5. Generate Node - 报告生成                                  │
│    基于检索结果生成 Markdown 合规报告                         │
└────────────────────────────────────────────────────────────┘
    │
    ▼
┌────────────────────────────────────────────────────────────┐
│ 6. Verify Node - 引用验证                                   │
│    NLI 模型验证报告中的法规引用是否正确                       │
│    → PASS: 结束                                             │
│    → WARN: 继续生成                                         │
│    → FAIL: 回到 Query Planner 重新检索 (max_attempts)       │
└────────────────────────────────────────────────────────────┘
```

---

## 3. 目录结构

```
attrax/
├── app/                          # Next.js App Router
│   ├── page.tsx                   # 首页 (上传入口)
│   ├── layout.tsx                 # 根布局
│   ├── globals.css                # 全局样式
│   ├── upload/                    # 上传页面
│   │   └── page.tsx
│   ├── burning/                   # 扫描中动画页
│   │   └── [sessionId]/page.tsx
│   ├── result/                    # 结果展示页
│   │   └── [sessionId]/page.tsx
│   └── api/                       # API 路由
│       └── scan/
│           ├── route.ts          # POST /api/scan (创建扫描)
│           └── [sessionId]/
│               └── route.ts      # GET /api/scan/{id} (轮询状态)
│
├── components/                   # React 组件
│   ├── ui/                       # shadcn/ui 基础组件
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── progress.tsx
│   │   ├── separator.tsx
│   │   ├── sheet.tsx
│   │   ├── sonner.tsx            # Toast 通知
│   │   ├── tabs.tsx
│   │   └── tooltip.tsx
│   │
│   ├── PageTransition.tsx        # 页面过渡动画
│   │
│   ├── burning/                  # 扫描中组件
│   │   └── (火焰动画等)
│   │
│   ├── flame/                    # 火焰效果
│   │   └── (动画组件)
│   │
│   ├── result/                   # 结果展示
│   │   └── ProfitReportView.tsx  # 成本利润报告视图
│   │
│   └── upload/                   # 上传组件
│       └── (文件上传相关组件)
│
├── lib/                          # 核心库
│   ├── types.ts                  # TypeScript 类型定义
│   ├── schemas.ts                 # Zod Schema 验证
│   ├── utils.ts                  # 工具函数
│   │
│   ├── report-export.ts          # PDF/DOCX 导出
│   │
│   ├── pipeline/                 # 扫描管线
│   │   ├── scan.ts              # runScan() - 调用 RAG 服务
│   │   └── session-store.ts     # 会话存储 (内存 + 文件)
│   │
│   ├── hooks/                    # React Hooks
│   │   └── useScanPolling.ts    # 轮询 hook
│   │
│   └── mock/                     # Mock 数据
│       └── scan-result.ts        # Demo 模式数据
│
├── rag_service/                  # Python RAG 服务
│   ├── main.py                   # FastAPI 入口
│   ├── config.py                 # 配置管理
│   │
│   ├── orchestrator/             # LangGraph 编排
│   │   ├── graph.py             # StateGraph 装配
│   │   ├── state.py             # GraphState 定义
│   │   └── nodes/               # 节点实现
│   │       ├── vision.py        # 视觉分析节点
│   │       ├── query_planner.py # 查询规划节点
│   │       ├── retriever.py    # 检索节点
│   │       ├── synthesis.py     # 综合节点
│   │       ├── generator.py     # 报告生成节点
│   │       ├── verifier.py      # 验证节点
│   │       └── refiner.py       # 精炼节点
│   │
│   ├── retrieval/                # 检索管线
│   │   ├── hybrid_retriever.py  # 混合检索主类
│   │   ├── faiss_retriever.py   # FAISS 向量检索
│   │   ├── bm25_retriever.py    # BM25 稀疏检索
│   │   ├── ollama_embedder.py   # Ollama Embedding
│   │   ├── modelScope_embedder.py # ModelScope API
│   │   ├── local_embedder.py    # 本地 Embedding
│   │   ├── fusion.py            # RRF 融合
│   │   └── must_check.py        # 必检项注入
│   │
│   ├── generate/                 # 报告生成
│   │   └── report_generator.py  # mimoTalk LLM 调用
│   │
│   ├── verify/                    # 引用验证
│   │   └── citation_verifier.py  # NLI 验证
│   │
│   ├── parser/                   # 文档解析
│   │   ├── docx_parser.py
│   │   └── html_parser.py
│   │
│   ├── chunker/                  # 分块策略
│   │   └── legal_chunker.py    # 法律文档分块
│   │
│   └── tests/                   # pytest 测试
│
├── data/                         # 数据文件
│   ├── faiss/                   # FAISS 索引
│   │   ├── legal_chunks.index   # 索引文件
│   │   └── legal_chunks_meta.json # 元数据
│   │
│   ├── corpus/                  # 语料库
│   │   ├── asia/               # 东南亚
│   │   │   ├── indonesia/
│   │   │   ├── malaysia/
│   │   │   ├── singapore/
│   │   │   ├── thailand/
│   │   │   └── vietnam/
│   │   ├── cn/                 # 中国
│   │   ├── eu/                 # 欧盟
│   │   │   ├── regulations/
│   │   │   └── products/
│   │   ├── gcc/                # 海湾
│   │   ├── intl/              # 国际组织
│   │   ├── middle_east/       # 中东
│   │   ├── us/                # 美国
│   │   └── processed/         # 处理后的 JSON
│   │
│   └── sessions/              # 会话文件 (TTL 1小时)
│
├── tests/                       # 前端测试
│   ├── unit/                   # Vitest 单元测试
│   ├── e2e/                    # Playwright E2E
│   └── setup.ts
│
├── public/                      # 静态资源
│   ├── uploads/                # 用户上传
│   ├── mock-fixtures/          # Mock 测试文件
│   └── brand/                  # 品牌资产
│
├── scripts/                     # 运维脚本
│   ├── start_rag.bat          # 启动 RAG 服务
│   └── start_all.bat          # 启动全部服务
│
├── docs/                       # 文档
│   └── (架构文档等)
│
├── package.json
├── next.config.ts
├── tsconfig.json
├── vite.config.ts
└── playwright.config.ts
```

---

## 4. 核心模块详解

### 4.1 前端核心流程

#### 会话存储 (session-store.ts)

```typescript
// 双层存储: 内存 + 文件
globalThis.__scanStore: Map<string, ScanStatus>  // 内存缓存
data/sessions/{sessionId}.json                   // 文件持久化
```

**核心函数：**

| 函数 | 说明 |
|------|------|
| `createSession(id)` | 创建新会话，初始化状态 |
| `updateSession(id, patch)` | 更新会话进度 |
| `getSession(id)` | 获取会话状态 |
| `clearStore()` | 清空所有会话 |

**生命周期：**
- TTL: 1 小时
- 自动清理过期会话文件

#### 扫描管线 (scan.ts)

```typescript
async function runScan(sessionId: string, input: RunScanInput) {
  // 1. 更新进度: 10% - 图片分析
  // 2. 更新进度: 30% - 查询规划
  // 3. POST /scan → RAG 服务
  // 4. 轮询获取结果
  // 5. 更新进度: 75% - 报告生成
  // 6. POST /profit-report → 成本利润报告
  // 7. 完成: 100%
}
```

**降级处理：**
- RAG 服务不可用 → 自动使用 Mock 数据
- 利润报告失败 → 跳过，不阻塞主流程

### 4.2 RAG 服务核心

#### Hybrid Retriever (hybrid_retriever.py)

```python
class HybridRetriever:
    def retrieve(self, query, product_category, region, top_k=20):
        # 1. 并行执行 Dense + BM25
        # 2. RRF 融合 (k=25)
        # 3. Must-Check 注入
        # 4. Region 过滤
        return fused_results
```

**Embedding 降级链：**
```
1. OllamaEmbedder (本地)
   ↓ 失败
2. LocalEmbedder (Qwen3 本地)
   ↓ 失败
3. ModelScopeEmbedder (API)
   ↓ 失败
BM25 Only 模式
```

#### LangGraph Graph (graph.py)

```python
def build_compliance_graph():
    g = StateGraph(GraphState)

    # 节点
    g.add_node("vision",        vision_analysis_node)
    g.add_node("query_planner", query_planner_node)
    g.add_node("fan_out",       lambda: None)  # Send dispatcher
    g.add_node("retrieve",       retriever_node)
    g.add_node("synthesis",      synthesis_node)
    g.add_node("generate",       generator_node)
    g.add_node("verify",        verifier_node)
    g.add_node("refine",         refiner_node)

    # 边
    g.set_entry_point("vision")
    g.add_edge("vision", "query_planner")
    g.add_edge("query_planner", "fan_out")

    # 条件边: fan_out → retrieve (每市场一个)
    g.add_conditional_edges("fan_out", fan_out_markets)

    g.add_edge("retrieve", "synthesis")
    g.add_edge("synthesis", "generate")
    g.add_edge("generate", "verify")

    # 条件边: verify → end/refine/generate
    g.add_conditional_edges("verify", should_regenerate)

    return g.compile()
```

---

## 5. API 接口文档

### 5.1 前端 API (Next.js)

#### POST /api/scan

创建新的扫描会话。

**请求：**
```json
{
  "category": "electronics",
  "markets": ["EU", "US"],
  "query": "充电宝出口欧盟美国合规要求"
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "sessionId": "01HX...",
    "status": "processing",
    "progress": 0,
    "stageText": "准备中..."
  }
}
```

#### GET /api/scan/[sessionId]

轮询扫描状态。

**响应：**
```json
{
  "success": true,
  "data": {
    "sessionId": "01HX...",
    "status": "ready",
    "progress": 100,
    "stageText": "✅ 合规扫描通过",
    "result": {
      "sessionId": "01HX...",
      "complianceReport": "# 合规报告\n\n...",
      "complianceStatus": "PASS",
      "agentTrace": [...],
      "retrievedChunks": [...]
    },
    "profitReport": {
      "report": "# 成本利润分析\n\n...",
      "barebone": {...},
      "compliant": {...}
    }
  }
}
```

### 5.2 RAG 服务 API

#### POST /scan

Agentic RAG 扫描。

**请求：**
```json
{
  "query": "充电宝出口欧盟美国合规要求",
  "product": "充电宝",
  "category": "electronics",
  "markets": ["EU", "US"],
  "images": [
    {"buffer": "base64...", "mime_type": "image/jpeg", "name": "product.jpg"}
  ]
}
```

**响应：**
```json
{
  "status": "PASS",
  "report": "# 合规报告...",
  "agent_trace": [
    {"node": "vision", "duration_ms": 1200},
    {"node": "query_planner", "duration_ms": 300},
    {"node": "retrieve", "duration_ms": 2500},
    {"node": "generate", "duration_ms": 4500},
    {"node": "verify", "duration_ms": 800}
  ],
  "loop_count": 0,
  "documents": [
    {"id": "reg_001", "doc_name": "欧盟REACH法规", "article_no": "Art. 3", "region": "EU", "score": 0.95}
  ]
}
```

#### POST /profit-report

生成成本利润报告。

**请求：**
```json
{
  "product": "充电宝",
  "category": "electronics",
  "markets": ["EU"]
}
```

**响应：**
```json
{
  "status": "SUCCESS",
  "report": "# 成本利润分析报告\n\n...",
  "product": "充电宝",
  "market": "EU"
}
```

#### GET /health

健康检查。

**响应：**
```json
{
  "status": "ok",
  "version": "0.3.0",
  "faiss_index": "loaded",
  "vector_count": 1523
}
```

---

## 6. 数据流

### 6.1 完整用户流程

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 用户上传产品图片                                              │
│    ↓                                                             │
│ 2. 前端: createSession() → sessionId                             │
│    ↓                                                             │
│ 3. 前端: runScan() → POST /api/scan                              │
│    ↓                                                             │
│ 4. Next.js: 转发到 RAG 服务 (localhost:8001)                     │
│    ↓                                                             │
│ 5. RAG 服务: run_compliance_graph()                              │
│    ↓                                                             │
│ 6. Vision → Query Planner → Fan-out → Retrieve → Synthesis       │
│    ↓                                                             │
│ 7. Generate → Verify (可选循环)                                  │
│    ↓                                                             │
│ 8. 返回 {status, report, documents}                              │
│    ↓                                                             │
│ 9. 前端: 轮询 GET /api/scan/{sessionId}                         │
│    ↓                                                             │
│ 10. 状态 ready → 跳转到结果页                                     │
│    ↓                                                             │
│ 11. 前端: 请求 /profit-report → 成本利润报告                     │
│    ↓                                                             │
│ 12. 用户可导出 PDF/DOCX                                         │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 会话状态流转

```
[创建] → processing (0%) → processing (30%) → processing (45%)
         ↓
    processing (75%) → processing (90%) → ready (100%)
         ↓
    [失败] → failed
```

---

## 7. 降级模式

### 7.1 降级策略矩阵

| 层级 | 正常模式 | 降级 1 | 降级 2 | 降级 3 |
|------|----------|--------|--------|--------|
| Embedding | Ollama 本地 | Qwen3 本地 | ModelScope API | BM25 Only |
| LLM | mimoTalk | - | - | Demo Mock |
| 向量检索 | FAISS + BM25 | BM25 Only | BM25 Only | BM25 Only |
| 前端 | 实时 RAG | Demo Mock | Demo Mock | Demo Mock |

### 7.2 环境变量控制

```bash
# Demo 模式 (完全离线)
DEMO_MODE=true

# RAG 服务地址
RAG_SERVICE_URL=http://localhost:8001

# Ollama (本地 Embedding)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text

# ModelScope (云端 Embedding)
MODELSCOPE_API_KEY=your_key

# mimoTalk (LLM)
MIMOTALK_API_KEY=your_key
MIMOTALK_BASE_URL=https://...
```

### 7.3 前端降级检测

```typescript
// lib/pipeline/scan.ts

try {
  const resp = await fetch(`${RAG_SERVICE_URL}/scan`, {...});
} catch {
  // RAG 服务不可用 → 使用 Mock 数据
  updateSession(sessionId, {
    status: "ready",
    progress: 100,
    stageText: "⚠️ 后端服务不可用，降级到演示模式…",
    result: createMockScanResult(sessionId),
  });
}
```

---

## 8. 部署指南

### 8.1 本地开发

```bash
# 1. 安装前端依赖
cd attrax
npm install

# 2. 安装 Python 依赖
pip install -r requirements.txt
# 或
pip install fastapi langgraph faiss-cpu pydantic-settings anthropic openai jieba pdfplumber

# 3. 启动 Ollama (Embedding)
ollama pull nomic-embed-text
ollama serve

# 4. 启动 RAG 服务
D:\python\python.exe -m uvicorn rag_service.main:app --reload --port 8001

# 5. 启动前端
npm run dev
```

### 8.2 环境变量配置

**attrax/.env.local:**
```bash
MIMOTALK_API_KEY=your_key_here
MIMOTALK_BASE_URL=https://token-plan-sgp.xiaomimimo.com/anthropic/v1
MIMOTALK_MODEL=mimo-v2.5

MODELSCOPE_API_KEY=your_modelscope_key
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text

RAG_SERVICE_URL=http://localhost:8001
DEMO_MODE=false
```

**rag_service/.env:**
```bash
MIMOTALK_API_KEY=your_key_here
MODELSCOPE_API_KEY=your_modelscope_key
OLLAMA_BASE_URL=http://localhost:11434
DEMO_MODE=false
```

### 8.3 Docker 部署 (TODO)

```dockerfile
# Dockerfile.rag-service
FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY rag_service/ ./rag_service/
EXPOSE 8000
CMD ["uvicorn", "rag_service.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 9. 开发指南

### 9.1 添加新的市场

1. **前端类型定义** (`lib/types.ts`):
```typescript
export const MarketSchema = z.enum(["EU", "US", "UK", "CN", "AU", "SA", "AE", "NEW_MARKET"]);
export type Market = "EU" | "US" | ... | "NEW_MARKET";
```

2. **添加语料** (`data/corpus/`):
```
data/corpus/new_market/
├── regulations/
└── products/
```

3. **重建索引**:
```bash
python -m rag_service.chunker.legal_chunker
```

### 9.2 添加新的产品类别

1. **更新 Schema** (`lib/schemas.ts`):
```typescript
export const ProductCategorySchema = z.enum([
  "electronics", "appliance", "3c", "toy", "home", "other", "new_category"
]);
```

2. **更新查询构建** (`lib/pipeline/scan.ts`):
```typescript
const productMap: Record<ProductCategory, string> = {
  electronics: "电子产品",
  // ...
  new_category: "新产品",
};
```

### 9.3 测试

```bash
# 前端单元测试
npm run test

# 前端 E2E 测试
npm run test:e2e

# Python RAG 服务测试
D:\python\python.exe -m pytest rag_service/tests/ -v
```

---

## 10. 故障排查

### 10.1 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 前端显示 "后端不可用" | RAG 服务未启动 | 启动 `uvicorn rag_service.main:app --port 8001` |
| Embedding 超时 | Ollama 未启动 | `ollama serve` 或配置 ModelScope API |
| 报告生成失败 | mimoTalk API Key 无效 | 检查 `MIMOTALK_API_KEY` |
| FAISS 索引加载失败 | 索引文件损坏 | 重建索引 |

### 10.2 健康检查

```bash
# 检查 RAG 服务
curl http://localhost:8001/health

# 检查 Ollama
curl http://localhost:11434/api/tags

# 检查前端
curl http://localhost:3000
```

### 10.3 日志查看

```bash
# RAG 服务日志
tail -f rag_service.log

# Next.js 开发日志
npm run dev
```

---

## 附录

### A. 语料库覆盖

| 地区 | 覆盖市场 | 法规数量 |
|------|----------|----------|
| 亚洲 | 新加坡、马来西亚、印尼、泰国、越南 | ~15 |
| 中国 | CN | ~10 |
| 欧盟 | EU | ~20 |
| 海湾 | SA、AE | ~8 |
| 国际 | UN、WIPO | ~5 |
| 美国 | US | ~5 |

### B. 性能指标

| 指标 | 目标 | 当前 |
|------|------|------|
| 首屏加载 | < 2s | ~3s |
| 报告生成 | < 30s | ~20-40s |
| Embedding 延迟 | < 500ms | ~300ms |
| 检索延迟 | < 1s | ~500ms |

### C. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 0.3.0 | 2026-05-12 | 利润报告 PDF/DOCX 导出 |
| 0.2.0 | 2026-05-07 | Agentic RAG 多轮检索 |
| 0.1.0 | 2026-04-01 | 初始版本 |

---

*文档由 Claude Code 自动生成 | 最后更新: 2026-05-12*
