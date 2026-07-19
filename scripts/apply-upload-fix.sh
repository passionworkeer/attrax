#!/usr/bin/env bash
# 在服务器上执行：部署 upload-fix standalone（前端修复）
# 前置：/tmp/attrax-deploy-complete.tar.gz 已上传到服务器
#   ↑ 这个 tarball 必须用 scripts/build-deploy-tarball.sh 打包,
#     它会自动 stage .next/static + public 进 standalone。
#     不要手打 tar,否则漏 static 会导致整站 CSS 404 裸奔(2026-07-19 事故)。
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

log "=== [2] 备份当前 standalone -> standalone-pre-upload-fix-$TS ==="
cp -a "$STD" "$ATTRAX/.next/standalone-pre-upload-fix-$TS"
echo "备份大小: $(du -sh "$ATTRAX/.next/standalone-pre-upload-fix-$TS" | cut -f1)"

log "=== [3] 停 nextjs（rag-service 保持停止）==="
$PM2 stop nextjs 2>/dev/null || true

log "=== [4] 解包新 standalone（保留服务器 .env / data / logs）==="
# 清旧 static（旧 BUILD_ID chunks）和 server chunks（内容哈希命名，旧的无害但清掉更干净）
rm -rf "$STD/.next/static" "$STD/.next/server"
# 解包：覆盖代码 + 静态资源（.next/server + .next/static + public + server.js + node_modules）
# 只排除运行时状态：.env / data / logs。public 是构建产物（fonts/svg），必须随包发布，
# 不能 exclude——否则一旦服务器 public 缺失就永远补不回来。
tar -xzf "$TARBALL" -C "$ATTRAX/.next/" \
  --exclude='standalone/.env' \
  --exclude='standalone/data' \
  --exclude='standalone/logs'
# 修复属主
chown -R admin:admin "$STD" 2>/dev/null || true
echo "新 BUILD_ID: $(cat $STD/.next/BUILD_ID)"

# === [4.5] 关键安全网：断言 static + public 真的解出来了 ===
# 历史事故 (2026-07-19): tarball 打包时漏了 staging 步骤,standalone/.next/static 为空,
# 解包后整站 CSS/字体 404、页面裸奔。这里在重启前强校验,不通过就回滚,绝不带病上线。
CSS_COUNT=$(find "$STD/.next/static/chunks" -name '*.css' 2>/dev/null | wc -l)
MEDIA_COUNT=$(find "$STD/.next/static/media" -type f 2>/dev/null | wc -l)
if [ "$CSS_COUNT" -lt 2 ] || [ "$MEDIA_COUNT" -lt 5 ] || [ ! -d "$STD/public" ]; then
  log "!!! 解包后 static/public 不完整 (css=$CSS_COUNT media=$MEDIA_COUNT public=$([ -d "$STD/public" ] && echo yes || echo NO))"
  log "!!! tarball 打包时漏了 staging(没把 .next/static + public 拷进 standalone)"
  log "!!! 回滚到备份,避免上线裸奔站点"
  rm -rf "$STD"
  cp -a "$ATTRAX/.next/standalone-pre-upload-fix-$TS" "$STD"
  log "!!! 已回滚。请用 scripts/build-deploy-tarball.sh 重新打包(它会自动 stage static+public)"
  exit 3
fi
log "static 校验通过: css=$CSS_COUNT media=$MEDIA_COUNT public=yes"

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
echo "(目标 BUILD_ID 取决于本地 build,见 tarball 打包日志)"

log "=== 完成。回滚命令：==="
echo "  cp -a $ATTRAX/.next/standalone-pre-upload-fix-$TS/* $STD/ && \$PM2 delete nextjs && \$PM2 start $ATTRAX/scripts/ecosystem.config.cjs --only nextjs"
