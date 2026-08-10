#!/bin/bash
# Attrax uptime probe — cron runs this every 5 min (see cron-attrax-uptime).
#
# Probes the frontend `/api/health`, which itself probes RAG `/ready`. A 200 means
# the whole chain is healthy: nginx up, nextjs up, RAG dependencies (bm25 / llm
# key / config / scan_service) satisfied. A non-200 means something is degraded —
# including RAG's ~30-60s restart window, which the alert state machine absorbs.
#
# This script only probes + logs + delegates. Notification (webhook + FAIL/RESOLVED
# dedup) is owned by uptime-alert.sh, which it calls with the HTTP code and body.
set -u

HEALTH_URL="https://127.0.0.1:443/api/health"
LOG="/opt/attrax/logs/attrax-uptime.log"
ALERT="/opt/attrax/scripts/uptime-alert.sh"
TS=$(date -Iseconds)

# -s silent, -k ignore self-signed localhost TLS, print http code on the last line.
RESPONSE=$(curl -sk -w $'\n%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null)
HTTP_CODE=$(printf '%s' "$RESPONSE" | tail -n1)
BODY=$(printf '%s' "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  : # healthy — stay quiet; alert.sh emits RESOLVED if recovering from an outage.
else
  echo "$TS FAIL http=$HTTP_CODE url=$HEALTH_URL body=$BODY" >> "$LOG"
fi

# Always invoke alert.sh — it owns the FAIL/RESOLVED state machine.
if [ -x "$ALERT" ]; then
  "$ALERT" "$HTTP_CODE" "$BODY" >> "$LOG" 2>&1
fi
