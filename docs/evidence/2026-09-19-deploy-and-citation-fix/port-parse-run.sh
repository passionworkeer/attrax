#!/bin/bash
# 验证 apply-deploy.sh [0] 端口预检的解析在三种输入下都安全。
#
# 背景：2026-09-19 部署实测 —— 改了这里的 grep 后，真实 vhost 的
# `server 127.0.0.1:3000 max_fails=3 fail_timeout=30s;` 行尾不是数字，
# `grep -oE '[0-9]+$'` 匹配失败退出非零，在 set -e + pipefail 下整个脚本
# 在任何日志之前静默退出（rc=1、零输出、部署 no-op）。
#
# 本脚本对三种输入跑同一段解析逻辑，断言：
#   1. 真实 vhost → 解析出 3000，且不早退
#   2. 没有 server 行的 vhost → live_port 为空，且不早退
#   3. 只有注释含 127.0.0.1:9999 → live_port 为空（不误认注释），且不早退
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

parse_port() {
  # 与 apply-deploy.sh [0] 完全相同的逻辑
  local LIVE_VHOST="$1"
  local server_line live_port
  server_line="$(grep -E '^[[:space:]]*server[[:space:]]+127\.0\.0\.1:[0-9]+' "${LIVE_VHOST}" | head -1 || true)"
  live_port=""
  if [ -n "${server_line}" ]; then
    live_port="${server_line#*127.0.0.1:}"
    live_port="${live_port%%[!0-9]*}"
  fi
  printf '%s' "${live_port}"
}

fail=0
check() {
  local label="$1" file="$2" expected="$3" got
  got="$(parse_port "${file}")"
  if [ "${got}" = "${expected}" ]; then
    echo "  PASS  ${label}: live_port='${got}'"
  else
    echo "  FAIL  ${label}: 期望 '${expected}' 实得 '${got}'"
    fail=1
  fi
}

echo "=== 端口解析验证（set -euo pipefail 下）==="
check "真实 vhost(server 行带 max_fails)" "${HERE}/real-vhost.conf" "3000"
check "无 server 行的 vhost"               "${HERE}/no-server-line.conf" ""
check "只有注释含 127.0.0.1:9999"          "${HERE}/comment-only.conf" ""

if [ "${fail}" -eq 0 ]; then
  echo "PASS: 三种输入全部符合预期，且脚本未提前退出"
else
  echo "FAIL: 存在不符合预期的输入"
fi
exit "${fail}"
