# CLAUDE.md — 火鹰合规 (Attrax)

> 项目配置和约定说明，供 AI 编码助手使用。

---

## 项目概述

- **项目名称**：火鹰合规（Blaze Hawks / Attrax）
- **核心功能**：跨境电商合规风险智能扫描平台（基于规则知识库 + 法规原文 + LLM 生成的 KB 锚定架构）
- **一句话**：用户上传产品图片，AI 自动识别类别和市场，结合多市场法规知识库生成带精确引用的合规报告

---

## 技术栈

### 前端（Next.js）

- **框架**：Next.js ^16.2.6 + React 19.2.4 + TypeScript（strict）
- **样式**：Tailwind CSS 4.x + shadcn/ui 4.4.0
- **动画**：framer-motion 12.38.0
- **Markdown**：react-markdown + remark-gfm（报告渲染）
- **导出**：jspdf（PDF）+ docx（DOCX）
- **验证**：Zod 4.3.6（Schema 验证）
- **测试**：Vitest（单元）+ Playwright（E2E）
- **目录**：`app/`（页面）、`components/`（UI）、`lib/`（核心库）

### 后端 RAG 服务（Python）

- **框架**：FastAPI 0.115.6（线性 3 步管线：vision → generate → verify；LangGraph 已于 de-RAG §7.7 塌缩移除）
- **语言**：Python 3.10+
- **Embedding**：阿里云 PAI `text-embedding-v4`（1024 维，生产唯一路径）。2026-09-10 由 ModelScope Qwen3-Embedding-0.6B 切换（Key 吊销）；⚠️ PAI batch≤10 硬限（超限 400）
- **LLM**：MiniMax-M3（Anthropic SDK，端点 `https://api.minimaxi.com/anthropic/v1`）
- **检索**：不再走向量检索——当前是 **规则知识库（must_check）+ KB 锚点（kb_loader）+ 法规原文（article_loader）** 三段式
- **PDF 解析**：pdfplumber
- **目录**：`rag_service/`（FastAPI 服务，端口 8001）、`data/`（语料、profile、监管补充包）

---

## 关键约定

### 端口与地址

| 服务 | 地址 |
|------|------|
| 前端（Next.js） | `http://localhost:3000` |
| RAG Service（FastAPI） | `http://localhost:8001` |

> **重要**：前端调用 RAG 服务时使用端口 **8001**（不是 8000），配置在 `RAG_SERVICE_URL` 环境变量，代码见 `lib/rag-client/client.ts`。
> docker-compose 映射为 loopback-only `127.0.0.1:${RAG_PORT:-8001}:8000`（容器内 8000，宿主机 8001）。

### 多市场支持

- **市场**：`EU` / `UK` / `US` / `CN` / `AU` / `SA` / `AE` / `JP` 等
- **品类（2026-09-10 起 10 个）**：`electronics` / `toys` / `battery` / `textiles` / `cosmetic` / `food_contact` / `appliance` / `3c` / `home` / `other`
- **特征横切**（must_check）：`battery` / `wireless` / `mains` / `children`
- 默认市场：`EU`, `US`

### 会话存储

- **服务端**：RAG 服务自管会话（`rag_service/` FastAPI + 文件后端）
- 前端代码：`lib/rag-client/v1-adapter.ts`（创建扫描）/ `lib/rag-client/client.ts`（HTTP 封装）/ `app/api/scan/route.ts`（BFF 路由）
- `lib/pipeline/` 当前文件：`session-auth`、`demo-scan-session`、`report-package`、`profit-report`——全部活跃服务于 demo 路径与 BFF 报告导出

### 降级模式

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| DEMO_MODE | `DEMO_MODE=true` 环境变量 | 使用 Mock 数据，无需 API Key |
| Embedding 降级 | PAI API 不可用 | 当前**无**自动 fallback（探测仅含 PAI）；Embedding 失败会直接报错而非降级 |
| 引用验证 | 生产环境（无 NLI 模型） | deterministic quote matching：`verify/quote_matcher.py` 对 LLM 引用的法规条款做反向字面匹配，返回每条引用的 `match_status`；`verification_mode` 字段 + `/health` 暴露真实模式 |
| RAG 服务不可用 | 无法连接 localhost:8001 | 前端降级为 degraded 状态 + 红色横幅提示（sessionPayload 暴露 degradedReason，非静默 demo） |

### 前端调用 RAG 服务流程

```
用户上传图片
  → POST /api/scan（Next.js API route）
      → lib/rag-client/v1-adapter.ts（createScan）
          → fetch(RAG_SERVICE_URL/api/v1/scans, ...)   # RAG 服务自管会话/队列
          → 返回 sessionId + accessToken（Set-Cookie + Bearer）
  → 前端轮询 GET /api/scan/{sessionId}
      → lib/rag-client/v1-result-adapter.ts（getScan）→ RAG /api/v1/scans/{id}
  → 结果页渲染：app/result/[sessionId]/page.tsx（use-result-loader 轮询 hook）

  → 补充证据（可选）：POST /api/scan/{sessionId}/evidence + /revisions
      → ScanService.append_evidence / request_revision（2026-09-14 J10）
```

---

## 目录结构

```
attrax/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # 首页
│   ├── layout.tsx                # 根布局（BlazeLocaleProvider）
│   ├── [locale]/page.tsx         # i18n 首页变体
│   ├── upload/page.tsx           # 上传页
│   ├── burning/[sessionId]/      # 扫描中动画页
│   ├── result/[sessionId]/       # 结果页（合规 + 利润 + 决策 + 路线图）
│   │   └── use-result-loader.ts  # 结果页轮询 hook
│   ├── profit/[sessionId]/       # 利润独立页面
│   ├── pricing/page.tsx          # 商业方案
│   ├── regulations/page.tsx      # 法规更新列表
│   └── api/                      # Next.js API 路由
│       ├── scan/route.ts         # POST /api/scan — 创建扫描
│       ├── scan/[sessionId]/     # GET 轮询 + asset/[index] + evidence + revisions
│       ├── backend-session-access.ts  # 会话访问 token 校验（session-auth）
│       ├── regulations/updates/  # GET 法规更新
│       ├── regulations/[docId]/  # GET 单条法规原文（evidence-pack 引用）
│       └── health/               # GET 健康检查
│
├── components/                   # React 组件
│   ├── ui/                       # shadcn/ui 基础组件
│   ├── blaze-hawks/              # BlazeLocaleProvider（locale 真值源）+ 品牌 UI
│   ├── result/                   # 结果展示
│   │   ├── ComplianceReportView.tsx
│   │   ├── EvidenceRequestPanel.tsx     # J10 补充证据 UI（2026-09-14）
│   │   ├── InspectionChecklistPanel.tsx # J02/J09 语义检查
│   │   ├── FloatingEvidenceCrop.tsx / HotspotLayer.tsx / ObservationHotspotLayer.tsx
│   │   ├── AgentTraceView.tsx
│   │   └── DegradedBanner / SourceNotice / FallbackNotice / DownloadButtons / ImageCarousel
│   └── regulation/               # CitationChip / DocViewer / LinkBackToReport
│
├── lib/                          # 核心库
│   ├── types.ts                  # TS 类型（Market/ProductCategory/ScanStatus/...）
│   ├── schemas.ts                # Zod Schema
│   ├── utils.ts                  # 工具函数
│   ├── constants.ts              # 共享常量（超时/限额/限流）
│   ├── api-response.ts           # API 响应信封（ok/fail/unwrapApiData）
│   ├── i18n.tsx                  # 前端 i18n hook（useTranslation；locale 取自 BlazeLocaleProvider）
│   ├── i18n/translations.ts      # zh/en 文案表
│   ├── complipilot/              # 规航AI 品牌文案 / 扫描阶段 / 场景
│   ├── rate-limit.ts             # 限流
│   ├── upload-validation.ts      # 上传文件校验
│   ├── report-localization.ts    # 报告字段本地化
│   ├── report-export.ts          # 报告导出入口（仅 downloadEvidencePack 实际被引）
│   ├── report-download.ts        # 报告导出（动态导入，lazy loading）
│   ├── report-export-modules/    # 报告导出实现（compliance / profit / decision / roadmap / shared / evidence-pack；客户端 jsPDF/Packer，无 API 路由）
│   ├── result-view-helpers.ts    # 结果页视图助手
│   ├── pipeline/                 # demo 会话 + BFF 报告导出（4 文件，全部活跃）
│   │   ├── session-auth.ts       # 会话访问 token（哈希 + 校验）
│   │   ├── demo-scan-session.ts  # demo 模式会话
│   │   ├── report-package.ts     # 报告包结构归一化（normalizeReportPackage）
│   │   └── profit-report.ts      # 利润报告合成 + RenderModel
│   ├── mock/                     # Demo 模式模拟数据（blaze-scan-result / blaze-scenario / scan-result / roadmap / blaze-copy）
│   ├── hooks/useScanPolling.ts   # 轮询 hook
│   ├── rag-client/               # 前端 RAG 客户端
│   │   ├── v1-adapter.ts          # 创建扫描 / 轮询
│   │   ├── v1-result-adapter.ts  # 结果字段映射
│   │   ├── evidence-api.ts       # 补充证据 API
│   │   ├── client.ts             # HTTP 封装
│   │   ├── errors.ts             # 错误类型
│   │   ├── response-schemas.ts   # Zod response
│   │   ├── report-package-schema.ts
│   │   ├── openapi.snapshot.json # 从运行中 RAG 服务抓取的 OpenAPI
│   │   └── types.gen.ts          # 自动生成的 TS 类型
│   └── upload/category-manifest.ts  # 上传品类清单（该目录唯一文件）
│
├── rag_service/                  # Python RAG 服务（FastAPI，端口 8001）
│   ├── main.py                   # FastAPI 入口（/api/v1/* 端点）
│   ├── config.py                 # settings（环境变量读取）
│   ├── application/scans.py      # 扫描生命周期 + 证据/重扫逻辑
│   ├── api/v1.py                 # /api/v1/scans + /evidence + /revisions
│   ├── infrastructure/file_backend.py
│   ├── pipeline/                 # 线性 3 步管线 vision → generate → verify（LangGraph 形态已于 de-RAG §7.7 塌缩移除）
│   │   ├── runner.py             # 编排入口
│   │   ├── state.py              # 状态定义
│   │   └── nodes/                # vision / generator / verifier / findings_builder / visual_checks
│   ├── retrieval/                # 知识库锚定三件套
│   │   ├── must_check.py         # CATEGORY_REGULATIONS（10 品类×7 市场）+ FEATURE_REGULATIONS
│   │   ├── kb_loader.py          # 锚点 YAML 加载
│   │   └── article_loader.py     # 法规原文 + 摘要解析
│   ├── verify/                   # 验证层
│   │   ├── applicability.py      # 三态 ProductFacts（confirmed/candidate/absent）
│   │   ├── grounding.py          # grounding verifier
│   │   ├── quote_matcher.py      # 引用反向字面匹配（deterministic，每条 citation 返回 match_status）
│   │   └── vision_cache.py       # 视觉结果 LRU 缓存
│   ├── schemas/                  # Pydantic
│   │   ├── report_package.py
│   │   └── visual_inspection.py
│   ├── generate/
│   │   ├── report_generator.py   # LLM 报告生成
│   │   └── prebuilt_profit_data.py
│   ├── parser/                   # docx / html 解析
│   ├── regulation_collectors/    # 法规离线采集（base / eu_rdf / powershell_fetcher）
│   └── tests/                    # pytest 单元测试
│
├── data/                         # 数据文件
│   ├── regulations/              # 44 篇锚点法规 YAML（生产只读）
│   ├── kb/                       # KB 锚点 YAML
│   ├── inspection_profiles/      # 视觉检查 profile（11 个 yaml）
│   ├── regulation_sources/       # 法规数据源注册表
│   ├── regulation_supplements/   # watchdog 自动入库包 + manifest（⚠️ */raw/ 原件 PDF/DOCX/HTML 不纳入版本控制，约 400MB，见 .gitignore）
│   ├── regulation_eval/ + regulation_reports/  # 法规评测与报告产物
│   └── corpus/                   # 法规语料 HTML（运行时由 watchdog 维护）
│   # 运行时目录（gitignore，不入库）：data/sessions/（TTL 1h）、data/backend/、data/uploads/
│
├── tests/                        # 前端测试
│   ├── unit/                     # Vitest 单元测试
│   ├── e2e/                      # Playwright E2E
│   ├── pressure/                 # 压力测试脚本（improved-load-test.js）
│   └── setup.ts
│
├── public/                       # 静态资源（fonts/NotoSansSC-Regular.ttf 17MB 不入库，服务器自备）
├── docs/                         # 项目文档（详见 docs/README.md）
│   ├── plans/                    # 修复计划与设计 spec
│   │   ├── 2026-09-11-de-rag-evidence-spec.md  # de-RAG 迁移路线（执行基准）
│   │   ├── 2026-09-14-judge-review-and-optimization-plan.md  # 当下优化方向
│   │   └── 2026-09-09-optimization-audit.md    # 已完成的审计
│   ├── evidence/                 # 评测与生产证据（历史截图 / DOM 快照）
│   ├── infra/                    # 服务器配置快照
│   └── FRONTEND-BACKEND-INTEGRATION.md  # 当前 API 契约源（替代已过时的 API-CONTRACT.md）
└── scripts/                      # 运维脚本
    ├── build-deploy-tarball.sh   # 部署 tarball 构建（自动写 .deployed 标识）
    ├── preflight-deploy.mjs
    ├── ingest_regulation_supplements.py  # watchdog 流水线
    ├── watchdog/                 # 法规自动入库守护
    ├── ecosystem.config.cjs      # pm2 配置
    └── eval_grounding.py + report_regulation_coverage.py
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
  category: z.enum(["electronics", "toys", "battery", "textiles", "cosmetic", "food_contact", "appliance", "3c", "home", "other"]),
  markets: z.array(z.enum(["EU", "US", "UK", "CN", "AU", "SA", "AE", "JP"])),
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
| `MINIMAX_API_KEY` | - | 是 | LLM API Key（兼容旧 `MIMOTALK_API_KEY`） |
| `MINIMAX_BASE_URL` | `https://api.minimaxi.com/anthropic/v1` | 否 | Anthropic 兼容 LLM 端点 |
| `MINIMAX_MODEL` | `MiniMax-M3` | 否 | 模型名称 |
| `PAI_API_KEY` | - | 是（非 Demo） | 阿里云 PAI Embedding API Key（2026-09-10 从 ModelScope 切换） |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | 否 | Ollama 地址（备用，未接入探测） |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | 否 | Ollama Embedding 模型（备用） |
| `RAG_SERVICE_URL` | `http://localhost:8001` | 否 | RAG 服务地址 |
| `DEMO_MODE` | `false` | 否 | Demo 模式（Mock 数据，无需 API Key） |
| `DAILY_FREE_SCAN_LIMIT` | `3` | 否 | 每日免费扫描次数 |
| `ATTRAX_BUILD_SHA` | - | 否 | 当前部署 commit SHA（pydantic-settings 读取，写在 `rag_service/.env`） |

### RAG 服务（`rag_service/.env`）

同上前端变量（Ollama、PAI、LLM 等），RAG 服务从 `rag_service/.env` 读取。

### 关键 RAG 服务环境变量

| 变量 | 说明 |
|------|------|
| `RAG_ALLOWED_ORIGINS` | CORS 白名单（逗号分隔） |
| `RAG_INTERNAL_SECRET` | BFF ↔ RAG 内部认证密钥（fail-closed：prod 空 secret 拒绝启动） |
| `ATTRAX_BUILD_SHA` | 当前部署 commit SHA |
| `SCAN_WORKER_CONCURRENCY` | 扫描 worker 并发数（默认 **5**，见 `config.py`） |

---

## 已知限制

| 限制 | 说明 |
|------|------|
| **无持久化** | 会话仅存储 1 小时（内存 + 文件 TTL），无数据库 |
| **无用户系统** | 无登录/注册/权限控制（Demo 模式有访问 token 校验） |
| **Embedding 单点** | PAI API 是唯一路径，无 Ollama 自动 fallback |
| **requirements 快照** | 生产安装用 `requirements-prod.txt`；原 `requirements.txt`（500+ 条）已改名 `requirements-snapshot.txt` 并标注勿安装 |
| **无多语言报告** | 报告目前仅中文输出 |
| **agent_trace 乘法级复制风险** | Send() fan-out + refine 循环下 trace 指数增长（默认 max_attempts=2 安全；配置不当会 OOM 而非平滑触发 recursion_limit），待修 |
| **rag-service 单 worker 内存波动** | 多市场 BM25 索引构建会推高 RSS 到 ~960MB；已通过 `ecosystem.config.cjs` 把 `max_memory_restart` 调到 1300M（留 300MB 给 nextjs+系统，超出走 swap）。单 worker 仍是瓶颈：并发扫描会串行等待 |

---

## 最近修复

### 2026-09-14 — Judge review batches A + A1 + B1 + C2（cdb069f / 6b57148 / 58dbbf8）

9-14 spec 冻结（`docs/plans/2026-09-14-judge-review-and-optimization-plan.md`，11 节 J01–J11）。已实现：
- **Batch A**（6b57148）：J04 citation contract、J05 unverified default、J06 CJK evidence-pack、J07 fine numbers removed、J11 title fallback
- **Batch A1**（58dbbf8）：J01 progress terminal-state contract（`resultReady` + `completing` state）
- **Batch B1 + C2**（cdb069f）：J02/J09 semantic inspection checks + J10 evidence/revision loop（POST `/api/v1/scans/{id}/evidence` + `/revisions`；UI `EvidenceRequestPanel`）

### 2026-09-13 — Visual inspection batch D+E + 部署回归修复（e1244aa / 1698d67 / 3a8dc1a / b6cea17）

- **Batch D**（e1244aa）：适用性引擎（`applicability.py`）、确定性 findings（`findings_builder.py`，零 LLM 参与）、视觉缓存（`vision_cache.py`）
- **Batch E**（e1244aa）：mask contract（`FloatingEvidenceCrop` maskUrl）、`scripts/eval_grounding.py` 评测工具、`docs/annotation/grounding-eval.md` 标注格式
- **ATTRAX_BUILD_SHA via pydantic-settings**（1698d67）：`pm2 restart` 即生效，专门避开 pm2 env 雷区
- **生产回归修复**（3a8dc1a + b6cea17）：
  - `_parse_vision_text` 结构化分支丢 `observations` key → 透传
  - 六个管线节点被误判为风险 → 按精确 `node.id` 匹配
  - 零风险扫描被错送 `ResultIncompletePanel` → 修正守卫（有 observations/findings 层就正常渲染）

### 2026-09-11 — De-RAG 架构 spec 冻结（未实施）

第一性原理审查结论：**完全去掉 RAG**（embedding + 向量检索 + BM25 + LangGraph），改为 **Knowledge-Anchored Generation**。LangGraph 编排壳已按 §7.7 塌缩为线性 3 步管线（vision → generate → verify）；must_check + KB 是主路径，PAI 仍承担 embedding 类辅助调用。完整规格：`docs/plans/2026-09-11-de-rag-evidence-spec.md`。

### 2026-09-10 — A+B 混合架构 + 审计批处理

- **must_check 升主源**（e4da8d5）：规则矩阵作为报告主锚点，语料检索只是补充引用
- **PAI embedding 切换**：ModelScope key 吊销 → 阿里云 PAI `text-embedding-v4`
- **品类 6→10**：+battery / cosmetic / textile / food_contact
- **审计批处理**：删除死代码 `lib/pipeline/scan.ts` + `scan-queue.ts` + `LegacyResultView` 及其测试；P0-1~P0-6 + P1-1~P1-8 全部修复；验证 vitest 914 + pytest 562 全绿
- 详见 `docs/plans/2026-09-09-optimization-audit.md`

### 2026-07-18 — 服务器事故 + 修复

- **症状**：服务器 load 飙到 111、可用内存 58MB、公网 HTTPS 502、前端疯狂 400（`Failed to find Server Action`，BUILD_ID 与浏览器不匹配）
- **真根因（2 层）**：
  1. 前端 BUILD_ID 旧，浏览器 Server Action ID 与新版不匹配 → 扫描提交 400 + 反复重试
  2. rag-service `--workers 1` + 扫描 280s 超时（LLM `json.loads failed` 反复重试）→ 单 worker 被卡 + 内存涨到 960MB → `max_memory_restart: 900M` 过低 → pm2 频繁重启 → meta.json 95MB 未分片全量加载加剧崩溃循环
- **运维修复（已落地）**：
  - meta.json 95MB 分片：`FaissRetriever.split_meta_to_shards('data/faiss/legal_chunks_meta.json', 50)` → 50 分片各 ~3MB，加载器自动识别（⚠️ 历史记录：`data/faiss/` 与 `FaissRetriever` 已随 de-RAG 于 2026-09 移除，此条仅为事故存档）
  - `max_memory_restart: 900M → 1300M`（rag-service，留 300MB 给 nextjs+系统，超出走 4GB swap）

---

## 部署雷区

- **`pm2 restart` 不读 env 段**：只换代码 / 静态 → `pm2 restart` 足够；换 env（PM2 ecosystem env 段、cwd）→ 必须 `pm2 delete && start`，`restart` 不重读
- **换 `.env` 文件**：`pm2 restart` 即可（pydantic-settings 每次启动读 .env）；换 ecosystem env 段才需要 delete && start
- **Next 16 + Turbopack `output: "standalone"` 不复制 `.next/static/`**（Next 15 还会这么做）：standalone/ 里只有 server.js + 路由 manifest + 最小 node_modules；**部署时必须分别 rsync/tar `.next/standalone/` 和 `.next/static/` 两份到服务器**
- **`standalone/public/` 不存在**（Next 16 standalone 不复制）：必须 `ln -sfn /opt/attrax/public /opt/attrax/.next/standalone/public`，否则 `/complipilot/*` 全部 404
- **裸 `pm2 start server.js --name nextjs --cwd .next/standalone` 会丢 env**：必须用 `pm2 start scripts/ecosystem.config.cjs --only nextjs` 让 env 块注入
- **nginx `_next/static/` 用 `alias <root>/.next/static/`**（不用 snippet 的 `root $nextjs_root`）：Next 16 下 standalone/ 没有 `.next/static/`，URI 映射不到文件
- **`/api/health` 200 不代表 BFF→rag auth 通**：还要跑一次真实扫描（提交 + 轮询 + 看结果）才能确认 `RAG_INTERNAL_SECRET` 等关键 env 生效
- **`openrsync` 大目录会崩**：`.next/standalone` 用 `tar -C .next -czf - X | ssh lighthouse 'tar -xzf -'`；小目录 rsync OK
- **服务器 git HEAD 落后**：deploy 流程只 rsync/tar **runtime 产物**，从不 `git pull`。要同步 git 用 `git bundle create /tmp/X.bundle old..new && scp && ssh fetch`

---

## 常用命令

```bash
# 前端
npm run dev                    # 启动前端（3000）
npm run build                  # 构建生产版本（生成 .next/standalone/ + .next/static/）
npm run test                   # Vitest 单元测试
npm run test:e2e              # Playwright E2E 测试
npm run lint                   # ESLint
npm run typecheck              # tsc --noEmit

# RAG 服务
python3 -m uvicorn rag_service.main:app --reload --port 8001
python3 -m pytest rag_service/tests/ -v

# 一键启动
pm2 start scripts/ecosystem.config.cjs   # 前端 + RAG 同时启动
```

---

## 文档索引

- `README.md` — 项目入口 + 快速上手 + 架构图 + 部署要点
- `docs/README.md` — 文档目录
- `docs/FRONTEND-BACKEND-INTEGRATION.md` — 当前 API 契约源（替代过时的 `API-CONTRACT.md`）
- `docs/plans/2026-09-11-de-rag-evidence-spec.md` — de-RAG 迁移路线（执行基准）
- `docs/plans/2026-09-14-judge-review-and-optimization-plan.md` — 当前优化方向
- `docs/plans/2026-09-09-optimization-audit.md` — 已完成的审计
- `docs/README.md` §生产部署 — 部署入口（lighthouse git-bundle + tar 流程）
- `CHANGELOG.md` — 历史修复 + 事故记录

---

*最后更新：2026-09-14*

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.