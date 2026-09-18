# 01 · 架构总览

## 核心要点（30 秒读完）

- **产品本质**：用户上传一张产品图 → AI 识别品类与特征 → 按规则知识库（KB anchors）+ 法规原文生成带确定性引用的合规报告。
- **三段式架构**：浏览器 → Next.js 16 BFF（端口 3000，nginx 反代 443）→ FastAPI RAG（端口 8001，仅 loopback）。
- **流水线**：线性三步 `vision → generate → verify`（无 LangGraph、无向量库），单一 LLM 调用链。
- **法规与 KB**：44 篇法规 YAML + 44 个 KB 锚点 + 35 个 watchdog 监控源；改动自动入库。
- **运营栈**：单台 aliyun-sz 阿里云深圳（实际 2 vCPU / 1.6GB；4 vCPU / 8GB 假设需 `lscpu` 复核）+ pm2 跑 nextjs + rag-service + regwatch 三个守护进程。
- **关键术语**：de-RAG = 去 RAG 架构（2026-09-11 之后的迁移）。KB 锚点 = 「强制 LLM 引用这些法规，不允许自创」。anchor list = 给某次扫描激活的法规集合。

## 一句话

attrax 让用户上传一张产品图，AI 识别品类与可见特征，从规则知识库（KB anchors）+ 法规原文库里挑出必须覆盖的法规条款，让 LLM 按锚点生成带逐条引用的合规报告，再用确定性字符串比对验证 LLM 引用的真实性。最终页面附带利润分析、商业决策与路线图。

## 顶层组件

```
┌────────────────────────┐      ┌────────────────────────┐
│ 浏览器 (Next.js 渲染)   │ ───► │ Next.js BFF (/api/*)   │
│  app/result/[sessionId] │ ◄─── │  app/api/scan/*        │
└────────────────────────┘      └─────────┬──────────────┘
                                          │ Bearer + sessionId
                                          │ (HttpOnly cookie)
                                          ▼
                       ┌────────────────────────────────────┐
                       │ RAG FastAPI (/api/v1, 端口 8001)    │
                       │   POST /api/v1/scans (multipart)   │
                       │   GET  /api/v1/scans/{id}          │
                       │   POST /api/v1/scans/{id}/evidence │
                       │   POST /api/v1/scans/{id}/revisions│
                       │   GET  /api/v1/regulations/{docId} │
                       │   GET  /health, /ready             │
                       └────────────────┬───────────────────┘
                                        │ KB anchors + 法规条文
                                        ▼
              ┌────────────────────────────────────────────┐
              │ Pipeline (de-RAG, vision → generate → verify) │
              │  VisionAnalyzer  (MiniMax+DeepSeek 双供应商) │
              │  ReportGenerator (MiniMax+DeepSeek 双供应商) │
              │  quote_matcher  (确定性字符串比对)            │
              └────────────┬───────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────────────┐
        │ 数据：data/regulations/*.yaml + kb/anchors   │
        │  data/regulation_supplements/watchdog-*/     │
        └──────────────────────────────────────────────┘
```

## 端口与协议

| 服务 | 监听 | 公开/反代 | 备注 |
|---|---|---|---|
| Next.js 16 standalone | `127.0.0.1:3000` | nginx `attrax_nextjs` upstream → 443 | 前端 + BFF；不能从公网直连 |
| RAG FastAPI | `127.0.0.1:8001` | 不开反代 | 浏览器永远走 `/api/scan/*` BFF，绕开 8001 |
| watchdog | 不开端口 | pm2 守护 | 内部 Python 子进程，凌晨巡检 |
| nginx | `0.0.0.0:443` + `80` | 公网 | TLS 1.2/1.3，certbot 续期 |

> 详见 [`05-frontend-and-bff.md`](./05-frontend-and-bff.md) 与 [`06-server-security.md`](./06-server-security.md)。

## 关键约定（直读自 `CLAUDE.md` §关键约定）

- **多市场**：16 个（EU/US/UK/CN/AU/SA/AE/JP/KR/CA/SG/MX/BR/DE/FR/IT），白名单由 `lib/types.ts:MARKET_IDS` 与 `rag_service/config.py:ALLOWED_MARKETS` 双向同步（2026-09-13 审计 P0-5 修复漂移）。
- **品类**：10 个，规范形式是单数 `electronics / toy / battery / textile / cosmetic / food_contact / appliance / 3c / home / other`（`lib/types.ts:PRODUCT_CATEGORIES`）。BFF 的 `ALLOWED_CATEGORIES` 额外接受复数写法以兼容历史输入，KB anchor 与管线内部统一用单数。
- **特征**：`battery / wireless / mains / children`（横切品类，决定是否额外锚点生效）。
- **默认市场**：`["EU", "US"]`，前端 `StartScanRequestSchema` 的 `.default(...)`。
- **会话**：RAG 服务自管（`data/backend/sessions/`，TTL 24h）。访问令牌 32-byte 随机串，SHA-256 哈希存盘；`/api/scan/[sessionId]` 之间通过 HttpOnly cookie 或 `Authorization: Bearer` 二次校验。
- **降级矩阵**：

  | 触发 | 行为 |
  |---|---|
  | `DEMO_MODE=true` | Mock 数据，不调 LLM |
  | 识图失败 | 同一观察请求改发 DeepSeek OpenAI 兼容 `/chat/completions`；未配 key = 关闭降级 |
  | 报告生成失败 | 同一 body 改发 DeepSeek Anthropic 兼容端点（`DEEPSEEK_ANTHROPIC_BASE_URL`，含 `/v1`） |
  | RAG 不可达 | 前端降级为 `degraded` + 红色横幅 |

  详细逻辑见 [`04-backend-pipeline.md`](./04-backend-pipeline.md) §降级。

## de-RAG 时间线（去 RAG 架构迁移）

参考 `docs/plans/2026-09-11-de-rag-evidence-spec.md`：

1. **旧形态**：LangGraph `StateGraph` 编排 + FAISS / BM25 检索栈 + PAI embedding + 自建 NLI 验证。
2. **2026-09-11 spec 冻结**：完全去掉 embedding 与向量检索，改为「规则知识库（must_check / KB anchors）+ 法规原文（article_loader）+ LLM 按锚点生成」三段式。
3. **2026-09-13 落地**：LangGraph 状态机塌缩为线性三步 `vision → generate → verify`（`rag_service/pipeline/runner.py`）。
4. **2026-09-15~17 收尾**：embedding 栈（PAI/ModelScope）整栈删除；`vision.py` 与 `report_generator.py` 都加了 DeepSeek 双供应商降级；`quote_matcher.py` 取代旧 NLI verifier。

> 现存的 `data/regulations/` 与 `data/kb/anchors/` 是这次重构后唯一保留的两份「离线整理的语料」。其余语料（PDF 原文 DOCX/HTML）由 watchdog 拉取后落到 `data/regulation_supplements/`，不入版本控制（`*.raw/`）。

## 仓库目录地图

```
attrax/
├── app/                          # Next.js App Router 页面
│   ├── api/scan/                 # BFF 路由（POST 创建 / GET 轮询 / evidence / revisions）
│   ├── api/regulations/updates/  # 法规更新列表
│   ├── api/regulations/[docId]/  # 单条法规原文
│   ├── burning/[sessionId]/      # 扫描中动画页
│   ├── result/[sessionId]/       # 结果页（合规 + 利润 + 决策 + 路线图）
│   ├── upload/page.tsx           # 上传页
│   └── pricing/, regulations/, profit/  其他页面
│
├── components/
│   ├── result/                   # ComplianceReportView / EvidenceRequestPanel /
│   │                             # InspectionChecklistPanel / FloatingEvidenceCrop /
│   │                             # HotspotLayer / ObservationHotspotLayer /
│   │                             # AgentTraceView / DegradedBanner / DownloadButtons
│   ├── complipilot/              # 品牌 UI
│   ├── regulation/               # CitationChip / DocViewer / LinkBackToReport
│   └── blaze-hawks/              # BlazeLocaleProvider（locale 真值源）
│
├── lib/
│   ├── types.ts                  # 共享类型 + MARKET_IDS（scan 校验内联在 app/api/scan/route.ts）
│   ├── rag-client/v1-adapter.ts  # 唯一的 RAG HTTP 封装（其余 client.ts 已删除）
│   ├── pipeline/session-auth.ts  # 会话 token（哈希 + 常量时间比对）
│   ├── pipeline/demo-scan-session.ts
│   ├── pipeline/profit-report.ts
│   ├── rate-limit.ts             # BFF 单进程固定窗口（10 / 60s）
│   ├── result/inspection-view-model.ts
│   ├── report-export-modules/    # 报告导出（compliance/profit/decision/roadmap/evidence-pack）
│   └── upload/category-manifest.ts
│
├── rag_service/                  # Python FastAPI（端口 8001）
│   ├── main.py                   # FastAPI 入口（/scan、/health、/ready、/api/v1/*）
│   ├── config.py                 # pydantic-settings 读 .env
│   ├── api/v1.py                 # 公开 v1 API（multipart + Bearer + scan_service DI）
│   ├── application/scans.py      # ScanService：会话生命周期 + 异步 job + 证据 / 重扫
│   ├── infrastructure/file_backend.py
│   ├── pipeline/
│   │   ├── runner.py             # 线性 3 步管线（vision → generate → verify）
│   │   ├── state.py              # GraphState 定义
│   │   └── nodes/                # vision / generator / verifier / findings_builder /
│   │                             # visual_checks / declared_facts
│   ├── retrieval/
│   │   ├── must_check.py         # build_anchor_list（品类 + 特征 → 必查法规清单）
│   │   ├── kb_loader.py          # 加载 data/kb/anchors/*.yaml（自失效缓存）
│   │   └── article_loader.py     # 加载 data/regulations/{region}/*.yaml（含 source_kind 治理）
│   ├── verify/
│   │   ├── applicability.py      # 三态 ProductFacts：confirmed / candidate / absent
│   │   ├── grounding.py          # grounding 验证
│   │   ├── quote_matcher.py      # 确定性引用验证（matched / fallback / unmatched）
│   │   └── vision_cache.py       # VisionAnalyzer LRU 缓存（按图像 hash + provider key）
│   ├── generate/report_generator.py
│   ├── schemas/                  # Pydantic：ReportPackage / VisualInspection
│   ├── regulation_collectors/    # base / eu_rdf / powershell_fetcher（手动采集）
│   └── tests/                    # pytest 单元测试
│
├── data/
│   ├── regulations/              # 44 篇 YAML（eu/ us/ cn/ uk/ au/ un/ 共 6 region）
│   ├── kb/anchors/               # 44 个 KB YAML（每个一篇法规）
│   ├── inspection_profiles/      # 11 个视觉检查 profile
│   ├── regulation_sources/       # 35 个 watchdog 监控源注册表
│   ├── regulation_supplements/   # watchdog 自动入库产物（不入库，约 400MB）
│   └── corpus/                   # watchdog 维护的语料 HTML（运行时）
│
├── docs/                         # 项目自带文档（与本套独立）
│   ├── plans/                       # de-RAG + judge review + 优化审计
│   ├── regulations/                # 法规清单与官方源
│   ├── infra/                      # 服务器配置快照
│   ├── SECURITY.md                 # 安全政策
│   ├── WATCHDOG.md                 # watchdog 运维手册
│   └── FRONTEND-BACKEND-INTEGRATION.md  # 现行 API 契约
│
├── scripts/
│   ├── ecosystem.config.cjs      # pm2 配置（nextjs + rag-service + regwatch）
│   ├── build-deploy-tarball.sh   # 本地构建 + 打 tarball（写 .deployed 标识）
│   ├── apply-deploy.sh           # 服务器端解包（保留 2 份可回滚）
│   ├── backup-data.sh            # 每日 03:00 数据备份
│   ├── backup-remote.sh          # 异地备份（当前未配置目标，no-op）
│   ├── check-rag-openapi-drift.mjs  # CI：OpenAPI 快照 vs 真实路由
│   ├── check_i18n_consistency.py
│   ├── collect_official_sources_from_registry.py
│   ├── e2e_kb_pipeline.py
│   ├── eval_grounding.py         # 评测：grounding
│   ├── report_regulation_coverage.py
│   ├── run-production-regression.ts
│   ├── guard-no-server-build.mjs # 守卫：服务器 /opt/ 下拒绝 next build
│   └── watchdog/                 # 见 [03-regulation-update-watchdog.md](./03-regulation-update-watchdog.md)
│
├── public/                       # 静态资源（fonts/NotoSansSC-Regular.ttf 17MB 入库——PDF 导出依赖）
├── tests/                        # vitest 单元 + playwright e2e + pressure 压测
└── middleware.ts                 # Next.js 中间件
```

## 部署形态（关键事实）

- 不走 docker-compose、不走 Ansible；`scripts/ecosystem.config.cjs` 用 pm2 在生产跑 `nextjs` + `rag-service` + `regwatch`。
- 构建产物走本地 `bash scripts/build-deploy-tarball.sh` → scp → 服务器 `/tmp/attrax-apply-deploy.sh`。
- `package.json` 已加 `prebuild` 钩子（`scripts/guard-no-server-build.mjs`），服务器 `/opt/attrax` 下 `npm run build` 直接拒绝（2026-09-16 真实事故后补的守卫）。

> 完整部署流程见 [`07-deployment-and-operations.md`](./07-deployment-and-operations.md)。

## 目录跳转

- 想知道「44 篇法规是哪 44 篇、怎么触发」 → [`02-regulations-and-knowledge-base.md`](./02-regulations-and-knowledge-base.md)
- 想知道「每天凌晨 watchdog 在干什么」 → [`03-regulation-update-watchdog.md`](./03-regulation-update-watchdog.md)
- 想知道「vision → generate → verify 每一步具体做了什么」 → [`04-backend-pipeline.md`](./04-backend-pipeline.md)
- 想知道「浏览器到 BFF 到 RAG 的真实链路」 → [`05-frontend-and-bff.md`](./05-frontend-and-bff.md)
- 想知道「服务器怎么加固、密钥怎么管」 → [`06-server-security.md`](./06-server-security.md)
- 想知道「怎么部署、备份、监控、出事故怎么救」 → [`07-deployment-and-operations.md`](./07-deployment-and-operations.md)