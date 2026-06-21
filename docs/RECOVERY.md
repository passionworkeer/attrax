# Recovery Procedure — 120.77.36.107

Last incident: 2026-06-21, npm audit fix + rebuild OOM'd the 1.6GB-RAM server, SSH became unreachable (banner exchange timeout). This file is the runbook for recovery.

## Quick diagnosis

```bash
ssh -o ConnectTimeout=15 root@120.77.36.107 'uptime; free -m'
```

- **Connection timed out during banner exchange** → sshd alive but CPU/IO thrashed (OOM swap). Wait 5-10 min or force-restart from Aliyun console.
- **Connection closed by remote** → MaxStartups / MaxSessions hit. Wait 60s for half-open to clear.
- **No route to host** → host down. Aliyun console check.
- **Permission denied (publickey)** → key issue. Check `~/.ssh/authorized_keys` or `ssh -v` for details.

## Force restart from Aliyun console

1. https://ecs.console.aliyun.com → Instances → `iZwz96dvzk6r77fwxkylciZ` (or by IP 120.77.36.107)
2. "操作" → "实例状态" → "强制重启" (注意是"强制"而不是"普通",跳过优雅关机)
3. 等待 60-120s for boot
4. SSH 验证

## After restart — restore service

systemd `pm2-root.service` auto-starts and runs `pm2 resurrect` which reads `/home/admin/.pm2/dump.pm2`. The dump saved the last-known processes (nextjs + rag-service). If `.next/standalone/` is intact, the previous build will start automatically.

```bash
ssh root@120.77.36.107
cd /opt/attrax

# 1. Verify .next/standalone exists and has the last build
ls .next/standalone/server.js
cat .next/standalone/.next/BUILD_ID   # should be XzwrLs7SC-QpamMLI55Vt (15-round build)

# 2. If standalone exists, verify health
curl -sk https://127.0.0.1:443/api/health
# Expected: {"frontend":"ok","ragService":{"status":"ok",...},"demoMode":false}

# 3. If standalone is MISSING or broken, rebuild:
# 3a. Stop RAG to free 800MB
su admin -c "PM2_HOME=/home/admin/.pm2 /opt/attrax/node_modules/pm2/bin/pm2 stop rag-service"

# 3b. Verify pm2 still exists
ls /opt/attrax/node_modules/pm2/bin/pm2
# If missing, do: su admin -c "npm ci" (FULL install, NOT --omit=dev; pm2 is a devDep)

# 3c. Build
su admin -c "NODE_OPTIONS=--max-old-space-size=1024 npm run build"

# 3d. Deploy artifacts
rm -rf .next/standalone/.next/static .next/standalone/public .next/standalone/.env
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
cp .env .next/standalone/.env
chown -R admin:admin .next/standalone
mkdir -p .next/standalone/data/sessions .next/standalone/data/scan-queue
chown -R admin:admin .next/standalone/data
chmod 750 .next/standalone/data /opt/attrax/data/sessions /opt/attrax/data/scan-queue

# 3e. Restart
su admin -c "PM2_HOME=/home/admin/.pm2 /opt/attrax/node_modules/pm2/bin/pm2 delete all"
su admin -c "PM2_HOME=/home/admin/.pm2 /opt/attrax/node_modules/pm2/bin/pm2 start scripts/ecosystem.config.cjs"
su admin -c "PM2_HOME=/home/admin/.pm2 /opt/attrax/node_modules/pm2/bin/pm2 save"
```

## If the new lockfile (npm audit fix) was partially deployed

The new `package-lock.json` was scp'd before the OOM. If `npm ci` was started but didn't finish, the server is in an inconsistent state (lockfile says one thing, node_modules another). In that case:

```bash
# Verify lock matches what's installed
su admin -c "npm ci"   # FULL install (no --omit-dev); will reconcile to lockfile
# This may take 1-2 min and use 500MB+ RAM
```

## Lessons (so we don't repeat this)

1. **Build memory budget on this 1.6GB server**: stop rag-service (~800MB) → build (~600MB peak) → copy → restart. The 800MB-from-stopping-rag is the only reason previous 14 rounds of builds worked. The 15th round (npm ci + build without stopping) exhausted memory.
2. **Never `rm -rf` the standalone directory before verifying the backup copy is in place** (`ls /opt/attrax/.next/standalone.bak.*` then `cp -a` then `ls /opt/attrax/.next/standalone/server.js` to confirm). The 15th round deleted the live standalone AND the backup, leaving nothing to roll back to.
3. **pm2 is in devDependencies** (not bundled with the app). If you do `npm ci --omit=dev`, pm2 gets removed from `node_modules`. For build, you NEED dev deps (postcss, tailwind, esbuild). For runtime, the standalone build carries its own bundled `node_modules` so it doesn't need the project root's. The build machine needs full deps; the runtime image needs only standalone.
4. **Future**: move build to a separate CI runner (GitHub Actions, local Mac/Linux box) and ship the standalone artifact. The 1.6GB server should only *run*, never *build*.
