# Attrax 安全加固总结（16 轮 / 2026-06-21）

> 这是 1 页能看完的摘要。详细政策看 `SECURITY.md`，运维操作看 `SERVER-OPS.md`，恢复流程看 `RECOVERY.md`，服务器配置快照看 `infra/`。

## 当前状态（snap 时间：2026-06-21 22:12）

| 指标 | 值 |
|---|---|
| 服务地址 | `https://203.0.113.10` |
| 进程 | `nextjs` + `rag-service`（`admin` 用户，非 root）|
| BUILD_ID | `eusCCO-zyHAMmN9q6h69E` |
| 公网暴露端口 | 22 (SSH) / 80 (→443) / 443 (HTTPS) |
| npm audit | **0 production vulnerabilities** |
| 真实 RAG 命中率 | 6/6 = 100% |
| 内存 | 1613MB 总, ~1300MB 用 (nextjs 100 + rag 750 + nginx 50 + 系统 400) |

## 16 轮时间线

### 代码层（commit `b0c9922`）

| 轮 | 内容 | 文件 |
|---|---|---|
| 1 | 修 RAG 端 `complianceReport` 字段缺失兜底（`044daf1` 已 commit）| `rag_service/generate/report_generator.py` |
| 2-5 | A 阶段：文件权限 600、ufw 防火墙、apt 安全更新、logrotate | `.env` `ufw` `apt` `logrotate.d` |
| 6 | B 阶段：SSH 密钥强制 + 密码登录禁 | `/etc/ssh/sshd_config.d/00-attrax-hardening.conf` |
| 7-8 | C 阶段：nginx 443 + 自签证书 + 限流 + buffer/timing | `/etc/nginx/sites-available/attrax` |
| 9-10 | D 阶段：pm2 改 `admin` 跑 + systemd 监督 | `/etc/systemd/system/pm2-root.service` |
| 11 | 移除 admin docker 组（提权路径堵死）| `gpasswd -d admin docker` |
| 12 | `RAG_ALLOWED_ORIGINS` 显式配置 | `rag_service/.env` |
| 13 | fail2ban 加 nginx 80/443 保护 + ignoreip 防自 ban | `/etc/fail2ban/jail.d/` |
| 14 | Zod schema 在 3 个 `[sessionId]` 路由（防 path traversal 500 → 404）| `app/api/{scan,trace,roadmap}/[sessionId]/route.ts` |
| 15 | `session-store.ts` 改 silent validation + `tokenFromRequest` 移除 `?token=` query | `lib/pipeline/` |
| 16 | npm audit fix 8→0 + OOM 恢复 + RECOVERY.md | `package-lock.json` `docs/RECOVERY.md` |

### 服务器配置（`docs/infra/` 快照，可一键部署）

```
docs/infra/
├── nginx-{nginx,attrax-site,custom-error-pages}.conf    # HTTPS + 11 security headers + /..env 拦截
├── sysctl-99-attrax-hardening.conf                      # 22 内核参数 (syncookies, rp_filter, kptr_restrict)
├── sshd-{00-attrax-hardening,banner}                    # MaxAuthTries 3, 5min idle, 强 MACs, 法律警告
├── fail2ban-{filter,jail}-attrax-404-probe.conf         # 404 probe 智能 ban
├── journald-00-attrax.conf                              # 200M cap, 14天
├── cron-attrax-{backup,uptime,data-rotation,backup-remote}
├── {uptime-check,uptime-alert,backup-data,backup-remote}.sh
├── deploy-infra.yml + inventory.example                  # Ansible playbook
└── nginx-nginx.conf                                     # server_tokens off + buffer/timing
```

## 关键决策（为什么这样做）

| 决策 | 理由 |
|---|---|
| **pm2 用 `admin` 而非 root** | RCE 不会直接拿到 root；admin 也没在 docker 组 |
| **`HOSTNAME=127.0.0.1`** | nextjs 只内部 listen，nginx 反代是唯一对外入口 |
| **`ufw` 只放 22/80/443** | 3000/8001 监听 127.0.0.1，ufw 默认 deny incoming |
| **session token 32 bytes random** | 256 位熵，SHA-256 哈希 + `timingSafeEqual` |
| **Magic bytes 验证图片/PDF** | 不只信 Content-Type；PNG/JPEG/WEBP/PDF/DOCX 都看真实文件头 |
| **`?token=` query 移除** | 防 token 出现在 nginx access log |
| **path traversal 改 404** | `validateSessionId` 不 throw，返 null；nginx `proxy_intercept_errors on` 兜底 |
| **fail2ban recidive jail** | 5 次被 ban 升级到 1 周（永久 ban repeat offenders）|

## 关键事件

| 时间 | 事件 | 处理 |
|---|---|---|
| 2026-06-21 09:00 | 用户跑 `gitpush` 5 轮加固 + 部署 | 部署到 203.0.113.10 |
| 2026-06-21 19:00 | `npm audit fix` + `npm ci --omit=dev` 误删 pm2 + build OOM | 服务器挂 30+ 分钟，文档记入 `RECOVERY.md` |
| 2026-06-21 22:00 | 用户从阿里云控制台强制重启 | 重建 build，恢复 0 vuln + 端到端 OK |

## 未做（明确决定不做）

| 项 | 理由 |
|---|---|
| Let's Encrypt 真实证书 | 没有域名；当前自签证书供演示 |
| 异地备份脚本 | 服务器无异地端点；脚本已写好 (`backup-remote.sh`)，需用户配 `BACKUP_REMOTE_DEST` |
| 告警 webhook | `uptime-alert.sh` 已写好，需用户配 `UPTIME_WEBHOOK_URL` |
| CSP nonce 替代 `unsafe-eval` | React 16+ 框架限制，需要改 build pipeline（4h+ 工作量）|
| 公网开放 3000/8001 | 应急 debug 用，未公开 |
| 异地 / 跨可用区灾备 | 1.6GB 单点机器，无 SLA 承诺 |

## 相关文档

- [`SECURITY.md`](./SECURITY.md) — 完整安全政策（key 管理、网络暴露、SSH、HTTPS、API、进程、log、备份、监控、事件响应）
- [`SERVER-OPS.md`](./SERVER-OPS.md) — 日常运维（pm2、logrotate、健康检查、build/deploy 流程）
- [`RECOVERY.md`](./RECOVERY.md) — 紧急恢复 runbook（OOM、断连、备份恢复步骤）
- [`infra/`](./infra/) — 服务器配置快照 + Ansible playbook
- [`plans/`](./plans/) — 历史修复计划（remediation 路线图）
- [`PROJECT.md`](./PROJECT.md) / [`PRD.md`](./PRD.md) / [`RAG-ARCHITECTURE-v3.md`](./RAG-ARCHITECTURE-v3.md) — 项目本身文档

## 给接手人的话

1. **先看 `RECOVERY.md`** — 服务器挂了的应急流程
2. **再看 `SECURITY.md`** — 知道现在哪些端口/key 怎么管的
3. **要改服务器配置** — 改 `infra/` 对应文件，跑 `docs/infra/deploy-infra.yml` 一键部署
4. **要改代码** — 所有改动都在 git 历史里，`git log` 看 commit 标题
5. **别动 `package-lock.json` 然后跑 `npm ci --omit=dev`** — pm2 在 devDeps，会被删
6. **build 前必须 `pm2 stop rag-service`** — 否则 1.6GB 内存会 OOM（`SERVER-OPS.md` 5.4 节）
