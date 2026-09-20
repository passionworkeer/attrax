# 法规详情页「返回上一页」修复（两轮）

**日期**：2026-09-20
**最终提交**：`4b0ed30` · BUILD_ID `mRzHjG0DEJf5PRnCyw5wC`
**页面**：`https://www.twinbuddy.xyz/regulations/US-16-CFR-1263#guidance-product-requirements`

## 第一轮（`9d92e1f`）：router.back() → 浏览器历史栈

原实现 `useRouter().back()`（Next.js App Router）在从外部链接 / 分享链接直接
打开时没有站内 SPA 历史项，静默 no-op，按钮点了没反应。第一轮改为
`history.length > 1 ? window.history.back() : window.location.assign("/regulations")`。

**用户实测反馈：仍然不对** —— 直接打开该链接点「返回上一页」，页面跳到了浏览器
（新标签页/空白页）。原因：浏览器历史里新标签页也是一条记录，`history.length > 1`
成立，`history.back()` 就把用户带出了站点。

## 第二轮（`4b0ed30`）：按「上一页归属」决定回退

核心变为：**只有历史中的上一条确实是本站页面才回退，否则回站内法规列表
`/regulations`**。判定分两层：

| 浏览器 | 判定依据 |
|--------|----------|
| 有 Navigation API（Chromium、新版 Safari/Firefox） | `navigation.currentEntry.index` 与 `navigation.entries()[index-1].url`：上一页同源才回退；直接打开时 `index` 为 0（实测 Chromium 直接打开 `history.length = 2` 但 `navIndex = 0` —— 初始空白/新标签条目不计入 `entries()`） |
| 无 Navigation API（旧 Firefox / 旧 Safari） | 根布局挂载 `InSiteVisitMarker` 把「本标签页访问过本站」写入 sessionStorage；详情页**首屏渲染时**读取（本页自身写入发生在挂载后，晚于读取，不会自证），有标记才回退 |

实现：新增 `lib/regulation/back-navigation.ts`（纯函数 + 存储读写，可单测）、
`components/regulation/InSiteVisitMarker.tsx`（挂在 `app/layout.tsx`，无渲染）。
`LinkBackToReport` 只做「读信号 → 决定 back / assign」。

## 验证

### 单测 / 静态检查

| 项目 | 结果 |
|------|------|
| `npx vitest run`（全量） | 96 文件 / 1032 测试全部通过（新增 16 条：`tests/unit/back-navigation.test.ts` 9 条纯函数、组件回归 7 条） |
| `npx tsc --noEmit` | 0 error |
| `npx eslint`（改动文件） | 0 error |

### 真浏览器（脚本 `verify-back-nav.mjs`，同目录）

场景：**A 直接打开**（必须留在站内、不得回退）· **B 站内先前页进入**（必须
`history.back()` 回上一页）· **C 从外部站点同标签进入**（必须留在站内）。每个
引擎跑两种能力变体：现代（真实 Navigation API）与旧版（注入脚本移除
`window.navigation`，覆盖降级路径）。判别方式：注入脚本包一层 `history.back`，
调用时置 `window.name` 标记 —— 最终 URL 相同也可能走了不同实现路径，必须区分。

- 本地 dev（localhost:3001）：chromium + firefox × 现代/旧版 × A/B/C = **12/12**
- 生产（https://www.twinbuddy.xyz）：chromium + firefox + **webkit** × 现代/旧版 × A/B/C = **18/18**

```
"case": "chromium / 现代(Navigation API) · A 直接打开",  "finalUrl": "/regulations", "via": "(assign)",            pass: true
"case": "chromium / 现代(Navigation API) · B 站内先前页", "finalUrl": "/regulations", "via": "used-history-back",  pass: true
（firefox / webkit / 旧版变体同构，共 18 条，PASSED: 18/18）
```

- WebKit 无法在本地 dev 验证：dev 响应头 CSP 含 `upgrade-insecure-requests`，
  WebKit 会把 localhost 的 chunk 请求升级成 https 导致无法水合（Chromium /
  Firefox 豁免 localhost）。生产为 https 站点无此问题，故 WebKit 在生产验证。

### 验证方法本身的两个坑（第一轮与第二轮各踩一个）

1. **水合前点击 = 假阴性**：`page.goto` 返回后立刻点击会落在 SSR 静态按钮上，
   onClick 尚未挂载，看起来像"功能没修好"。必须先等按钮节点出现 `__reactProps$`。
2. **场景 B 必须等上一页写完标记再跳走**：脚本若在上一页 `domcontentloaded`
   后立刻导航，上一页的 `InSiteVisitMarker` 效应还没执行，sessionStorage 里
   没有标记，会测出"降级路径不工作"的假象。真实用户点击站内链接前上一页必然
   已水合（交互本身需要 JS），脚本用"等标记写入"来对齐这一点。

## 部署

- `ATTRAX_TARBALL=.deploy/attrax-deploy-4b0ed30.tar.gz bash scripts/build-deploy-tarball.sh`
  → scp 到服务器 → 改名为 `/tmp/attrax-deploy-complete.tar.gz`（apply-deploy.sh 默认读该路径）→ `bash /tmp/attrax-apply-deploy.sh`
- health gate：attempt 2 OK；`.deployed` = `commit=4b0ed30 build_id=mRzHjG0DEJf5PRnCyw5wC`
- 服务器 git 快进到 `4b0ed30`：**bundle 起点必须用服务器实际 HEAD**（本次服务器
  落后于 origin 两个提交，用 `origin 前两个提交..HEAD` 打包会因缺少前置提交
  fetch 失败），故用 `git bundle create .deploy/attrax.bundle b2ba70a..HEAD`
- 期间并行会话又推送了 `d08dc41` / `d4e1774`（i18n 文案），未触碰本次文件，
  bundle 一并将服务器 git 带到 `4b0ed30`
