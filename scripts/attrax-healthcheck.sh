#!/usr/bin/env bash
# attrax-healthcheck.sh — 每 60 秒检查 /api/health 和三个 PM2 进程。
#
# 为什么需要：2026-09-18 事故中 nginx upstream 端口错配，全站 502 / 404，
# 没有自动恢复 — 靠人发现并 sed 修改。这次加一层主动巡检：
#
#   level 1: 1 次失败 → 仅记录到 /var/log/attrax-healthcheck.log
#   level 2: 连续 3 次失败 → nginx -s reload（reload 会重读 vhost，修临时漂移）
#   level 3: 连续 6 次失败 → 恢复异常 PM2 进程或重启 nextjs
#   level 4: 连续 12 次失败 → 恢复全部三个进程
#
# 本轮异常返回非零，供 systemd 和独立监控发现自愈未完成。
# 重启期间存在短暂服务中断，连续失败达到阈值后才执行。
#
# 安装（root）：
#   install -m755 scripts/attrax-healthcheck.sh /usr/local/bin/attrax-healthcheck.sh
#   install -m644 scripts/attrax-healthcheck.service /etc/systemd/system/
#   install -m644 scripts/attrax-healthcheck.timer   /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now attrax-healthcheck.timer
set -uo pipefail

pm2() { /usr/local/sbin/attrax-pm2 "$@"; }

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
process_ok=0
if /usr/local/sbin/attrax-process-status >/dev/null; then
  process_ok=1
fi

if [ "$code" = "200" ] && [ "$process_ok" -eq 1 ]; then
  if [ "$count" -gt 0 ]; then
    log "RECOVERED after ${count} consecutive failures (now 200)"
    reset_state
  fi
  exit 0
fi

count=$((count + 1))
echo "$count" > "$STATE_DIR/consecutive_failures"
log "FAIL #$count: ${HEALTH_URL} -> ${code}; PM2 healthy=${process_ok}"

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
  take_action "level4-restore-all" systemctl reload-or-restart pm2-attrax.service
elif [ "$count" -ge "$FAIL_THRESHOLD_RESTART_NEXTJS" ]; then
  if [ "$process_ok" -eq 0 ]; then
    take_action "level3-restore-processes" systemctl reload-or-restart pm2-attrax.service
  else
    take_action "level3-restart-nextjs" pm2 restart nextjs
  fi
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
      exit 1
    fi
  fi
  if command -v nginx >/dev/null 2>&1 && nginx -t >> "$LOG_FILE" 2>&1; then
    take_action "level2-nginx-reload" nginx -s reload
  fi
fi

exit 1
