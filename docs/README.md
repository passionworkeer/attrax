# 火鹰合规 - 文档索引

> 最后更新：2026-09-14

## 入口

| 我想知道… | 看这里 |
|---|---|
| **当前 API 契约**（前后端对接） | [`FRONTEND-BACKEND-INTEGRATION.md`](./FRONTEND-BACKEND-INTEGRATION.md) ⭐ |
| 项目架构怎么演进（de-RAG 路线） | [`plans/2026-09-11-de-rag-evidence-spec.md`](./plans/2026-09-11-de-rag-evidence-spec.md) |
| 当下在修什么（judge review J01–J11） | [`plans/2026-09-14-judge-review-and-optimization-plan.md`](./plans/2026-09-14-judge-review-and-optimization-plan.md) |
| 安全政策（key、网络、权限、headers） | [`SECURITY.md`](./SECURITY.md) |
| 服务器挂了怎么恢复 | [`infra/NEXTJS-16-STANDALONE-NOTES.md`](./infra/NEXTJS-16-STANDALONE-NOTES.md) + 看 lighthouse 上 `pm2 logs` 排障 |
| watchdog 法规自动入库 | [`WATCHDOG.md`](./WATCHDOG.md) + `scripts/watchdog/README.md` |
| Next 16 standalone 部署坑 | [`infra/NEXTJS-16-STANDALONE-NOTES.md`](./infra/NEXTJS-16-STANDALONE-NOTES.md) |
| nginx/sysctl/sshd/fail2ban 实际配置 | [`infra/`](./infra/) |
| 历史事故 / 修复记录 | 根目录 [`CHANGELOG.md`](../CHANGELOG.md) |
| 历史修复计划 | [`plans/`](./plans/) |
| 历史安全加固 16 轮 | [`HARDENING-SUMMARY.md`](./HARDENING-SUMMARY.md)（⚠️ SUPERSEDED → `SECURITY.md`） |
| 历史上线评估 | [`PROJECT-STATUS.md`](./PROJECT-STATUS.md)（2026-09-14 重写） |
| 历史服务器版本对账 | [`SERVER-VERSION.md`](./SERVER-VERSION.md)（⚠️ SUPERSEDED aliyun-sz 时代快照 → lighthouse 用 `CLAUDE.md §部署雷区`） |
| 评测与生产证据 | [`evidence/`](./evidence/) |
| 标注集格式（grounding eval） | [`annotation/grounding-eval.md`](./annotation/grounding-eval.md)（仍为 `eval_grounding.py` 当前格式） |
| 现行法规源（25 条 live registry） | [`data/regulation_sources/official_sources.json`](../data/regulation_sources/official_sources.json) + [`data/regulation_supplements/README.md`](../data/regulation_supplements/README.md)（历史快照 [`regulation-data-sources-coverage-2026-05-27.md`](./archive/regulation-data-sources-coverage-2026-05-27.md) ⚠️ SUPERSEDED） |

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

## 生产部署（lighthouse 43.155.141.192）

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
├── SERVER-VERSION.md                      ← ⚠️ SUPERSEDED aliyun-sz 时代快照（lighthouse 用 `CLAUDE.md §部署雷区`）
├── WATCHDOG.md                            ← 法规自动入库运维手册
├── HARDENING-SUMMARY.md                   ← ⚠️ SUPERSEDED 历史快照（16 轮加固）→ SECURITY.md
├── PROJECT-STATUS.md                      ← 2026-09-14 重写的当前上线评估
├── PROJECT.md                    ← ⚠️ 历史产品文档，2026-09-14 移至 `docs/archive/`
├── PRD.md                        ← ⚠️ 历史产品文档，仍在原位；阅读前看顶部 banner（自承认历史）
├── MOCK-REAL-MAPPING.md                   ← 2026-09-14 重写的字段对照
├── plans/                                 ← 修复计划与设计 spec（历史 + 当前，2026-09-11 de-RAG + 2026-09-14 judge-review 是权威）
├── evidence/                              ← 评测与生产证据（judge-review 2026-09-13 等历史截图）
├── annotation/                            ← 标注集格式（grounding eval，仍为当前格式）
├── superpowers/specs/                     ← ⚠️ SUPERSEDED 架构设计 spec（历史）
└── archive/                               ← 2026-09-14 清理移入：PROJECT.md / DOCUMENT-PIPELINE.md / regulation-data-sources-coverage-2026-05-27.md / 其他退役 spec
    ├── README.md
    ├── NEXTJS-16-STANDALONE-NOTES.md      ← Next 16 standalone 部署坑（当前）
    ├── nginx-attrax-locations.conf        ← nginx 站配快照（当前）
    └── sysctl-*.conf / sshd-*.conf / fail2ban-*.conf / cron-*  ← 历史快照（aliyun 时代，不再走 Ansible）
```

> ⚠️ 2026-09-14 清理：`DEPLOYMENT.md` / `RECOVERY.md` / `E2E-REPORT-20260718.md` / `DEPLOY-CHECKLIST.md` 已删除（内容仅适用已退役的阿里云深圳 `120.77.36.107`，attrax 当前生产是腾讯云首尔 lighthouse）。

## 相关链接

- **本地**: http://localhost:3000
- **公网**: https://wangjianjun.xyz
- **API 健康**: `https://wangjianjun.xyz/api/health`
- **GitHub**: https://github.com/passionworkeer/attrax
- **AI 协作说明**: 根目录 [`CLAUDE.md`](../CLAUDE.md)