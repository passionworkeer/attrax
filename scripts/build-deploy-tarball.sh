#!/usr/bin/env bash
# build-deploy-tarball.sh — 本地 build 后打成服务器部署用的 tarball。
#
# 为什么需要这个脚本(2026-07-19 事故根因):
#   Next.js standalone 构建产出两个独立的东西:
#     .next/standalone/   — server bundle(server.js + .next/server + node_modules)
#     .next/static/       — 客户端 chunks(CSS/JS/字体),Next 不会自动放进 standalone
#     public/             — 静态资源(favicon/fonts/svg),同样不会自动放进去
#   官方部署文档要求手动把 static + public 拷进 standalone,否则浏览器加载
#   /_next/static/chunks/*.css 全部 404、页面裸奔无样式。
#   本脚本把"build → stage → 打包 → 校验"做成原子流程,保证 tarball 永远完整。
#
# 产物:/tmp/attrax-deploy-complete.tar.gz(供 lighthouse 上的 /tmp/attrax-apply-deploy.sh 消费)
# 本机可用 ATTRAX_TARBALL=/path/to.tar.gz 覆盖产物路径(中间产物不落 /tmp)。
#
# 用法:
#   bash scripts/build-deploy-tarball.sh           # build + stage + 打包
#   bash scripts/build-deploy-tarball.sh --no-build # 跳过 build,只 stage + 打包(已 build 过)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

STANDALONE="${PROJECT_ROOT}/.next/standalone"
STATIC_SRC="${PROJECT_ROOT}/.next/static"
PUBLIC_SRC="${PROJECT_ROOT}/public"
TARBALL="${ATTRAX_TARBALL:-/tmp/attrax-deploy-complete.tar.gz}"

log() { echo "[$(date -Iseconds)] $*"; }

# === [1] 可选:next build ===
if [ "${1:-}" != "--no-build" ]; then
  if [ ! -f "${PROJECT_ROOT}/.env.local" ]; then
    log "WARNING: .env.local 不存在,build 可能缺环境变量"
  fi
  log "=== [1] npm run build(本地,避免服务器 OOM)==="
  npm run build
else
  log "=== [1] 跳过 build(--no-build)==="
fi

# === [2] 校验 build 产物存在 ===
if [ ! -f "${STANDALONE}/server.js" ]; then
  log "ERROR: ${STANDALONE}/server.js 不存在 —— build 未完成或失败"
  exit 1
fi
if [ ! -d "${STATIC_SRC}" ]; then
  log "ERROR: ${STATIC_SRC} 不存在 —— build 未完成"
  exit 1
fi
if [ ! -d "${PUBLIC_SRC}" ]; then
  log "ERROR: ${PUBLIC_SRC} 不存在"
  exit 1
fi
log "BUILD_ID: $(cat "${STANDALONE}/.next/BUILD_ID")"

# === [3] stage:把 static + public 拷进 standalone(关键步骤!) ===
log "=== [3] stage static + public 进 standalone ==="
rm -rf "${STANDALONE}/.next/static" "${STANDALONE}/public"
cp -r "${STATIC_SRC}" "${STANDALONE}/.next/static"
cp -r "${PUBLIC_SRC}" "${STANDALONE}/public"

# === [4] stage 后强校验(绝不打一个裸奔的包)===
CSS_COUNT=$(find "${STANDALONE}/.next/static/chunks" -name '*.css' 2>/dev/null | wc -l)
MEDIA_COUNT=$(find "${STANDALONE}/.next/static/media" -type f 2>/dev/null | wc -l)
if [ "$CSS_COUNT" -lt 2 ] || [ "$MEDIA_COUNT" -lt 5 ]; then
  log "ERROR: stage 后 static 不完整 (css=$CSS_COUNT media=$MEDIA_COUNT),中止打包"
  exit 2
fi
log "stage 校验通过: css=$CSS_COUNT media=$MEDIA_COUNT public=$(ls "${STANDALONE}/public" | wc -l) 项"

# === [3.5] 写 .deployed 部署标识(随包走 → /opt/attrax/.next/standalone/.deployed) ===
# 治本:以后线上 `cat .deployed` 就能对账到 commit/build_id,
# 不再需要每次手动维护 docs/SERVER-VERSION.md 的版本块。
COMMIT_FULL="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
COMMIT_SHORT="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
UPSTREAM="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo unknown)"
BID="$(cat "${STANDALONE}/.next/BUILD_ID")"
cat > "${STANDALONE}/.deployed" <<EOF
# Attrax 部署标识 — 由 build-deploy-tarball.sh 写入,/tmp/attrax-apply-deploy.sh 解包后落地
# 对账: ssh attrax 'cat /opt/attrax/.next/standalone/.deployed'
commit=${COMMIT_SHORT}
commit_full=${COMMIT_FULL}
build_id=${BID}
branch=${BRANCH}
ref=${UPSTREAM}
built_at=$(date -Iseconds)
EOF
log ".deployed: commit=${COMMIT_SHORT} build_id=${BID} ref=${UPSTREAM}"

# ATTRAX_BUILD_SHA 落地文件 — 短 commit 写到 standalone/.build-sha，让
# apply-deploy.sh 拷到 /opt/attrax/.build-sha，ecosystem.config.cjs 启动时
# 读出来注入 rag-service env。这样 /ready 与 audit 日志报 SHA 与 .deployed
# 始终一致。
echo "${COMMIT_SHORT}" > "${STANDALONE}/.build-sha"
log ".build-sha: ${COMMIT_SHORT}"

# === [4.5] 防污染清理: 严防测试包、大 zip 与运行时垃圾打入生产部署包 ===
rm -rf "${STANDALONE}/规航AI-"* "${STANDALONE}/test-results" "${STANDALONE}/tests/fixtures/regression-package-"* "${STANDALONE}/tests/fixtures/"*.zip

# === [5] 打包(把整个 standalone 连同已 stage 的 static/public 一起)===
log "=== [5] 打包 -> ${TARBALL} ==="
# 在 .next/ 下打包,使 tar 内路径以 standalone/ 开头(/tmp/attrax-apply-deploy.sh 解包到 .next/)
tar -C "${PROJECT_ROOT}/.next" -czf "${TARBALL}" standalone
log "tarball 大小: $(du -sh "${TARBALL}" | cut -f1)"

# === [6] 二次校验:确认 tarball 里真的有 static + public ===
log "=== [6] 校验 tarball 内容 ==="
TAR_CSS=$(tar -tzf "${TARBALL}" | grep -c 'standalone/.next/static/chunks/.*\.css$' || true)
TAR_PUBLIC=$(tar -tzf "${TARBALL}" | grep -c '^standalone/public/' || true)
if [ "$TAR_CSS" -lt 2 ] || [ "$TAR_PUBLIC" -lt 3 ]; then
  log "ERROR: tarball 内 static/public 缺失 (css=$TAR_CSS public条目=$TAR_PUBLIC),中止"
  exit 4
fi
log "tarball 校验通过: 含 css=$TAR_CSS 个, public条目=$TAR_PUBLIC 个"

log "=== 完成 ==="
log "下一步: scp ${TARBALL} lighthouse:/tmp/ 然后 ssh lighthouse 'bash /tmp/attrax-apply-deploy.sh'"
log "BUILD_ID: $(cat "${STANDALONE}/.next/BUILD_ID")"
