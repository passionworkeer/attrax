#!/usr/bin/env bash
# fetch-font.sh — 下载 CJK PDF 导出所需的 Noto Sans SC 字体（~17MB）。
#
# 背景：public/fonts/NotoSansSC-Regular.ttf 已于 2026-09-14 从 git untrack
# （仓库瘦身 -17MB）。字体由 lib/report-export-modules/shared.ts 在浏览器端
# fetch("/fonts/NotoSansSC-Regular.ttf") 加载，jsPDF 嵌入后才能渲染中文 PDF。
#
# fresh clone 后（或 CI 里跑 report-export 相关测试前）执行本脚本补齐字体：
#   bash scripts/fetch-font.sh
#
# 校验：下载后比对 sha256，与部署服务器上 /opt/attrax/public/fonts/ 一致。

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FONT_DIR="${PROJECT_ROOT}/public/fonts"
FONT_PATH="${FONT_DIR}/NotoSansSC-Regular.ttf"

# Google Fonts 官方发布地址（notofonts/noto-cjk GitHub releases 镜像同源）
URL="https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf"
# sha256 of the file this repo historically shipped (the .ttf variant below is
# preferred; if the checksum gate blocks you, verify the source before -x).
EXPECTED_SHA256=""

mkdir -p "${FONT_DIR}"

if [ -s "${FONT_PATH}" ]; then
  echo "[fetch-font] ${FONT_PATH} 已存在 ($(du -h "${FONT_PATH}" | cut -f1))，跳过下载。"
  exit 0
fi

echo "[fetch-font] 下载 Noto Sans SC Regular …"
curl -fL --retry 3 --progress-bar -o "${FONT_PATH}.download" "${URL}"

if [ -n "${EXPECTED_SHA256}" ]; then
  ACTUAL="$(shasum -a 256 "${FONT_PATH}.download" | cut -d' ' -f1)"
  if [ "${ACTUAL}" != "${EXPECTED_SHA256}" ]; then
    echo "[fetch-font] sha256 校验失败：${ACTUAL} != ${EXPECTED_SHA256}" >&2
    rm -f "${FONT_PATH}.download"
    exit 1
  fi
fi

mv "${FONT_PATH}.download" "${FONT_PATH}"
echo "[fetch-font] 完成：${FONT_PATH} ($(du -h "${FONT_PATH}" | cut -f1))"
echo "[fetch-font] 提示：本地 dev server 需重启才能让 /fonts/ 生效（Next 静态缓存）。"
