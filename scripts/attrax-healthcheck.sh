#!/usr/bin/env bash
# attrax-healthcheck.sh — 每 60 秒 curl /api/health，失败升级恢复动作。
#
# 为什么需要：2026-09-18 事故中 nginx upstream 端口错配，全站 502 / 404，
# 没有自动恢复 — 靠人发现并 sed 修改。这次加一层主动巡检：
#
#   level 1: 1 次失败 → 仅记录到 /var/log/attrax-healthcheck.log
#   level 2: 连续 3 次失败 → nginx -s reload（reload 会重读 vhost，修临时漂移）
#   level 3: 连续 6 次失败 → pm2 restart nextjs（应用自身挂了）
#   level 4: 连续 12 次失败 → pm2 restart rag-service + nextjs（后端也挂了）
#
# 退出码无意义（systemd timer 调起时不管退出码）；动作通过日志体现。
# 不会破坏健康状态：reload/restart 都是幂等无副作用。
#
# 安装（root）：
#   install -m755 scripts/attrax-healthcheck.sh /usr/local/bin/attrax-healthcheck.sh
#   install -m644 scripts/attrax-healthcheck.service /etc/systemd/system/
#   install -m644 scripts/attrax-healthcheck.timer   /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now attrax-healthcheck.timer
set -uo pipefail

HEALTH_URL="${ATTRAX_HEALTH_URL:-http://127.0.0.1/api/health}"
LOG_FILE="${ATTRAX_HEALTH_LOG:-/var/log/attrax-healthcheck.log}"
STATE_DIR="${ATTRAX_HEALTH_STATE:-/var/lib/attrax/healthcheck}"
FAIL_THRESHOLD_RELOAD=3
FAIL_THRESHOLD_RESTART_NEXTJS=6
FAIL_THRESHOLD_RESTART_ALL=12
CURL_TIMEOUT=5

mkdir -p "$(dirname "$LOG_FILE")" "$STATE_DIR"

log() {
  printf '%s %s\n' "$(date -Iseconds)" "$*" >> "$LOG_FILE"
}

reset_state() {
  : > "$STATE_DIR/consecutive_failures"
  rm -f "$STATE_DIR/last_action"
}

count=$(cat "$STATE_DIR/consecutive_failures" 2>/dev/null || echo 0)

code=$(curl -sk -m "$CURL_TIMEOUT" -o /dev/null -w "%{http_code}" "$HEALTH_URL" || echo 000)

if [ "$code" = "200" ]; then
  if [ "$count" -gt 0 ]; then
    log "RECOVERED after ${count} consecutive failures (now 200)"
    reset_state
  fi
  exit 0
fi

count=$((count + 1))
echo "$count" > "$STATE_DIR/consecutive_failures"
log "FAIL #$count: ${HEALTH_URL} -> ${code}"

take_action() {
  local label="$1"
  shift
  log "ACTION ($label): $*"
  "$@" >> "$LOG_FILE" 2>&1
  echo "$label" >> "$STATE_DIR/action_history"
  # only keep last 50 actions
  tail -n 50 "$STATE_DIR/action_history" > "$STATE_DIR/action_history.tmp" \
    && mv "$STATE_DIR/action_history.tmp" "$STATE_DIR/action_history"
  echo "$label@$(date -Iseconds)" > "$STATE_DIR/last_action"
}

if [ "$count" -ge "$FAIL_THRESHOLD_RESTART_ALL" ]; then
  take_action "level4-restart-all" pm2 restart rag-service nextjs
elif [ "$count" -ge "$FAIL_THRESHOLD_RESTART_NEXTJS" ]; then
  take_action "level3-restart-nextjs" pm2 restart nextjs
elif [ "$count" -ge "$FAIL_THRESHOLD_RELOAD" ]; then
  # level2: 先尝试用 .template 重新渲染 vhost，再 reload（防止 vhost 文件本身
  # 就漂移了——只 reload 不会改写磁盘上的端口字面量）
  RENDER_SCRIPT="/opt/attrax/scripts/render-nginx-vhost.sh"
  VHOST_PATH="/etc/nginx/sites-enabled/attrax"
  if [ -x "$RENDER_SCRIPT" ] && [ -w "$(dirname "$VHOST_PATH")" ]; then
    log "ACTION (level2-render): bash $RENDER_SCRIPT --out $VHOST_PATH"
    if bash "$RENDER_SCRIPT" --out "$VHOST_PATH" >> "$LOG_FILE" 2>&1; then
      log "  render ok, proceeding to nginx reload"
    else
      log "WARN: render failed, skipping reload"
      echo "$count" > "$STATE_DIR/consecutive_failures"
      exit 0
    fi
  fi
  if command -v nginx >/dev/null 2>&1 && nginx -t >> "$LOG_FILE" 2>&1; then
    take_action "level2-nginx-reload" nginx -s reload
  fi
fi

exit 0
