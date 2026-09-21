# 火鹰合规 (Attrax)

> **跨境电商合规风险扫描** —— 上传产品图，AI 识别类别与目标市场，结合多市场法规知识库生成带精确引用的合规报告与证据包。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Demo-在线体验-blue)](https://twinbuddy.xyz)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](#)
[![Python](https://img.shields.io/badge/Python-3.10+-blue)](#)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](#)

---

### 🌐 在线体验 (Live Demo)

👉 **官方在线演示：[https://twinbuddy.xyz](https://twinbuddy.xyz)**  
欢迎访问体验完整功能！无需本地配置环境即可直接体验产品图上传、智能品类/特征识别、多市场合规条款匹配与证据包生成流程。

---

## 这是什么

Attrax 是一个面向跨境电商卖家的合规风险扫描平台。用户上传产品图片，系统通过视觉识别 + 法规知识库锚定生成报告，每条结论附带可点验的法规原文引用。

支持品类 10 类（**单数**：`electronics` / `toy` / `battery` / `textile` / `cosmetic` / `food_contact` / `appliance` / `3c` / `home` / `other` — 见 `lib/types.ts` + `data/kb/anchors/*.yaml`），目标市场 16 个（`EU` / `US` / `UK` / `CN` / `AU` / `SA` / `AE` / `JP` / `KR` / `CA` / `SG` / `MX` / `BR` / `DE` / `FR` / `IT` — `MARKET_IDS`）。当前架构采用 **规则知识库（must_check）+ 法规原文（article_loader）+ LLM 生成** 三段式，详见 [`docs/plans/2026-09-11-de-rag-evidence-spec.md`](./docs/plans/2026-09-11-de-rag-evidence-spec.md) 中既定的 de-RAG 迁移路线。

## 核心能力

- **多市场法规覆盖**：61 篇锚点法规（公开法规全文 + 商业标准摘要）+ 63 篇目录条目（attrax-docs 导入，覆盖越南 / 印尼 / 马来西亚 / 泰国 / 新加坡 / 海湾国家等 21 个区域），按市场 × 品类 × 特征（电池 / 无线 / 电源 / 儿童相关）三维检索
- **视觉识别 + 事实结构化**：从产品图片提取品类与可见特征（接口、铭牌、材质等），输出结构化 observations / findings
- **KB 锚定生成**：每条结论附 `[regulation#article]` 引用 + 原文摘录，可点开条款详情页验证
- **引用可信度分层**：`source` / `literal` / `semantic` 三档，缺验证默认未验证（不静默给满分）
- **证据包导出**：合规报告 + 利润分析 + 决策表 + 路线图四件套，PDF / DOCX 双格式
- **路线图 + 利润独立页面**：执行阶段拆解 + 成本利润模型，无数据时显式回退

## 快速上手

### 环境要求

- Node.js 18+ / npm
- Python 3.10+
- macOS / Linux（生产部署推荐 Ubuntu 22.04）

### 1. 启动 RAG 服务（端口 8001）

```bash
cd rag_service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-prod.txt
uvicorn rag_service.main:app --reload --port 8001
```

### 2. 启动前端（端口 3000）

```bash
cp .env.local.example .env.local   # 填入 LLM_API_KEY（无 embedding 依赖）
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

在浏览器打开 `http://localhost:3000`，上传项目内置的 `public/mock-fixtures/preset-charger-photo.png` 或玩具示例图 → 等待扫描完成 → 进入结果页 → 点击「下载证据包」查看 PDF。

亦可直接访问在线演示站点：**[https://twinbuddy.xyz](https://twinbuddy.xyz)**。

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
│  RAG 服务（FastAPI + 可配置 LLM；KB 锚定，无 embedding）      │
│  rag_service/pipeline/                                         │
│    vision → generate → verify                                  │
│  rag_service/verify/{applicability, grounding, quote_matcher, vision_cache}   │
│  rag_service/retrieval/{must_check, kb_loader, article_loader} │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  数据层                                                        │
│  data/regulations/{region}/*.yaml — 61 篇锚点 + 63 篇目录条目 │
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
├── docs/                         # 架构 / 部署 / 计划 / 技术全景
├── scripts/                      # 运维脚本（deploy / ingest / watchdog / eval）
└── public/                       # 静态资源
```

## 贡献与规范

我们欢迎社区贡献！无论是修复缺陷、优化算法还是扩充法规库，都非常感谢您的参与。

- **开发与贡献流程**：请查阅 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解分支约定、提交信息格式与 PR 规范。
- **分支约定**：`feat/<name>` / `fix/<name>` / `chore/<name>` / `docs/<name>`
- **提交规范**：Conventional Commits 格式
- **代码检查**：TypeScript strict、ESLint、Ruff（Python 后端）
- **测试要求**：发起 PR 前确保 `npm run test` 与 `npm run typecheck` 100% 通过

## 部署

项目支持基于 Node.js 16 Standalone 与 FastAPI 的轻量化生产部署，可通过本地构建 tarball 并上传至目标服务器整包替换：

```bash
# 1) 本地：构建 + stage + 打包 + 校验（把 .next/static 与 public/ 一起放进 standalone/）
bash scripts/build-deploy-tarball.sh                     # 产物 /tmp/attrax-deploy-complete.tar.gz

# 2) 传到目标服务器
scp /tmp/attrax-deploy-complete.tar.gz user@your-server:/tmp/

# 3) 服务器：整包替换 .next/standalone/ + 自愈 static symlink + 写 BUILD_ID + 重启
ssh user@your-server 'bash /tmp/attrax-apply-deploy.sh'

# 4) 若更新了 Python 后端（rag_service/），在服务器拉取后重启服务
ssh user@your-server 'cd /opt/attrax && git pull && pm2 restart rag-service --update-env'

# 5) 健康校验（必须 ready=true 且 checks 六项全 true）
ssh user@your-server 'curl -s http://127.0.0.1:8001/api/v1/ready | python3 -m json.tool'
```

详细生产部署细节见 [`docs/README.md`](./docs/README.md) §生产部署 与 [`docs/infra/`](./docs/infra/)。

## 开源协议 (License)

本项目遵循 [MIT License](./LICENSE) 开源协议。任何人均可免费使用、复制、修改、合并、发布、分发及销售本软件副本。

## 相关文档

- [在线体验站点](https://twinbuddy.xyz)
- [贡献指南 (CONTRIBUTING.md)](./CONTRIBUTING.md)
- [开源协议 (LICENSE)](./LICENSE)
- [AI 协作规范 (CLAUDE.md)](./CLAUDE.md)
- [技术全景总览 (docs/tech-overview)](./docs/tech-overview/README.md)
- [API 契约文档 (docs/FRONTEND-BACKEND-INTEGRATION.md)](./docs/FRONTEND-BACKEND-INTEGRATION.md)
- [变更与事故修复日志 (CHANGELOG.md)](./CHANGELOG.md)
- [生产部署与架构指引 (docs/README.md)](./docs/README.md)
- [安全规范说明 (docs/SECURITY.md)](./docs/SECURITY.md)
