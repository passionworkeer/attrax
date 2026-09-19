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
- **样式**：Tailwind CSS 4.x + shadcn/ui 4.4.0 + `@base-ui/react` + lucide-react
- **Markdown**：react-markdown + remark-gfm（报告渲染）
- **导出**：jspdf（PDF）+ docx（DOCX）
- **验证**：Zod 4.3.6（Schema 验证）
- **测试**：Vitest（单元）+ Playwright（E2E）
- **目录**：`app/`（页面）、`components/`（UI）、`lib/`（核心库）
- 注：`framer-motion` / `next-themes` / `ulid` / `sonner` / `@anthropic-ai/sdk` 已于 2026-09-17 从依赖中移除（无任何 importer）；动画/主题现在走 CSS + `tw-animate-css`

### 后端 RAG 服务（Python）

- **框架**：FastAPI 0.115.6（线性 3 步管线：vision → generate → verify；LangGraph 已于 de-RAG §7.7 塌缩移除）
- **语言**：Python 3.10+
- **Embedding**：**无**——embedding 栈（PAI/ModelScope）已随 de-RAG §7.7 整体删除，`_current_embedding_provider()` 保留 stub 恒返 `"none"`。任何文档/配置提到 PAI_API_KEY 都是过时的（无代码读取）
- **LLM**：通过 `LLM_*` 配置 Anthropic 兼容主模型；本地可使用 Qwen，`MINIMAX_*` / `MIMOTALK_*` 仅作兼容别名
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

> **重要**：前端调用 RAG 服务时使用端口 **8001**（不是 8000），配置在 `RAG_SERVICE_URL` 环境变量，代码见 `lib/rag-client/v1-adapter.ts`（唯一的 RAG HTTP 封装；旧的 `rag-client/client.ts` 已删除）。
> docker-compose 映射为 loopback-only `127.0.0.1:${RAG_PORT:-8001}:8000`（容器内 8000，宿主机 8001）。

### 多市场支持

- **市场**：16 个 — `EU` / `US` / `UK` / `CN` / `AU` / `SA` / `AE` / `JP` / `KR` / `CA` / `SG` / `MX` / `BR` / `DE` / `FR` / `IT`（见 `lib/types.ts:MARKET_IDS` + `rag_service/config.py:ALLOWED_MARKETS`；2026-09-13 P0-5 audit 把 BFF/RAG allow-list 同步对齐）
- **品类**：`electronics` / `toy` / `battery` / `textile` / `cosmetic` / `food_contact` / `appliance` / `3c` / `home` / `other`（共 10 个，**单数**；`lib/types.ts` / `data/kb/anchors/*.yaml` 全部用单数。旧文档里的 `toys` / `textiles` 是 typo）
- **特征横切**（must_check）：`battery` / `wireless` / `mains` / `children`
- 默认市场：`EU`, `US`

### 会话存储

- **服务端**：RAG 服务自管会话（`rag_service/` FastAPI + 文件后端）
- 前端代码：`lib/rag-client/v1-adapter.ts`（创建扫描 / 轮询 / 证据，含 HTTP 封装）/ `app/api/scan/route.ts`（BFF 路由）
- `lib/pipeline/` 当前文件：`session-auth`、`demo-scan-session`、`profit-report`——全部活跃服务于 demo 路径与 BFF 报告导出

### 降级模式

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| DEMO_MODE | `DEMO_MODE=true` 环境变量 | 使用 Mock 数据，无需 API Key |
| 识图供应商 | 主模型视觉调用返回空（超时 / 网络 / 4xx / 5xx） | 同一张图的观察请求降级到 `DEEPSEEK_*`（OpenAI 兼容 `/chat/completions`，`deepseek-flash`）。未配置 key = 降级关闭，保持 `vision_call_failed` 行为 |
| 报告生成 | 主模型 `/messages` 调用失败（超时 / 4xx / 5xx，或返回非 JSON） | 同一份 prompt 重发到 DeepSeek 的 **Anthropic 兼容**端点（`DEEPSEEK_ANTHROPIC_BASE_URL`，注意含 `/v1`），`ragProvider` 如实写 `deepseek`。两条都不通才退回 mock 包 + `degraded` |
| Embedding | （已删除） | de-RAG §7.7 后无 embedding 调用，不存在降级路径 |
| 引用验证 | 生产环境 | deterministic quote matching：`verify/quote_matcher.py` 对 LLM 引用的法规条款做反向字面匹配，返回每条引用的 `match_status`；逐扫描的 `report_package.auditMetadata.verificationMode` 字段暴露真实模式（不在 `/health` 上） |
| RAG 服务不可用 | 无法连接 localhost:8001 | 前端降级为 degraded 状态 + 红色横幅提示（sessionPayload 暴露 degradedReason，非静默 demo） |

### 前端调用 RAG 服务流程

```
用户上传图片
  → POST /api/scan（Next.js API route）
      → lib/rag-client/v1-adapter.ts（createScan）
          → fetch(RAG_SERVICE_URL/api/v1/scans, ...)   # RAG 服务自管会话/队列
          → 返回 sessionId + accessToken（Set-Cookie + Bearer）
  → 前端轮询 GET /api/scan/{sessionId}
      → lib/rag-client/v1-adapter.ts（getScan）→ RAG /api/v1/scans/{id}
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
│   ├── admin/                    # 管理员 BI 看板（page + login + Dashboard + LoginForm，2026-09-19）
│   └── api/                      # Next.js API 路由
│       ├── scan/route.ts         # POST /api/scan — 创建扫描
│       ├── scan/[sessionId]/     # GET 轮询 + asset/[index] + evidence + revisions
│       ├── backend-session-access.ts  # （helper 模块，非路由）cookie/bearer 读取
│       ├── report/[sessionId]/[reportType]/  # GET md/csv 文本导出（PDF/DOCX 在客户端）
│       ├── regulations/updates/  # GET 法规更新
│       ├── regulations/[docId]/  # GET 单条法规原文（evidence-pack 引用）
│       ├── admin/{login,logout,overview}/  # 管理员会话 + 运营统计（2026-09-19）
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
│   ├── utils.ts                  # 工具函数
│   ├── constants.ts              # 共享常量（超时/限额/限流）
│   ├── api-response.ts           # API 响应信封（ok/fail/unwrapApiData）
│   ├── i18n.tsx                  # 前端 i18n hook（useTranslation；locale 取自 BlazeLocaleProvider）
│   ├── i18n/translations.ts      # zh/en 文案表
│   ├── complipilot/              # 规航AI 品牌文案 / 扫描阶段 / 场景
│   ├── rate-limit.ts             # 限流
│   ├── upload-validation.ts      # 上传文件校验
│   ├── report-localization.ts    # 报告字段本地化
│   ├── report-export.ts          # 报告导出静态 facade（compliance / profit / decision / roadmap / evidence-pack / markdown-text 全部导出；UI 走 lib/report-download.ts 走 lazy import）
│   ├── report-download.ts        # 报告导出（动态导入，lazy loading）—— 给 UI 消费者
│   ├── report-export-modules/    # 报告导出实现（compliance / profit-pdf / profit-docx / profit-render-model / decision / roadmap / evidence-pack / shared / markdown-text / inspection-annex；PDF/DOCX 走客户端 jsPDF/Packer，md/csv 走 app/api/report/[sessionId]/[reportType] API 路由）
│   ├── result-view-helpers.ts    # 结果页视图助手
│   ├── result/                   # 统一结果 ViewModel（2026-09-14 J03/J15）
│   │   └── inspection-view-model.ts  # buildInspectionResultViewModel —— finding↔observation↔image 真实 join + 引用去重 + 产品名 fallback + evidence request 合并
│   ├── pipeline/                 # demo 会话 + BFF 报告导出（3 文件，全部活跃）
│   │   ├── session-auth.ts       # 会话访问 token（哈希 + 校验；Bearer-only，不读 ?token=）
│   │   ├── demo-scan-session.ts  # demo 模式会话
│   │   └── profit-report.ts      # 利润报告合成 + RenderModel
│   ├── mock/                     # Demo 模式模拟数据（blaze-scan-result / blaze-scenario / scan-result / blaze-copy 是 mock）；roadmap 不是 mock — 是导出 RenderModel，结果页 export 链 live 也用
│   ├── hooks/useScanPolling.ts   # 轮询 hook
│   ├── rag-client/               # 前端 RAG 客户端
│   │   ├── v1-adapter.ts          # 创建扫描 / 轮询 / 证据（唯一的 RAG HTTP 封装）
│   │   ├── v1-result-adapter.ts  # 结果字段映射
│   │   ├── evidence-api.ts       # 补充证据 API
│   │   ├── report-package-schema.ts  # 报告包 Zod 契约（validateReportPackage；types.ts 的 CitationRefContract 来源）
│   │   ├── openapi.snapshot.json # OpenAPI 契约快照（由 rag_service app 对象导出）
│   │   └── types.gen.ts          # 由快照生成的 TS 类型（check:rag-contract 门控）
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
│   │   └── nodes/                # vision / generator / verifier / findings_builder / visual_checks / declared_facts（J09 NEGATIVE_VALUES 共享：findings_builder + generator 都从这里 import is_negative_value）
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
│   ├── regulations/              # 法规库：61 篇锚点法规 YAML（36 篇带条款正文）+ 63 篇目录条目（attrax-docs 导入，仅元数据）→ regulations_index.json 共 124 条
│   │   └── _imports/             # 目录导入清单（2026-09-19 attrax-docs）+ README；导入脚本 scripts/import_regulation_docs.py
│   ├── kb/                       # KB 锚点 YAML
│   ├── inspection_profiles/      # 视觉检查 profile（11 个 yaml）
│   ├── regulation_sources/       # 法规数据源注册表
│   ├── regulation_supplements/   # watchdog 自动入库包 + manifest（⚠️ */raw/ 原件 PDF/DOCX/HTML 不纳入版本控制，约 400MB，见 .gitignore）
│   ├── regulation_eval/ + regulation_reports/  # 法规评测与报告产物
│   └── corpus/                   # 法规语料 HTML（运行时由 watchdog 维护）
│   # 运行时目录（gitignore，不入库）：data/backend/sessions/（RAG 会话，TTL 24h）、data/backend/jobs/、data/backend/uploads/
│
├── tests/                        # 前端测试
│   ├── unit/                     # Vitest 单元测试
│   ├── e2e/                      # Playwright E2E
│   ├── pressure/                 # 压力测试脚本（improved-load-test.js）
│   └── setup.ts
│
├── public/                       # 静态资源（fonts/NotoSansSC-Regular.ttf 17MB 保持入库——PDF 导出与测试运行时依赖）
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
    ├── import_regulation_docs.py # attrax-docs 法规目录导入（清单 → YAML → 索引）
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

所有用户输入在系统边界验证。**注意：`lib/schemas.ts` 已于 2026-09-17 round-5 删除**（22 个 export 里 21 个零引用），校验分散在 BFF 路由与专属契约文件：

- `app/api/scan/route.ts`：**流式转发**——只做 Content-Length 上限（413）、Content-Type 嗅探（400 `BAD_INPUT`）、限流（429）、以及从请求体前 8KB 嗅探 category 的早期拒绝（`INVALID_CATEGORY`）。文件数量/类型/魔数/总大小的逐项校验由 RAG `api/v1.py:_read_uploads` 负责（BFF 不缓冲请求体，见 2026-09-18 并发加固）
- `app/api/scan/[sessionId]/asset/[index]/route.ts`：内联 `SessionIdSchema`（`^scan_[0-9A-Za-z_-]{1,50}$`，与 RAG `FileBackend._SAFE_ID` 对齐）
- `lib/rag-client/report-package-schema.ts`：报告包 Zod 契约（`validateReportPackage`；`CitationRefContract` 的唯一来源，经 `lib/types.ts` re-export）
- 类型单源仍在 `lib/types.ts`（`MARKET_IDS` 16 市场 / `PRODUCT_CATEGORIES` 10 品类）

```typescript
import { z } from "zod";

// session_id 校验（asset BFF 路由的内联实现）：
const SessionIdSchema = z
  .string()
  .min(6)
  .max(64)
  .regex(/^scan_[0-9A-Za-z_-]{1,50}$/);
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
| `LLM_PROVIDER` | 按模型推断 | 否 | 主模型供应商标识，例如 `qwen` 或 `minimax` |
| `LLM_API_KEY` | - | 是 | 主模型 API Key；兼容旧 `MINIMAX_API_KEY` / `MIMOTALK_API_KEY` |
| `LLM_BASE_URL` | MiniMax Anthropic 兼容端点 | 否 | Anthropic 兼容 LLM 端点 |
| `LLM_MODEL` | `MiniMax-M3` | 否 | 主模型名称，例如 `qwen3.8-max-0902` |
| `LLM_THINKING` | 空 | 否 | `enabled` / `disabled`；空值保留供应商默认行为 |
| `LLM_TIMEOUT_SECONDS` | `240` | 否 | 主模型请求超时，限制在 10–600 秒 |
| `DEEPSEEK_API_KEY` | - | 否 | **降级**通道 key（识图 + 报告生成共用，`rag_service` 读取）。留空 = 关闭降级 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 否 | 识图降级端点（OpenAI 兼容 `/chat/completions`） |
| `DEEPSEEK_ANTHROPIC_BASE_URL` | `https://api.deepseek.com/anthropic/v1` | 否 | 报告生成降级端点（Anthropic 兼容；代码拼 `{base}/messages`，**必须带 `/v1`**） |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 否 | 降级模型（reasoning 模型，`content` 与 `reasoning_content` 共用 completion 预算） |
| `DEEPSEEK_MAX_TOKENS` | `16384` | 否 | 降级通道 completion 预算（也是报告生成预算的下限）。**调小会导致 HTTP 200 + 空 content**（预算被 reasoning 吃光） |
| `RAG_SERVICE_URL` | `http://localhost:8001` | 否 | RAG 服务地址（BFF 转发目标） |
| `DEMO_MODE` | `false` | 否 | Demo 模式（Mock 数据，无需 API Key） |
| `ATTRAX_DEBUG_TOKEN` | - | 否 | `=1` 时创建扫描响应体带 accessToken（默认仅 HttpOnly cookie） |
| `RATE_LIMIT_TRUST_XFF` / `RATE_LIMIT_CLIENT_ID_SALT` / `RATE_LIMIT_STORE_DIR` | - | 否 | BFF 限流调优（`lib/rate-limit.ts`） |
| `DAILY_FREE_SCAN_LIMIT` | - | 否 | ⚠️ 无人读取（ecosystem 注入但前后端代码均不消费），待实现或移除 |
| `ATTRAX_BUILD_SHA` | - | 否 | 当前部署 commit SHA（pydantic-settings 读取，写在 `rag_service/.env`） |

> `PAI_API_KEY` / `MODELSCOPE_API_KEY` / `OLLAMA_*` 已无代码读取（embedding 栈随 de-RAG §7.7 删除），不要在新配置里填写。

### RAG 服务（`rag_service/.env`）

同上（LLM、DEMO_MODE 等），RAG 服务从 `rag_service/.env` 读取。

### 关键 RAG 服务环境变量

| 变量 | 说明 |
|------|------|
| `RAG_ALLOWED_ORIGINS` | CORS 白名单（逗号分隔） |
| `RAG_INTERNAL_SECRET` | BFF ↔ RAG 内部认证密钥（fail-closed：prod 空 secret 拒绝启动）。**真值单一来源 = `/opt/attrax/.rag-internal-secret`（`600`）**，由 `scripts/ecosystem.config.cjs` 同时注入 `rag-service` 与 `nextjs`；不在任何 `.env` 或 git 中 |
| `ATTRAX_BUILD_SHA` | 当前部署 commit SHA |
| `SCAN_WORKER_CONCURRENCY` | 扫描 worker 并发数（默认 **5**，见 `config.py`） |

---

## 已知限制

| 限制 | 说明 |
|------|------|
| **无持久化** | RAG 会话存文件 TTL 默认 24h（`data/backend/sessions/`，`session_ttl_hours`），无数据库 |
| **无用户系统** | 无登录/注册/权限控制（会话级 accessToken 校验有） |
| **requirements 快照** | 生产安装用 `requirements-prod.txt`；原 `requirements.txt`（500+ 条）已改名 `requirements-snapshot.txt` 并标注勿安装 |
| **报告语言** | 报告正文以中文为主；导出走 `?lang=en` 时报告框架字段有英文回退（`lib/report-localization.ts`），LLM 生成的正文本身仍中文 |
| **rag-service 单 worker** | uvicorn `--workers 1`，扫描经 ThreadPoolExecutor（`SCAN_WORKER_CONCURRENCY=5`）并发；`max_memory_restart: 1300M`（ecosystem.config.cjs）。LLM 慢/挂时仍会占住 worker（`_SCAN_TIMEOUT_SECS=280` 兜底） |

---

## 最近修复

### 2026-09-19 — 管理员运营 BI 看板 /admin（分支 `codex/admin-bi-dashboard`，已合并进 main 并部署上线）

- **功能**：`/admin` 运营看板（Recharts，指标卡 + 服务使用趋势面积图 + 法规每日更新柱图 + 市场分布 + 近期扫描 + 抓取来源表格，7/30/90 天切换、CSV 导出）。首页导航有「管理后台」入口。数据口径全部来自真实运行数据，详见 `docs/admin-bi.md`
- **演示模式**：看板右上角「真实数据 / 演示数据」切换（`lib/admin/demo-data.ts` 固定种子模拟：30 天 42 位访客、扫描 343/739 次、法规规模沿用真实数量）；琥珀色标签 + 工具栏横幅 + CSV `-demo` 后缀明确标注非真实统计，每次进入默认回到真实数据
- **鉴权**：scrypt 密码（`scripts/setup-admin.mjs` 生成或 `--password` 轮换为运营指定口令——原子替换哈希并清空旧会话；生产口令在服务器 `/opt/attrax/.deploy/admin-access.txt`，不写入 git）+ SQLite 会话令牌哈希，HttpOnly/SameSite=Strict Cookie 8h，登录限流 5 次/15 分钟，登录/退出同源校验（生产要求 https Origin），密码长度 8–256 位
- **数据管线**：① middleware 匿名流量采集 → `data/admin/analytics.sqlite`（node:sqlite，只记 day/kind/路径分类，无 IP/参数/上传内容；仅当 `.admin-auth.json` 存在时启用）② 扫描统计来自 RAG 审计日志（懒导入 + 每日备份前 `retain-admin-audit.py` 强制留存，日志轮转不丢历史）③ 法规存量/来源读生产索引与源注册表 ④ 每日新增/更新来自 watchdog 历史快照 + 新增逐轮 `watchdog-runs.jsonl`（`orchestrator.py` 调 `metrics.py`，北京时间归档）
- **踩坑（重要）**：`middleware.ts` 必须保留 `runtime: "nodejs"`——Next 16 下旧文件名 middleware 去掉该行会被 webpack 按 edge 目标编译，统计链路的 `node:` 内置模块直接 UnhandledSchemeError 构建失败（文档说 proxy.ts 默认 Node 且显式设置会抛错，只适用于新文件名）
- **运维接线**：每日备份（backup-data.sh cron）先跑审计留存再备份（留存失败不阻断备份但落日志）；ops 随包 12 文件（+backup-admin.mjs/retain-admin-audit.py）；`setup-admin.mjs`/`verify-admin.mjs` 需单独 scp
- **验证**：vitest 1005（含 admin-overview 聚合夹具测试）/ watchdog 160（含 metrics 4 例）/ tsc / eslint 0 error；本地浏览器实测（登录、真实数据渲染、流量入账、交互、过期提示）；生产 `verify-admin.mjs` 9/9 + 部署后抽查（法规 1052/25 市场/37 源，扫描 7 天 93 次全完成，流量采集计数中）。部署记录见 `docs/evidence/2026-09-19-admin-bi-dashboard/`
- **已知现象**：巡检 ingest 窗口（每日 03:00 起数十秒）内读看板可能看到索引重建的瞬时值，自愈；82 条无时间戳旧审计不进曲线（界面标注）

### 2026-09-19 — attrax-docs 法规目录导入（/regulations 法规档案 61 → 124 条 / 21 区域）

- **背景**：`/workspace/me/attrax-docs` 补齐了各地区法规原件（PDF/HTML 共 72 份，去重后 68 份唯一内容）与《出海合规法规文件清单》《法规分类表》《出海合规法律法规政策清单》三份清单；产品侧要求 `/regulations` 展示尽可能多的法规数据，不要求这些条目进入扫描引用
- **做法**：新增 `scripts/import_regulation_docs.py` + 清单 `data/regulations/_imports/attrax-docs-2026-09-19.json`（63 条：CN 11 / EU 15 / US 5 / UK 1 / VN 6 / ID 5 / SG 2 / MY 3 / TH 1 / SA 3 / AE 4 / GCC 1 / UN 2 / GLOBAL 4）。逐条写 `data/regulations/{region}/{id}.yaml`（`articles: []`、`source_kind: unverified`、新字段 `domain` 领域分类与 `doc_files` 本地原件路径），原件复制到 `data/regulations/{region}/raw/`（68 份 46MB，gitignore，见该目录 README），最后复用 `AutoIngestor._rebuild_index()` 重建索引
- **插件的三个既有约束**：① `_REGION_DIRS` 补 VN/ID/MY/TH/GCC/GLOBAL；② `_rebuild_index` 带上 `domain`（老条目没有该字段，前端按可选处理）；③ `rag_service/tests/test_kb_loader.py` 的「锚点 ↔ 法规 1:1」断言改为**单向** `anchored ⊆ regulated` —— 目录条目是超集，没有 KB 锚点也不进扫描。同时补上反向约束 `test_regulations_without_an_anchor_are_metadata_only`：没有锚点的法规不得带条款正文，否则真锚点丢了锚点会静默掉出所有扫描
- **前端**：`ArchiveTab` 市场筛选加 越南/印尼/马来西亚/泰国/新加坡/海湾国家（UN 标签由「国际」改为「联合国」，新增 GLOBAL「国际」），卡片加领域标签（中英映射），搜索覆盖领域；`UpdatesTab` 市场筛选同步扩到 20 个并补 `markets.*` 文案（含 NZ——watchdog 有 2 个新西兰源，缺按钮时 NZ 卡片只能混在「全部」里且显示裸代码）；副标题数字改为动态（{archive}/{markets}/{sources}/{updates}）
- **近期动态补卡**：`app/api/regulations/updates/data-regions.ts` 新增 12 条（reg-101…112，越南 Decree 13/53、印尼 PDP Law 与 Permenperin 75/2024、马来西亚 CBPDT 指南、沙特 PDPL 宽限期届满、中国两用物项条例与技术目录、GB 44495、EU AI Act、US INFORM、UN R155/R156），日期均核对到法规公布/生效日；`STATIC_DEMO = EDITORIAL_DEMO(30) + REGIONAL_UPDATES(12)`
- **URL 实测口径**：63 条 source_url 全部 curl 探测过，但 **curl 对 EUR-Lex 没有区分度**——有效 ELI 与编造 ELI 都返回 202，所以 `OK 202` 只证明主机可达。EUR-Lex 的 15 条另用 Cellar 端点按 CELEX 复核（`docs/evidence/2026-09-19-regulations-catalog-import/verify-eu-eli.py`），15 条全部 303 = 文书存在。另有 18 条登记的是官方门户而非条款深链（越南 vanban.chinhphu.vn、印尼 jdih.setneg.go.id、阿联酋 u.ae 等），点「原文」到门户首页，条文以本地原件为准；其中 UN R155/R156、EU-2019-452、AE-LABOR-33-2021 在条目 `note` 写明原因
- **对抗性审查（同日）修掉的**：`--copy-docs` 在 YAML 已存在时不复制原件（文档承诺的恢复流程失效）→ 拆成「写 YAML」「复制原件」两步 + `scripts/watchdog/tests/test_import_regulation_docs.py` 15 条回归；清单字段未 strip 会在 `run()` 抛未捕获 KeyError（且崩在索引重建前，留下库与索引不一致）；`docs` 可用 `../` 越出原件目录、同区域重名原件被静默覆盖（均改为校验期拒绝）；`MY-DATA-SHARING-2025` 编号 Act 862 → **Act 864**（862 是 2024 年财政法）；4 组重复/张冠李戴的原件登记去重（`doc_files` 72 → 68 份唯一原件）；`page.tsx` 统计接口返回非 2xx 时不再静默显示「—」而无横幅
- **验证**：pytest 738 passed（rag_service，含库不变量）+ 156 passed（watchdog，含导入脚本回归）、vitest 998 passed、tsc、eslint 0 error；浏览器实测 `/regulations` 三个 tab（档案 124 条 × 21 区域、筛选与领域标签、近期动态 42 条含越南 2 条、NZ 筛选空态）；`verify-eu-eli.py` 15/15 存在
- **部署（同日）**：ddc9967 上线，BUILD_ID `YU8SNxMLjsyFVHcWswvRm`。⚠️ 法规库要 **additive rsync + 在服务器上重建索引**（不能拷本地索引，服务器有 3 条 watchdog 自动入库的 UK 法规会被抹掉）；上线后生产档案 **127 条**（本地 124 + 3）、抓取源 37、近期动态 60（42 静态 + 18 实时）。部署后真实扫描 `ready` 68s / 5 findings / 15 citations（MiniMax 429 → 走 DeepSeek 降级，属设计内）。完整记录见 `docs/evidence/2026-09-19-regulations-catalog-import/production-deploy.md`

### 2026-09-19 — 并发加固批次部署中产出的 deploy 自愈（a1a4474）

- **问题**：H10 部署时 `nginx -t` 卡住。vhost 加了 `limit_conn attrax_conn 20`，但定义共享内存区的 `limit_conn_zone` 必须放在主 `/etc/nginx/nginx.conf` 的 `http {}` 段，vhost 渲染只改 `/etc/nginx/sites-enabled/attrax`，跨文件依赖无人维护
- **现场补救**：在服务器上以 sed 注入正确行让部署走完（nginx reload 成功、HTTPS 公网 200、真实冒烟扫描通过）
- **固化**：
  - `docs/infra/nginx-nginx.conf` 显式收录 `limit_conn_zone $binary_remote_addr zone=attrax_conn:10m`，与 vhost 引用同源
  - `apply-deploy.sh [8.5]` 在 render vhost 之前自检主 conf 是否含 `limit_conn_zone ... attrax_conn:10m`，缺则按同样字符串在 `keepalive_requests 100` 之后插入（idempotent）；注入后再跑一次 `nginx -t` 确认通过
  - DEPLOY §8 雷区加一条 + PORTS.md 历史加一条 + §3.1 加 `git push` 步骤
- **教训**：nginx `limit_*` 指令的「定义段」与「引用段」不在同一个文件时，单文件渲染会留下隐式依赖——`apply-deploy.sh` 必须能自愈

### 2026-09-18 — 全栈并发加固批次（前端 BFF / RAG / 存储 / watchdog / 基础设施）

- **起因与结论**：五个方向各派一个审查（前端 BFF / RAG 管线 / 存储与文件后端 / 外部采集 / 服务器基础设施）。底层原语本身是好的（O_EXCL 跨进程锁、tmp+os.replace 原子写、RLock 串行化状态写），**缺的是多进程边界、长跑生命周期、突发流量、跨子系统资源竞争**——多处靠"部署约定"活着（`instances: 1`、单 upstream、单磁盘备份）。修复原则：凡会拖慢热路径的一律不做，据此明确跳过 audit.jsonl 与 session JSON 的逐次 fsync
- **前端 BFF 请求体改为流式转发**（f405713）：`POST /api/scan` 与 `/evidence` 不再 `request.formData()` 整份读进堆再重新序列化（50MB × 并发足以顶破 nextjs 的 `max_memory_restart: 768M`），改为把 `request.body` 流直接交给上游 fetch（`duplex: "half"`）。**契约随之变化**：浏览器发出的字段名就是 RAG 看到的字段名（上传页改发 `declared_facts`、文本字段排在文件前面，以便 BFF 的 8KB 嗅探读到 `category`）；RAG 接受旧名 `userDeclaredFacts` 与逗号分隔的 `markets`，`query` 为空时按原措辞合成；逐文件校验下沉到 RAG `_read_uploads`。同一批次修掉嗅探器正则分组取错的真 bug（`name="category"` 永远匹配不上，`INVALID_CATEGORY` 早检一直失效）、revision 幂等键改为客户端传入、资产接口改流式回传
- **>8KB 上传整条挂死（8ff0866）**：嗅探 `category` 的第一版用 `body.tee()` 撕分支、读满 8KB 后 `cancel()`，导致**任何超过嗅探窗口的请求体死锁**（44KB 真实产品图在 BFF 停到超时，RAG 侧连 POST 记录都没有；≤8KB 因能读到 `done` 反而正常，小 fixture 单测与短桩请求都漏掉了）。改为单 reader 读前缀 + 回放流。**这类传输层问题单测结构上无法覆盖**，验证证据与复现步骤见 `docs/evidence/2026-09-18-concurrency-hardening/`
- **限流器跨进程原子性**（1a6bd0c）：文件桶读-改-写用 `O_CREAT|O_EXCL` 锁文件包住，抢不到锁退回进程内限流；此前靠 `instances: 1` 约定活着
- **RAG 幂等与状态原子化**：幂等检查与写入合并到同一次持锁（H11 补充证据、H12 重扫——job 记录 + audit log 互为补集，前者覆盖崩溃窗口与运行中的 job，后者拦住 job 已删除后的迟到重试）；新增 `update_session_atomic` 统一进度/阶段/心跳三处读-改-写；vision cache 的 get/put/evict 全程持锁；`save_upload` 的大块字节写移出锁（此前单次 10MB 写串行化整个后端）；陈旧 job 锁改为「持有者 PID 已死立即回收」
- **watchdog**（9dc1f55）：`urllib` → 进程级单例 `httpx.Client` 连接池 + full-jitter 退避；YAML/index/state 改原子写；**并行 ingest**（抓完即投独立池，与剩余抓取重叠，实测 create 1.45x / update 1.19x，真实 35 源整轮 0 失败）；条件请求缓存按 `source_id` 命名空间 + `--ack`/`--revert` 失效。审查中还发现并修掉既有缺陷：httpx 不抛异常导致 5xx 错误页被哈希成"变更"、6/7 个 collector 没传 `source_id` 使命名空间失效（加 AST 守卫防回归）、基线未推进的源不失效缓存会让未应用的变更被永久退役
- **服务器基础设施**（71523d1）：nginx `proxy_next_upstream` 重试 5xx、`limit_conn` 每 IP 20、`multi_accept on`、上游 `max_fails=3 fail_timeout=30s`；sysctl `tcp_tw_reuse` + 全端口范围；pm2 `kill_timeout=10000`（**刻意不加 `wait_ready`**——Next.js 从不发 pm2 ready 信号）；备份先 `cp -al` 快照再打包并纳入 `backend/{sessions,jobs,uploads}`；fail2ban 不再把 5xx 计入探测失败；logrotate 属主改 root
- **验证**：vitest 997/997、tsc、eslint 全绿；pytest 后端全绿；watchdog 139 全绿；双 OpenAPI 契约门控通过。**真实 HTTP 端到端**（Next.js dev + undici + 桩上游）确认上游收到 `transferEncoding: chunked` 且无 `Content-Length`——请求体确实在流式转发

### 2026-09-18 — 线上实测批次（回归脚本假绿 / 备份从未运行 / 3001 地雷文件 / watchdog CLI 直跑失败）

- **生产回归脚本 4 处 UI 漂移 + 退出码假绿**（691a985）：`run-production-regression.ts` 对着旧上传页 UI 写的选择器全部失效——品类选择已改 Base UI Select（非原生 `<select>`）、市场按钮选中态是 `aria-pressed`（非 `bg-white/40` class）、条件问题收在 `<details>` 里默认折叠、页面有两个 `type="submit"`（页头 CTA 经 `form=` 关联 + 表单内 `#scan-submit`）；且全挂时退出码仍为 0（CI 假绿）。全部修正后 3/3 用例通过（56s/128s/153s，source=real）。默认 BASE_URL 从已退役的 `example.com`（401）改为 `twinbuddy.xyz`
- **备份从未在 aliyun-sz 上运行过**（7fd8bd2）：`/etc/cron.d/attrax-backup{,-remote}` 以 `ubuntu` 用户跑，但本机只有 root/admin——cron 对不存在用户静默跳过，`/opt/attrax/backups` 与日志目录均不存在（脚本一旦运行必然创建，不存在 = 从未运行）。cron 用户改 root + 守卫测试允许列表同步；手动首跑成功（1.7M tarball）。**异地备份仍未配置**（`BACKUP_REMOTE_DEST` 空，cron 文档已注明单盘风险）
- **孤儿 cron 清理**（服务器侧）：`attrax-uptime` 每 5 分钟跑不存在的 `uptime-check.sh`（无 MTA 静默失败）；`attrax-data-rotation` / `attrax-queue-perms` 指向已随 de-RAG 删除的 `data/scan-queue`（2>/dev/null 空转）。全部移除
- **`/etc/nginx/sites-available/attrax` 3001 地雷**（389ee5c）：旧手工流程副本仍写 3001，任何"从 sites-available 恢复"的标准 Debian 操作都会把 502 带回来。apply-deploy [8.5] 渲染后顺手删除（仅当 sites-enabled/attrax 非软链）；PORTS.md 补记 vhost 唯一真值
- **watchdog CLI 直跑失败**（691a985）：`python3 scripts/watchdog/{check_sources,review,auto_ingest}.py` 文件路径直跑时 `sys.path[0]` 不含仓库根，`ModuleNotFoundError: No module named 'scripts'`（生产机实测踩中）；三个 CLI 补仓库根引导，`-m` 方式不受影响
- **部署**：389ee5c tarball 上线（BUILD_ID `Et6wM48xv7j4kP69ApVCJ`，apply-deploy [8.5] 首次实战：重渲染 vhost + 删地雷 + health gate 通过）；服务器 git 经 bundle 快进到 7fd8bd2（含 5d19945 防护与全部纠偏文档）
- **验证**：vitest 987 / pytest 822 全绿；生产回归 3/3；部署前后各一次真实冒烟扫描（provider=minimax、source=real）；`check_sources` 30/30 healthy；导出端点（compliance md / roadmap csv / 401 无 cookie）符合契约
- **遗留观察**（未修，属产品/配置决策）：MiniMax 报告在 ~16.4k 字符处顶到输出上限后走 repair 重试（日志常见 `direct json.loads failed: Unterminated string` → `repaired in one bounded retry`，最终报告 ~12k 字符，功能无损）；`docs/infra/ALIYUN-SZ-DEPLOY.md` 中残余的 3001 字样均为事故复盘叙述，非指引

### 2026-09-18 — 全站 502（nginx upstream 端口漂移）+ 端口单一来源防护

- **事故**：全站 502 数小时。`/etc/nginx/sites-enabled/attrax` upstream 写 `127.0.0.1:3001`（照 `docs/infra/ALIYUN-SZ-DEPLOY.md` 旧版"aliyun-sz 端口偏移"约定配的），但 ecosystem 里 nextjs 一直监听 3000——LabMemory 已退役、偏移前提消失且 ecosystem 从未改过。pm2 三进程全 online、直连 200，只有公网 502，极具迷惑性
- **即时修复**：upstream 3001→3000 + `nginx -s reload`，恢复 200
- **防护（三层）**：
  1. **端口单一来源 `scripts/ports.env`**：`ecosystem.config.cjs` require `ports.env.cjs`（`sync-ports.js` 镜像）；nginx vhost 由 `docs/infra/nginx-attrax-vhost-prod.conf.template`（`__NEXTJS_PORT__` 占位符）经 `scripts/render-nginx-vhost.sh` 渲染。8 个运维文件随 deploy tarball 走（`standalone/ops/`），apply-deploy.sh [6.5] 安装
  2. **部署强制刷新**：apply-deploy.sh [8.5] 每次部署重渲染 vhost + `nginx -t` + reload；[8] 改用 `pm2 startOrRestart`（重读 ecosystem）——手改端口一律被覆盖回真值
  3. **运行时自愈**：systemd timer `attrax-healthcheck.timer` 60s 一次 curl 公网 `/api/health`；连续 3 次失败 → 重渲染 vhost + reload；6 次 → `pm2 restart nextjs`；12 次 → 连 rag-service 一起重启。**实测人为改坏 upstream 后 150 秒自动恢复**。日志 `/var/log/attrax-healthcheck.log`
- **文档纠偏**：ALIYUN-SZ-DEPLOY.md 7 处 3001/8002 旧端口全部改正（事故的书面根源就是这份文档）；新增 §4.4 防护说明 + `docs/infra/PORTS.md` 端口台账
- **注意**：`ecosystem.config.cjs` 本地 require 会因缺 `/opt/attrax/.rag-internal-secret` 走 dev placeholder（仅打 warning）；生产 `APP_ENV=production` 仍 fail-closed 抛错

### 2026-09-17 — 法规源全量实测审计（9 个源从未抓取成功）

- **背景**：对 35 个注册源做全量实测（生产机真实抓取，走各自 collector 完整路径），发现 **9 个源的 `source_url` 返回 403/404，自 2026-09-16 上线起每个 pass 都在失败**。生产机自己的 `errors.json` 早已逐条记录，但没有告警、没有断言、没人看。根因是 `human_view_status` 是手工字段，填的是"浏览器能不能打开"，与抓取能力无关
- **第一层修复**：CPSC RSS（403）换成 SaferProducts.gov REST API（新增 `cpsc_recall_api` collector）；CN/JP/KR/AE/SA/BR 六个源换到实测 200 的端点；EU Safety Gate API 已整体下线（所有候选端点探测均 404 或只返回 SPA 外壳），标 `fetch_status: "unreachable"`
- **第二层问题（更隐蔽）**：修完 URL 后 6 个源返回 200 但正文只有 24–224 字符（JS 渲染的 SPA，stdlib `html.parser` 拿不到内容）。摘要**永远不变**，看起来像"这个源一直没变化"。比不追踪更糟。标 `fetch_status: "shell_only"` 并跳过；要真正覆盖需要引入 headless browser，属独立架构决定
- **新增源**（全部实测）：`us-cpsc-recalls-api`、`us-fda-device-recalls`、`us-fda-food-enforcement`（`food_contact` 品类此前零召回信号）
- **新工具**：`scripts/watchdog/check_sources.py` —— 把每个源走真实 collector 抓一遍，报告可达性 + 内容厚度（`thin` 检测），退出码 0/3/1。这是本次沉淀的守卫
- **修掉的假可用 bug**：OpenFDA 不显式排序会返回档案库任意切片（实测 device 返回 2003 年记录、food 返回 2016 年记录），30 天窗口过滤后摘要为空 —— 空摘要和"真的没有召回"无法区分；且 device 端点对 `recall_initiation_date` 排序是 HTTP 500（字段不存在），须按端点声明
- **同时**：orchestrator 并行抓取（线程池 + 协作式 60s deadline）、`source_type` plugin 注册表、`review.py` 复核/回滚 CLI、UA 季度轮换、5 个被硬封端点的 collector 删除
- **验证**：pytest 776 passed；生产机 `check_sources` **30/30 healthy, 0 thin, 0 failed**。完整审计记录见 `docs/regulations/SOURCE-AUDIT-2026-09-17.md`

### 2026-09-17 — 对抗审查 round 5（契约 / 限流 / 安全 / 运维）

- **限流单桶**：RAG `_client_ip` 在 BFF（127.0.0.1，trusted proxy）不转发 XFF 时把所有用户归入同一 30 req/60s 写桶。`v1-adapter` 新增 `UpstreamForward` + `upstreamForwardFrom(request)`（x-real-ip / x-request-id），6 个 BFF 路由透传；`middleware.ts` 把 request-id 注入转发请求头
- **契约**：`DecisionNode.severity` 在 Pydantic/snapshot/types.gen 显式声明（此前靠 `extra="allow"` 活着，前端评分依赖它）；asset 路由 OpenAPI 声明 binary 响应；snapshot + types.gen.ts 重新生成，双 gate 通过
- **安全**：`_enforce_secret_policy` 不再把 ephemeral secret 写日志（改打 pid）；5 个 BFF 路由 401 带 `Set-Cookie: Max-Age=0` 清死 token
- **UX**：burning 页 `navigatedRef` 从 useState 改为 ref（回调去重）+ state（渲染），修 timer 旧闭包 guard
- **运维**：docker-compose 补 `DEEPSEEK_*`；`.build-sha` 链路让 `ATTRAX_BUILD_SHA` 与 `.deployed` 一致；preflight secret 48-hex；nginx vhost/README 文件名对齐（此前照 README 安装 `nginx -t` 失败）；`.dockerignore` 排除 eval/reports
- **清理**：删 `lib/schemas.ts`（21/22 export 零引用）+ 对应测试、`findingsForObservation`、`blazeRoadmapRows` 死链条；`CitationRefContract` 单源化收敛
- **误报率警示**：三路 agent 报告约一半经复核是误报（assets 实际会填充、html_parser 内部函数被 parse_html 调用、多个"死导出"实为文件内活跃类型）—— 下轮审查先验证后修改
- **验证**：vitest 915 / pytest 655 / tsc / eslint / 双契约 gate / `npm run build` exit 0 全绿；共享工作树被另一 session 数据污染时的 pytest 失败需在独立 worktree 复测

### 2026-09-16 — 报告生成也降级到 DeepSeek（MiniMax 全挂时仍出真报告）

- **背景**：识图降级上线后，MiniMax 整体挂掉时仍会 `degraded` —— 视觉证据有了，但报告生成是 MiniMax-only，只能退回 mock 包
- **实现**：`report_generator.py` 的 `_generate_mimotalk`（唯一传输方法，4 个调用点共用）在 primary 失败后，把**同一份 body** 重发到 DeepSeek 的 Anthropic 兼容端点；`_read_mimotalk_response` 改为拼接所有 `type=="text"` 块；`provider` 变成「实际服务的供应商」（默认仍是 `minimax`），`pipeline/nodes/generator.py` 在生成后刷新它，否则 trace / `ragProvider` 会把降级报告谎报成 MiniMax 的
- **两个必须知道的坑**：
  1. **位置读取响应会恒空**：DeepSeek 的 Anthropic 端点返回 `content[0]={"type":"thinking"}`、`content[1]={"type":"text"}`。原来的 `content[0].text` 恒为 `""` → `ValueError: empty response` → mock 包。看起来完全像"降级也挂了"，实际只是读错了块
  2. **重试预算会吃掉降级机会**：`_LLM_MAX_ATTEMPTS=3` × 90s 超时 + backoff ≈ **273s**，而 `main._SCAN_TIMEOUT_SECS=280`。纯超时故障下 primary 重试就能耗尽整轮预算，**DeepSeek 根本没机会被调用**。所以配置了降级 key 时 primary 只试 1 次 —— 有降级在手，快速降级胜过空转
- **范围**：识图仍走已验证的 OpenAI 兼容端点（用户选择不动）；不做 circuit breaker（生成器是进程级单例，粘性降级会在 MiniMax 恢复后一直用 DeepSeek）
- **验证**：pytest 587 passed；本地坏 key 起服务跑真实扫描 → `status=ready` / `provider=deepseek`（改动前是 `degraded`）；正常 key → 仍 `provider=minimax` / `source=real` 无回归

### 2026-09-16 — 识图供应商降级（MiniMax → DeepSeek）

- **背景**：识图只有 MiniMax 一条路，它偶发不可用时整条扫描在第一步就丢掉视觉证据
- **实现**：`config.py` 新增 `DEEPSEEK_{API_KEY,BASE_URL,MODEL,MAX_TOKENS}`（+ `resolve_deepseek_config`，沿用 `os.environ.setdefault` 桥接 `.env`）；`pipeline/nodes/vision.py` 把消息构建与缓存抽成 `_vision_text`，MiniMax 返回空时调用 `_call_deepseek`（`_to_openai_messages` 做 Anthropic→OpenAI 形状转换）；`available` 改为「任一供应商有 key」，只有降级 key 的部署也能出视觉证据
- **缓存分层**：降级结果存在按 `fallback_model` 计算的独立 cache key 下，永不被当作 primary 结果回放；primary 每次仍会重试（可能已恢复），降级缓存只省掉重复的 DeepSeek 调用
- **踩坑（重要）**：`deepseek-flash` 是 reasoning 模型，`reasoning_content` 与 `content` **共用** completion 预算，且 reasoning 用量随图片复杂度波动（实测单张铭牌 1.2k–4.9k tokens）。沿用 primary 的 3072 会得到 **HTTP 200 + 空 content** —— 看起来像"降级也挂了"，实际是预算被 reasoning 吃光。故降级通道独立预算 `DEEPSEEK_MAX_TOKENS=16384`，且空 content + 有 reasoning 时打显式错误日志
- **验证**：pytest 574 passed；真实图片实测 MiniMax 与 DeepSeek 两条路（free-form + checklist 12 项 + 多图 3 张 36 observations 全通）；真实进程内把 MiniMax key 打坏 → 日志 `served by fallback (deepseek-flash)`，视觉仍产出 3 certs / 12 observations，第 2、3 次重试走降级缓存未重复调用

### 2026-09-16 — 线上全站 500 + 图片 404（服务器侧 `next build` 删掉运行中的 standalone）

- **症状**：线上部分路由 500、前端渲染 branded「Runtime error / Something caught fire」错误页；`/complipilot/*` 图片与视频全 404（while `/`、`/upload`、`/api/health` 仍 200，极具迷惑性）
- **真根因**：`/opt/attrax/.next/standalone` 被删 —— pm2 `nextjs` 进程的 cwd 指向已删除目录。日志证据：`ChunkLoadError: Cannot find module '.../chunks/ssr/_1z4zay9._.js'`、`Invariant: The client reference manifest for route "/profit/[sessionId]" does not exist`、`/500 ENOENT ... pages/500.html`。触发者是当天 12:11~12:15 在服务器 `/opt/attrax` 里跑的 `npm install && npm run build`（`/tmp/attrax-build.done` = `BUILD_DONE_127`、`/tmp/attrax-build2.done` = `BUILD2_DONE_1`，两次都没成功），`next build` 开跑即清空 `.next/`
- **修复**：本地 `scripts/build-deploy-tarball.sh` 重建完整 tarball（BUILD_ID `gaEfawLViEVVL-teld9_G` / commit `1fc4472`）→ scp → 解包出新的 `.next/standalone/` → `.next/static` 重指软链到 `standalone/.next/static` → `pm2 restart nextjs`。旧 `.next/static` 备份在 `/opt/attrax/.next/_broken-<stamp>/`
- **验证**：`/profit/test` 500→200、`/regulations/*` 正常、全部 chunk/css 200、`/complipilot/{logo.png,ocean-poster.png,ocean-hero.mp4}` 200（正确 content-type）、真实扫描 45s 走通
- **治本**：新增 `scripts/guard-no-server-build.mjs` + `package.json` `prebuild` 钩子 —— cwd 在 `/opt/` 下直接拒绝构建（`ATTRAX_ALLOW_SERVER_BUILD=1` 可放行），本地与服务器两侧均已实测

### 2026-09-15 — Hazard coverage 诚实 + matcher 对比词防御 + 输入不可变（commit `2d8fa19` / HEAD）

- **P0 hazard "observed" 不再撒谎**（7c7f4cb）：`lib/result/inspection-view-model.ts:coverageOf` 对 hazard+0 findings 旧逻辑是无论 visibility 都返 "observed" — J09-skipped 检查（用户声明 `magnets: absent` → 0 findings）会让模糊照片渲染绿色"已观察" badge，含义"合规已确认"，实际根本没看清。修复：只有 `present_readable` 才 collapse 到 "observed"；`not_in_view` / `present_unreadable` / `occluded` 走 "reshoot"，`absent_in_visible_scope` 走 "confirm"。`components/result/InspectionChecklistPanel.tsx:rowFromVMCheck` 同步删 hazard override
- **P0 hazard matcher 拦对比词**（d1839f8）：`rag_service/pipeline/nodes/findings_builder.py:_is_negative_hazard_observation` 旧 substring 匹配会被 `但 / 但是 / 然而 / 不过 / but / however / yet` 引入的真实 defect 截胡（例：`"外壳平整，无可见裂纹…但电池仓附近可见明显氧化锈迹"` → 锈迹 finding 被静默丢弃）。修复：抽 `_NEGATIVE_HAZARD_PHRASES` + 新 `_CONTRAST_MARKERS`，新增 `_is_dominantly_negative_hazard_description` 要求 negative phrase **且**无 contrast marker；新增 `TestP0MixedStateHazardDescriptions` 4 例测试覆盖 rust / burn / 然而 / but / 纯 negative
- **P0 caller observations 不可变**（d1839f8）：同文件 for-loop 旧代码 `obs["visibility"] = "present_readable"` 直接 mutate 输入 dict，违反 CLAUDE.md §不可变模式 CRITICAL。修复：浅拷贝 `effective_obs = {**obs, "visibility": "present_readable"}` 用于本地 rank + best 表项，**不**写回 caller's observations list；新增 `TestP0CallerObservationNotMutated` 测试断言调用方 dict 不变
- **P1 NEGATIVE_VALUES 共享**（7c4d774）：新 `rag_service/pipeline/nodes/declared_facts.py` 导出 `NEGATIVE_VALUES` frozenset + `is_negative_value()` helper；`findings_builder.py` + `generator.py` 都改 import，消除字面 set 重复（两处都用 `{absent, none, no, false, 无, 否, 0, 不含, 无内置电池}`，drift 风险）
- **chore**（498eb08 + 8ded0ce + 2d8fa19 + 2bbda21）：
  - Panel 删 unused `CHECK_CATALOG` import + 删 stale hazard override + `let visibility` → `const`
  - `.gitignore` 加 `.DS_Store` / `.screenshots/regression-*/` / `规航AI-三产品完整测试包-20260914{,.zip}`（Unicode 模式 `git check-ignore` 验证匹配）
  - `scripts/run-production-regression.ts` 3 处硬编码 `/workspace/me/attrax/...` test-package 路径 + gemini artifact dir + 3 处硬编码 prod URL 全改 `__dirname` 相对 + env override
  - `.screenshots/_check.mjs` / `_verify.mjs` / `_verify_tabs.mjs` 删 Windows 路径 + 错误 `localhost:3001` 端口
  - `scripts/build-deploy-tarball.sh` 4 处注释 + log 行 phantom `apply-upload-fix.sh` → `/tmp/attrax-apply-deploy.sh`
  - `scripts/ecosystem.config.cjs` 删 stale "pm2 cron_restart 03:00 UTC" 注释块
  - `docs/WATCHDOG.md` + `scripts/watchdog/README.md` auto-ingest 契约对齐（README 旧版说"库不自动重建"与默认 `ATTRAX_REGWATCH_AUTO_INGEST=true` 矛盾）
  - `docs/infra/NEXTJS-16-STANDALONE-NOTES.md` 删 phantom `pages.module.css`，改成实际 `components/complipilot/{homepage,flow-shell,scan-image-stage,bright-flow}.module.css`

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

第一性原理审查结论：**完全去掉 RAG**（embedding + 向量检索 + BM25 + LangGraph），改为 **Knowledge-Anchored Generation**。LangGraph 编排壳已按 §7.7 塌缩为线性 3 步管线（vision → generate → verify）；must_check + KB 是主路径（spec 当时计划保留 PAI 做 embedding 辅助，实际落地时 embedding 栈整体删除）。完整规格：`docs/plans/2026-09-11-de-rag-evidence-spec.md`。

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

- **绝不在服务器 `/opt/attrax` 里跑 `npm run build`**（2026-09-16 事故）：`next build` 一开跑就清空 `.next/`，连 pm2 正在跑的 `nextjs` 的 cwd（`.next/standalone`）一起删掉。进程不会立刻死（Linux 保留被删目录的 inode），所以 `/api/health` 和首页仍返回 200，看着像"没事"；但 Node 按需加载 chunk —— 已加载的路由照常，**没加载到的路由逐个 `ChunkLoadError` / `MODULE_NOT_FOUND` → 500 + 前端 branded「Runtime error / Something caught fire」**，同时 nginx `root /opt/attrax/.next/standalone/public` 失效 → `/complipilot/*` 图片视频全 404。构建只在本地做；`package.json` 已加 `prebuild` 守卫（`scripts/guard-no-server-build.mjs`）在 `/opt/` 下直接拒绝，确需服务器构建用 `ATTRAX_ALLOW_SERVER_BUILD=1`
- **`pm2 restart` 不读 env 段**：只换代码 / 静态 → `pm2 restart` 足够；换 env（PM2 ecosystem env 段、cwd）→ 必须 `pm2 delete && start`，`restart` 不重读
- **换 `.env` 文件**：`pm2 restart` 即可（pydantic-settings 每次启动读 .env）；换 ecosystem env 段才需要 delete && start
- **Next 16 + Turbopack `output: "standalone"` 不复制 `.next/static/`**（Next 15 还会这么做）：standalone/ 里只有 server.js + 路由 manifest + 最小 node_modules；**部署时必须分别 rsync/tar `.next/standalone/` 和 `.next/static/` 两份到服务器**
- **`standalone/public/` 不存在**（Next 16 standalone 不复制）：必须 `ln -sfn /opt/attrax/public /opt/attrax/.next/standalone/public`，否则 `/complipilot/*` 全部 404
- **裸 `pm2 start server.js --name nextjs --cwd .next/standalone` 会丢 env**：必须用 `pm2 start scripts/ecosystem.config.cjs --only nextjs` 让 env 块注入
- **nginx `_next/static/` 用 `alias <root>/.next/static/`**（不用 snippet 的 `root $nextjs_root`）：Next 16 下 standalone/ 没有 `.next/static/`，URI 映射不到文件
- **`/api/health` 200 不代表 BFF→rag auth 通**：还要跑一次真实扫描（提交 + 轮询 + 看结果）才能确认 `RAG_INTERNAL_SECRET` 等关键 env 生效
- **`openrsync` 大目录会崩**：`.next/standalone` 用 `tar -C .next -czf - X | ssh aliyun-sz 'tar -xzf -'`；小目录 rsync OK
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
npm run test:rag               # rag_service/tests/（自动挑 rag_service/.venv 的 python）
rag_service/.venv/bin/python -m pytest scripts/watchdog/tests/ -q   # watchdog + 脚本回归

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
- `docs/README.md` §生产部署 — 部署入口（aliyun-sz git-bundle + tar 流程）
- `CHANGELOG.md` — 历史修复 + 事故记录

---

*最后更新：2026-09-19*

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
