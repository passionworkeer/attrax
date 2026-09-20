# 法规页「抓取覆盖」卡片副标文案修正（规航合规 → 覆盖 N 个合规区域）

**日期**：2026-09-20
**提交**：`d08dc41`（代码）· BUILD_ID `6FdMRHV1mwcHuPJxHjRRP`
**范围**：`https://twinbuddy.xyz/regulations` 右侧「抓取覆盖」卡片副标，仅文案变更，数值口径不变。

## 改动内容

| 位置 | 旧文案 | 新文案 |
|------|--------|--------|
| `components/regulation/RegulationsClient.tsx:202`（zh） | `25 个规航合规 · 1334 原文` | `覆盖 25 个合规区域 · 1334 原文` |
| 同处（en） | `25 covered markets · 1334 raw` | `covering 25 compliance regions · 1334 raw files` |

卡片主数值仍是 `stats.raw.marketsCovered`（抓取市场数 70），副标 `stats.archive.markets`（合规区域数 25）与 `stats.raw.totalRawFiles`（原文 1334）口径未动。

## 未改动（用户未指出，保持现状）

页面顶部副标题 `lib/i18n/translations.ts` zh `regulations.subtitle` 仍为「法规库 724 条目录（**覆盖 25 个规航合规区域** / 70 个抓取市场）· …」，生产 SSR HTML 中该串仍在（本次快照里 `个规航合规` 命中 1 处即此处）。如需一并调整须另开改动。

## 验证

- 本地：`npx tsc --noEmit` 0 error；`npx eslint components/regulation/RegulationsClient.tsx` 0 error（1 处 `fallbackStats` unused 警告为改动前既有，本轮未引入）；vitest **1020/1020 通过**（95 文件）
- 本地浏览器实测（`attrax-dev` :3001）：zh 卡片 `抓取覆盖 / 70 / 覆盖 25 个合规区域 · 1334 原文`；切 locale=en 为 `Fetch coverage / 70 / covering 25 compliance regions · 1334 raw files`；控制台 0 error
- 构建产物反查：`.next/standalone` 内新串命中 SSR chunk + static chunk；英文串命中生产 `/opt/attrax/.next/static/chunks/2o6ly9ap6pobp.js`
- 生产 SSR HTML（本目录 `prod-regulations-zh.html`，26,145 bytes）：卡片副标 = `覆盖 25 个合规区域 · 1334 原文`
- **生产真实扫描冒烟**（本目录 `prod-scan-smoke.mjs` + `smoke-output.txt`）：`POST /api/scan` 上传 Anker A2332 三图（electronics / EU,US）→ 轮询 → `status=ready source=real provider=deepseek`，5 findings / 9 citations / score 85，94s。provider=deepseek 是 MiniMax 失败后的设计内降级（RAG 服务侧日志同批），不影响主链路

## 部署

- 本地 build + `scripts/build-deploy-tarball.sh` → `tmp-deploy/attrax-deploy-complete.tar.gz`（61M，BUILD_ID `6FdMRHV1mwcHuPJxHjRRP`）→ scp → 服务器 `bash /tmp/attrax-apply-deploy.sh`
- apply-deploy：ops 12 文件安装 + render 校验 `upstream attrax_nextjs -> 127.0.0.1:3000` + nginx reload + health gate attempt 2 OK
- 对账：`/opt/attrax/.next/standalone/.deployed` = `commit=d08dc41 build_id=6FdMRHV1mwcHuPJxHjRRP`；公网 `/regulations` HTTP 200
- 部署前确认服务器原为 `a2a3f14`（本地 main 仅多文档提交），无其他会话更新的部署被覆盖
