# 法规详情页「返回上一页」修复：Next router.back() → 传统浏览器历史栈

**日期**：2026-09-20
**提交**：`9d92e1f` · BUILD_ID `CqYlc_Jzp8CGubP5uKQIt`
**现象**：`https://www.twinbuddy.xyz/regulations/US-16-CFR-1263#guidance-product-requirements`
右上角「返回上一页」点击无反应。

## 根因

`components/regulation/LinkBackToReport.tsx` 原实现是 `useRouter().back()`。
Next.js App Router 的 `router.back()` 只在**本站 SPA 历史链存在**时生效：
用户从外部链接 / 分享链接 / 书签直接打开详情页时，App Router 没有可回退的
内部历史项，`router.back()` 静默 no-op —— 按钮看起来"点不了"。该页面的主要
入口恰恰是扫描报告里的引用 chip（打开新标签）与分享链接，命中此场景。

## 修改（传统 web 行为）

`LinkBackToReport.tsx` 改为浏览器原生历史栈：

- `history.length > 1`（浏览器栈里有上一页，含从外部站点同标签进入）→ `window.history.back()`，
  与浏览器自带后退键行为一致；
- `history.length <= 1`（直接打开 / 书签进入，无上一页）→ `window.location.assign("/regulations")`
  回退到法规档案列表，避免点击后毫无反应。

左侧「返回首页」链接不变。全仓检索确认 `router.back()` / `history.back()` 仅此一处使用。

新增 3 条 vitest（`tests/unit/regulation-navigation.test.tsx`）覆盖：无历史走列表、
有历史走 `history.back()`、首页链接恒在。

## 验证

### 本地

| 项目 | 结果 |
|------|------|
| `npx vitest run tests/unit/regulation-navigation.test.tsx` | 4/4 通过 |
| `npx vitest run`（全量） | 95 文件 / 1020 测试全部通过 |
| `npx tsc --noEmit` | 0 error |
| `npx eslint`（改动文件） | 0 error / 0 warning |
| 本地浏览器实测（next dev，直接打开详情页，桩 history.length=1） | 点击后真实跳转到 `/regulations` |

### 生产（真实浏览器 Playwright，脚本见同目录 `verify-back-nav.mjs`）

```
[
  { "scenario": "A: 无历史直接打开（length=1）",  "historyLength": 1, "finalUrl": "https://www.twinbuddy.xyz/regulations", "pass": true },
  { "scenario": "B: 站内先前页进入（length>1）", "historyLength": 3, "finalUrl": "https://www.twinbuddy.xyz/regulations", "pass": true }
]
PASSED: 2/2
```

- 部署产物反查：服务器 `2g55-7kofcysp.js` 含 `history.length>1?window.history.back():window.location.assign("/regulations")`，
  全量 chunk 中无旧实现残留（`min-h-10 ... underline"` 旧样式 0 命中）。
- 页面本身：`https://www.twinbuddy.xyz/regulations/US-16-CFR-1263` HTTP 200。

### 验证方法本身的坑（第一版脚本误判）

第一版脚本 `page.goto` 后立刻点击，报"点击无反应"——实为**点击发生在 React
水合之前**，onClick 尚未挂到 SSR 静态按钮上。改为等待按钮节点出现
`__reactProps$`（React 水合的确定性信号）后再点击，同一页面通过。今后对本站
客户端交互做真浏览器验证时必须带水合等待，否则得到假阴性。

## 部署

- 本地 `ATTRAX_TARBALL=.deploy/attrax-deploy-9d92e1f.tar.gz bash scripts/build-deploy-tarball.sh` → 61M tarball；
  `apply-deploy.sh` 固定读 `/tmp/attrax-deploy-complete.tar.gz`，scp 后在服务器上改为该路径执行
  （也可用 `ATTRAX_TARBALL` 覆盖）
- apply-deploy health gate：attempt 2 OK（10:39）；`.deployed` = `commit=9d92e1f build_id=CqYlc_Jzp8CGubP5uKQIt`
- 服务器 git 经 bundle 快进 `31d4fd7 → 9d92e1f`（bundle 内 ref 为 `HEAD`，须 `git fetch <bundle> HEAD:from-bundle`；
  服务器工作树有运行时脏文件（watchdog 改写的 UK-WEEE.yaml 等），因不冲突可正常 fast-forward）
- 上线后 4 分钟并行会话部署了 `a2a3f14`（品牌改名，`9d92e1f` 的后代提交，含本次修复），
  当前线上 `.deployed` = `commit=a2a3f14 build_id=emWKtD7ueXVJa06Z6Rrbu`；其 chunk
  `2g55-7kofcysp.js` 仍含本次修复代码，回归脚本对当前线上构建复跑同样 2/2 通过
- 公网 `https://www.twinbuddy.xyz/regulations/US-16-CFR-1263` HTTP 200
