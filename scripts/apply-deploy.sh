#!/bin/bash
# apply-deploy.sh — 服务器侧部署：用 build-deploy-tarball.sh 的产物整包替换 Next.js standalone。
#
# 为什么要有这个文件：这段逻辑原本只存在于服务器的 /tmp/attrax-apply-deploy.sh，
# 未纳入版本控制 —— /tmp 会被清理，机器重建后流程即丢失，且改动没有任何评审记录。
# 它是「回滚」和「部署后校验」唯一该发生的地方，所以必须与 build-deploy-tarball.sh
# 成对入库。
#
# 配套（本地）：
#   bash scripts/build-deploy-tarball.sh        # -> /tmp/attrax-deploy-complete.tar.gz
#   scp /tmp/attrax-deploy-complete.tar.gz lighthouse:/tmp/
#
# 服务器：
#   bash /tmp/attrax-apply-deploy.sh            # 部署
#   bash /tmp/attrax-apply-deploy.sh --rollback # 回滚到上一个 standalone
#
# 安装到服务器（首次或更新本脚本时）：
#   scp scripts/apply-deploy.sh lighthouse:/tmp/attrax-apply-deploy.sh
#
# 注意：本脚本只处理 Next.js（.next/standalone + .next/static + BUILD_ID + pm2 nextjs）。
# 改了 rag_service/*.py 时另行 scp 并 `pm2 restart rag-service --update-env`。
set -euo pipefail

TARBALL="/tmp/attrax-deploy-complete.tar.gz"
ATTRAX_DIR="${ATTRAX_DIR:-/opt/attrax}"
STANDALONE="${ATTRAX_DIR}/.next/standalone"
STATIC_LINK="${ATTRAX_DIR}/.next/static"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_DIR="${ATTRAX_DIR}/.next/standalone-pre-deploy-${STAMP}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
KEEP_BACKUPS=2

log() { echo "[$(date -Iseconds)] $*"; }

previous_backups() {
  # newest first
  ls -dt "${ATTRAX_DIR}"/.next/standalone-pre-deploy-* 2>/dev/null || true
}

# ── rollback ────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--rollback" ]; then
  target=$(previous_backups | head -1)
  if [ -z "${target}" ]; then
    log "ERROR: no standalone-pre-deploy-* snapshot to roll back to"
    exit 1
  fi
  log "=== rollback -> ${target} ==="
  broken="${ATTRAX_DIR}/.next/standalone-rollback-${STAMP}"
  # Plain `if`, not `[ -d ] && mv`: under `set -e` a failed test would make the
  # whole chain return non-zero and abort the rollback.
  if [ -d "${STANDALONE}" ]; then
    mv "${STANDALONE}" "${broken}"
  fi
  mv "${target}" "${STANDALONE}"
  # The static symlink is rebuilt from the restored tree, not assumed.
  rm -f "${STATIC_LINK}"
  ln -s "${STANDALONE}/.next/static" "${STATIC_LINK}"
  cat "${STANDALONE}/.next/BUILD_ID" > "${ATTRAX_DIR}/.next/BUILD_ID" 2>/dev/null || true
  cd "${ATTRAX_DIR}" && pm2 restart nextjs --update-env 2>&1 | tail -5
  log "rolled back; the broken tree was kept at ${broken}"
  exit 0
fi

# ── [1] preflight ──────────────────────────────────────────────────────────
log "=== [1] preflight ==="
test -f "${TARBALL}" || { log "ERROR: tarball missing: ${TARBALL}"; exit 1; }
test -d "${STANDALONE}" || { log "ERROR: no existing standalone at ${STANDALONE}"; exit 1; }

# ── [2] snapshot current standalone ────────────────────────────────────────
log "=== [2] backup current standalone -> ${BACKUP_DIR} ==="
mv "${STANDALONE}" "${BACKUP_DIR}"
previous_backups | tail -n "+$((KEEP_BACKUPS + 1))" | xargs -r rm -rf

# ── [3] extract ────────────────────────────────────────────────────────────
log "=== [3] extract tarball ==="
tar -C "${ATTRAX_DIR}/.next" -xzf "${TARBALL}"
test -f "${STANDALONE}/server.js" || { log "ERROR: extract failed (no server.js)"; exit 1; }

# ── [4] static symlink ─────────────────────────────────────────────────────
log "=== [4] verify .next/static symlink ==="
# Next 16 + Turbopack keeps chunks at the build root; nginx aliases /_next/static/
# to this path, so a dangling link means every chunk 404s.
if [ ! -e "${STATIC_LINK}" ]; then
  log "  static symlink broken, recreating"
  rm -f "${STATIC_LINK}"
  ln -s "${STANDALONE}/.next/static" "${STATIC_LINK}"
fi
ls -la "${STATIC_LINK}" | head -1

# ── [5] BUILD_ID ───────────────────────────────────────────────────────────
log "=== [5] BUILD_ID ==="
NEW_BID=$(cat "${STANDALONE}/.next/BUILD_ID")
echo "${NEW_BID}" > "${ATTRAX_DIR}/.next/BUILD_ID"
log "  BUILD_ID: ${NEW_BID}"

# ── [6] deploy marker ──────────────────────────────────────────────────────
log "=== [6] verify .deployed marker ==="
test -f "${STANDALONE}/.deployed" && cat "${STANDALONE}/.deployed"

# ── [7] cleanup tarball ────────────────────────────────────────────────────
log "=== [7] cleanup tarball ==="
rm -f "${TARBALL}"

# ── [8] restart ────────────────────────────────────────────────────────────
log "=== [8] restart pm2 nextjs ==="
cd "${ATTRAX_DIR}"
pm2 restart nextjs --update-env 2>&1 | tail -10

# ── [9] health gate ────────────────────────────────────────────────────────
# Without this the script reported success the moment pm2 accepted the restart,
# even if the new build then failed to serve. /api/health walks nginx -> nextjs
# -> RAG /ready, so a 200 means the whole chain is up. Poll it: a fresh nextjs
# can take a few seconds to bind.
log "=== [9] health gate (${HEALTH_URL}) ==="
for attempt in $(seq 1 10); do
  code=$(curl -sk -m 5 -o /dev/null -w "%{http_code}" "${HEALTH_URL}" || echo 000)
  if [ "${code}" = "200" ]; then
    log "health OK after ${attempt} attempt(s)"
    log "=== DONE (BUILD_ID ${NEW_BID}) ==="
    exit 0
  fi
  log "  attempt ${attempt}: http=${code}"
  sleep 3
done

log "ERROR: health gate failed (last http=${code}) — the new build is not serving."
log "       Roll back with: bash $0 --rollback"
log "       Previous tree kept at: ${BACKUP_DIR}"
exit 1
