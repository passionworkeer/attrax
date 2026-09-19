#!/bin/bash
# 实测 apply-deploy.sh 的失败自动回滚（2026-09-19 新增）。
#
# 场景：用真实脚本 + 假 ATTRAX_DIR/REPO_DIR/HEALTH_URL 跑一次"部署"，让
# [9] health gate 必然失败（指向一个没人监听的端口），验证：
#   1) trap 真的触发 --rollback
#   2) 线上树被还原成部署前那棵（内容可辨认）
#   3) 退出码非 0（运维能从 cron/CI 看到失败）
# pm2 用桩替代（本地没装），nginx 段因 /etc/nginx 不可写自动跳过。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../.." && pwd)"
SANDBOX="${HERE}/sandbox"
FAKE_BIN="${HERE}/fakebin"

rm -rf "${SANDBOX}" "${FAKE_BIN}"
mkdir -p "${SANDBOX}/attrax/.next/standalone/.next/static" "${SANDBOX}/repo/scripts" "${SANDBOX}/repo/docs/infra" "${FAKE_BIN}"

# ── 部署前的"旧树"：用一个可辨认的字符串标记 ──
echo "OLD-TREE-MARKER" > "${SANDBOX}/attrax/.next/standalone/server.js"
echo "OLD-BUILD-ID"    > "${SANDBOX}/attrax/.next/standalone/.next/BUILD_ID"
echo "old-static"      > "${SANDBOX}/attrax/.next/standalone/.next/static/chunk.js"
ln -s "${SANDBOX}/attrax/.next/standalone/.next/static" "${SANDBOX}/attrax/.next/static"

# ── 假 REPO_DIR：render/ops 安装目标（不碰真实仓库） ──
for f in ports.env ports.env.cjs render-nginx-vhost.sh ecosystem.config.cjs \
         attrax-healthcheck.sh attrax-healthcheck.service attrax-healthcheck.timer \
         backup-data.sh backup-remote.sh; do
  cp "${REPO}/scripts/${f}" "${SANDBOX}/repo/scripts/${f}"
done
cp "${REPO}/docs/infra/nginx-attrax-vhost-prod.conf.template" "${SANDBOX}/repo/docs/infra/"

# ── 假 pm2：记录被调用并成功退出 ──
cat > "${FAKE_BIN}/pm2" <<'PM2'
#!/bin/bash
echo "[fake-pm2] $*"
exit 0
PM2
chmod +x "${FAKE_BIN}/pm2"

# ── 构造 tarball：含 standalone/server.js + ops/(10 个文件) ──
STAGE="${SANDBOX}/stage"
mkdir -p "${STAGE}/standalone/ops" "${STAGE}/standalone/.next"
echo "NEW-TREE-MARKER" > "${STAGE}/standalone/server.js"
echo "NEW-BUILD-ID"    > "${STAGE}/standalone/.next/BUILD_ID"
echo "commit=deadbeef" > "${STAGE}/standalone/.build-sha"
for f in ports.env ports.env.cjs render-nginx-vhost.sh ecosystem.config.cjs \
         attrax-healthcheck.sh attrax-healthcheck.service attrax-healthcheck.timer \
         backup-data.sh backup-remote.sh; do
  cp "${REPO}/scripts/${f}" "${STAGE}/standalone/ops/${f}"
done
cp "${REPO}/docs/infra/nginx-attrax-vhost-prod.conf.template" "${STAGE}/standalone/ops/"
TARBALL="${SANDBOX}/attrax-deploy-complete.tar.gz"
tar -C "${STAGE}" -czf "${TARBALL}" standalone

echo "===================== 开始实测 ====================="
echo "tarball ops 数: $(tar -tzf "${TARBALL}" | grep -c '^standalone/ops/')"
echo "部署前旧树标记: $(cat "${SANDBOX}/attrax/.next/standalone/server.js")"

# 部署前健康检查必须拿到 200（否则按设计不回滚）。这个一次性服务只应答
# 第一个请求就退出 —— 到 [9] health gate 时它已经不在，失败不可避免。
python3.11 "${HERE}/one_shot_health.py" 59999 &
HEALTH_PID=$!
sleep 1
echo

PATH="${FAKE_BIN}:${PATH}" \
ATTRAX_DIR="${SANDBOX}/attrax" \
ATTRAX_REPO_DIR="${SANDBOX}/repo" \
ATTRAX_TARBALL="${TARBALL}" \
HEALTH_URL="http://127.0.0.1:59999/api/health" \
  bash "${REPO}/scripts/apply-deploy.sh"
rc=$?
wait "${HEALTH_PID}" 2>/dev/null

echo
echo "===================== 结果 ====================="
echo "退出码: ${rc}（期望非 0）"
if [ -f "${SANDBOX}/attrax/.next/standalone/server.js" ]; then
  echo "当前线上树标记: $(cat "${SANDBOX}/attrax/.next/standalone/server.js")"
else
  echo "当前线上树: 不存在（回滚失败）"
fi
echo "备份目录: $(ls -d "${SANDBOX}/attrax/.next/standalone-pre-deploy-"* 2>/dev/null | head -3)"
echo "rollback 暂存目录: $(ls -d "${SANDBOX}/attrax/.next/standalone-rollback-"* 2>/dev/null | head -3)"

[ "${rc}" -ne 0 ] && grep -q "OLD-TREE-MARKER" "${SANDBOX}/attrax/.next/standalone/server.js" 2>/dev/null \
  && echo "PASS: 失败后自动回滚到旧树" \
  || echo "FAIL: 未回滚到旧树"
