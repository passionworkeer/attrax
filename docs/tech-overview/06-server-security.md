# 06 · 服务器与安全

## 核心要点（30 秒读完）

- **生产机**：aliyun-sz 阿里云深圳 `203.0.113.10`（Ubuntu 24.04.4 LTS），`ufw` allow 22/80/443、deny 3000/3001/8001/8002。
- **nginx vhost**：`example.com` listen 443；TLS 1.2/1.3；5 个响应安全头；`location ^~ /_next/static/` 用 alias 不走 snippet（Next 16 standalone 不再复制 `.next/static`）。
- **限流双层 + 会话鉴权**：nginx `limit_req_zone $binary_remote_addr zone=attrax_api:10m rate=10r/s`；BFF `lib/rate-limit.ts:checkRateLimit('scan:${clientId}', 10, 60_000)`；会话 token 32-byte random + SHA-256 hash + `timingSafeEqual`。
- **fail-closed secret**：`/opt/attrax/.rag-internal-secret`（600）单一来源；prod 空 secret → `RuntimeError` 拒启动；非 prod 自动生成 ephemeral secret。
- **magic bytes 上传校验**：JPEG/PNG/WEBP/PDF/DOCX 文件头校验 + 大小上限 + DOCX zip bomb 防御（≤500 members，≤50MB 展开）。
- **内核加固**：22 个 sysctl（SYN cookies / ptrace_scope=2 / kptr_restrict=2 / dmesg_restrict=1 / fs.protected_hardlinks）。
- **运维缺口**：⚠️ 无异地备份（`scripts/backup-remote.sh` 未安装）；⚠️ uptime 告警 webhook 未配置（只落日志）；⚠️ `ubuntu` 有 NOPASSWD sudo 全量。

> 生产机：aliyun-sz 阿里云深圳 `203.0.113.10`，Ubuntu 24.04.4 LTS + 内核 6.8。配置文件快照在 `docs/infra/` 与 `docs/SECURITY.md`。

## 架构与端口

| 服务 | 监听 | 公网 | 反代 |
|---|---|---|---|
| nginx 1.24 | `0.0.0.0:443` + `80` | 是 | nextjs 127.0.0.1:3000 |
| Next.js 16 standalone | `127.0.0.1:3000` | **否** | nginx upstream `attrax_nextjs` |
| RAG FastAPI | `127.0.0.1:8001` | **否** | 不开反代；BFF 直连 loopback |
| regwatch (Python) | 不开端口 | 否 | pm2 守护，进程内 sleep 循环 |

> `ufw`（`/var/lib/ufw`）allow 22/80/443；deny 3000 / 8001 全部入站。

## SSH 加固（`docs/infra/sshd-00-attrax-hardening.conf`）

- `PermitRootLogin prohibit-password`：root 可用 key，不能用密码。
- `PasswordAuthentication no`：所有用户禁止密码登录。
- `MaxAuthTries 3`，`MaxSessions 5`。
- `ClientAliveInterval 300`，`ClientAliveCountMax 2`：10 分钟空闲超时。
- MACs：只允许 SHA-2 + UMAC-128（无 SHA-1）。
- `Banner /etc/ssh/banner`：合法警告。
- 授权 key：`~root/.ssh/authorized_keys`（2 个）+ `~ubuntu/.ssh/authorized_keys`（1 个）。

## HTTPS 与 nginx（`docs/infra/nginx-*.conf`）

- TLS 1.2/1.3 only，强密码套件（`HIGH:!aNULL:!MD5`）。
- Let's Encrypt cert，`/etc/letsencrypt/live/example.com/{fullchain,privkey}.pem`，certbot systemd timer 自动续期。
- 主 vhost `docs/infra/nginx-attrax-vhost.conf`：
  - `server_name example.com www.example.com` listen 443。
  - `server_tokens off`：Server 头只显示 `nginx`。
  - 5 个响应安全头（`Strict-Transport-Security` / `Referrer-Policy` / `X-Permitted-Cross-Domain-Policies` / `X-DNS-Prefetch-Control` / `Permissions-Policy`）。
  - ACME challenge 走 `:80 /var/www/acme-challenge`。
- 共享 location `docs/infra/nginx-attrax-locations.conf`：
  - 屏蔽 dotfile（`.env*`、`.git`、`.svn`、`.DS_Store`）。
  - 屏蔽 CMS 探测（`/wp-admin`、`/phpmyadmin` 等）。
  - 屏蔽备份 / 配置文件扩展名（`.sql`、`.bak`、`.tar.gz`、`.log` 等）。
  - `location ^~ /_next/static/` alias `/opt/attrax/.next/static/` + `Cache-Control: public, max-age=31536000, immutable`（Next 16 standalone 不再自动复制 `.next/static`，必须 alias 走）。
  - `location ^~ /_next/data/` alias 同路径 + `must-revalidate`。
  - `location ~ ^/complipilot/.+\.(png|webp|mp4)$` root `/opt/attrax/.next/standalone/public` + 30d cache。
  - `location = /api/health` 不限流。
  - `location ~ ^/api/scan(/.*)?$` `limit_req zone=attrax_api burst=20 nodelay`（IP 维度 10 r/s）。
  - `location /` `limit_req zone=attrax_api burst=40 nodelay`。
  - 所有 proxy 设置 `X-Real-IP`（BFF `lib/rate-limit.ts` 真实客户端 IP 来源）。

## API 限流（双层）

**nginx**（粗粒度、IP 维度、约 600 次 / 分钟上限）：

```nginx
limit_req_zone $binary_remote_addr zone=attrax_api:10m rate=10r/s;
```

**BFF**（细粒度、按 client、约 10 次 / 60s）：

`lib/rate-limit.ts:checkRateLimit('scan:${clientId}', 10, 60_000)`：

- 固定窗口，`resetAt` 绝对时间戳。
- `clientId` 优先 `X-Real-IP`（nginx 已写）；XFF 默认不信任（开关 `RATE_LIMIT_TRUST_XFF=true`）。
- 存储不可用 → 进程内 Map 降级（同窗口同 key，仅失去跨重启持久化）。
- BFF 是真实成本门槛，比 nginx 严约 60 倍。每次放行的扫描都消耗 LLM 调用并占用 5 个 worker 之一（最长 280s）。

**RAG**（写入路径二次限流）：

`rag_service/main.py:protect_requests` 中间件：`_RATE_LIMIT_WINDOW_SECS=60 / _RATE_LIMIT_MAX_REQUESTS=30` 进程内 deque，限 `/scan` / `/scan-multipart` / `/profit-report` / `/api/v1/scans`。

## 会话鉴权

- 创建扫描：32-byte random token（`crypto.randomBytes(32).toString('base64url')`），SHA-256 hash 落盘（`data/backend/sessions/{sessionId}.json`）。
- 后续轮询：HttpOnly cookie 或 `Authorization: Bearer`，`timingSafeEqual` 常量时间比对。
- `sessionId` 校验：`^scan_[0-9A-Za-z_-]{1,64}$`（RAG v1）+ `^scan_[0-9A-Za-z_-]{1,50}$`（前端 Zod），64 包含 50，无错位。

## 内部 secret（fail-closed）

- `/opt/attrax/.rag-internal-secret`（`600`，`ubuntu:ubuntu`）是 `RAG_INTERNAL_SECRET` 的**唯一来源**（`scripts/ecosystem.config.cjs` 通过 `env.RAG_INTERNAL_SECRET` 读取文件内容注入 pm2 进程；不在任何 `.env`，不进 git）。
- RAG 中间件对 `/_INTERNAL_WRITE_PATHS` 校验 `X-Internal-Secret` header，HMAC `compare_digest` 防时序攻击。
- `_enforce_secret_policy`（`main.py`）：prod 空 secret → `RuntimeError` 拒启动；非 prod 自动生成 ephemeral secret + 打日志；`RAG_ALLOW_INSECURE=true` 显式 opt-out。

## CORS

`RAG_ALLOWED_ORIGINS=https://example.com,http://localhost:3000`。RAG 8001 只听 loopback，跨域攻击面已收窄到「同站误用」。

## 文件上传 magic bytes（`lib/upload-validation.ts`）

- JPEG `FF D8 FF`、PNG `89 50 4E 47`、WEBP `RIFF....WEBP`、PDF `%PDF`、DOCX `PK 03 04` / `PK 05 06`。
- 大小上限：图片 10MB / PDF 15MB / DOCX 15MB / 总 50MB。
- DOCX 还校验 ZIP 结构（`[Content_Types].xml` + `word/document.xml` 必须存在）+ 成员 ≤ 500 + 展开后 ≤ 50MB（防 zip bomb）。

## 进程与文件权限

- pm2 运行身份 `ubuntu`（**不**是 root），systemd `pm2-ubuntu.service` + `PM2_HOME=/home/ubuntu/.pm2`。
- `/opt/attr` 归属 `ubuntu:ubuntu`；`data/` 还附加 `netdev` 组（让 nextjs 能写）。
- ⚠️ **`/etc/sudoers` 给 `ubuntu` 全量 NOPASSWD sudo**（也复制在 `/etc/sudoers.d/90-cloud-init-users` + `aliyun-sz` 行）。任何 pm2 进程 = root 权限；这是比操作员白名单更宽松的设置，需要收紧为显式命令白名单（见 `docs/SECURITY.md §Known limitations §3`）。
- `ubuntu` 已从 docker 组移除。
- `unattended-upgrades` 开启（安全包自动更新）。

## 内核加固（`docs/infra/sysctl-99-attrax-hardening.conf`）

22 个 sysctl：

- `tcp_syncookies=1`、`rp_filter=1`（反 SYN flood / 反 spoof）。
- `accept_redirects=0`、`accept_source_route=0`、`secure_redirects=0`。
- `log_martians=1`、`icmp_echo_ignore_broadcasts=1`。
- `fs.protected_hardlinks=1`、`fs.protected_symlinks=1`。
- `kernel.kptr_restrict=2`、`kernel.dmesg_restrict=1`、`kernel.yama.ptrace_scope=2`。
- `net.core.somaxconn=1024`、`net.core.netdev_max_backlog=2048`。

## journald & logrotate

- `docs/infra/journald-00-attrax.conf`：journald 200 MB 上限 + 14 天保留。
- `docs/infra/logrotate-attrax`（安装到 `/etc/logrotate.d/attrax`）：轮转 `/opt/attrax/logs/*.log`、pm2 日志（`/home/ubuntu/.pm2/logs/*.log`）、`data/backend/audit.jsonl`。2026-09-17 之前**没有**任何 attrax 自身日志轮转规则。
- nginx 日志走发行版自带 `/etc/logrotate.d/nginx`。
- `/opt/attrax/logs/` 归属 `ubuntu`（不是旧文档写的 `admin`）。

## fail2ban

4 个 jail：`sshd`、`nginx-auth`、`nginx-botsearch`、`recidive`（`/etc/fail2ban/jail.local`）。`fail2ban-client status` 复核一致。`docs/infra/fail2ban-*` 是 lighthouse 时代快照；今天 aliyun-sz 又是新生产，需重新比对——其中残留的 `198.51.100.20` IP 是 1921 旧机记录。

## 备份

- **每日 03:00 cron**（`docs/infra/cron-attrax-backup` → `/etc/cron.d/attrax-backup`）：`scripts/backup-data.sh` 打包 `.env` / `.env.local` / `.env.production` / `rag_service/.env` / `data/kb` / `data/regulation_sources` / `data/regulation_supplements` / `data/**/*.db`（de-RAG 之后 FAISS 索引已不存在）。
- 产物 `/opt/attrax/backups/attrax-data-YYYYMMDD-HHMMSS.tar.gz`，权限 `600`，保留最近 14 份（实测约 4 MB）。
- **异地备份 no-op**：`docs/infra/cron-attrax-backup-remote` 已就位，但 `scripts/backup-remote.sh` 未安装到服务器，`BACKUP_REMOTE_DEST` 未配置。`单盘故障会同时失去全部 14 份备份`——`docs/SECURITY.md §Known limitations §1` 标记为最高优先级运维缺口。

## 监控

- 每 5 分钟 cron `/etc/cron.d/uptime-monitor` → `/home/ubuntu/uptime-check.sh`（**work 仓** `ops/monitor/uptime-check.sh` 是唯一来源，服务器仅存副本）。
- 探针覆盖：多站点 HTTP、前端 `/api/health`（穿透到 RAG `/ready`）、pm2 进程内存 / 状态、Next 构建漂移指纹、**磁盘水位**。
- 日志 `/home/ubuntu/uptime.log`（成功不写，只记失败 / 漂移）。
- 告警：脚本支持可选 webhook；**未配置**时只写日志，不会通知到人（同样是 `Known limitations §2`）。

## 事故响应（`docs/SECURITY.md §Incident response`）

1. **断网**：`ufw deny in` 22/80/443（或 `iptables -I INPUT 1 -j DROP`）。
2. **快照**：重启前 `dd` 整盘。
3. **审计日志**：`journalctl --since="24 hours ago"` + `tail /var/log/attrax-*.log` + `grep -E "(sk-cp-|ms-)" /var/log/`。
4. **轮换 key**：MiniMax dashboard 改 `MINIMAX_API_KEY`（`PAI_API_KEY` / `MODELSCOPE_API_KEY` / `OLLAMA_*` 随 embedding 栈删除，无代码读取）。
5. **强制会话失效**：`rm /opt/attrax/data/backend/sessions/*.json`（RAG FileBackend 真值）。
6. **检 SSH**：`~/.ssh/authorized_keys`（root + ubuntu）查异常条目。
7. **重建**：从干净 git checkout 重新部署。

## 关键文件清单

- [`docs/SECURITY.md`](docs/SECURITY.md)：完整安全政策。
- [`docs/infra/README.md`](docs/infra/README.md)：配置片段清单 + 安装方式。
- [`docs/infra/nginx-attrax-vhost.conf`](docs/infra/nginx-attrax-vhost.conf)：主 vhost。
- [`docs/infra/nginx-attrax-locations.conf`](docs/infra/nginx-attrax-locations.conf)：共享 location。
- [`docs/infra/nginx-nginx.conf`](docs/infra/nginx-nginx.conf)：nginx 主配置（旧机快照，仅参考）。
- [`docs/infra/sshd-00-attrax-hardening.conf`](docs/infra/sshd-00-attrax-hardening.conf)：sshd 加固。
- [`docs/infra/sysctl-99-attrax-hardening.conf`](docs/infra/sysctl-99-attrax-hardening.conf)：内核加固。
- [`docs/infra/logrotate-attrax`](docs/infra/logrotate-attrax)：attrax 自身日志轮转。
- [`docs/infra/cron-attrax-backup`](docs/infra/cron-attrax-backup) + [`-remote`](docs/infra/cron-attrax-backup-remote)：备份 cron。
- [`scripts/backup-data.sh`](scripts/backup-data.sh) + [`backup-remote.sh`](scripts/backup-remote.sh)：备份脚本。
- [`lib/rate-limit.ts`](lib/rate-limit.ts)：BFF 限流。
- [`lib/upload-validation.ts`](lib/upload-validation.ts)：上传校验。
- [`lib/pipeline/session-auth.ts`](lib/pipeline/session-auth.ts)：会话 token。

## 已知风险（按 `docs/SECURITY.md §Known limitations`）

1. **无异地备份** → 装 `scripts/backup-remote.sh` + 配 `BACKUP_REMOTE_DEST` + 恢复演练。
2. **uptime 告警未接人** → 配 webhook。
3. **`ubuntu` NOPASSWD sudo 全量** → 收紧为显式命令白名单。
4. 依赖审计 `npm audit --omit=dev --audit-level=high` 是 advisory（`continue-on-error`）；剩余的 sharp 升级是 breaking change，需要单独构建回归。
5. **单点**：1 台机 + 1 uvicorn worker（5 并发扫描，单次最长 280s）。
6. **无用户系统**：任何拿到 URL 的人都能扫描（demo 故意；限流兜底）。