#!/bin/bash
set -euo pipefail
umask 077

# Attrax daily data backup
# Backs up FAISS index + .env files + corpus manifest to a timestamped tarball
# Keep last 14 backups (rotate)
BACKUP_DIR=/opt/attrax/backups
LOGFILE=/opt/attrax/logs/attrax-backup.log
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUP_DIR/attrax-data-$STAMP.tar.gz"
mkdir -p "$BACKUP_DIR"

# Files to back up
SOURCES=(
  /opt/attrax/data/faiss/legal_chunks.index
  /opt/attrax/data/faiss/legal_chunks_meta.json
  /opt/attrax/data/faiss/index_manifest.json
  /opt/attrax/.env
  /opt/attrax/rag_service/.env
  /opt/attrax/data/corpus/corpus_index.json
)

# Check all sources exist
for src in "${SOURCES[@]}"; do
  if [ ! -e "$src" ]; then
    echo "[$STAMP] MISSING: $src" >> "$LOGFILE"
    exit 1
  fi
done

# Create tarball
tar czf "$ARCHIVE" \
  --owner=0 --group=0 \
  -C /opt/attrax/data/faiss legal_chunks.index legal_chunks_meta.json index_manifest.json \
  -C /opt/attrax .env \
  -C /opt/attrax/rag_service .env \
  -C /opt/attrax/data/corpus corpus_index.json

# Set restrictive perms (contains keys)
chmod 600 "$ARCHIVE"
chown admin:admin "$ARCHIVE" 2>/dev/null || true

SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo "[$STAMP] backup ok: $ARCHIVE ($SIZE)" >> "$LOGFILE"

# Rotate: keep last 14
cd "$BACKUP_DIR"
ls -1t attrax-data-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

echo "backup complete: $ARCHIVE"
