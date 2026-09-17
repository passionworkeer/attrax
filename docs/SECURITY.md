# Attrax Security Policy

> **⚠️ 历史快照（2026-06-21，aliyun-sz 部署时代）** — 生产已迁至 lighthouse（腾讯首尔，见 `docs/infra/`），文中 IP/机器细节为当时快照。安全设计原则（fail-closed secret、magic bytes 校验、fail2ban、限流）仍然有效，但涉及具体文件/路径的条目以下述修正为准：
>
> - `lib/pipeline/session-store.ts` 已删除（2026-09-14）——sessionId 格式校验现在在 `lib/schemas.ts` `SessionIdSchema` + `app/api/backend-session-access.ts` `SAFE_SESSION_ID`
> - `PAI_API_KEY` 无代码读取（embedding 栈已删），密钥旋转只需 `MINIMAX_API_KEY` / `RAG_INTERNAL_SECRET`
> - 会话失效路径：`rm /opt/attrax/data/backend/sessions/*.json`（RAG FileBackend，非 data/sessions）
> - `scan-queue` 本地作业文件已不存在（本地管线删除），上传仅存 RAG 侧 `data/backend/uploads/`
>
> Last updated: 2026-06-21 (after 11 rounds of hardening); corrections banner added 2026-09-14.

This document covers security practices for the Attrax production deployment (historically at `203.0.113.10`, now lighthouse). Companion file: `infra/` contains actual server config snapshots.

## Architecture

- **Edge**: nginx 1.24.0 on `0.0.0.0:443` (public), `0.0.0.0:80` (HTTP→HTTPS redirect)
- **App**: Next.js 16.2.6 standalone on `127.0.0.1:3000` (proxied by nginx, not directly reachable)
- **RAG**: Python FastAPI on `127.0.0.1:8001` (called by Next.js only, not directly reachable)
- **Process manager**: pm2 7.0.1 under `admin` user, supervised by systemd `pm2-root.service`
- **RAG service user**: `admin` (no root, no docker group)
- **OS**: Ubuntu 24.04.4 LTS, kernel 6.8

## Key management

| File | Permission | Owner | Notes |
|---|---|---|---|
| `/opt/attrax/.rag-internal-secret` | `600` | `ubuntu:ubuntu` | **`RAG_INTERNAL_SECRET` 的唯一来源**（BFF ↔ RAG 内部认证）。由 `scripts/ecosystem.config.cjs` 注入到 `rag-service` 与 `nextjs`；不写入任何 `.env`，不进 git |
| `/opt/attrax/.env` | `600` | `ubuntu:netdev` | Top-level Next.js env |
| `/opt/attrax/.env.local` | `600` | `ubuntu:netdev` | |
| `/opt/attrax/.env.production` | `600` | `ubuntu:netdev` | |
| `/opt/attrax/rag_service/.env` | `600` | `ubuntu:ubuntu` | RAG-specific env（不含 `RAG_INTERNAL_SECRET`） |
| `/opt/attrax/backups/*.tar.gz` | `600` | `ubuntu:ubuntu` | Daily backup contains .env |
| Backup directory | `750` | `ubuntu:ubuntu` | Not world-readable |

### 轮换 `RAG_INTERNAL_SECRET`

```bash
ssh lighthouse 'openssl rand -hex 24 | tr -d "\n" | sudo tee /opt/attrax/.rag-internal-secret >/dev/null && sudo chmod 600 /opt/attrax/.rag-internal-secret'
ssh lighthouse 'cd /opt/attrax && pm2 startOrRestart scripts/ecosystem.config.cjs --only rag-service,nextjs'
# 必须两端同时重启：只重启一个会让 BFF 与 RAG 的 secret 不一致 → 写端点全 401
curl -s http://127.0.0.1:8001/api/v1/ready   # checks 应全 true
```

验证要跑一次真实扫描，`/api/health` 200 **不**代表 BFF→rag 鉴权通过。

**Never** commit any `.env` file. The `RAG_ALLOWED_ORIGINS` placeholder in `.env.local.example` is documentation only.

## Network exposure

| Port | Public | Reason |
|---|---|---|
| 22 (SSH) | Yes | Admin access; key-only auth, MaxAuthTries 3 |
| 80 (HTTP) | Yes | Redirects to 443 (HSTS) |
| 443 (HTTPS) | Yes | Frontend + reverse proxy |
| 3000 (Next.js) | **No** | ufw deny + nginx internal |
| 8001 (RAG) | **No** | ufw deny + listen 127.0.0.1 |

`ufw` rules (`/var/lib/ufw`): allow 22/80/443, deny all else inbound. Default `deny incoming, allow outgoing`.

## SSH hardening

See `infra/sshd-00-attrax-hardening.conf`:

- `PermitRootLogin prohibit-password` — root can use key, no password
- `PasswordAuthentication no` — no password auth for any user
- `MaxAuthTries 3`, `MaxSessions 5`
- `ClientAliveInterval 300`, `ClientAliveCountMax 2` — 10-minute idle timeout
- `MACs` — only SHA-2 + UMAC-128 (no SHA-1)
- `Banner /etc/ssh/banner` — legal warning

Authorized keys: `~root/.ssh/authorized_keys` (2 keys), `~admin/.ssh/authorized_keys` (1 key).

## HTTPS hardening

See `infra/nginx-*.conf`:

- **TLS 1.2 + 1.3 only**, strong ciphers (`HIGH:!aNULL:!MD5`)
- **Let's Encrypt cert** at `/etc/letsencrypt/live/twinbuddy.xyz/{fullchain.pem,privkey.pem}` (90-day, auto-renew via certbot systemd timer; issued 2026-06-21, expires 2026-09-19). Covers `twinbuddy.xyz` + `www.twinbuddy.xyz`. ACME challenge path served from `/var/www/acme-challenge` (nginx location, not proxied to Next.js).
- `server_tokens off` — `Server:` header shows only `nginx`
- Custom error pages at `/var/www/custom-errors/` — 162 bytes instead of leaking build ID
- 11 security response headers (see infra README)
- `proxy_intercept_errors on` + `error_page 500 =404` — upstream 5xx hidden from clients

**Domain**: `https://example.com` (A record → 198.51.100.20 Lighthouse Seoul). SSL via Let's Encrypt certbot.

## API protection

- **Rate limit**: 双层 —
  - nginx `limit_req_zone $binary_remote_addr zone=attrax_api:10m rate=10r/s`，应用于 `/api/scan*`（`burst=20 nodelay`）与 `/`（`burst=40 nodelay`）；即单 IP 最多约 600 次/分钟（`/etc/nginx/snippets/attrax-locations.conf`）
  - BFF `checkRateLimit('scan:${clientId}', 10, 60_000)`（`app/api/scan/route.ts` → `lib/rate-limit.ts`）：每 client 60s 窗口 10 次，**固定窗口**（计数器 + 绝对 resetAt，非滑动窗口）
  - **BFF 才是真实成本门槛**，比 nginx 严约 60 倍：每次放行的扫描都消耗 LLM 调用，并占用 5 个 RAG worker 槽位之一（单次最长 280s）。因此存储不可用时**降级为进程内计数**（同窗口、同 key，仅失去跨重启持久化），既不静默放行也不全站 429
  - 单进程假设：pm2 以 fork 模式运行 `nextjs` 且未设 `instances`，故进程内计数与文件存储等效；若将来扩为多实例/多容器，需重新引入跨进程锁（见 `lib/rate-limit.ts` 模块头）
- **fail2ban**: 4 jails — `sshd`、`nginx-auth`、`nginx-botsearch`、`recidive`（`/etc/fail2ban/jail.local`；`fail2ban-client status` 复核一致）
  - `jail.local` 未配置 `ignoreip`（旧文档写的 `attrax-404-probe` jail 并未在 lighthouse 部署；`docs/infra/fail2ban-*.conf` 是阿里云深圳时代快照 —— 该机已退役，其中残留的 `203.0.113.10` 亦然）
- **Session auth**: 32-byte random tokens (256 bits entropy), SHA-256 hashed, `timingSafeEqual` constant-time comparison
- **SessionId validation**: 三层正则不统一 — `lib/schemas.ts:SessionIdSchema` 限 50 字符（`/^scan_[0-9A-Za-z_-]{1,50}$/`），`app/api/backend-session-access.ts:SAFE_SESSION_ID` + RAG `rag_service/api/v1.py:_SESSION_ID` 限 64 字符（`/^scan_[A-Za-z0-9_-]{1,64}$/`）。BFF 的 64 是外层，前端 schema 的 50 是内层；调用经 Zod 校验，64-char 范围包含 50-char 范围，没有错位风险
- **CORS**: `RAG_ALLOWED_ORIGINS=https://example.com,http://localhost:3000` (8001 only listens on loopback 127.0.0.1 so cross-origin attacks are limited)
- **Magic bytes**: `lib/upload-validation.ts` validates PNG/JPEG/WEBP/PDF/DOCX content signatures, plus size limits, plus MIME + extension checks

## Process & file permissions

- `pm2` runs as **`ubuntu`** (NOT root), via `/etc/systemd/system/pm2-ubuntu.service` (`User=ubuntu`); `PM2_HOME=/home/ubuntu/.pm2`
- `/opt/attrax` owned by `ubuntu:ubuntu`; `data/` additionally group-owned by `netdev` (so the `nextjs` process can write under its own uid)
- **`/etc/sudoers` grants full passwordless sudo, not a restricted allowlist**: `ubuntu ALL=(ALL:ALL) NOPASSWD: ALL` (also duplicated in `/etc/sudoers.d/90-cloud-init-users`), plus a `lighthouse ALL=(ALL) NOPASSWD: ALL` entry. Anything running as `ubuntu` — including the three pm2-supervised apps — can become root without a password. This is broader than the operator-command allowlist earlier versions of this document described; treat a compromise of any pm2 app as a root compromise, and tighten to an explicit allowlist if that blast radius is not acceptable
- `ubuntu` removed from the `docker` group (no container privilege escalation)
- `unattended-upgrades` enabled for security packages
- **Secrets**: `/opt/attrax/.rag-internal-secret` (`600`) is the single source for `RAG_INTERNAL_SECRET`; `.env` files are `600`/`640`. Never commit them (see `.gitignore` — `.env*`)

## Disabled services

Manually stopped + disabled (cloud server doesn't need them):

- `docker.service`, `docker.socket`, `containerd.service`
- `ModemManager.service`
- `apport.service`
- `multipathd.service`
- `udisks2.service`

## Kernel hardening

22 sysctl parameters in `infra/sysctl-99-attrax-hardening.conf`:

- `tcp_syncookies=1` (SYN flood)
- `rp_filter=1` (anti-spoofing)
- `accept_redirects=0`, `accept_source_route=0`, `secure_redirects=0`
- `log_martians=1`, `icmp_echo_ignore_broadcasts=1`
- `fs.protected_hardlinks=1`, `fs.protected_symlinks=1`
- `kernel.kptr_restrict=2`, `kernel.dmesg_restrict=1`, `kernel.yama.ptrace_scope=2`
- `net.core.somaxconn=1024`, `net.core.netdev_max_backlog=2048`

## Log management

- `journald` capped at 200 MB, 14-day retention (`infra/journald-00-attrax.conf`)
- `logrotate` for `/var/log/attrax-*.log`: daily, keep 14, compress
- `/opt/attrax/logs/`: `attrax-backup.log` (admin-readable only, 750 directory)
- Uptime cron writes to `/opt/attrax/logs/attrax-uptime.log` (no-op on success, only logs failures)

## Backup policy

- **Daily 03:00 cron** (`infra/cron-attrax-backup`): `backup-attrax-prod.sh` tars `.env`, `rag_service/.env`, `data/regulation_supplements/` and SQLite state databases (De-RAG FAISS removed)
- Backup stored in `/opt/attrax/backups/attrax-data-YYYYMMDD-HHMMSS.tar.gz` (~10 MB, permission 600)
- Keeps last 14 backups (rotation)
- **No offsite backup** — single-server risk. Add `rsync` to a remote before public launch.

## Uptime monitoring

- **Every 5 minutes cron** (`infra/cron-attrax-uptime`): `uptime-check.sh` curls `/api/health`
- On failure: writes to `/opt/attrax/logs/attrax-uptime.log`
- No alerting — manual review required. Add email/WeChat webhook before public launch.

## Known limitations (TODO before public launch)

1. **Self-signed HTTPS cert** → use real domain + Let's Encrypt
2. **No offsite backup** → add `rsync` to remote
3. **No alerting on uptime failures** → add email/WeChat
4. **Untested Zod schema on [sessionId] routes** → 3 routes patched, need rebuild
5. **`session-store.ts` 已删除**（2026-09-14 de-RAG 治理）——sessionId 校验改走 `lib/schemas.ts SessionIdSchema` + `app/api/backend-session-access.ts SAFE_SESSION_ID`，坏 sessionId 不再单独抛错
6. **`scan-queue` 本地作业文件已删除**（2026-09-14 de-RAG 治理）——上传仅存 RAG 侧 `data/backend/uploads/`，无 base64 job 文件落地
7. **8 npm audit vulnerabilities** (transitive: undici, hono, vite) → `npm audit fix` + rebuild
8. **No user authentication** → anyone with the URL can scan (intentional for demo, but rate-limited)

## Code-level security highlights

- All API inputs validated with Zod (`lib/schemas.ts`)
- Session tokens: `crypto.randomBytes(32).toString('base64url')` + SHA-256 hash
- File uploads: MIME + extension + magic bytes (`lib/upload-validation.ts`)
- Reports rendered with `react-markdown` (safe HTML, no `dangerouslySetInnerHTML`)
- `eval`/`new Function`/`exec` not used in project code (only in scraped regulation HTML, which is sanitized at chunking)

## Incident response

If you suspect compromise:

1. **Disconnect**: `ufw deny in` on 22/80/443 (or `iptables -I INPUT 1 -j DROP`)
2. **Snapshot**: `dd` the disk before rebooting
3. **Audit logs**: `journalctl --since="24 hours ago"` + `tail /var/log/attrax-*.log` + `grep -E "(sk-cp-|ms-)" /var/log/`
4. **Rotate keys**: `MINIMAX_API_KEY`（仅此一个；`PAI_API_KEY` / `MODELSCOPE_API_KEY` / `OLLAMA_*` 随 embedding 栈删除，无代码读取）on the MiniMax dashboard
5. **Force re-key**: invalidate all sessions by `rm /opt/attrax/data/backend/sessions/*.json`（RAG FileBackend 真值；老路径 `/opt/attrax/.next/standalone/data/sessions/` 已不存在 —— `.next/standalone/data/` 从未被 RAG 写入）
6. **Inspect**: check `~/.ssh/authorized_keys` on root and admin for unexpected entries
7. **Rebuild**: deploy fresh from clean git checkout

## Audit log of changes

See git commit history. Major rounds:
- 2026-06-21: Initial deploy + RAG complianceReport fix (`044daf1`)
- 2026-06-21: pm2 ecosystem + test pixel image (`bb8c55d`)
- 2026-06-21: SERVER-OPS manual (`47a786b`)
- 2026-06-21: End-to-end RAG report fix (`d5d4302`)

Server-side hardening applied via SSH (11 rounds of `/loop`-driven improvements, not yet committed to git):
- See `docs/infra/` for all captured configs
