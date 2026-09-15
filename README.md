# 火鹰合规 (Attrax)

> **跨境电商合规风险扫描** —— 上传产品图，AI 识别类别与目标市场，结合多市场法规知识库生成带精确引用的合规报告。

[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](#)
[![Python](https://img.shields.io/badge/Python-3.10+-blue)](#)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](#)

## 这是什么

Attrax 是一个面向跨境电商卖家的合规风险扫描平台。用户上传产品图片，系统通过视觉识别 + 法规知识库锚定生成报告，每条结论附带可点验的法规原文引用。

支持品类 10 类（**单数**：`electronics` / `toy` / `battery` / `textile` / `cosmetic` / `food_contact` / `appliance` / `3c` / `home` / `other` — 见 `lib/types.ts` + `data/kb/anchors/*.yaml`），目标市场 16 个（`EU` / `US` / `UK` / `CN` / `AU` / `SA` / `AE` / `JP` / `KR` / `CA` / `SG` / `MX` / `BR` / `DE` / `FR` / `IT` — `MARKET_IDS`）。当前架构采用 **规则知识库（must_check）+ 法规原文（article_loader）+ LLM 生成** 三段式，详见 [`docs/plans/2026-09-11-de-rag-evidence-spec.md`](./docs/plans/2026-09-11-de-rag-evidence-spec.md) 中既定的 de-RAG 迁移路线。

## 核心能力

- **多市场法规覆盖**：44 篇锚点法规、~10k 法规条款原文（公开法规全文 + 商业标准的 summary），按市场 × 品类 × 特征（电池 / 无线 / 电源 / 儿童相关）三维检索
- **视觉识别 + 事实结构化**：从产品图片提取品类与可见特征（接口、铭牌、材质等），输出结构化 observations / findings
- **KB 锚定生成**：每条结论附 `[regulation#article]` 引用 + 原文摘录，可点开条款详情页验证
- **引用可信度分层**：`source` / `literal` / `semantic` 三档，缺验证默认未验证（不静默给满分）
- **证据包导出**：合规报告 + 利润分析 + 决策表 + 路线图四件套，PDF / DOCX 双格式
- **路线图 + 利润独立页面**：执行阶段拆解 + 成本利润模型，无数据时显式回退

## 快速上手

### 环境要求

- Node.js 18+ / npm
- Python 3.10+
- macOS / Linux（生产部署为 Ubuntu 22.04）

### 1. 启动 RAG 服务（端口 8001）

```bash
cd rag_service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-prod.txt
uvicorn rag_service.main:app --reload --port 8001
```

### 2. 启动前端（端口 3000）

```bash
cp .env.local.example .env.local   # 填入 MINIMAX_API_KEY（LLM；无 embedding 依赖）
npm install
npm run dev
```

### 3. 跑测试

```bash
npm run test         # vitest（前端单元）
npm run test:e2e     # Playwright（E2E）
npm run test:rag     # pytest（RAG 服务后端）
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
```

### 4. 一键演示

上传项目内置的 `public/mock-fixtures/preset-charger-photo.png` 或玩具示例图 → 等 ~30s → 进入结果页 → 点「下载证据包」看 PDF。

## 架构

```
┌────────────────────────────────────────────────────────────────┐
│  前端（Next.js 16 + React 19 + TypeScript）                    │
│  app/upload → app/burning → app/result → app/profit           │
│  components/result/* + components/regulation/*                  │
│  lib/rag-client/{v1-adapter,v1-result-adapter,evidence-api,client,errors,response-schemas,report-package-schema,types.gen,openapi.snapshot.json}
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  BFF 层（Next.js API routes）                                  │
│  /api/scan/* — 创建扫描 / 轮询状态 / 提交补充证据 / 重扫      │
│  /api/regulations/updates — 法规更新列表                       │
│  /api/health — 健康检查                                       │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  RAG 服务（FastAPI + MiniMax LLM；KB 锚定，无 embedding）      │
│  rag_service/pipeline/                                         │
│    vision → generate → verify                                  │
│  rag_service/verify/{applicability, grounding, quote_matcher, vision_cache}   │
│  rag_service/retrieval/{must_check, kb_loader, article_loader} │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  数据层                                                        │
│  data/regulations/{region}/{reg_id}.yaml — 44 篇锚点法规条款   │
│  data/inspection_profiles/*.yaml — 视觉检查 profile           │
│  data/regulation_supplements/ — watchdog 自动入库的语料包     │
│  data/backend/sessions/ — RAG 会话文件（TTL 24h）              │
└────────────────────────────────────────────────────────────────┘
```

## 项目结构

```
attrax/
├── app/                          # Next.js App Router
│   ├── upload/                   # 上传页
│   ├── burning/[sessionId]/      # 扫描中动画页
│   ├── result/[sessionId]/       # 结果页（合规 + 利润 + 决策 + 路线图）
│   ├── profit/[sessionId]/       # 利润独立页面
│   ├── pricing/                  # 商业方案
│   ├── regulations/              # 法规更新列表
│   └── api/                      # BFF API routes
│       ├── scan/route.ts
│       ├── scan/[sessionId]/     # 轮询 + 资产 + 证据 + 重扫
│       ├── regulations/updates/
│       ├── report/[sessionId]/[reportType]/
│       └── health/
├── components/                   # UI 组件
│   ├── ui/                       # shadcn/ui 基础组件
│   ├── blaze-hawks/              # BlazeLocaleProvider（locale）+ 品牌 UI
│   ├── result/                   # 结果展示（InspectionChecklistPanel,
│   │                             # FloatingEvidenceCrop, EvidenceRequestPanel）
│   └── regulation/               # CitationChip / DocViewer
├── lib/                          # 前端核心库
│   ├── rag-client/               # v1-adapter + v1-result-adapter + evidence-api + client + errors + response-schemas + report-package-schema + types.gen + openapi.snapshot.json
│   ├── report-export-modules/     # 报告导出（compliance / profit / decision /
│   │                             #   roadmap / evidence-pack / shared）
│   ├── hooks/useScanPolling.ts   # 轮询 hook（结果页另有 use-result-loader）
│   ├── i18n.tsx + i18n/translations.ts
│   ├── pipeline/                 # demo 会话 + BFF 报告导出（session-auth /
│   │                             #   demo-scan-session / report-package / profit-report）
│   └── types.ts + schemas.ts     # Zod Schema
├── rag_service/                  # Python RAG 服务（FastAPI，端口 8001）
│   ├── main.py                   # FastAPI 入口
│   ├── pipeline/                 # 线性 3 步管线（vision → generate → verify）
│   ├── retrieval/                # must_check / kb_loader / article_loader
│   ├── verify/                   # applicability / grounding / quote_matcher / vision_cache
│   ├── schemas/                  # Pydantic report_package
│   └── tests/                    # pytest
├── data/                         # 法规语料 + 视觉 profile + 会话
├── tests/                        # 前端测试（vitest + Playwright）
├── docs/                         # 架构 / 部署 / 计划 / 评审证据
├── scripts/                      # 运维脚本（deploy / ingest / watchdog / eval）
└── public/                       # 静态资源
```

## 开发流程

- **分支约定**：`feature/<name>` / `fix/<name>` / `chore/<name>` / `docs/<name>`
- **提交粒度**：单一关注点（一个修复 / 一个新增功能 / 一次文档同步）
- **测试**：vitest 单元 + pytest 后端 + Playwright E2E；CI 在 `.github/workflows/ci.yml`
- **代码规范**：TypeScript strict、ESLint、Ruff（Python 后端）

## 部署

生产环境是腾讯云首尔 lighthouse（`43.155.141.192`），通过 git bundle 同步源码 + 本地构建 + tar/拷贝到服务器：

```bash
# 本地
npm run build                                          # 构建 .next/standalone/ + .next/static/
tar -C .next -czf - standalone | ssh lighthouse 'tar -xzf - -C /opt/attrax/.next'
tar -C .next -czf - static | ssh lighthouse 'mkdir -p /opt/attrax/.next/standalone/.next && tar -xzf - -C /opt/attrax/.next/standalone/.next'

# 服务器
ssh lighthouse 'sed -i "s/^ATTRAX_BUILD_SHA=.*/ATTRAX_BUILD_SHA=$(git -C /Users/wangjianjun/me/attrax rev-parse HEAD)/" /opt/attrax/rag_service/.env'
ssh lighthouse 'cd /opt/attrax && RAG_INTERNAL_SECRET=$(grep "^RAG_INTERNAL_SECRET=" /opt/attrax/rag_service/.env | cut -d= -f2) APP_ENV=production /usr/bin/pm2 start scripts/ecosystem.config.cjs --only nextjs'
```

详细部署步骤（`/opt/attrax/.next/standalone/.next/static` symlink、`public/` 链接、nginx alias 等）见 [`docs/README.md`](./docs/README.md) §生产部署 与 [`docs/infra/NEXTJS-16-STANDALONE-NOTES.md`](./docs/infra/NEXTJS-16-STANDALONE-NOTES.md)。

## 引用

- AI 协作说明 → [CLAUDE.md](./CLAUDE.md)
- 架构设计 → [docs/plans/](./docs/plans/)（特别是 `2026-09-11-de-rag-evidence-spec.md` 与 `2026-09-14-judge-review-and-optimization-plan.md`）
- API 契约 → [docs/FRONTEND-BACKEND-INTEGRATION.md](./docs/FRONTEND-BACKEND-INTEGRATION.md)
- 历史事故 / 修复记录 → [CHANGELOG.md](./CHANGELOG.md)
- 部署文档 → [docs/README.md](./docs/README.md) §生产部署 + [docs/infra/](./docs/infra/)
- 当前优化方向 → [docs/plans/2026-09-14-judge-review-and-optimization-plan.md](./docs/plans/2026-09-14-judge-review-and-optimization-plan.md)（11 节 J01–J11；J01 / J02 / J04–J07 / J09 / J10 / J11 已实施；J03 ViewModel + J15 合并证据请求随 2026-09-14 落地；J08 留待 spec 收尾）

---

**最后更新**：2026-09-14