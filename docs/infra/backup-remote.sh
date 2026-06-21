#!/bin/bash
# Attrax remote backup - rsync local backups to remote
# Configure BACKUP_REMOTE_DEST in /opt/attrax/.env
# Examples:
#   BACKUP_REMOTE_DEST=user@backup-host:/srv/attrax-backups
#   BACKUP_REMOTE_DEST=s3://my-bucket/attrax-backups (requires s3cmd or aws cli)
set -u
LOCAL_DIR=/opt/attrax/backups
LOG=/opt/attrax/logs/attrax-backup-remote.log
TS=$(date -Iseconds)
LATEST=$(ls -1t $LOCAL_DIR/attrax-data-*.tar.gz 2>/dev/null | head -1)
REMOTE_DEST=$(grep "^BACKUP_REMOTE_DEST=" /opt/attrax/.env 2>/dev/null | cut -d= -f2-)
REMOTE_DEST=${REMOTE_DEST:-${ATTRAX_BACKUP_REMOTE_DEST:-}}

if [ -z "$LATEST" ]; then
  echo "$TS no local backup" >> "$LOG"
  exit 1
fi
if [ -z "$REMOTE_DEST" ]; then
  echo "$TS no REMOTE_DEST configured (skipping)" >> "$LOG"
  exit 0
fi

if rsync -avz --partial --timeout=60 "$LATEST" "$REMOTE_DEST/" 2>> "$LOG"; then
  echo "$TS ok: $LATEST -> $REMOTE_DEST" >> "$LOG"
else
  echo "$TS FAIL: $LATEST -> $REMOTE_DEST" >> "$LOG"
  exit 1
fi
