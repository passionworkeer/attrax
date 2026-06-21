*************************************************************************
*  Attrax production server. Authorized access only.                    *
*  All activity is logged and monitored.                                *
*************************************************************************
#!/bin/bash
set -euo pipefail
BACKUP_DIR=/opt/attrax/backups
LOGFILE=/opt/attrax/logs/attrax-backup.log
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUP_DIR/attrax-data-$STAMP.tar.gz"
mkdir -p "$BACKUP_DIR"

tar czf "$ARCHIVE" \
  --owner=0 --group=0 \
  -C /opt/attrax/data/faiss legal_chunks.index legal_chunks_meta.json index_manifest.json \
  -C /opt/attrax .env \
  -C /opt/attrax/rag_service .env \
  -C /opt/attrax/data/corpus corpus_index.json

chmod 600 "$ARCHIVE"
chown admin:admin "$ARCHIVE" 2>/dev/null || true
SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo "[$STAMP] backup ok: $ARCHIVE ($SIZE)" >> "$LOGFILE"

cd "$BACKUP_DIR"
ls -1t attrax-data-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "ok: $ARCHIVE ($SIZE)"
