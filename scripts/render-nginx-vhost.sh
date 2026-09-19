#!/usr/bin/env bash
# render-nginx-vhost.sh — 把 nginx-attrax-vhost-prod.conf.template 渲染成最终
# nginx vhost 配置文件，端口从 scripts/ports.env 注入。
#
# 为什么需要：
#   2026-09-18 事故：nginx vhost upstream 端口（3001）与 ecosystem.config.cjs 的
#   PORT（3000）漂移，全站 502。根因是同一份"端口真理"在 nginx 配置文件和
#   ecosystem.config.cjs 里各写一遍，没有单一来源。
#
#   治本：nginx vhost 由 .template 生成，端口占位符 __NEXTJS_PORT__ 由本脚本
#   从 scripts/ports.env 注入；ecosystem.config.cjs 通过 require('./ports.env.cjs')
#   读同一个源。两边再也不会漂移。
#
# 用法：
#   bash scripts/render-nginx-vhost.sh                 # 渲染到 stdout
#   bash scripts/render-nginx-vhost.sh --out /path     # 写入文件（deploy 用）
#   bash scripts/render-nginx-vhost.sh --check         # 只校验：上游端口必须等于 ports.env 的 NEXTJS_PORT
#
# 退出码：
#   0 = 渲染/校验通过
#   1 = 模板或源缺失
#   2 = 渲染后端口与 ports.env 不一致（校验模式专用）
#   3 = nginx -t 失败（仅 --out + 可用 nginx 时）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/../docs/infra/nginx-attrax-vhost-prod.conf.template"
PORTS_ENV="${SCRIPT_DIR}/ports.env"

if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: template not found: $TEMPLATE" >&2
  exit 1
fi
if [ ! -f "$PORTS_ENV" ]; then
  echo "ERROR: ports.env not found: $PORTS_ENV" >&2
  exit 1
fi

# 提取 NEXTJS_PORT（POSIX shell 友好解析）
# `|| true` 必须有：grep 未命中退出 1，set -e + pipefail 下命令替换失败会让脚本
# 在任何输出之前静默退出，下面的 ERROR 分支永远走不到。
NEXTJS_PORT="$(grep -E '^NEXTJS_PORT=' "$PORTS_ENV" | head -1 | cut -d= -f2- | tr -d '[:space:]' || true)"
if ! [[ "$NEXTJS_PORT" =~ ^[0-9]+$ ]] || [ "$NEXTJS_PORT" -lt 1 ] || [ "$NEXTJS_PORT" -gt 65535 ]; then
  echo "ERROR: NEXTJS_PORT in ports.env is missing or invalid: '$NEXTJS_PORT'" >&2
  exit 1
fi

# 渲染：把 __NEXTJS_PORT__ 全部替换为真实端口
RENDERED="$(sed "s/__NEXTJS_PORT__/${NEXTJS_PORT}/g" "$TEMPLATE")"

MODE="${1:-}"
OUT=""
CHECK_ONLY=0
case "$MODE" in
  --out)
    OUT="${2:?render-nginx-vhost.sh --out <path>}"
    ;;
  --check)
    CHECK_ONLY=1
    ;;
esac

if [ "$CHECK_ONLY" = "1" ]; then
  # 校验：渲染结果的 upstream attrax_nextjs 块里必须有 `server 127.0.0.1:PORT`
  # 行，且 PORT 等于 ports.env 的 NEXTJS_PORT（模板若被写死字面量端口，这里就
  # 会读出漂移）。
  #
  # 两点必须注意：
  #   1. 端口不能靠"行尾数字"提取 —— 真实行是
  #      `server 127.0.0.1:3000 max_fails=3 fail_timeout=30s;`，行尾是 `;`。
  #      用纯 bash 参数展开：先截 `127.0.0.1:` 之后，再截到第一个非数字。
  #   2. `|| true` 不能省 —— grep 未命中退出 1，set -e + pipefail 下命令替换
  #      失败会让脚本在任何输出之前静默退出（2026-09-19：preflight 的第二步
  #      因此必然静默 rc=1，整个预检失效）。未命中要走下面的 ERROR 分支。
  SERVER_LINE="$(printf '%s\n' "$RENDERED" | awk '/upstream attrax_nextjs/,/^}/' | grep -E '^[[:space:]]*server[[:space:]]+127\.0\.0\.1:[0-9]+' | head -1 || true)"
  if [ -z "$SERVER_LINE" ]; then
    echo "ERROR: rendered template has no upstream attrax_nextjs server line" >&2
    exit 2
  fi
  EFFECTIVE_PORT="${SERVER_LINE#*127.0.0.1:}"
  EFFECTIVE_PORT="${EFFECTIVE_PORT%%[!0-9]*}"
  if [ "$EFFECTIVE_PORT" != "$NEXTJS_PORT" ]; then
    echo "ERROR: upstream port drift — rendered template says :${EFFECTIVE_PORT} but ports.env says ${NEXTJS_PORT}" >&2
    exit 2
  fi
  echo "OK: rendered upstream attrax_nextjs -> 127.0.0.1:${NEXTJS_PORT}"
  exit 0
fi

if [ -n "$OUT" ]; then
  printf '%s\n' "$RENDERED" > "$OUT"
  echo "wrote $OUT (upstream -> 127.0.0.1:${NEXTJS_PORT})"
  # 注意：这里只写文件，不做 nginx -t / reload — 校验与 reload 是调用方的职责
  # (apply-deploy.sh [8.5]、attrax-healthcheck.sh level2)，避免双重 reload。
else
  printf '%s\n' "$RENDERED"
fi
