*************************************************************************
*  Attrax production server. Authorized access only.                    *
*  All activity is logged and monitored.                                *
*************************************************************************
#!/bin/bash
HEALTH=$(curl -sk https://127.0.0.1:443/api/health 2>/dev/null)
TS=$(date -Iseconds)
if echo "$HEALTH" | grep -q "\"ragService\":{\"status\":\"ok\""; then
  : # ok, no-op
else
  echo "$TS UPGRADE: $HEALTH" >> /opt/attrax/logs/attrax-uptime.log
fi
