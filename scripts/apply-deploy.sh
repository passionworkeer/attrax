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
#   scp /tmp/attrax-deploy-complete.tar.gz aliyun-sz:/tmp/
#
# 服务器：
#   bash /tmp/attrax-apply-deploy.sh            # 部署
#   bash /tmp/attrax-apply-deploy.sh --rollback # 回滚到上一个 standalone
#
# 安装到服务器（首次或更新本脚本时）：
#   scp scripts/apply-deploy.sh aliyun-sz:/tmp/attrax-apply-deploy.sh
#
# 注意：本脚本只处理 Next.js（.next/standalone + .next/static + BUILD_ID + pm2 nextjs）。
# 改了 rag_service/*.py 时另行 scp 并 `pm2 restart rag-service --update-env`。
#
# 端口单一来源（2026-09-18 事故防护）：
#   tarball 里带 standalone/ops/（ports.env、render-nginx-vhost.sh、vhost 模板、
#   healthcheck 三件套、ecosystem.config.cjs）。本脚本把它们安装到服务器，
#   再用 render-nginx-vhost.sh 重新生成 /etc/nginx/sites-enabled/attrax 并 reload，
#   保证 nginx upstream 端口永远等于 ports.env 的 NEXTJS_PORT —— 与
#   ecosystem.config.cjs（require ports.env.cjs）同源，杜绝 3001/3000 漂移。
set -euo pipefail

TARBALL="${ATTRAX_TARBALL:-/tmp/attrax-deploy-complete.tar.gz}"
ATTRAX_DIR="${ATTRAX_DIR:-/opt/attrax}"
STANDALONE="${ATTRAX_DIR}/.next/standalone"
STATIC_LINK="${ATTRAX_DIR}/.next/static"
REPO_DIR="${ATTRAX_REPO_DIR:-/opt/attrax}"
RENDER_SCRIPT="${REPO_DIR}/scripts/render-nginx-vhost.sh"
LIVE_VHOST="/etc/nginx/sites-enabled/attrax"
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
  cd "${ATTRAX_DIR}"
  # 区分两种失败：树已还原但进程没起来（exit 3，操作者需手动 pm2 restart）
  # vs 还原本身失败（set -e 直接中止）。自动回滚的调用方据此报出准确信息。
  if pm2 restart nextjs --update-env 2>&1 | tail -5; then
    log "rolled back; the broken tree was kept at ${broken}"
  else
    log "ERROR: tree restored to ${target} but 'pm2 restart nextjs' failed — run it manually"
    exit 3
  fi
  exit 0
fi

# ── 失败自动回滚（2026-09-19）────────────────────────────────────────────────
# [2] 之后旧树已挪走、新树解到一半，任何一步失败都会把站点留在半挂状态，
# 而此前只有人工跑 `--rollback` 这一条恢复路径（docs 里一句提示）。
# 规则（第一性原理：只对"这次部署造成的"故障回滚）：
#   - 阶段一 preflight：还没动过线上代码，失败不回滚
#   - 阶段二 backup_taken：[2] 已把旧树挪进备份目录 —— 此时无论解包是否成功，
#     线上都可能没有完整可用的树，失败必须回滚（tar 坏包正是这个场景）
#   - 阶段三 deployed：[3] 解包成功；失败同样回滚
#   - 仅在部署前健康 = 200 时才回滚 —— 部署前就挂着的站，失败不能归因于本次
#   - `--rollback` 子调用里 DEPLOY_STAGE 仍是 preflight，天然不会递归
DEPLOY_STAGE="preflight"
PRE_DEPLOY_HEALTH="$(curl -sk -m 5 -o /dev/null -w "%{http_code}" "${HEALTH_URL}" || echo 000)"

rollback_on_failure() {
  rc=$?
  if [ "$rc" -eq 0 ] || [ "${DEPLOY_STAGE}" = "preflight" ]; then
    return
  fi
  if [ "${PRE_DEPLOY_HEALTH}" != "200" ]; then
    log "WARN: deploy failed (rc=${rc}) but the site was already unhealthy before this deploy (pre=${PRE_DEPLOY_HEALTH}) — NOT auto-rolling back."
    log "       inspect /opt/attrax/.next/standalone-pre-deploy-${STAMP} before deciding."
    return
  fi
  log "WARN: deploy failed (rc=${rc}) at stage '${DEPLOY_STAGE}' — auto-rolling back"
  if bash "$0" --rollback; then
    log "auto-rollback done; the failed tree was kept for inspection"
  else
    log "ERROR: auto-rollback FAILED — recover manually: bash $0 --rollback (previous tree: ${BACKUP_DIR})"
  fi
}
trap rollback_on_failure EXIT

# ── [0] 端口漂移预检（只警告不阻断；真正的修复在 [6.5]+[8.5]）──────────────
# 检查当前线上 nginx vhost 的 upstream 端口是否等于服务器上 ports.env 的
# NEXTJS_PORT。不一致说明有人手改过 vhost —— 本次部署的 [8.5] 会用
# render-nginx-vhost.sh 重新生成并修掉它，所以这里 warn 让操作者知情。
if [ -f "${REPO_DIR}/scripts/ports.env" ] && [ -f "${LIVE_VHOST}" ]; then
  expected_port="$(grep -E '^NEXTJS_PORT=' "${REPO_DIR}/scripts/ports.env" | head -1 | cut -d= -f2- | tr -d '[:space:]')"
  # 只认 upstream 块里的 `server 127.0.0.1:PORT`（行首关键字），不认 proxy_pass
  # 或注释里出现的地址 —— 旧实现用 `head -1` 取全文第一个 127.0.0.1:PORT，在
  # 多 upstream（blue/green）或带历史注释的 vhost 上会读错。
  live_port="$(grep -E '^[[:space:]]*server[[:space:]]+127\.0\.0\.1:[0-9]+' "${LIVE_VHOST}" | head -1 | grep -oE '[0-9]+$')"
  if [ -n "${expected_port}" ] && [ -n "${live_port}" ] && [ "${live_port}" != "${expected_port}" ]; then
    log "WARN: nginx upstream 端口漂移 — vhost=${live_port}, ports.env=${expected_port}；[8.5] 将重新渲染修复"
  fi
fi

# ── [1] preflight ──────────────────────────────────────────────────────────
log "=== [1] preflight ==="
test -f "${TARBALL}" || { log "ERROR: tarball missing: ${TARBALL}"; exit 1; }
test -d "${STANDALONE}" || { log "ERROR: no existing standalone at ${STANDALONE}"; exit 1; }
# ops/ 必须在包里（端口单一来源链路依赖它）
OPS_COUNT=$(tar -tzf "${TARBALL}" | grep -c '^standalone/ops/' || true)
if [ "$OPS_COUNT" -lt 10 ]; then
  log "ERROR: tarball 缺 standalone/ops/（只有 ${OPS_COUNT} 个文件，需要 10 个）— 用最新 build-deploy-tarball.sh 重新打包"
  exit 1
fi

# ── [2] snapshot current standalone ────────────────────────────────────────
log "=== [2] backup current standalone -> ${BACKUP_DIR} ==="
mv "${STANDALONE}" "${BACKUP_DIR}"
# 旧树已挪走：从这一刻起线上没有完整可用的树，任何失败都必须回滚（含 tar 坏包）。
DEPLOY_STAGE="backup_taken"
previous_backups | tail -n "+$((KEEP_BACKUPS + 1))" | xargs -r rm -rf

# ── [3] extract tarball ────────────────────────────────────────────────────
log "=== [3] extract tarball ==="
tar -C "${ATTRAX_DIR}/.next" -xzf "${TARBALL}"
test -f "${STANDALONE}/server.js" || { log "ERROR: extract failed (no server.js)"; exit 1; }
# 新树已落地 —— 从这一刻起任何失败都触发上面的自动回滚（前提：部署前健康）。
DEPLOY_STAGE="deployed"

# ── [4] static symlink ─────────────────────────────────────────────────────
log "=== [4] verify .next/static symlink ==="
# Next 16 + Turbopack keeps chunks at the build root; nginx aliases /_next/static/
# to this path, so a dangling link means every chunk 404s.
#
# Rebuild UNCONDITIONALLY. Checking `[ ! -e ]` only catches a dangling link:
# after an in-place extract the old link already resolves (same path, replaced
# contents), so it was kept as-is even when the new build reorganized chunks —
# which surfaces as ChunkLoadError against the new server's embedded manifest.
# `rm -rf` on a symlink removes the link, never its target.
rm -rf "${STATIC_LINK}"
ln -s "${STANDALONE}/.next/static" "${STATIC_LINK}"
ls -la "${STATIC_LINK}" | head -1

# ── [5] BUILD_ID ───────────────────────────────────────────────────────────
log "=== [5] BUILD_ID ==="
NEW_BID=$(cat "${STANDALONE}/.next/BUILD_ID")
echo "${NEW_BID}" > "${ATTRAX_DIR}/.next/BUILD_ID"
log "  BUILD_ID: ${NEW_BID}"

# ── [6] deploy marker ──────────────────────────────────────────────────────
log "=== [6] deploy marker ==="
test -f "${STANDALONE}/.deployed" && cat "${STANDALONE}/.deployed"
# 把 commit SHA 拷到 /opt/attrax/.build-sha，ecosystem.config.cjs 启动 rag-service 时
# 读出来作为 ATTRAX_BUILD_SHA（保证 /ready 与 audit 日志与 .deployed 一致）。
if [ -f "${STANDALONE}/.build-sha" ]; then
  cp "${STANDALONE}/.build-sha" "${ATTRAX_DIR}/.build-sha"
  log "  .build_sha: $(cat "${ATTRAX_DIR}/.build-sha")"
fi

# ── [6.5] 安装 ops/：端口单一来源 + nginx 渲染 + healthcheck ───────────────
# tarball 里的 standalone/ops/ 是随构建走的运维文件真值。安装到：
#   /opt/attrax/scripts/{ports.env,ports.env.cjs,render-nginx-vhost.sh,ecosystem.config.cjs}
#   /opt/attrax/docs/infra/nginx-attrax-vhost-prod.conf.template
#   /usr/local/bin/attrax-healthcheck.sh
#   /etc/systemd/system/attrax-healthcheck.{service,timer}
# render-nginx-vhost.sh 按 ${SCRIPT_DIR}/../docs/infra/… 解析模板路径，布局必须保持。
log "=== [6.5] install ops files (ports / render / healthcheck) ==="
OPS="${STANDALONE}/ops"
mkdir -p "${REPO_DIR}/scripts" "${REPO_DIR}/docs/infra"
install -m 644 "${OPS}/ports.env"                    "${REPO_DIR}/scripts/ports.env"
install -m 644 "${OPS}/ports.env.cjs"                "${REPO_DIR}/scripts/ports.env.cjs"
install -m 755 "${OPS}/render-nginx-vhost.sh"        "${REPO_DIR}/scripts/render-nginx-vhost.sh"
install -m 644 "${OPS}/ecosystem.config.cjs"         "${REPO_DIR}/scripts/ecosystem.config.cjs"
install -m 644 "${OPS}/nginx-attrax-vhost-prod.conf.template" "${REPO_DIR}/docs/infra/nginx-attrax-vhost-prod.conf.template"
# 备份执行体：cron（/etc/cron.d/attrax-backup{,-remote}）直接调用
# /opt/attrax/scripts/backup-data.sh 与 backup-remote.sh。此前它们只存在于
# 文档的"手工 scp"步骤里 —— 缺失时 cron 静默失败，备份等于没跑。
install -m 755 "${OPS}/backup-data.sh"               "${REPO_DIR}/scripts/backup-data.sh"
install -m 755 "${OPS}/backup-remote.sh"             "${REPO_DIR}/scripts/backup-remote.sh"
if [ -d /etc/systemd/system ]; then
  install -m 755 "${OPS}/attrax-healthcheck.sh"      /usr/local/bin/attrax-healthcheck.sh
  install -m 644 "${OPS}/attrax-healthcheck.service" /etc/systemd/system/attrax-healthcheck.service
  install -m 644 "${OPS}/attrax-healthcheck.timer"   /etc/systemd/system/attrax-healthcheck.timer
  systemctl daemon-reload
  systemctl enable attrax-healthcheck.timer >/dev/null 2>&1 || true
  systemctl start attrax-healthcheck.timer >/dev/null 2>&1 || true
  log "  healthcheck timer enabled"
else
  log "  WARN: no systemd on this host — healthcheck not installed"
fi
log "  ops installed; render 校验: $(bash "${RENDER_SCRIPT}" --check)"

# ── [7] cleanup tarball ────────────────────────────────────────────────────
log "=== [7] cleanup tarball ==="
rm -f "${TARBALL}"

# ── [8] restart ────────────────────────────────────────────────────────────
log "=== [8] restart pm2 nextjs ==="
cd "${ATTRAX_DIR}"
# startOrRestart（而不是裸 pm2 restart nextjs）才会重读 ecosystem.config.cjs ——
# 新版 ecosystem require ports.env.cjs，端口变更要靠它生效（部署雷区：
# env 段变化必须让 pm2 重新加载配置文件）。
pm2 startOrRestart "${REPO_DIR}/scripts/ecosystem.config.cjs" --only nextjs 2>&1 | tail -10

# ── [8.5] 重新渲染 nginx vhost 并 reload（防端口漂移）──────────────────────
# 每次部署都从 .template + ports.env 重新生成 vhost：手改过的端口、过期的
# upstream 一律被覆盖回单一来源的值。
log "=== [8.5] render + reload nginx vhost ==="
if [ -w "$(dirname "${LIVE_VHOST}")" ]; then
  # The rendered vhost references the `attrax_conn` shared memory zone.
  # The directive that defines it (`limit_conn_zone`) must live in the
  # main `/etc/nginx/nginx.conf` `http {}` block, not in the vhost. If a
  # previous deploy missed it, `nginx -t` below fails before reload —
  # inject the canonical one-liner in place (idempotent; same string as
  # docs/infra/nginx-nginx.conf keeps in source).
  NGINX_MAIN="/etc/nginx/nginx.conf"
  if ! grep -q "limit_conn_zone .* zone=attrax_conn:10m" "${NGINX_MAIN}"; then
    if grep -q "^[[:space:]]*keepalive_requests 100;" "${NGINX_MAIN}"; then
      log "  injecting limit_conn_zone into ${NGINX_MAIN} (http {} — required by vhost)"
      # 备份带时间戳：固定的 .bak-attrax 会被下一次 self-heal 覆盖，且让巡检
      # 分不清是哪次部署留下的。
      sed -i.bak-attrax-"$(date -u +%Y%m%d-%H%M%S)" "/^[[:space:]]*keepalive_requests 100;$/a\\
    # 2026-09-18 concurrency hardening (H10): per-IP concurrent-connection cap.\\
    limit_conn_zone \$binary_remote_addr zone=attrax_conn:10m;" "${NGINX_MAIN}"
    nginx -t || { log "ERROR: nginx -t still fails after zone injection"; exit 1; }
    else
      log "ERROR: cannot inject limit_conn_zone — keepalive_requests 100 marker not found in ${NGINX_MAIN}"
      log "       add 'limit_conn_zone \$binary_remote_addr zone=attrax_conn:10m;' manually inside http {}"
      exit 1
    fi
  fi
  bash "${RENDER_SCRIPT}" --out "${LIVE_VHOST}"
  # 清掉旧手工流程遗留的 /etc/nginx/sites-available/attrax（2026-09-18 生产实测
  # 发现它仍写着 3001——任何"从 sites-available 恢复"的标准 Debian 操作都会把
  # 502 带回来）。渲染产物是 sites-enabled/attrax 正规文件、不依赖它，直接删除。
  if [ -e /etc/nginx/sites-available/attrax ] && [ ! -L "${LIVE_VHOST}" ]; then
    rm -f /etc/nginx/sites-available/attrax
    log "  removed stale /etc/nginx/sites-available/attrax (unused 3001 leftover)"
  fi
  nginx -t
  nginx -s reload && log "  nginx reloaded (upstream = ports.env.NEXTJS_PORT)"
else
  log "  WARN: ${LIVE_VHOST} 不可写，跳过渲染 — 手动运行: bash ${RENDER_SCRIPT} --out ${LIVE_VHOST} && nginx -s reload"
fi

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
