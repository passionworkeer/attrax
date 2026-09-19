# 火鹰合规 - 文档索引

> 最后更新：2026-09-19

## 入口

| 我想知道… | 看这里 |
|---|---|
| **当前 API 契约**（前后端对接） | [`FRONTEND-BACKEND-INTEGRATION.md`](./FRONTEND-BACKEND-INTEGRATION.md) ⭐ |
| 项目架构演进（de-RAG 路线） | [`plans/2026-09-11-de-rag-evidence-spec.md`](./plans/2026-09-11-de-rag-evidence-spec.md) |
| 当下在修什么（judge review J01–J11） | [`plans/2026-09-14-judge-review-and-optimization-plan.md`](./plans/2026-09-14-judge-review-and-optimization-plan.md) |
| 安全政策（key、网络、权限、headers） | [`SECURITY.md`](./SECURITY.md) |
| 服务器挂了怎么恢复 | [`infra/NEXTJS-16-STANDALONE-NOTES.md`](./infra/NEXTJS-16-STANDALONE-NOTES.md) + 看 aliyun-sz 上 `pm2 logs` 排障 |
| watchdog 法规自动入库 | [`WATCHDOG.md`](./WATCHDOG.md) + `scripts/watchdog/README.md` |
| Next 16 standalone 部署坑 | [`infra/NEXTJS-16-STANDALONE-NOTES.md`](./infra/NEXTJS-16-STANDALONE-NOTES.md) |
| nginx/sysctl/sshd/fail2ban 实际配置 | [`infra/`](./infra/) |
| 历史事故 / 修复记录 | 根目录 [`CHANGELOG.md`](../CHANGELOG.md) |
| 历史修复计划 | [`plans/`](./plans/) |
| 当前项目状态与完成度 | [`PROJECT-STATUS.md`](./PROJECT-STATUS.md) |
| 字段对照与 Mock/Real 映射 | [`MOCK-REAL-MAPPING.md`](./MOCK-REAL-MAPPING.md) |
| 评测与生产证据 | [`evidence/`](./evidence/)（2026-09-18 并发加固的实 HTTP 验证脚本见 [`evidence/2026-09-18-concurrency-hardening/`](./evidence/2026-09-18-concurrency-hardening/)） |
| 标注集格式（grounding eval） | [`annotation/grounding-eval.md`](./annotation/grounding-eval.md) |
| 现行法规源（35 条 live registry） | [`data/regulation_sources/official_sources.json`](../data/regulation_sources/official_sources.json) |
| 退役历史文档（旧 PRD / 旧合同 / 旧机加固） | [`archive/`](./archive/) |

## 快速开始（本地开发）

```bash
# RAG 后端（端口 8001）
cd rag_service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-prod.txt
uvicorn rag_service.main:app --reload --port 8001

# 前端（端口 3000）
cp .env.local.example .env.local   # 填 MINIMAX_API_KEY（LLM；无 embedding 依赖）
npm install
npm run dev

# 测试
npm run test           # vitest 单元
npm run test:e2e       # Playwright E2E
npm run test:rag       # pytest 后端
npm run typecheck && npm run lint
```

## 生产部署（aliyun-sz 120.77.36.107）

生产环境是阿里云深圳 aliyun-sz（Ubuntu 24.04），pm2 跑 `nextjs` + `rag-service` + `regwatch`，nginx 反代。**不走 docker-compose、不走 Ansible**（`docs/infra/` 下的 Ansible 文件是历史 lighthouse 时代遗留，已退役）。

| 操作 | 方法 |
|---|---|
| 源码同步 | git bundle 路线（本地 `git bundle create` → scp → 服务器 `git fetch`；服务器 ssh key 无法直接 fetch github，详见 memory `2026-09-14-lighthouse-fetch-github-fix`） |
| 构建产物 | 本地 `bash scripts/build-deploy-tarball.sh` → `/tmp/attrax-deploy-complete.tar.gz`（内含已 stage 好 `.next/static/` 与 `public/` 的整个 `standalone/`）→ scp 到服务器 → `/tmp/attrax-apply-deploy.sh` 整包替换 `.next/standalone/`（旧目录挪成 `standalone-pre-deploy-*`，只留最近一份作回滚点） |
| 静态资源 | **不需要 symlink 或 rsync `public/`**：tarball 已把 `public/` 打进 `standalone/public`，nginx 的 `/complipilot/*` 直接 `root /opt/attrax/.next/standalone/public`；`/_next/static/` 走 `alias /opt/attrax/.next/static/`（该路径是指向 `standalone/.next/static` 的 symlink，由 apply 脚本自愈） |
| 重启 | `pm2 restart nextjs rag-service`（改 `.env` 也用 restart；改 ecosystem env 段才要 delete && start） |
| 健康检查 | `ssh aliyun-sz 'curl -s http://localhost:3001/api/health'` |
| 备份 | `/opt/attrax/backups/`（每日 03:00 cron，保留 14 份） |

详细步骤：根目录 [`README.md`](../README.md) §部署 + [`infra/NEXTJS-16-STANDALONE-NOTES.md`](./infra/NEXTJS-16-STANDALONE-NOTES.md)。

## 目录结构

```
docs/
├── README.md                              ← 你在这里
├── FRONTEND-BACKEND-INTEGRATION.md        ← 当前 API 契约源
├── SECURITY.md                            ← 安全政策
├── WATCHDOG.md                            ← 法规自动入库运维手册
├── PROJECT-STATUS.md                      ← 当前上线评估与系统状态
├── MOCK-REAL-MAPPING.md                   ← 字段对照与 Mock/Real 映射
├── regulations/                           ← 现行法规清单与官方源审计
│   └── SOURCE-AUDIT-2026-09-17.md         ← 37 个源的全量实测审计（权威度/可达性/覆盖缺口）
├── infra/                                 ← 服务器与 nginx 现行运维快照
├── plans/                                 ← 修复计划与设计 spec（2026-09-11 de-RAG + 2026-09-14 judge-review）
├── evidence/                              ← 评测与生产证据（历史截图）
├── annotation/                            ← 标注集格式（grounding eval）
└── archive/                               ← 退役历史文档（旧 PRD / 旧合同 / 阿里云深圳旧机加固 / superpowers）

> ⚠️ 2026-09-18 清理：attrax 又迁回阿里云深圳 `120.77.36.107`，之前 lighthouse 时代的部署文档按需比对。

## 相关链接

- **本地**: http://localhost:3000
- **公网**: https://wangjianjun.xyz
- **API 健康**: `https://wangjianjun.xyz/api/health`
- **GitHub**: https://github.com/passionworkeer/attrax
- **AI 协作说明**: 根目录 [`CLAUDE.md`](../CLAUDE.md)