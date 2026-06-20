#!/usr/bin/env bash
# scripts/sync-data-to-server.sh
#
# 用途：把本地 data/faiss/ 和 data/corpus/processed/ rsync 到服务器对应目录。
# 前提：
#   1. 服务器已经 `git clone` 完代码到 $SERVER_PATH
#   2. 本地有 SSH 免密登录到 $SERVER
#
# 用法：
#   SERVER=user@your.server.ip SERVER_PATH=/opt/attrax bash scripts/sync-data-to-server.sh
# 或先 export 再跑：
#   export SERVER=user@1.2.3.4
#   export SERVER_PATH=/opt/attrax
#   bash scripts/sync-data-to-server.sh

set -euo pipefail

: "${SERVER:?Set SERVER=user@host (e.g. user@1.2.3.4)}"
: "${SERVER_PATH:?Set SERVER_PATH=/path/to/attrax (where you git cloned)}"

LOCAL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Local root : $LOCAL_ROOT"
echo "Server     : $SERVER"
echo "Server path: $SERVER_PATH"
echo
echo "Will sync:"
echo "  $LOCAL_ROOT/data/faiss/         -> $SERVER:$SERVER_PATH/data/faiss/"
echo "  $LOCAL_ROOT/data/corpus/processed/ -> $SERVER:$SERVER_PATH/data/corpus/processed/"
echo

read -rp "Proceed? [y/N] " ans
if [[ "$ans" != "y" && "$ans" != "Y" ]]; then
  echo "Aborted."
  exit 1
fi

# --exclude the placeholder Official marker files that aren't on server
rsync -avz --progress \
  -e ssh \
  --include='*/' \
  --include='*_Official_*.json' --exclude='data/corpus/processed/*' \
  --exclude='data/sessions/**' \
  --exclude='data/analysis/**' \
  "$LOCAL_ROOT/data/faiss/"         "$SERVER:$SERVER_PATH/data/faiss/"
rsync -avz --progress \
  -e ssh \
  "$LOCAL_ROOT/data/corpus/processed/" "$SERVER:$SERVER_PATH/data/corpus/processed/"

echo
echo "Done. On the server, verify with:"
echo "  ssh $SERVER 'ls -lh $SERVER_PATH/data/faiss/ && du -sh $SERVER_PATH/data/corpus/processed/'"
