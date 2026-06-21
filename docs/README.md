# 火鹰合规 - 文档索引

> 最后更新：2026-06-21（16 轮安全加固后）

## 🎯 入口

| 我想知道… | 看这里 |
|---|---|
| **当前状态 / 16 轮做了什么** | [`HARDENING-SUMMARY.md`](./HARDENING-SUMMARY.md) ⭐ 起点 |
| 安全政策（key、网络、权限、headers）| [`SECURITY.md`](./SECURITY.md) |
| 服务器怎么跑、怎么改、怎么备份 | [`SERVER-OPS.md`](./SERVER-OPS.md) |
| 服务器挂了怎么恢复 | [`RECOVERY.md`](./RECOVERY.md) |
| nginx/sysctl/sshd/fail2ban 实际配置 | [`infra/`](./infra/)（含 Ansible playbook）|
| 项目本身（架构、需求、状态）| [`PROJECT.md`](./PROJECT.md) [`PRD.md`](./PRD.md) [`RAG-ARCHITECTURE-v3.md`](./RAG-ARCHITECTURE-v3.md) [`PROJECT-STATUS.md`](./PROJECT-STATUS.md) |
| RAG 语料库怎么构建 | [`DOCUMENT-PIPELINE.md`](./DOCUMENT-PIPELINE.md) |
| 法规数据源覆盖 | [`regulation-data-sources-coverage-2026-05-27.md`](./regulation-data-sources-coverage-2026-05-27.md) |
| 历史修复计划 | [`plans/`](./plans/) |

## 🚀 快速开始（本地开发）

```bash
# 前端
npm install
npm run dev
# 访问 http://localhost:3000

# RAG 后端
cp rag_service/.env.example rag_service/.env
# 编辑填入 MIMOTALK_API_KEY + MODELSCOPE_API_KEY
D:\python\python.exe -m uvicorn rag_service.main:app --reload --port 8001

# 测试
npm run test           # vitest 单元
npm run test:e2e       # Playwright E2E
npm run test:all       # 全部
```

## 🏭 生产部署（120.77.36.107，无 Docker）

| 操作 | 方法 |
|---|---|
| 改服务器配置 | 改 `infra/` 对应文件 → `ansible-playbook -i inventory deploy-infra.yml` |
| 重新 build 应用 | `SERVER-OPS.md` 5.4 节（**必须先 `pm2 stop rag-service`**）|
| 紧急恢复 | `RECOVERY.md` |
| 备份位置 | `/opt/attrax/backups/` (每日 03:00 cron, 保留 14 份) |
| 健康检查 | `https://120.77.36.107/api/health` |

## 📁 目录结构

```
docs/
├── README.md                    ← 你在这里
├── HARDENING-SUMMARY.md         ← 16 轮加固摘要（建议先看）
├── SECURITY.md                  ← 安全政策
├── SERVER-OPS.md                ← 运维手册
├── RECOVERY.md                  ← 紧急恢复
├── PROJECT.md / PRD.md / RAG-ARCHITECTURE-v3.md
├── DOCUMENT-PIPELINE.md         ← 语料库构建
├── PROJECT-STATUS.md            ← 上线评估
├── regulation-data-sources-coverage-2026-05-27.md
├── plans/                       ← 历史修复计划
├── superpowers/specs/           ← 架构设计 spec
└── infra/                       ← 服务器配置快照 + Ansible
    ├── README.md                ← 部署到新服务器指南
    ├── deploy-infra.yml         ← Ansible playbook
    ├── inventory.example
    ├── nginx-*.conf / sysctl-*.conf / sshd-*.conf
    ├── fail2ban-*.conf / journald-*.conf
    ├── cron-attrax-* / *.sh
    └── sshd-banner.txt
```

## 🔗 相关链接

- **首页**: http://localhost:3000
- **公网**: https://120.77.36.107
- **API 健康**: `https://120.77.36.107/api/health`
- **GitHub**: https://github.com/passionworkeer/attrax
