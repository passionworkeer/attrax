# 法规页「规航合规」文案修正（抓取覆盖卡片 + 顶部副标题）

**日期**：2026-09-20
**提交**：`d08dc41`（卡片副标）· `e5cabf5`（顶部副标题）
**BUILD_ID**：`6FdMRHV1mwcHuPJxHjRRP`（d08dc41）· `sOeIh8PJ9TEtqcNMOMaEq`（e5cabf5）
**范围**：`https://twinbuddy.xyz/regulations` 两处文案，数值口径均未改动。

## 改动内容（两处，2 文件）

| 位置 | 旧文案 | 新文案 |
|------|--------|--------|
| `components/regulation/RegulationsClient.tsx:202` 卡片副标（zh） | `25 个规航合规 · 1334 原文` | `覆盖 25 个合规区域 · 1334 原文` |
| 同处（en） | `25 covered markets · 1334 raw` | `covering 25 compliance regions · 1334 raw files` |
| `lib/i18n/translations.ts` zh `regulations.subtitle` 顶部副标题 | `覆盖 25 个规航合规区域 / 70 个抓取市场` | `覆盖 25 个合规区域 / 70 个抓取市场` |
| 同处（en） | `covering 25 covered markets / 70 fetched markets` | `covering 25 compliance regions / 70 fetched markets` |

数值来源未动：卡片主数值 `stats.raw.marketsCovered`（70 抓取市场）、副标 `stats.archive.markets`（25 合规区域）与 `stats.raw.totalRawFiles`（1334 原文）。

## 验证

- 本地：`npx tsc --noEmit` 0 error；`npx eslint`（改动文件）0 error；vitest 全绿（第一轮 1020/1020，第二轮 1032/1032——含并发会话新增的用例）
- `git grep 规航合规`（app / components / lib / tests）0 命中
- 本地浏览器实测（`attrax-dev` :3001）：卡片 `抓取覆盖 / 70 / 覆盖 25 个合规区域 · 1334 原文`；切 locale=en 为 `Fetch coverage / 70 / covering 25 compliance regions · 1334 raw files`；顶部副标题 `法规库 724 条目录（覆盖 25 个合规区域 / 70 个抓取市场）…`；控制台 0 error
- 构建产物反查：新串命中 standalone 内 SSR/static chunk 与 `lib/i18n/translations.ts`；旧串 `个规航合规` 在 standalone 的 app/components/lib/.next 中 0 命中；英文串命中生产 `/opt/attrax/.next/static/chunks/*.js`
- 生产 SSR HTML（本目录 `prod-regulations-zh.html`，26,371 bytes，取于 e5cabf5 部署后）：顶部副标题与卡片副标均为新文案，整页 `规航合规` 命中 **0**
- **生产真实扫描冒烟**（`prod-scan-smoke.mjs`，两次部署各跑一次）：
  - `smoke-output-d08dc41.txt`：Anker A2332 三图（electronics / EU,US）→ `status=ready source=real provider=deepseek`，5 findings / 9 citations / score 85，94s
  - `smoke-output-e5cabf5.txt`：同用例 → `status=ready source=real`，5 findings / 11 citations / score 84，73s
  - `provider=deepseek` 是 MiniMax 失败后的设计内降级，不影响主链路

## 部署

两次部署均走 `scripts/build-deploy-tarball.sh` → `tmp-deploy/attrax-deploy-complete.tar.gz` → scp → 服务器 `bash /tmp/attrax-apply-deploy.sh`：

1. `d08dc41`（BUILD_ID `6FdMRHV1mwcHuPJxHjRRP`）：ops 12 文件安装 + render 校验 `upstream attrax_nextjs -> 127.0.0.1:3000` + nginx reload + health gate attempt 2 OK
2. `e5cabf5`（BUILD_ID `sOeIh8PJ9TEtqcNMOMaEq`）：同上步骤，health gate attempt 2 OK；中间并发会话部署过 `4b0ed30`（返回上一页修复），本次构建为其后继提交，功能一并包含

对账：`/opt/attrax/.next/standalone/.deployed` = `commit=e5cabf5 build_id=sOeIh8PJ9TEtqcNMOMaEq`；公网 `/regulations` HTTP 200；服务器 git 树经 bundle 快进到 `e5cabf5`。

`git bundle create` 的坑：正向端必须是 ref 名（`4b0ed30..main`），写裸 SHA（`4b0ed30..e5cabf5`）会被判为 empty bundle 拒绝。

## 备注

- 英文文案仅在客户端 locale=en 时渲染（locale 存 localStorage），SSR 默认中文；英文验证走构建产物 chunk 反查。
- 期间同目录另有并发会话在改「返回上一页」（`app/layout.tsx` / `lib/regulation/` / `InSiteVisitMarker.tsx`）：第一次构建时（10:52）其改动未提交，已反查确认未进构建产物；其后该会话自行提交并部署（`4b0ed30`），第二次构建在干净工作树上进行。
