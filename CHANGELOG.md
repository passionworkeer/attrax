# Changelog

本项目所有重要修复的根因记录,供未来对账 / post-mortem / 新人上手。

## 2026-08-13 — commit `566c4ae` — 文档对账 + 7-21~8-10 部署回写

**背景**:对抗性审查发现 `docs/SERVER-VERSION.md` 滞留在 2026-07-20 的 `f167767`,而服务器 `.deployed` 实际已是 `566c4ae`(2026-08-10 10:22 build)。中间 12 个 commit 已部署但未回写文档。本次只改文档对齐真值,无代码改动。

**服务器真值(SSH `cat /opt/attrax/.next/standalone/.deployed`)**:
- commit=`566c4ae` / commit_full=`566c4ae3af7bafad498568767031c51d26927ac9`
- build_id=`WB3ldfLOxeBRK3xWwClDv` / branch=`main` / ref=`origin/main`
- built_at=`2026-08-10T10:22:50+08:00`
- 探活:前端 `/api/health`=200/6ms;RAG `:8001/health`=`ok`/`demo_mode=false`/`embedding=modelscope_api`/`dense_dim_mismatch_count=0`

**7-21 ~ 8-10 已部署的 12 个 commit(此前未回写 CHANGELOG,现补登)**:

| commit | 主题 |
|---|---|
| `4a00ef3` | docs(server):同步线上真值到 f167767 + trace [sessionId] 部署 |
| `841d880` | fix(frontend):修 35/D 单一问题 — HIGH 不再折成 critical + mock 按 preset 给分数梯度 |
| `b7bf784` | feat(frontend):add uploaded-image 2.5D 扫描阶段 |
| `86fc2fd` | merge:合并 origin/codex/upload-image-stage(前端 2.5D 扫描阶段) |
| `aee801d` | fix(profit-page):真实后端扫描利润页不再用 mock 兜底 |
| `e851f20` | feat(result-page):结果页加利润摘要条 + 利润页 bare 模式加风险 caveat |
| `edb49ae` | refactor(export):利润页 PDF/DOCX 改走 RenderModel,字符与前端一致 |
| `da3f816` | fix(export):利润页 PDF/DOCX 白底白字显示空白,小卡片改白底,成本利润说明走统一 RenderModel |
| `0615689` | docs:define actual financial report integrity |
| `25f9604` | fix(profit):财务报告真实数据闭环,停用 Markdown 猜测与固定 ¥128 |
| `8563cd2` | fix(backend):scan 合规整改 + 队列安全 + 诚实输出(P0-1/P1-1/P1-2) |
| `566c4ae` | fix(ci):清零 CI/CD 暴露的 e2e/audit 债务 + 补服务器健康监控告警 (#4) |

**主线主题**:
1. **利润导出统一**(`edb49ae`/`da3f816`):新增 `ProfitRenderModel` 作为页面 + PDF/DOCX 唯一真值源,修白底白字 + 两入口数字不一致。
2. **财务报告诚实化**(`25f9604`):真实扫描不再用正则从 markdown 猜金额 / 固定 ¥128 兜底;`synthesizeFinancialSummaryIfMissing` 在缺结构化字段时返回 null(诚实降级),而非伪造。
3. **scan 后端整改**(`8563cd2`):P0-1 降级红色 banner + degradedReason 暴露;P1-1 accessTokenHash 防覆盖;P1-2 withWriteLock 串行化 + enqueueScan 失败回滚。
4. **CI 债务清零**(`566c4ae`,PR #4):e2e/audit 暴露的债务清零 + 补服务器健康监控告警。

## 2026-07-20 — commit `6bce766` — 8 个用户可见 bug + 93 CI 测试债 → 0

**部署**:BUILD_ID `8MPBvunubBpYuqCrC_gW4`(上一个 `ekmjiomccTcAos50wKnTw`)。
**SSH 端到端真实扫描验证**:65W 充电器图 → 11 次轮询 55 秒 → 真实 RAG 报告 score=35/D(charger 缺图高危),全链路工作。
**测试**:`npx vitest run` → **943 / 943 passed**(从 93 失败修复)。

### 产品代码 8 个用户可见 bug

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| 1 | standalone 生产 next/image 优化失败,`/complipilot/*` `/mock-fixtures/*` 全部破图(err log 80+ 行 `received null`) | `next.config.ts` | `images.unoptimized: true`(standalone 部署不自带 sharp optimizer) |
| 2 | 英文 demo 合规章导出吐 `{{PRODUCT}}` `{{SCORE}}` 占位符废文本 | `lib/reporting.ts:135` | `locale === "en" ? EN : ZH.replace(...)` 因 `.replace` 优先级高于 `?:`,EN 分支直接返回原模板 → 改 `const tpl = ...; tpl.replace(...)` |
| 3 | 真实扫描 trace 耗时全部显示 `0.0s` | `app/api/trace/[sessionId]/route.ts` | 加 `_traceDurationMs` helper 读 `durationMs ?? duration_ms ?? duration` 兜底(后端 `_camelize` 已转 camelCase,v1 路径之前只读 snake 拿不到) |
| 4 | Demo / 降级模式 UI 显示 `verdict=UNKNOWN` `riskLevel=LOW` | `lib/mock/scan-result.ts` | verdict / riskLevel 从 `nodes[0].metadata` 提升到 `decisionView` 顶层(前端 schema 9c6a76f 已提升、真实后端也在顶层产出),每个 node 加 `severity` |
| 5 | 65W / 加湿器 / 儿童积木 demo 在 upload 选 EU/US 但渲染落回 EU/UK,儿童积木还丢 US-CPSIA-TOY 法规 | `app/upload/page.tsx` `app/result/[sessionId]/page.tsx` | `startPresetDemo` 在 query 里带 `markets=EU,US`(逗号分隔),result page 读 query 传给 `createMockScanResult({ category, markets })`,`createMockScanResult` 本来就支持 `options.markets` |
| 6 | `/[locale]` 首页 eyebrow 仍硬编码 `Blaze Hawks` 与 `{t("title")}` 品牌名自相矛盾 | `app/[locale]/page.tsx:32` | 改为 `{locale === "en" ? "CompliPilot" : "规航AI"}` |

### 产品逻辑 2 个改进

| 问题 | 文件 | 修复 |
|------|------|------|
| UNKNOWN complianceStatus 映射到 `info` / 90/A(过度乐观,合规场景危险:用户据此放行) | `lib/rag-client/v1-result-adapter.ts` `lib/types.ts` | `Severity` union 加 `unknown`,`scoreFor("unknown") = 50/C` 中性档(不是 90/A 绿色);`severityFor` 加 `"unknown"` 映射;`resultScore` 改 UNKNOWN 走 `scoreFor("unknown")` |
| `buildProfitReport` 真实 RAG 路径无 financialSummary 时,删了正则 fallback(3e5259e)后**静默**生成空/伪 content | `lib/reporting.ts` | 优先透传 `backend profitReport.markdown`(后端 LLM 生成的真实分析);既无 financialSummary 也无 backend markdown 时显式返回 `Figures not available` 而非伪造金额 |

### 测试 CI 93 失败 → 0

| 文件 | 失败数 → 0 | 根因 | 修法 |
|------|------------|------|------|
| `tests/unit/report-export.test.ts` | 86 → 0 | 71f9292 启用 PDF/DOCX 客户端导出改用 `doc.output("blob")` 后,测试 mock 缺 `output` 方法 + anchor 缺 `style`,导致 `doc.output is not a function` 整个测试 throw | (1) `jsPDFMethods` 加 `output: vi.fn(() => ({}))`;(2) `mockAnchorRef.current` 加 `style: { display: "" }`;(3) `expect(jsPDFMethods.save).toHaveBeenCalledWith(filename)` → `expect(mockAnchorRef.current.download).toBe(filename)`(实现走 `downloadBlob` 设 `a.download`);(4) 4 个 `removeChild`/`revokeObjectURL` 断言前 `await new Promise(setTimeout)` flush(`downloadBlob` 用 `setTimeout(0)` 异步清理);(5) 1 处品牌名"火鹰"→"规航AI" |
| `tests/unit/v1-result-adapter.test.ts` | 1 → 0 | a2235dd 改 `severityFor` 读 `node.severity` 后,fixture node 只用旧 `status:"warning"` 无 `severity`,fallback 到 `info` → 90/A ≠ 期望 65/C | fixture node 加 `severity: "medium"` |
| `tests/unit/api-scan-session-full.test.ts` | 1 → 0 | score contract fixture 无 agentTrace,UNKNOWN 走 fallback | fixture `agentTrace: [{ node: "synthesis", severity: "medium" }]`(同时和 UNKNOWN→50/C 修复配合) |
| `tests/unit/rag-client-report-package.test.ts` | 已含 | 断言反向(期望 `metadata.verdict`) | 改 `expect(dv.verdict).toBe("REJECTED")` 等顶层断言 |
| `tests/unit/i18n-comprehensive.test.ts` | 已含 | 71f9292 漏改第 93 行 | `'火鹰合规'` → `'规航AI'` |
| `tests/unit/upload-page-actions.test.tsx` | 已含 | 6a360fa 改 `startPresetDemo` 加 `?preset=...` query 后,测试断言还是 `/result/demo` | 断言 `expect.stringContaining("/result/demo?preset=charger")`(包含 markets query 也通过) |
| `tests/unit/reporting-real-profit.test.ts` | 2 → 0 | 期望 buildProfitReport 透传 backend markdown 或 "not available",但实现走合成 markdown | 见上面 `lib/reporting.ts` 修复(同一改动) |
| `tests/unit/useScanPolling.test.tsx` | 3 → 0 | 注释 `// POLL_INTERVAL_MS` 但实际 `POLL_INITIAL_INTERVAL_MS = 2000` 不是 850;同步 `advanceTimersByTime` 不 flush microtask | (1) `850` → `2000`;(2) `advanceTimersByTime(` → `advanceTimersByTimeAsync(`;(3) `renderHook` 后用 `flushInitialPoll()` helper 或 `await act(advanceTimersByTimeAsync(1))` 等初始 fetch 真正发起 |

### 治本机制:`.deployed` 标识

- 之前线上 BUILD_ID 与本地 commit 失联(SERVER-VERSION.md 滞后 1+ 个 commit),靠人工对账。
- `scripts/build-deploy-tarball.sh` 加 `[3.5]` 块:`stage` 时自动写 `commit / commit_full / build_id / branch / ref / built_at` 到 `${STANDALONE}/.deployed`,随 tarball 走、`apply-upload-fix.sh` 解包后落地到 `/opt/attrax/.next/standalone/.deployed`。
- 对账:`ssh attrax 'cat /opt/attrax/.next/standalone/.deployed'` 一次拿到 commit + BUILD_ID + ref,无需再手动维护 `docs/SERVER-VERSION.md` 版本表。

### `.gitignore` 顺手修复

- `规航AI-源码-后端联调-20260717/` 850MB 目录的 pattern 原本被误写在注释行末尾 + 被 stray `\r` 污染,**从未生效**(`git status` 一直显示该目录 `??`)。拆出独立行 + 统一文件 CRLF → LF(符合 `.gitattributes eol=lf`)。
- 新增 `scripts/check-react-418.mjs` 到 throwaway 7/18 debug probe 区块(归 `c0a8bb4` 同一类)。

## 2026-07-19 — `edb2431` — `.deployed` 机制 + 版本对账文档

详见 [docs/SERVER-VERSION.md](docs/SERVER-VERSION.md)。`edb2431` 引入 `.deployed` 治本机制(首次为修复 `6bce766` 部署时使用);同时把 `docs/SERVER-VERSION.md` 从滞后 `db3a54b` 的状态更新到真值 + 标记 `§6 待办 .deployed` 完成。

## 2026-07-18 — `83890ae` — standalone 部署补 static+public staging

`build-deploy-tarball.sh` / `apply-upload-fix.sh` 在 `next.config.output = "standalone"` 下,`.next/static`(客户端 CSS/JS)+ `public/` 不会被自动拷进 `.next/standalone/`,浏览器加载 `/_next/static/*` 全部 404、整站裸奔。事故根因 2026-07-18 19:00(成都阿里云 ECS load 111 + sshd MaxStartups 卡死),事故期间多次部署发现:tarball 内 `static/` 缺失 → 整站 CSS 404。

修复:`build-deploy-tarball.sh` 在 `[3] stage` 步骤把 `.next/static` + `public/` 拷进 `standalone/`,并强校验 `css ≥ 2 + media ≥ 5` + `public/` 存在,不强校验则 `exit 2` 拒绝打包;`apply-upload-fix.sh` 解包后同样校验,不通过就回滚到 `standalone-pre-upload-fix-*` 备份,绝不带病上线。
