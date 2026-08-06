#!/bin/bash
# Attrax uptime alert — state-machine webhook notifier.
#
# Called by uptime-check.sh every 5 min with the probe's HTTP code ($1) and body
# ($2). Owns FAIL/RESOLVED dedup via a state file so a RAG restart's ~30-60s blip
# doesn't spam the channel:
#   - First FAIL after an OK period  → write state file + fire FAIL webhook.
#   - Sustained FAIL                 → silent (state file already exists).
#   - First OK after a FAIL period   → clear state file + fire RESOLVED webhook.
#
# Configure UPTIME_WEBHOOK_URL in /opt/attrax/.env (DingTalk / WeChat Work / Slack
# incoming webhook / etc.). Without it, this script is a graceful no-op: it logs
# transitions only and never notifies, so monitoring keeps running silently until
# a webhook is configured.
set -u

HTTP_CODE="${1:-}"
BODY="${2:-}"
TS=$(date -Iseconds)
HOSTNAME=$(hostname)
LOG="/opt/attrax/logs/attrax-uptime-alert.log"
STATE="/opt/attrax/logs/uptime-down.since"

WEBHOOK_URL=$(grep "^UPTIME_WEBHOOK_URL=" /opt/attrax/.env 2>/dev/null | cut -d= -f2-)
WEBHOOK_URL=${WEBHOOK_URL:-${ATTRAX_UPTIME_WEBHOOK_URL:-}}

send_webhook() {
  # $1 = FAIL | RESOLVED
  local status="$1"
  if [ -z "$WEBHOOK_URL" ]; then
    echo "$TS no webhook configured (transition=$status)" >> "$LOG"
    return 0
  fi
  local health_json
  health_json=$(printf '%s' "$BODY" \
    | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()[:500]))' 2>/dev/null \
    || printf '"%s"' "$BODY")
  local msg
  msg=$(printf '{"hostname":"%s","timestamp":"%s","status":"%s","http_code":"%s","health":%s}' \
    "$HOSTNAME" "$TS" "$status" "$HTTP_CODE" "$health_json")
  local rc
  rc=$(curl -sk -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
    -d "$msg" --max-time 5 "$WEBHOOK_URL" 2>/dev/null)
  echo "$TS webhook transition=$status http=$rc" >> "$LOG"
}

if [ "$HTTP_CODE" = "200" ]; then
  if [ -f "$STATE" ]; then
    since=$(cat "$STATE" 2>/dev/null)
    rm -f "$STATE"
    echo "$TS RESOLVED (was down since ${since:-unknown})" >> "$LOG"
    send_webhook "RESOLVED"
  fi
  exit 0
fi

# FAIL
if [ ! -f "$STATE" ]; then
  printf '%s' "$TS" > "$STATE"
  echo "$TS FAIL first-seen http=$HTTP_CODE body=$BODY" >> "$LOG"
  send_webhook "FAIL"
else
  : # already notified for this outage — stay quiet to avoid channel spam
fi
