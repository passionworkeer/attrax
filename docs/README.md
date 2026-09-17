# 火鹰合规 - 文档索引

> 最后更新：2026-09-14

## 入口

| 我想知道… | 看这里 |
|---|---|
| **当前 API 契约**（前后端对接） | [`FRONTEND-BACKEND-INTEGRATION.md`](./FRONTEND-BACKEND-INTEGRATION.md) ⭐ |
| 项目架构演进（de-RAG 路线） | [`plans/2026-09-11-de-rag-evidence-spec.md`](./plans/2026-09-11-de-rag-evidence-spec.md) |
| 当下在修什么（judge review J01–J11） | [`plans/2026-09-14-judge-review-and-optimization-plan.md`](./plans/2026-09-14-judge-review-and-optimization-plan.md) |
| 安全政策（key、网络、权限、headers） | [`SECURITY.md`](./SECURITY.md) |
| 服务器挂了怎么恢复 | [`infra/NEXTJS-16-STANDALONE-NOTES.md`](./infra/NEXTJS-16-STANDALONE-NOTES.md) + 看 lighthouse 上 `pm2 logs` 排障 |
| watchdog 法规自动入库 | [`WATCHDOG.md`](./WATCHDOG.md) + `scripts/watchdog/README.md` |
| Next 16 standalone 部署坑 | [`infra/NEXTJS-16-STANDALONE-NOTES.md`](./infra/NEXTJS-16-STANDALONE-NOTES.md) |
| nginx/sysctl/sshd/fail2ban 实际配置 | [`infra/`](./infra/) |
| 历史事故 / 修复记录 | 根目录 [`CHANGELOG.md`](../CHANGELOG.md) |
| 历史修复计划 | [`plans/`](./plans/) |
| 当前项目状态与完成度 | [`PROJECT-STATUS.md`](./PROJECT-STATUS.md) |
| 字段对照与 Mock/Real 映射 | [`MOCK-REAL-MAPPING.md`](./MOCK-REAL-MAPPING.md) |
| 评测与生产证据 | [`evidence/`](./evidence/) |
| 标注集格式（grounding eval） | [`annotation/grounding-eval.md`](./annotation/grounding-eval.md) |
| 现行法规源（25 条 live registry） | [`data/regulation_sources/official_sources.json`](../data/regulation_sources/official_sources.json) |
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

## 生产部署（lighthouse 198.51.100.20）

生产环境是腾讯云首尔 lighthouse（Ubuntu 22.04），pm2 跑 `nextjs` + `rag-service` + `regwatch`，nginx 反代。**不走 docker-compose、不走 Ansible**（`docs/infra/` 下的 Ansible 文件是历史 aliyun-sz 时代的，不再维护）。

| 操作 | 方法 |
|---|---|
| 源码同步 | git bundle 路线（本地 `git bundle create` → scp → 服务器 `git fetch`；服务器 ssh key 无法直接 fetch github，详见 memory `2026-09-14-lighthouse-fetch-github-fix`） |
| 构建产物 | 本地 `npm run build` → tar `.next/standalone/` + `.next/static/` → scp 到 `/opt/attrax/.next/`（openrsync 大目录会崩，必须 tar） |
| 静态资源 symlink | `ln -sfn /opt/attrax/public /opt/attrax/.next/standalone/public`（Next 16 standalone 不复制 public/） |
| 重启 | `pm2 restart nextjs rag-service`（改 `.env` 也用 restart；改 ecosystem env 段才要 delete && start） |
| 健康检查 | `ssh lighthouse 'curl -s http://localhost:3000/api/health'` |
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
├── infra/                                 ← 服务器与 nginx 现行运维快照
├── plans/                                 ← 修复计划与设计 spec（2026-09-11 de-RAG + 2026-09-14 judge-review）
├── evidence/                              ← 评测与生产证据（历史截图）
├── annotation/                            ← 标注集格式（grounding eval）
└── archive/                               ← 退役历史文档（旧 PRD / 旧合同 / 阿里云深圳旧机加固 / superpowers）

> ⚠️ 2026-09-14 清理：`DEPLOYMENT.md` / `RECOVERY.md` / `E2E-REPORT-20260718.md` / `DEPLOY-CHECKLIST.md` 已删除（内容仅适用已退役的阿里云深圳 `203.0.113.10`，attrax 当前生产是腾讯云首尔 lighthouse）。

## 相关链接

- **本地**: http://localhost:3000
- **公网**: https://example.com
- **API 健康**: `https://example.com/api/health`
- **GitHub**: https://github.com/passionworkeer/attrax
- **AI 协作说明**: 根目录 [`CLAUDE.md`](../CLAUDE.md)