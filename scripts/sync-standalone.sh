#!/usr/bin/env bash
# sync-standalone.sh — Deploy a freshly built Next.js standalone to the server.
#
# Usage: bash scripts/sync-standalone.sh
#
# Why this script exists: standalone output requires both `.next/standalone/`
# (server bundle) AND `.next/static/` (client chunks). The official Next.js
# deploy steps are:
#   1. `next build`  → produces `.next/standalone/` and `.next/static/`
#   2. Copy `.next/static/*`  → `.next/standalone/.next/static/`
#   3. Copy `public/*`        → `.next/standalone/public/`
# Steps 2 and 3 are NOT automatic — if you forget them the browser loads a
# blank page because every `/_next/static/chunks/*.js` returns 404. This
# script does all three and restarts the nextjs process so the new file list
# is picked up.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STANDALONE="${PROJECT_ROOT}/.next/standalone"
STATIC_SRC="${PROJECT_ROOT}/.next/static"
PUBLIC_SRC="${PROJECT_ROOT}/public"
STATIC_DST="${STANDALONE}/.next/static"
PUBLIC_DST="${STANDALONE}/public"
BACKUP_ENV="/tmp/standalone-env.bak"

SERVER="admin@120.77.36.107"
REMOTE_STANDALONE="/opt/attrax/.next/standalone"

if [ ! -d "${STANDALONE}" ]; then
  echo "ERROR: ${STANDALONE} not found — run \`npm run build\` first." >&2
  exit 1
fi

# 1. Mirror .next/static into the standalone tree so client chunks ship with
#    the server bundle.
if [ -d "${STATIC_SRC}" ]; then
  mkdir -p "${STATIC_DST}"
  cp -r "${STATIC_SRC}/." "${STATIC_DST}/"
  echo "staged: ${STATIC_DST}"
else
  echo "ERROR: ${STATIC_SRC} not found — incomplete build?" >&2
  exit 1
fi

# 2. Mirror public/ into standalone (favicons, robots, etc.).
if [ -d "${PUBLIC_SRC}" ]; then
  rm -rf "${PUBLIC_DST}"
  cp -r "${PUBLIC_SRC}" "${PUBLIC_DST}"
  echo "staged: ${PUBLIC_DST}"
fi

# 3. Snapshot the current remote .env so secrets survive the upload.
ssh -o ConnectTimeout=10 -o BatchMode=yes "${SERVER}" \
  "cp -a ${REMOTE_STANDALONE}/.env ${BACKUP_ENV} 2>/dev/null || true"

# 4. Upload standalone.
scp -o ConnectTimeout=10 -o BatchMode=yes -r "${STANDALONE}/." \
  "${SERVER}:${REMOTE_STANDALONE}/"

# 5. Restore .env, fix ownership, restart nextjs so the file list reloads.
ssh -o ConnectTimeout=10 -o BatchMode=yes "${SERVER}" "
  set -e
  cp ${BACKUP_ENV} ${REMOTE_STANDALONE}/.env
  chmod 600 ${REMOTE_STANDALONE}/.env
  chown -R admin:admin ${REMOTE_STANDALONE}
  mkdir -p ${REMOTE_STANDALONE}/data/uploads /opt/attrax/logs
  chown -R admin:admin ${REMOTE_STANDALONE}/data/uploads /opt/attrax/logs
  chmod 755 ${REMOTE_STANDALONE}/data/uploads
  /opt/attrax/node_modules/.bin/pm2 restart nextjs
"

# 6. Smoke test.
sleep 4
HEALTH=$(ssh -o ConnectTimeout=5 -o BatchMode=yes "${SERVER}" \
  "curl -sk -o /dev/null -w '%{http_code}' https://127.0.0.1/api/health")
echo "smoke test: /api/health => HTTP ${HEALTH}"
if [ "${HEALTH}" != "200" ]; then
  echo "WARNING: health check did not return 200 — investigate." >&2
  exit 2
fi

echo "deploy OK"