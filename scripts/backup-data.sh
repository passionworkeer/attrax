#!/bin/bash
set -euo pipefail
umask 077

# Attrax daily production data backup (De-RAG architecture)
# Backs up active .env files, regulation registries, supplements and state databases
# Keep last 14 backups (rotate)

BACKUP_DIR=/opt/attrax/backups
LOGFILE=/opt/attrax/logs/attrax-backup.log
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUP_DIR/attrax-data-$STAMP.tar.gz"
mkdir -p "$BACKUP_DIR"
mkdir -p /opt/attrax/logs

log() {
  echo "[$STAMP] $*" | tee -a "$LOGFILE"
}

log "Starting backup..."

ITEMS=()
# Environment files (contain credentials)
for envfile in /opt/attrax/.env /opt/attrax/.env.local /opt/attrax/.env.production /opt/attrax/rag_service/.env; do
  if [ -f "$envfile" ]; then
    ITEMS+=("$envfile")
  fi
done

# Knowledge base & regulation registries
for dir in /opt/attrax/data/kb /opt/attrax/data/regulation_sources /opt/attrax/data/regulation_supplements; do
  if [ -d "$dir" ]; then
    ITEMS+=("$dir")
  fi
done

# State databases if present
for db in /opt/attrax/data/*.db /opt/attrax/data/*/*.db; do
  if [ -f "$db" ]; then
    ITEMS+=("$db")
  fi
done

if [ ${#ITEMS[@]} -eq 0 ]; then
  log "ERROR: No backup items found!"
  exit 1
fi

tar czf "$ARCHIVE" "${ITEMS[@]}" 2>> "$LOGFILE" || {
  log "ERROR: tar failed"
  exit 2
}

chmod 600 "$ARCHIVE"
SIZE=$(du -h "$ARCHIVE" | cut -f1)
log "backup ok: $ARCHIVE ($SIZE)"

# Rotate: keep last 14
cd "$BACKUP_DIR"
ls -1t attrax-data-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f || true

log "backup complete: $ARCHIVE"
