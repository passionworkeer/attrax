# Attrax Security Policy

> Last updated: 2026-06-21 (after 11 rounds of hardening)

This document covers security practices for the Attrax production deployment at `120.77.36.107`. Companion file: `infra/` contains actual server config snapshots.

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
| `/opt/attrax/.env` | `600` | `admin:admin` | Top-level Next.js env (read by `.next/standalone/.env` after copy) |
| `/opt/attrax/rag_service/.env` | `600` | `admin:admin` | RAG-specific env |
| `/opt/attrax/.next/standalone/.env` | `600` | `root:root` | Used at Next.js runtime |
| `/opt/attrax/backups/*.tar.gz` | `600` | `admin:admin` | Daily backup contains .env |
| `/var/log/attrax-*.log` | `640` | `admin:admin` | May contain key on rare error; not world-readable |
| Backup directory | `750` | `admin:admin` | Not world-readable |

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

**Domain**: `https://twinbuddy.xyz` (A record → 120.77.36.107). Old self-signed cert at `/etc/nginx/ssl/attrax.{crt,key}` is kept as fallback; nginx config now points to Let's Encrypt paths.

## API protection

- **Rate limit**: `limit_req_zone` in nginx, 10 req/s per IP for `/api/scan`, burst 20, returns 429
- **fail2ban**: 5 jails (`sshd`, `nginx-http-auth`, `nginx-bad-request`, `nginx-block-scanner`, `attrax-404-probe`)
  - `attrax-404-probe` is custom: bans any IP that 10-times-per-minute probes `.env`, `.git`, `wp-admin`, `phpmyadmin`, backup extensions (24-hour ban)
  - `ignoreip = 127.0.0.1/8, 120.77.36.107` (we don't ban ourselves)
- **Session auth**: 32-byte random tokens (256 bits entropy), SHA-256 hashed, `timingSafeEqual` constant-time comparison
- **SessionId validation**: regex `/^[a-zA-Z0-9_-]+$/` in `lib/pipeline/session-store.ts` (TODO: build to activate, currently only enforced via 3 routes' Zod)
- **CORS**: `RAG_ALLOWED_ORIGINS=https://120.77.36.107` (configured; 8001 only listens 127.0.0.1 so cross-origin attacks limited)
- **Magic bytes**: `lib/upload-validation.ts` validates PNG/JPEG/WEBP/PDF/DOCX content signatures, plus size limits, plus MIME + extension checks

## Process & file permissions

- `pm2` runs as `admin` (NOT root). Systemd unit (`pm2-root.service`) sets `User=admin` and `PM2_HOME=/home/admin/.pm2`
- `admin` removed from `docker` group (no container privilege escalation)
- `/opt/attrax` owned by `admin:admin` (recursive chown done in round 4)
- `/etc/sudoers` admin line: `admin ALL=(root) NOPASSWD: /opt/attrax/node_modules/pm2/bin/pm2, /usr/bin/systemctl, /opt/attrax/.venv/bin/python3, /bin/kill, /bin/tee, /bin/cp, /bin/chown, /bin/chmod, /usr/sbin/nginx`
  - Anything else requires password
- `unattended-upgrades` enabled for security packages

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

- **Daily 03:00 cron** (`infra/cron-attrax-backup`): `backup-data.sh` tars `faiss/`, `.env`, `rag_service/.env`, manifest files
- Backup stored in `/opt/attrax/backups/attrax-data-YYYYMMDD-HHMMSS.tar.gz` (~27 MB, permission 600)
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
5. **`session-store.ts` still throws on bad sessionId in old build** → rebuild
6. **`scan-queue` job files contain base64 user uploads** → directory is 750 (admin-only), but consider encryption
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
4. **Rotate keys**: `MINIMAX_API_KEY`, `PAI_API_KEY` on provider dashboards
5. **Force re-key**: invalidate all sessions by `rm /opt/attrax/.next/standalone/data/sessions/*.json`
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
