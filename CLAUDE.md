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

- **框架**：FastAPI 0.115.6 + LangGraph 1.1.6
- **语言**：Python 3.10+
- **向量检索**：FAISS（IndexHNSWFlat，1024 维，M=32/efConstruction=200/efSearch=64）+ BM25（jieba 分词）。2026-06-29 由 IndexFlatIP 转换而来（`scripts/convert_faiss_to_hnsw.py`，无重新 embedding），真实查询 recall@10≈99.96%
- **Embedding**：ModelScope Qwen3-Embedding-0.6B（云端 API，1024 维，生产唯一路径）。⚠️ Ollama embedder 代码存在但**未接入检索探测**（`hybrid_retriever._probe_embedders` 仅探测 ModelScope），ModelScope 不可用时直接降级到 BM25-only
- **LLM**：MiniMax-M3（Anthropic SDK，端点 `https://api.minimaxi.com/anthropic/v1`）
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

> **重要**：前端调用 RAG 服务时使用端口 **8001**（不是 8000），配置在 `RAG_SERVICE_URL` 环境变量，代码见 `lib/rag-client/client.ts`。
> docker-compose 映射为 `8001:8000`（容器内 8000，宿主机 8001）。

### 多市场支持

- 默认市场：`EU`, `US`
- 支持列表：`EU` / `US` / `UK` / `CN` / `AU` / `SA` / `AE` / `JP` 等
- LangGraph `Send()` fan-out 实现多市场并行检索

### 会话存储

- **内存层**：`globalThis.__scanStore`（Map，TTL 1小时）
- **文件层**：`data/sessions/{sessionId}.json`（JSON 文件持久化）
- **服务端**：RAG 服务自管会话（`rag_service/` FastAPI + SQLite/文件后端）
- 前端代码：`lib/rag-client/v1-adapter.ts`（创建扫描）/ `lib/rag-client/client.ts`（HTTP 封装）/ `app/api/scan/route.ts`（BFF 路由）
- ⚠️ 旧本地管线 `lib/pipeline/scan.ts` + `scan-queue.ts` 已于 2026-09-10 删除（死代码，见 docs/plans/2026-09-09-optimization-audit.md §1.1）

### 降级模式

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| DEMO_MODE | `DEMO_MODE=true` 环境变量 | 使用 Mock 数据，无需 API Key |
| Embedding 降级 | ModelScope API 不可用 | 降级到 BM25-only（**无 Ollama 自动 fallback**，探测仅含 ModelScope） |
| 引用验证 | 生产环境（NLI 模型未注入） | text-overlap 词重叠降级；`verification_mode` 字段 + `/health` 暴露真实模式 |
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
```

---

## 目录结构

```
attrax/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # 首页
│   ├── layout.tsx                # 根布局（i18n Provider）
│   ├── [locale]/page.tsx         # i18n 首页变体
│   ├── upload/page.tsx           # 上传页
│   ├── burning/[sessionId]/      # 扫描中动画页
│   ├── result/[sessionId]/       # 结果页（合规 + 利润 + 决策 + 路线图）
│   ├── regulations/page.tsx      # 法规更新列表
│   ├── trace/[sessionId]/        # Agent 轨迹页
│   ├── roadmap/[sessionId]/      # 合规路线图页
│   └── api/                      # Next.js API 路由
│       ├── session-access.ts     # 会话访问 token 校验
│       ├── scan/route.ts         # POST /api/scan — 创建扫描
│       ├── scan/[sessionId]/     # GET 轮询状态
│       ├── regulations/updates/  # GET 法规更新
│       ├── trace/[sessionId]/    # GET Agent 轨迹
│       ├── roadmap/[sessionId]/  # GET 合规路线图
│       └── health/               # GET 健康检查
│
├── components/                   # React 组件
│   ├── ui/                       # shadcn/ui 基础组件（11 个）
│   ├── upload/UploadForm.tsx     # 上传表单
│   ├── burning/BurningAnimation.tsx  # 扫描中动画
│   ├── result/                   # 结果展示
│   │   ├── AgentTraceView.tsx    # Agent 轨迹视图
│   │   └── ProfitReportView.tsx  # 成本利润报告视图（含 PDF/DOCX 导出）
│   ├── trace/                    # 轨迹可视化
│   │   ├── AgentDecisionTree.tsx
│   │   └── ComplianceTimeline.tsx
│   └── PageTransition.tsx        # 页面过渡动画
│
├── lib/                          # 核心库
│   ├── types.ts                  # TS 类型（Market/ProductCategory/ScanStatus/...）
│   ├── schemas.ts                # Zod Schema
│   ├── utils.ts                  # 工具函数
│   ├── constants.ts              # 共享常量（超时/限额/限流）
│   ├── api-response.ts           # API 响应信封（ok/fail/unwrapApiData）
│   ├── i18n.tsx                  # 前端 i18n（TranslationProvider/useTranslation）
│   ├── server-i18n.ts            # 服务端 i18n（serverT/SCAN_STAGE_TEXT）
│   ├── rate-limit.ts             # 限流
│   ├── upload-validation.ts      # 上传文件校验
│   ├── report-localization.ts    # 报告字段本地化
│   ├── report-export.ts          # 报告导出入口
│   ├── report-export-modules/    # 报告导出实现（compliance/profit/decision/roadmap/shared）
│   ├── pipeline/
│   │   ├── session-store.ts      # 会话存储（globalThis + 文件；仅旧 demo 路径）
│   │   ├── session-auth.ts       # 会话访问 token（哈希 + 校验）
│   │   ├── profit-report.ts      # 成本利润报告
│   │   └── report-package.ts     # 报告包结构
│   ├── mock/scan-result.ts       # Demo 模式模拟数据
│   └── hooks/useScanPolling.ts   # 轮询 hook
│
├── rag_service/                  # Python RAG 服务（FastAPI，端口 8001）
│   ├── main.py                   # FastAPI 入口（/scan, /health, /profit-report）
│   ├── config.py                 # settings（环境变量读取）
│   ├── orchestrator/             # LangGraph 编排
│   │   ├── graph.py              # StateGraph 装配（8 节点）
│   │   ├── state.py              # GraphState 定义
│   │   └── nodes/                # 节点
│   │       ├── vision.py
│   │       ├── query_planner.py
│   │       ├── retriever.py
│   │       ├── synthesis.py
│   │       ├── generator.py
│   │       ├── verifier.py
│   │       └── refiner.py
│   ├── retrieval/                # 检索管线
│   │   ├── hybrid_retriever.py   # 混合检索主类
│   │   ├── faiss_retriever.py    # FAISS 向量检索
│   │   ├── bm25_retriever.py     # BM25 稀疏检索
│   │   ├── modelScope_embedder.py # PAI text-embedding-v4（1024 维，2026-09-10 从 ModelScope 切换；batch≤10 硬限）
│   │   ├── ollama_embedder.py    # Ollama Embedding（fallback）
│   │   ├── fusion.py             # RRF 融合
│   │   # ⚠️ cohere_embedder/cohere_reranker 已删除（2026-09-10）：源码早已不存在，
│   │   #    旧文档误标“已实现”；requirements 中的 cohere 依赖已同步移除
│   │   ├── must_check.py         # 品类+特征规则矩阵（**报告主锚点**，A+B 混合）：
│   │   #                            CATEGORY_REGULATIONS（10 品类×7 市场）+
│   │   #                            FEATURE_REGULATIONS（battery/wireless/mains/children）
│   │   #                            detect_features + build_anchor_list 供 generator
│   │   #                            直接消费；apply_must_check 仍是检索侧引用注入
│   │   └── metadata_filter.py    # 检索元数据过滤
│   ├── parser/                   # 文档解析
│   │   ├── docx_parser.py
│   │   └── html_parser.py
│   ├── verify/citation_verifier.py  # 引用验证（生产 text-overlap 降级，NLI 未注入；verification_mode 暴露；无引用报告 coverage=0.0→REJECTED）
│   ├── generate/
│   │   ├── report_generator.py   # LLM 报告生成（Anthropic SDK）
│   │   └── prebuilt_profit_data.py
│   ├── schemas/report_package.py # 报告包 Pydantic Schema
│   ├── chunker/legal_chunker.py  # Parent-Child 法律分块
│   ├── regulation_collectors/    # 法规离线采集（base/eu_rdf/powershell_fetcher）
│   ├── eval/                     # 检索评估（metrics/run_eval）
│   └── tests/                    # pytest 单元测试
│
├── data/                         # 数据文件
│   ├── faiss/                    # FAISS 索引（legal_chunks.index, *_meta.json）
│   ├── corpus/                   # 法规语料
│   │   ├── processed/            # 已解析 JSON（~140 个）
│   │   ├── corpus_index.json     # 语料索引
│   │   ├── manifest.json         # 语料 manifest
│   │   ├── quality_report.json   # 质量报告
│   │   ├── asia/                 # 东南亚（indonesia/malaysia/singapore/thailand/vietnam）
│   │   ├── cn/                   # 中国法规
│   │   ├── eu/                   # 欧盟（regulations/html/uk/）
│   │   ├── gcc/                  # 海湾国家 G-Mark
│   │   ├── intl/                 # 国际组织（un/wipo）
│   │   ├── middle_east/          # 中东（saudi/uae）
│   │   └── us/                   # 美国（regulations/）
│   ├── regulation_supplements/   # 法规补充包（6 个日期批次 + manifest + audit）
│   ├── regulation_reports/       # 法规覆盖率报告
│   ├── sessions/                 # 会话文件（TTL 1小时）
│   └── scan-queue/               # 扫描任务队列（持久化）
│
├── tests/                        # 前端测试
│   ├── unit/                     # Vitest 单元测试（30+ 文件）
│   ├── e2e/                      # Playwright E2E 测试
│   ├── fixtures/                 # 测试数据
│   ├── pressure/                 # 压力测试脚本
│   └── setup.ts                  # 测试配置
│
├── public/                       # 静态资源
│   └── (默认 Next.js 资源)
│
├── docs/                         # 项目文档
│   ├── README.md                 # 文档索引
│   ├── PROJECT.md                # 项目描述
│   ├── PRD.md                    # 产品需求
│   ├── PROJECT-STATUS.md         # 上线评估
│   ├── RAG-ARCHITECTURE-v3.md    # RAG 架构（当前）
│   ├── DOCUMENT-PIPELINE.md      # 语料库构建
│   ├── DEPLOYMENT.md             # 部署指南
│   ├── regulation-data-sources-coverage-2026-05-27.md
│   ├── plans/                    # 修复计划
│   │   ├── ATTRAX_REMEDIATION_PLAN_2026-06-18.md
│   │   └── 2026-05-23-full-remediation-design.md
│   └── superpowers/specs/        # 架构设计 spec
│
└── scripts/                      # 运维脚本
    ├── build_faiss.py            # 构建 FAISS 索引（主）
    ├── collect_*.py              # 5 个法规离线采集脚本
    ├── ingest_regulation_supplements.py
    ├── diff_regulation_manifests.py
    ├── report_regulation_coverage.py
    ├── evaluate_regulation_retrieval.py
    ├── preflight-deploy.mjs
    ├── run-pytest.mjs
    ├── start_rag.bat             # Windows 启动
    ├── sync-data-to-server.sh
    ├── deploy.sh / deploy.ps1
    └── start-rag.bat             # 根目录启动
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
| `MINIMAX_API_KEY` | - | 是 | LLM API Key（兼容旧 `MIMOTALK_API_KEY`） |
| `MINIMAX_BASE_URL` | `https://api.minimaxi.com/anthropic/v1` | 否 | Anthropic 兼容 LLM 端点 |
| `MINIMAX_MODEL` | `MiniMax-M3` | 否 | 模型名称 |
| `MODELSCOPE_API_KEY` | - | 是（非 Demo） | ModelScope Embedding API Key |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | 否 | Ollama 地址 |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | 否 | Ollama Embedding 模型 |
| `RAG_SERVICE_URL` | `http://localhost:8001` | 否 | RAG 服务地址 |
| `DEMO_MODE` | `false` | 否 | Demo 模式（Mock 数据，无需 API Key） |
| `DAILY_FREE_SCAN_LIMIT` | `3` | 否 | 每日免费扫描次数 |

### RAG 服务（`rag_service/.env`）

同上前端变量（Ollama、ModelScope、LLM 等），RAG 服务从 `rag_service/.env` 读取。

### 关键 RAG 服务环境变量

| 变量 | 说明 |
|------|------|
| `RAG_ALLOWED_ORIGINS` | CORS 白名单（逗号分隔） |
| `FAISS_INDEX_DIR` | FAISS 索引目录覆盖（默认 `data/faiss/`） |
| `SCAN_WORKER_CONCURRENCY` | 扫描 worker 并发数（默认 **5**，见 `config.py`） |

---

## 已知限制

| 限制 | 说明 |
|------|------|
| **无持久化** | 会话仅存储 1 小时（内存 + 文件 TTL），无数据库 |
| **无用户系统** | 无登录/注册/权限控制（Demo 模式有访问 token 校验） |
| **cohere 依赖已移除** | embedder/reranker 源码早已不存在，2026-09-10 起文档与 requirements 同步删除（生产仅 ModelScope + BM25 fallback） |
| **requirements 快照** | 生产安装用 `requirements-prod.txt`；原 `requirements.txt`（500+ 条）已改名 `requirements-snapshot.txt` 并标注勿安装 |
| **无多语言报告** | 报告目前仅中文输出 |

---

## 最近修复（2026-06-29 对抗性审计后）

### 2026-09-10（下午）A+B 混合架构：must_check 升主源（e4da8d5）

第一性原理审查结论：语料仅 26MB/7170 chunks 且冻结在 6 月索引、embedding 单点故障 3 个月无人察觉、用户真实需求是"清单+理由"而非全文检索。**规则矩阵（must_check.py）是报告主锚点，语料检索是补充引用。**

- **特征矩阵**：`FEATURE_REGULATIONS`（battery/wireless/mains/children 横切特征）+ `detect_features`（vision core_features 关键词探测，精确优先防误联想）+ `build_anchor_list`（品类+特征合并去重、按目标市场过滤、UN 运输法规恒含）
- **生成锚定**：`generator_node` → `generate_report_package(mandatory_regulations=...)` → prompt 渲染「必检法规清单」，每条必须出现在报告中；检索证据不足仍需列出并标注「依据规则库，待核实原文」
- **品类 6→10**：+battery/cosmetic/textile/food_contact（矩阵早已存在但前端选不到——枚举不同步的实体 bug，tsc 连锁揪出 4 处 Record）
- **PAI embedding**：ModelScope key 吊销 → 阿里云 PAI `text-embedding-v4`（1024 维同构，索引重建当日完成）。⚠️ PAI batch≤10 硬限（超限 400）
- **不再投入**：reranker 训练 / 语料大规模扩充 / 引用覆盖率硬约束 / NLI 注入（见 handoff 2026-09-10）
- **计划中**（未实施）：EU Safety Gate 召回数据入库（喂 riskPoints）/ 语料周更 cron / web_search 工具（B 部分）

### 2026-09-10 审计批处理（docs/plans/2026-09-09-optimization-audit.md）

- **删除死代码**：`lib/pipeline/scan.ts`(470) + `scan-queue.ts`(467) + `components/upload/UploadForm.tsx`(509) + `LegacyResultView` 及其测试（scan-pipeline / scan-queue / scan-comprehensive / upload-form / result-imagecarousel-legacy）。`upload-storage.ts` 标 @deprecated。生产路径唯一：`/api/scan → v1-adapter → RAG /api/v1/scans`
- **P0-1 渲染闭环**：`DegradedBanner` + `SourceNotice` 真正接入 `app/result/[sessionId]/page.tsx`（成功态 + 空风险态），降级原因由 `use-result-loader` 轮询记录
- **result page 拆分**：1215 → 807 行。纯函数抽到 `lib/result-view-helpers.ts`，轮询抽到 `app/result/[sessionId]/use-result-loader.ts`，非成功态抽到 `result-state-panels.tsx`
- **常量去重**：`ALLOWED_MARKETS` / `MAX_MARKETS_PER_SCAN` 唯一来源 `rag_service/config.py`
- **安全**：POST /api/scan 的 accessToken 进响应体改为 `ATTRAX_DEBUG_TOKEN=1` 显式 opt-in
- **依赖清理**：npm 删 5 个零引用包；requirements 删 cohere；requirements.txt → requirements-snapshot.txt
- **generator.py 加固**：agent_trace 的 full_trace/state-return 分离处加维护红线注释
- **验证**：vitest 63 files/914 tests 全绿；pytest 562 全绿（空 env 覆盖本地 .env 后）；tsc/build 通过
- **遗留**：CSP nonce 化、/metrics + OTel、worker 拆池、demo data.ts 拆分（见审计长期项）

> 5-agent 并行对抗性审计后修复 P0/P1。核心主题：消除"降级路径系统性制造虚假可信"（合规报告不再静默呈现降级/空内容为"成功"）。

### 已修复（P0/P1）
- **P0-1**：RAG/LLM 失败时前端显示红色 `DegradedBanner`（role=alert + aria-live）；`sessionPayload` 重新暴露 `degradedReason`
- **P0-2**：无引用报告 `citation_coverage=0.0`→REJECTED（不再 `1.0` 自动满分过 PASS 门）
- **P0-3**：引用验证诚实暴露 `verification_mode`（nli / text_overlap / unverified），verifier node 不再静默 PASS；main.py NLI 未注入时打 warning
- **P0-4**：LLM 空串/失败时 status 写 `generation_failed`/`error`（不再 success）；`validationStatus` 标记 normalized/fallback/invalid
- **P0-5**：新增 `test_graph_e2e.py`（9 用例）首次端到端覆盖 compiled graph（Send fan-out / refine 路由 / max_attempts / 失败路径）
- **P0-6**：`RAG_INTERNAL_SECRET` 改 fail-closed（prod 空 secret 拒绝启动 / 非 prod 自动生成临时 secret，写入端点默认 401）
- **P1-1**：`updateSession` 禁止覆盖 `accessTokenHash`；生产 `createSession` 强制必填
- **P1-2**：`withWriteLock` 真串行化；`enqueueScan` 失败回滚 createSession + 返回 503
- **P1-3**：`updateSession` 在 progress<100 时延长 `expiresAt`（长任务不再被 TTL 提前清除）
- **P1-4**：`legal_chunks_meta.json`（345MB）改分片流式加载（峰值 ~800MB→~10MB/分片）；迁移工具 `FaissRetriever.split_meta_to_shards()`
- **P1-5**：tmp 文件名加 randomBytes（防 EPERM 碰撞）；`/health`、`/ready` 收敛敏感字段 + privileged 守卫
- **P1-6**：限流客户端指纹改多维度（可信IP > cookie > UA+accept-language+accept-encoding），消除 `daily:unknown` 全站共享
- **P1-7**：评测集重建（移除 chunk 词生成查询的数据泄漏，24 条自然语言查询集覆盖 UK/AU/SA/AE/JP，faithfulness 改 key_facts checklist）
- **P1-8**：本文件文档对齐（删 Ollama fallback 虚假宣称、NLI 验证宣传、SCAN_WORKER_CONCURRENCY=1）
- **P2**：scan-queue job 改 side-car `.bin` 引用 + 配额（170MB/500MB）；新增 API 路由集成测试（不 mock 整库）

### 基础设施迁移（2026-06-29，P2 续）
- **IndexFlatIP→HNSW**：`scripts/convert_faiss_to_hnsw.py` 从现有 flat 索引重构 14495 个向量直接建 HNSW（M=32/efConstruction=200），**无重新 embedding、无 API 调用**（~1.5s）。真实 chunk-vector 查询 recall@10≈99.96%、self-recall@1≈99.6%（efSearch=64，对比 flat 基线）。`build_faiss.py` 默认后端改为 `hnsw`；flat 备份留 `legal_chunks.flat.index.bak`，需 `FAISS_INDEX_TYPE=flat` 才回退
- **FastAPI 0.109 升级**：已落地至 `0.115.6`（`requirements-prod.txt` + Dockerfile + 安装环境均为 0.115.6，starlette 0.41.3）。全量 pytest 回归通过（327/328，唯一失败为预存在的 supplement manifest 文件大小断言，与本任务无关）。代码已用现代 API（`lifespan`/`@app.middleware`/`add_exception_handler`），无 0.109 残留兼容代码

### 已知遗留（需运维 / 单独任务）
- **限流迁 Redis**：用户确认短期用不到，留 TODO
- **rag-service 单 worker 扫字段内存在 700MB~960MB 之间波动**：单 worker 串行处理扫描时，多市场 BM25 索引构建会推高 RSS 到 ~960MB。已通过 `ecosystem.config.cjs` 把 `max_memory_restart` 从 900M 调到 1300M（留 300MB 给 nextjs+系统，超出走 swap）解决。但单 worker 仍是瓶颈：并发扫描会串行等待。后续若加并发，需先扩容内存或拆 worker
- **agent_trace 乘法级复制风险**：Send() fan-out + refine 循环下 trace 指数增长（默认 max_attempts=2 安全；配置不当会 OOM 而非平滑触发 recursion_limit），待修

### 2026-07-18 事故 + 修复
- **症状**：服务器 load 飙到 111、可用内存 58MB、sshd banner 60s 等不到（"Exceeded MaxStartups"只是症状）；公网 HTTPS 502；前端疯狂 400 Bad Request（`Failed to find Server Action`，BUILD_ID 与浏览器不匹配）
- **真根因（2 层）**：
  1. 前端 BUILD_ID 旧（`xeMxi3QS...`），浏览器 Server Action ID 与新版不匹配 → 扫描提交 400 + 反复重试
  2. rag-service `--workers 1` + 扫描 280s 超时（LLM `json.loads failed` 反复重试 → 单 worker 被卡 + 内存涨到 960MB）→ `max_memory_restart: 900M` 过低 → pm2 频繁重启 → meta.json 95MB 未分片全量加载加剧崩溃循环
- **部署修复**：上传修复 commit `dd6cbf5` → 正确部署包（含 static，重打）→ BUILD_ID 更新为 `mDqQgaYI9r6HRqiCd-cXr` → Server Action 错误清零
- **运维修复（已落地）**：
  - **meta.json 95MB 分片完成**：`FaissRetriever.split_meta_to_shards('data/faiss/legal_chunks_meta.json', 50)` → 50 分片各 ~3MB，加载器自动识别，逐片加载（峰值从一次性全量降到单分片），原 95MB 保留作 fallback
  - **max_memory_restart: 900M → 1300M**（rag-service，留 300MB 给 nextjs+系统，超出走 4GB swap）
- **未混淆**：限流不是原因（日志 0 条 429）。限流客户端指纹 P1-6 已升级多维度

---

## 常用命令

```bash
# 前端
npm run dev                    # 启动前端（3000）
npm run build                  # 构建生产版本
npm run test                   # Vitest 单元测试
npm run test:e2e              # Playwright E2E 测试
npm run lint                   # ESLint

# RAG 服务
D:\python\python.exe -m uvicorn rag_service.main:app --reload --port 8001
D:\python\python.exe -m pytest rag_service/tests/ -v
D:\python\python.exe scripts/build_faiss.py --limit N   # 重建 FAISS 索引

# 一键启动
start-all.bat                  # 前端 + RAG 同时启动
start-rag.bat                  # 仅启动 RAG 服务
```

---

## 文档索引

- `docs/README.md` — 文档索引和快速开始指南
- `docs/PROJECT.md` — 项目描述和技术栈
- `docs/PRD.md` — 产品需求文档
- `docs/RAG-ARCHITECTURE-v3.md` — RAG 技术架构详情（当前）
- `docs/DOCUMENT-PIPELINE.md` — 语料库构建流程
- `docs/PROJECT-STATUS.md` — 上线评估报告
- `docs/API-CONTRACT.md` — RAG HTTP 端点契约（5 端点 + 错误码 + 鉴权 + 降级）
- `docs/MOCK-REAL-MAPPING.md` — mock vs 真实 RAG 响应字段对照 + 漂移清单
- `lib/rag-client/` — 前端 RAG 客户端层（`client.ts` / `errors.ts` / `response-schemas.ts` / `report-package-schema.ts`）
- `lib/rag-client/openapi.snapshot.json` — 从运行中 RAG 服务抓取的 OpenAPI 规范（CI 会校验）
- `docs/plans/ATTRAX_REMEDIATION_PLAN_2026-06-18.md` — 修复路线图

---

*最后更新：2026-06-29*

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
