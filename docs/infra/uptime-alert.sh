#!/bin/bash
# Attrax uptime alert - call webhook when /api/health fails.
# Configure UPTIME_WEBHOOK_URL in /opt/attrax/.env (DingTalk/WeChat/Slack/PagerDuty)
set -u
HEALTH=$(curl -sk --max-time 10 https://127.0.0.1:443/api/health 2>/dev/null)
TS=$(date -Iseconds)
HOSTNAME=$(hostname)
LOG=/opt/attrax/logs/attrax-uptime-alert.log

WEBHOOK_URL=$(grep "^UPTIME_WEBHOOK_URL=" /opt/attrax/.env 2>/dev/null | cut -d= -f2-)
WEBHOOK_URL=${WEBHOOK_URL:-${ATTRAX_UPTIME_WEBHOOK_URL:-}}

if echo "$HEALTH" | grep -q '"ragService":{"status":"ok"'; then
  exit 0
fi

echo "$TS FAIL: $HEALTH" >> "$LOG"
if [ -z "$WEBHOOK_URL" ]; then
  echo "$TS no webhook configured" >> "$LOG"
  exit 0
fi

MSG="{\"hostname\":\"$HOSTNAME\",\"timestamp\":\"$TS\",\"status\":\"FAIL\",\"health\":$(echo "$HEALTH" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")}"
HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$MSG" --max-time 5 "$WEBHOOK_URL" 2>/dev/null)
echo "$TS webhook HTTP $HTTP_CODE" >> "$LOG"
