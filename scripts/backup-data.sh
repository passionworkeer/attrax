#!/bin/bash
set -euo pipefail
umask 077

# Attrax daily production data backup (De-RAG architecture)
# Backs up active .env files, regulation registries, supplements, state
# databases, and the live runtime state under data/backend/{sessions,jobs,
# uploads} (mid-pipeline scans).
# Keep last 14 backups (rotate).
#
# M12 hardening: data/backend/* is read live by RAG workers (FileBackend).
# Tarring live files can produce a torn write — half an evidence manifest
# or a partially-flushed session JSON. We snapshot via `cp -al` (hardlink
# the file tree) into /opt/attrax/backups/.snap-$STAMP/, then tar the
# snapshot. cp -al is O(1) per file and avoids the I/O + space cost of a
# full copy; the underlying inodes stay shared with the live tree, so new
# writes to the live dir don't disturb the snapshot until tar has streamed
# it. *.tmp / *.lock are excluded — they are work-in-progress and would
# not parse on restore anyway.

BACKUP_DIR=/opt/attrax/backups
LOGFILE=/opt/attrax/logs/attrax-backup.log
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUP_DIR/attrax-data-$STAMP.tar.gz"
SNAPSHOT="$BACKUP_DIR/.snap-$STAMP"
mkdir -p "$BACKUP_DIR"
mkdir -p /opt/attrax/logs

cleanup() {
  # Snapshot is large and only useful while tar is running. Always remove.
  rm -rf "$SNAPSHOT" 2>/dev/null || true
}
trap cleanup EXIT

log() {
  echo "[$STAMP] $*" | tee -a "$LOGFILE"
}

log "Starting backup..."

# 先把扫描审计日志留存进统计库再备份：审计日志轮转后看板的扫描历史仍完整，
# 备份捕获的也是已留存的数据。留存失败不阻断备份本身（备份是兜底），
# 但必须落日志可见——不允许静默跳过。
if python3 /opt/attrax/scripts/retain-admin-audit.py --root /opt/attrax >>"$LOGFILE" 2>&1; then
  log "admin audit retention ok"
else
  log "WARN: admin audit retention failed (see details above); backup continues"
fi

# SQLite 使用在线备份 API，保持 WAL 中的访客计数与会话一致。
if [ -f /opt/attrax/data/admin/analytics.sqlite ] || [ -f /opt/attrax/.admin-auth.json ]; then
  node /opt/attrax/scripts/backup-admin.mjs /opt/attrax "$SNAPSHOT/admin"
fi

ITEMS=()
if [ -d "$SNAPSHOT/admin" ]; then
  ITEMS+=("$SNAPSHOT/admin")
fi
# Environment files (contain credentials)
for envfile in /opt/attrax/.env /opt/attrax/.env.local /opt/attrax/rag_service/.env; do
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

# Snapshot the live runtime state dirs via hardlinks (M12).
# This includes M13 additions: sessions, jobs, uploads.
SNAPSHOT_ITEMS=()
for dir in /opt/attrax/data/backend/sessions /opt/attrax/data/backend/jobs /opt/attrax/data/backend/uploads; do
  if [ -d "$dir" ]; then
    SNAPSHOT_ITEMS+=("$dir")
  fi
done

if [ ${#SNAPSHOT_ITEMS[@]} -gt 0 ]; then
  mkdir -p "$SNAPSHOT"
  for src in "${SNAPSHOT_ITEMS[@]}"; do
    name=$(basename "$src")
    cp -al "$src" "$SNAPSHOT/$name"
  done
  log "snapshot ok: $SNAPSHOT (hardlinked from ${#SNAPSHOT_ITEMS[@]} dirs)"
  # Replace the live paths in ITEMS with their snapshot equivalents so tar
  # reads the frozen tree, not the live one.
  for i in "${!ITEMS[@]}"; do
    case "${ITEMS[$i]}" in
      /opt/attrax/data/backend/sessions|/opt/attrax/data/backend/jobs|/opt/attrax/data/backend/uploads)
        ITEMS[$i]="$SNAPSHOT/$(basename "${ITEMS[$i]}")"
        ;;
    esac
  done
fi

tar czf "$ARCHIVE" \
  --exclude='*.tmp' \
  --exclude='*.lock' \
  "${ITEMS[@]}" 2>> "$LOGFILE" || {
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
