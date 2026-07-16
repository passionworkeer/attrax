# Attrax Server Access Handoff

> Verified on 2026-07-16. This is the short operational entry point. For the older full runbook, see `docs/SERVER-OPS.md`.

## Current Decision

- The local repository is updated to `origin/main` at commit `08c84c56562fd07e752c80a26957000c8218b67b`.
- Production was **not deployed or updated** during the 2026-07-16 session. The frontend is expected to be substantially rebuilt later, so the current production build remains in place.
- Only the PM2 systemd startup state was repaired. No application process was restarted and the existing PIDs stayed online.

## SSH Entry Point

From the current Windows workstation:

```powershell
ssh admin@120.77.36.107
```

The workstation uses:

- Private-key path: `C:\Users\04735\.ssh\id_ed25519` (never copy this file into the repository)
- Authorized public-key fingerprint: `SHA256:nsRvSs2THqTndcDF9lEizY6Hdwy2aLkLrPt4Jjf9Ka4`
- Server user: `admin`
- Production path: `/opt/attrax`

Password authentication was not used successfully. Do not store a server password, private key, API key, or `.env` content in this repository.

Quick connection test:

```powershell
ssh -o BatchMode=yes -o ConnectTimeout=10 admin@120.77.36.107 "whoami; hostname; cd /opt/attrax && pwd"
```

Expected identity and path: `admin`, host `iZwz96dvzk6r77fwxkylciZ`, `/opt/attrax`.

## Runtime Management

Production runs without Docker:

- Nginx: ports 80 and 443
- Next.js standalone: `127.0.0.1:3000`
- FastAPI RAG service: `127.0.0.1:8001`
- PM2 owner: `admin`
- PM2 home: `/home/admin/.pm2`
- systemd unit: `pm2-root.service`

Always use the `admin` PM2 home explicitly:

```bash
cd /opt/attrax
env PM2_HOME=/home/admin/.pm2 \
  /opt/attrax/node_modules/pm2/bin/pm2 list
```

Read-only health checks:

```bash
systemctl is-active nginx pm2-root fail2ban certbot.timer
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:8001/health
curl -fsS -o /dev/null -w 'HTTPS status=%{http_code} time=%{time_total}s\n' \
  https://www.twinbuddy.xyz/
```

Expected: `pm2-root` is `active`, both internal health endpoints return `status: ok`, and public HTTPS returns 200.

## Verified Production Snapshot

On 2026-07-16:

- Nginx configuration passed `sudo nginx -t`.
- Next.js and RAG were healthy with `demoMode=false`.
- `pm2-root.service` had failed on 2026-06-21 because its PM2 executable was installed after the unit's first start attempt. The current process list was saved and the unit was reset and started successfully on 2026-07-16.
- Next.js and RAG retained their existing PIDs and roughly 23-day uptime during that repair.
- The server had about 1.6 GiB RAM, 4 GiB swap, and 25 GiB free disk space.
- The deployed Next.js artifacts were built on 2026-06-22 and are older than the current local `main`.

## Future Deployment Constraints

`/opt/attrax` is **not a Git checkout** and contains no `.git` directory. The GitHub repository also cannot be cloned anonymously from the server. Do not run `git pull` in `/opt/attrax` and do not copy workstation GitHub credentials to production.

For a future release, transfer a clean Git archive from a trusted workstation. Preserve these server-only assets:

- `/opt/attrax/.env`
- `/opt/attrax/data/`
- `/opt/attrax/.venv/`
- `/opt/attrax/.next/standalone/data/` when active sessions must survive
- `/home/admin/.pm2/dump.pm2`

The server is memory constrained. Before running `npm ci` or `npm run build` on it, stop `rag-service` to release roughly 850 MiB. Make a timestamped backup and prepare rollback commands before replacing artifacts. Re-check the deployment procedure after the planned frontend rebuild instead of assuming the older build steps still apply.

## Removing This Workstation's Access

On the server, first back up the authorization file, then remove the line whose comment is `17820577270@163.com`:

```bash
cp /home/admin/.ssh/authorized_keys \
  /home/admin/.ssh/authorized_keys.bak.$(date +%Y%m%d-%H%M%S)
sed -i '/17820577270@163\.com$/d' /home/admin/.ssh/authorized_keys
chmod 600 /home/admin/.ssh/authorized_keys
```

Test a new login in a separate terminal before closing the existing administrative session.
