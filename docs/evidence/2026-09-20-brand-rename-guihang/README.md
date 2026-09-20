# 品牌残留清理：attrax → 规航（前端界面）

**日期**：2026-09-20
**提交**：`a2a3f14`（代码）· BUILD_ID `emWKtD7ueXVJa06Z6Rrbu`
**范围**：全仓扫描 `attrax` 字眼，仅替换**用户可见的品牌文案**中残留的旧品牌名；
基础设施命名（cookie / nginx zone / 全局变量 / manifest 文件名 / 服务器路径）一律不动。

## 改动内容（5 处，2 文件）

| 位置 | 旧文案 | 新文案 |
|------|--------|--------|
| `lib/i18n/translations.ts` zh `regulations.subtitle` | `{attraxMarkets} 个 attrax 合规区域` | `{markets} 个规航合规区域` |
| `lib/i18n/translations.ts` en `regulations.subtitle` | `{attraxMarkets} attrax markets` | `{markets} covered markets` |
| `components/regulation/RegulationsClient.tsx:117` | 占位符 key `attraxMarkets` | `markets` |
| `components/regulation/RegulationsClient.tsx:158` | en `"attrax markets"` | `"covered markets"` |
| `components/regulation/RegulationsClient.tsx:202` | zh `"个 attrax 合规"` | `"个规航合规"`；en 同上 |

## 保持不动的 attrax（代码内部名，改了会出事故）

| 位置 | 值 | 改动后果 |
|------|-----|----------|
| `app/api/backend-session-access.ts`、`app/upload/page.tsx`、`lib/rate-limit.ts` | cookie 前缀 `attrax_scan_` | 改后所有在途扫描会话全部丢失 |
| `lib/admin/auth.ts` | cookie `attrax_admin` | 管理员登录态失效 |
| `lib/admin/traffic.ts` | cookie `attrax_visitor` | 访客去重全部重置 |
| `lib/rate-limit.ts` | `zone=attrax_api`（nginx）、UA salt `attrax-rate-limit-v2` | 限流失效 / 客户端指纹漂移 |
| `lib/pipeline/demo-scan-session.ts` | `__attraxDemoScanSessions` 全局键 | demo 会话状态丢失 |
| `lib/regulations/raw-stats.ts` | manifest 文件名 `attrax-docs-extra-2026-09-19.json` | 读不到真实文件 |
| `lib/regulations/data-root.ts`、`lib/admin/*` | `/opt/attrax` 服务器路径 | 生产路径不存在 |
| `app/api/regulations/updates/watchdog-source.ts` | 抓取源描述正文 `attrax regulation watchdog` | 法规动态条目文案，非品牌露出，涉及数据 |
| 各 `console.error("[attrax] ...")`、调试日志、注释 | — | 非用户可见 |

## 验证

- `npx tsc --noEmit` 0 error；`npx eslint` 0 error（改动文件）；`git grep attraxMarkets` 仅剩 0 处
- vitest：95 文件 / 1020 测试全部通过
- 本地浏览器实测 `/regulations`：渲染 "法规库 724 条目录（覆盖 25 个规航合规区域 / 70 个抓取市场）"，卡片副标 "25 个规航合规"（见 `prod-regulations-zh.html` 同源快照）
- 生产构建产物：`grep -rl "covered markets" .next/static/chunks/` 命中 3 个 chunk；旧文案 `attrax markets` 0 命中
- 生产线上：`https://twinbuddy.xyz/regulations` HTTP 200，SSR HTML 中 `attrax` 出现 0 次，副标题与卡片均为新文案（`prod-regulations-zh.html`）
- 部署：apply-deploy health gate 通过（attempt 2 OK）；`/opt/attrax/.next/standalone/.deployed` = `commit=a2a3f14 build_id=emWKtD7ueXVJa06Z6Rrbu`；公网 `/api/health` 200；服务器 git 经 bundle 快进到 `a2a3f14`

## 备注

- 英文文案仅在客户端 locale=en 时渲染（locale 存 localStorage），SSR 默认中文；英文验证走构建产物 chunk 反查（其中无 `attrax markets`）。
- `lib/i18n/translations.ts` 中译本 `regulations.subtitle` 的 `{attraxMarkets}` 占位符同步改名，调用方 `RegulationsClient.tsx:117` 只此一处，已对齐。
