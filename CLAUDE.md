# CLAUDE.md — 火鹰合规 (Attrax)

> 项目配置和约定说明，供 AI 编码助手使用。

---

## 项目概述

- **项目名称**：火鹰合规（Blaze Hawks / Attrax）
- **核心功能**：基于 LangGraph Agentic RAG 的跨境电商合规风险智能扫描平台
- **一句话**：用户上传产品图片，AI 自动识别类别和市场，结合多市场法规知识库生成带精确引用的合规报告

---

## 技术栈

### 前端（Next.js）

- **框架**：Next.js 16.2.4 + React 19.2.4 + TypeScript
- **样式**：Tailwind CSS 4.x + shadcn/ui 4.4.0
- **动画**：framer-motion 12.38.0
- **Markdown**：react-markdown + remark-gfm（报告渲染）
- **导出**：jspdf（PDF）+ docx（DOCX）
- **验证**：Zod 4.3.6（Schema 验证）
- **测试**：Vitest（单元）+ Playwright（E2E）
- **目录**：`app/`（页面）、`components/`（UI）、`lib/`（核心库）

### 后端 RAG 服务（Python）

- **框架**：FastAPI + LangGraph 1.1.6
- **语言**：Python 3.10+
- **向量检索**：FAISS（IndexFlatIP）+ BM25（jieba 分词）
- **Embedding**：Ollama nomic-embed-text（本地，768维）→ ModelScope Qwen3-Embedding-0.6B（云端，1024维）
- **LLM**：MiniMax-M3（Anthropic SDK，兼容 MiniMax/anthropic 端点）
- **PDF 解析**：pdfplumber
- **目录**：`rag_service/`（FastAPI 服务）、`data/`（语料和索引）

---

## 关键约定

### 端口与地址

| 服务 | 地址 |
|------|------|
| 前端（Next.js） | `http://localhost:3000` |
| RAG Service（FastAPI） | `http://localhost:8001` |
| Ollama（本地 Embedding） | `http://localhost:11434` |

> **重要**：前端调用 RAG 服务时使用端口 **8001**（不是 8000），配置在 `RAG_SERVICE_URL` 环境变量，代码见 `lib/pipeline/scan.ts`。
> docker-compose 映射为 `8001:8000`（容器内 8000，宿主机 8001）。

### 多市场支持

- 默认市场：`EU`, `US`
- 支持列表：`EU` / `US` / `UK` / `CN` / `AU` / `SA` / `AE` / `JP` 等
- LangGraph `Send()` fan-out 实现多市场并行检索

### 会话存储

- **内存层**：`globalThis.__scanStore`（Map，TTL 1小时）
- **文件层**：`data/sessions/{sessionId}.json`（JSON 文件持久化）
- 代码：`lib/pipeline/session-store.ts`
- `lib/pipeline/scan.ts` 调用 `createSession()` / `updateSession()`

### 降级模式

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| DEMO_MODE | `DEMO_MODE=true` 环境变量 | 使用 Mock 数据，无需 API Key |
| Embedding 降级 | Ollama 不可用 | 自动降级到 ModelScope Qwen3-Embedding |
| BM25 Only | Ollama + ModelScope 均不可用 | 纯稀疏检索 |
| NLI 降级 | NLI 模型不可用 | 降级为文本重叠法 |
| RAG 服务不可用 | 无法连接 localhost:8001 | 前端自动降级到 Demo 模式 |

### 前端调用 RAG 服务流程

```
用户上传图片
  → POST /api/scan（Next.js API route）
      → lib/pipeline/scan.ts
          → fetch(RAG_SERVICE_URL/scan, ...)
          → 创建 session → 返回 sessionId
  → 前端轮询 GET /api/scan/{sessionId}
      → lib/pipeline/session-store.ts
          → 读取 globalThis.__scanStore + 文件
```

---

## 目录结构

```
attrax/
├── app/                    # Next.js App Router（页面）
│   └── api/              # Next.js API 路由（/api/scan）
├── components/             # React 组件
│   ├── ui/               # shadcn/ui 组件（Button, Card 等）
│   ├── burning/          # 扫描中动画页
│   ├── flame/            # 火焰动画组件
│   ├── result/           # 结果展示组件
│   │   └── ProfitReportView.tsx  # 成本利润报告视图（含 PDF/DOCX 导出）
│   └── upload/           # 上传组件
├── lib/                   # 核心库
│   ├── schemas.ts         # Zod Schema（StartScanRequestSchema 等）
│   ├── types.ts           # TypeScript 类型（Market, ProductCategory, ScanStatus, ProfitReportResult, CostSummary）
│   ├── utils.ts           # 通用工具函数
│   ├── report-export.ts   # 报告导出（合规+利润，PDF/DOCX，含 Markdown 解析）
│   ├── pipeline/
│   │   ├── scan.ts        # 扫描管线（调用 RAG 8001）
│   │   └── session-store.ts  # 会话存储（globalThis.__scanStore）
│   ├── mock/
│   │   └── scan-result.ts # Demo 模式模拟数据
│   └── hooks/
│       └── useScanPolling.ts  # 轮询 hook
├── rag_service/           # Python RAG 服务
│   ├── main.py            # FastAPI 入口（/scan, /health）
│   ├── config.py          # settings（环境变量读取）
│   ├── orchestrator/      # LangGraph 编排
│   │   ├── graph.py      # StateGraph 装配
│   │   ├── state.py      # GraphState 定义
│   │   └── nodes/        # 节点（vision/query_planner/retriever/generator/verifier/refiner）
│   ├── retrieval/        # 检索管线
│   │   ├── hybrid_retriever.py    # 混合检索主类
│   │   ├── faiss_retriever.py     # FAISS 向量检索
│   │   ├── bm25_retriever.py      # BM25 稀疏检索
│   │   ├── local_embedder.py      # 本地 embedder（Ollama nomic-embed-text）
│   │   ├── ollama_embedder.py      # Ollama Embedding（fallback）
│   │   ├── modelScope_embedder.py # ModelScope Qwen3-Embedding
│   │   ├── cohere_embedder.py     # Cohere Embedding
│   │   ├── cohere_reranker.py     # ⚠️ 已实现但未接入管线
│   │   └── fusion.py             # 多检索结果融合
│   ├── parser/           # 文档解析
│   │   ├── docx_parser.py        # DOCX 解析
│   │   └── html_parser.py        # HTML 解析
│   ├── verify/
│   │   └── citation_verifier.py  # NLI 引用验证（软门）
│   ├── generate/
│   │   └── report_generator.py  # LLM 报告生成（Anthropic SDK）
│   ├── chunker/
│   │   └── legal_chunker.py     # Parent-Child 法律分块
│   └── tests/             # pytest 单元测试
├── data/                  # 数据文件
│   ├── faiss/            # FAISS 索引（legal_chunks.index）
│   ├── corpus/           # 语料库（按地域组织）
│   │   ├── asia/         # 东南亚法规（indonesia/malaysia/singapore/thailand/vietnam）
│   │   ├── cn/           # 中国法规
│   │   ├── eu/           # 欧盟法规（regulations/html/products/）
│   │   ├── gcc/          # 海湾国家（G-Mark 等）
│   │   ├── intl/         # 国际组织（WIPO/UN 等）
│   │   ├── middle_east/  # 中东（saudi/uae）
│   │   ├── us/           # 美国法规
│   │   └── screenshot_pending/  # 截屏 PDF（待 OCR 处理）
│   ├── analysis/         # 数据分析脚本输出（pdf_analysis.json 等）
│   ├── mock-fixtures/    # Mock 测试数据
│   └── sessions/         # 会话文件（TTL 1小时）
├── tests/                # 前端测试
│   ├── unit/             # Vitest 单元测试
│   ├── e2e/              # Playwright E2E 测试
│   └── setup.ts          # 测试配置
├── public/               # 静态资源
│   ├── uploads/          # 用户上传文件（临时）
│   ├── mock-fixtures/    # Mock 静态资源
│   └── brand/            # 品牌资产
├── docs/                 # 文档
│   └── RAG-ARCHITECTURE-v3.md  # RAG 架构文档（当前）
└── scripts/              # 运维脚本（start_rag.bat 等）
```

---

## 代码规范

### 不可变模式（CRITICAL）

始终返回新对象，不修改现有对象：

```typescript
// ❌ WRONG：Mutation
function updateSession(session, updates) {
  Object.assign(session, updates);
  return session;
}

// ✅ CORRECT：Immutable
function updateSession(session: ScanStatus, updates: Partial<ScanStatus>): ScanStatus {
  return { ...session, ...updates };
}
```

### 小函数原则

- 函数不超过 50 行
- 文件不超过 800 行
- 超过则拆分为多个文件/函数

### Zod Schema 验证

所有用户输入在系统边界验证：

```typescript
import { z } from "zod";

const StartScanRequestSchema = z.object({
  category: z.enum(["electronics", "toys", "battery", "textiles"]),
  markets: z.array(z.enum(["EU", "US", "UK", "CN", "AU", "SA", "AE"])),
  imageCount: z.number().int().min(1),
  documentCount: z.number().int().min(0).max(5),
});
```

### API 响应格式

```typescript
// 成功
{ "success": true, "data": { ... } }
// 错误
{ "success": false, "error": { "code": "BAD_INPUT", "message": "请至少上传 1 张图片。" } }
```

---

## 环境变量清单

### 前端（`.env.local`）

| 变量 | 默认值 | 必填 | 说明 |
|------|--------|------|------|
| `MIMOTALK_API_KEY` | - | 是 | LLM API Key（MiniMax-M3） |
| `MIMOTALK_BASE_URL` | `https://api.minimaxi.com/anthropic/v1` | 否 | Anthropic 兼容 LLM 端点 |
| `MIMOTALK_MODEL` | `MiniMax-M3` | 否 | 模型名称 |
| `MODELSCOPE_API_KEY` | - | 否 | ModelScope Embedding API Key |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | 否 | Ollama 地址 |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | 否 | Ollama Embedding 模型 |
| `RAG_SERVICE_URL` | `http://localhost:8001` | 否 | RAG 服务地址 |
| `DEMO_MODE` | `false` | 否 | Demo 模式（Mock 数据） |
| `DAILY_FREE_SCAN_LIMIT` | `3` | 否 | 每日免费次数 |
| `VISION_PROVIDER` | `mimo` | 否 | Vision AI 提供商 |

### RAG 服务（`rag_service/.env`）

同上前端变量（Ollama、ModelScope 等），RAG 服务从 `rag_service/.env` 读取。

---

## 已知限制

| 限制 | 说明 |
|------|------|
| **无持久化** | 会话仅存储 1 小时（内存 + 文件 TTL），无数据库 |
| **无用户系统** | 无登录/注册/权限控制 |
| **cohere_reranker 未接入** | `cohere_reranker.py` 已实现，但管线中未调用 |
| **截屏 PDF 待 OCR** | `data/corpus/screenshot_pending/` 下约 20 个 PDF 截屏未处理 |
| **无多语言** | 报告目前仅中文输出 |

---

## 常用命令

```bash
# 前端
npm run dev                    # 启动前端（3000）
npm run build                  # 构建生产版本
npm run test                   # Vitest 单元测试
npm run test:e2e              # Playwright E2E 测试

# RAG 服务
D:\python\python.exe -m uvicorn rag_service.main:app --reload --port 8001

# Python 测试
D:\python\python.exe -m pytest rag_service/tests/ -v

# 一键启动
start-all.bat                  # 前端 + RAG 同时启动
scripts\start_rag.bat         # 仅启动 RAG 服务
```

---

## 文档索引

- `docs/README.md` — 文档索引和快速开始指南
- `docs/PROJECT.md` — 项目描述和技术栈
- `docs/PRD.md` — 产品需求文档
- `docs/RAG-ARCHITECTURE-v3.md` — RAG 技术架构详情（当前）
- `docs/DOCUMENT-PIPELINE.md` — 语料库构建流程
- `docs/PROJECT-STATUS.md` — 上线评估报告
- `docs/archived/` — 历史归档文档

---

*最后更新：2026-06-19*