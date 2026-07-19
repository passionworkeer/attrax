#!/usr/bin/env bash
# 在服务器上执行：部署 upload-fix standalone（前端修复）
# 前置：/tmp/attrax-deploy-complete.tar.gz 已上传到服务器
# 前置：rag-service 已停（释放内存，部署期间不重启它）
set -euo pipefail

ATTRAX=/opt/attrax
STD="$ATTRAX/.next/standalone"
TS=$(date +%Y%m%d-%H%M%S)
export PM2_HOME=/home/admin/.pm2
PM2="$ATTRAX/node_modules/.bin/pm2"
TARBALL=/tmp/attrax-deploy-complete.tar.gz

log() { echo "[$(date -Iseconds)] $*"; }

log "=== [1] 当前状态 ==="
$PM2 list || true
echo "当前 BUILD_ID: $(cat $STD/.next/BUILD_ID 2>/dev/null || echo '?')"
echo "目标 BUILD_ID: mDqQgaYI9r6HRqiCd-cXr"

log "=== [2] 备份当前 standalone -> standalone-pre-upload-fix-$TS ==="
cp -a "$STD" "$ATTRAX/.next/standalone-pre-upload-fix-$TS"
echo "备份大小: $(du -sh "$ATTRAX/.next/standalone-pre-upload-fix-$TS" | cut -f1)"

log "=== [3] 停 nextjs（rag-service 保持停止）==="
$PM2 stop nextjs 2>/dev/null || true

log "=== [4] 解包新 standalone（保留服务器 .env / public / data / logs）==="
# 清旧 static（旧 BUILD_ID chunks）和 server chunks（内容哈希命名，旧的无害但清掉更干净）
rm -rf "$STD/.next/static" "$STD/.next/server"
# 解包：只覆盖代码（.next/server + .next/static + server.js + package.json + node_modules）
# 排除 data/public/.env/logs —— 服务器这些是独立的真实目录/文件，必须保留
tar -xzf "$TARBALL" -C "$ATTRAX/.next/" \
  --exclude='standalone/.env' \
  --exclude='standalone/data' \
  --exclude='standalone/logs' \
  --exclude='standalone/public'
# 修复属主
chown -R admin:admin "$STD" 2>/dev/null || true
echo "新 BUILD_ID: $(cat $STD/.next/BUILD_ID)"
echo "static chunks 目录: $(ls $STD/.next/static/ | tr '\n' ' ')"

log "=== [5] 重启 nextjs（delete + start，确保读 ecosystem.config.cjs）==="
$PM2 delete nextjs 2>/dev/null || true
$PM2 start "$ATTRAX/scripts/ecosystem.config.cjs" --only nextjs
sleep 10

log "=== [6] 验证 ==="
$PM2 list
echo "--- /api/health ---"
curl -s --max-time 10 http://127.0.0.1:3000/api/health || echo "(health 还没就绪，等 nextjs 启动)"
echo
echo "--- BUILD_ID 对账 ---"
echo "standalone: $(cat $STD/.next/BUILD_ID)"
echo "期望:       mDqQgaYI9r6HRqiCd-cXr"

log "=== 完成。回滚命令：==="
echo "  cp -a $ATTRAX/.next/standalone-pre-upload-fix-$TS/* $STD/ && \$PM2 delete nextjs && \$PM2 start $ATTRAX/scripts/ecosystem.config.cjs --only nextjs"
