#!/bin/bash
# Attrax remote backup - rsync local backups to remote.
#
# ----------------------------------------------------------------------------
# M14 configuration: BACKUP_REMOTE_DEST must be set for this script to do
# anything. It is read from /opt/attrax/.env (the same file BFF/RAG use) or
# from the environment variable ATTRAX_BACKUP_REMOTE_DEST. Without it, the
# script logs "no REMOTE_DEST configured (skipping)" and exits 0 — cron
# reports success, but no remote copy is made. This is the design choice,
# because not every deployment has an off-site target configured.
#
# To enable remote backups, add ONE of these lines to /opt/attrax/.env
# (whitespace around `=` is allowed, values may need quoting):
#
#   # rsync over SSH (recommended; SSH key must be in /root/.ssh/authorized_keys
#   # on the backup host, and the remote user must be able to write the dest)
#   BACKUP_REMOTE_DEST=backupuser@backup.example.com:/srv/attrax-backups/
#
#   # rsync to a local-mounted share (NFS, CIFS via mount, USB drive)
#   BACKUP_REMOTE_DEST=/mnt/backup-share/attrax/
#
#   # S3 via s3cmd (the rsync below will NOT speak S3; if you go this route,
#   # replace the rsync line in this script with `s3cmd put $LATEST s3://...`)
#   # BACKUP_REMOTE_DEST=s3://my-bucket/attrax-backups/
#
# After editing /opt/attrax/.env, no restart is needed (this script is run
# by cron, not pm2); the next cron tick picks it up.
#
# Cron installation (one-time, as root):
#   sudo cp docs/infra/cron-attrax-backup-remote /etc/cron.d/attrax-backup-remote
#   sudo chmod 644 /etc/cron.d/attrax-backup-remote
#
# aliyun-sz currently does NOT have BACKUP_REMOTE_DEST set (single-disk
# risk, documented in CHANGELOG 2026-09-18 batch). Until you set it, this
# cron job is a deliberate no-op.
# ----------------------------------------------------------------------------
set -u
LOCAL_DIR=/opt/attrax/backups
LOG=/opt/attrax/logs/attrax-backup-remote.log
TS=$(date -Iseconds)
# Same precondition backup-data.sh establishes: without this, a missing log
# directory makes the very first `>> "$LOG"` fail before anything is recorded —
# and since it is the failure path, the evidence would be lost exactly when it
# is most needed.
mkdir -p "$(dirname "$LOG")"
LATEST=$(ls -1t $LOCAL_DIR/attrax-data-*.tar.gz 2>/dev/null | head -1)
REMOTE_DEST=$(grep "^BACKUP_REMOTE_DEST=" /opt/attrax/.env 2>/dev/null | cut -d= -f2-)
REMOTE_DEST=${REMOTE_DEST:-${ATTRAX_BACKUP_REMOTE_DEST:-}}

if [ -z "$LATEST" ]; then
  echo "$TS no local backup" >> "$LOG"
  exit 1
fi
if [ -z "$REMOTE_DEST" ]; then
  echo "$TS no REMOTE_DEST configured (skipping) — set BACKUP_REMOTE_DEST in /opt/attrax/.env" >> "$LOG"
  exit 0
fi

if rsync -avz --partial --timeout=60 "$LATEST" "$REMOTE_DEST/" 2>> "$LOG"; then
  echo "$TS ok: $LATEST -> $REMOTE_DEST" >> "$LOG"
else
  echo "$TS FAIL: $LATEST -> $REMOTE_DEST" >> "$LOG"
  exit 1
fi
