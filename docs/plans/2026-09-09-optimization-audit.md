# attrax 优化点审计报告

> **审计时间**: 2026-09-09
> **审计范围**: 全仓库(`app/`、`lib/`、`components/`、`rag_service/`、`tests/`、`scripts/`、`docs/`、`middleware.ts`、配置)
> **审计方式**: 只读系统性代码扫描（未做任何修改）
> **优先级 = 影响 / 修复成本**，影响高 + 修复成本低 = 最优先
> **状态标注**: 「新发现」= CLAUDE.md/README 未明示的问题；「已记录」= 文档中已确认但仍存在的实际问题
> **参考基线**: 已知 P0-1~P0-6、P1-1~P1-8 + 2026-06-29 / 2026-07-18 两次事故修复全部落地；本次扫描发现的是「文档/代码脱节」与「隐性维护陷阱」为主

---

## TL;DR · 立即要做（本周）

| # | 问题 | 一句话 |
|---|------|--------|
| **1** | `lib/pipeline/scan.ts` (470) + `scan-queue.ts` (467) 整条管线是 **死代码** | 生产走 RAG `/api/v1/scans`，但 ~937 行旧管线 + 完整测试 + 三份文档反复描述为现行架构 |
| **2** | `DegradedBanner` / `LegacyResultView` / `SourceNotice` 组件 **未被任何页面渲染** | CLAUDE.md P0-1 说加了红色 banner，实际渲染层缺失 |
| **3** | `cohere_reranker.py` / `cohere_embedder.py` 文档说"已实现"，**文件实际不存在** | requirements-prod.txt 仍装 `cohere==6.1.0`，但 `_probe_embedders` 只探测 ModelScope |
| **4** | CLAUDE.md / README / RAG-ARCHITECTURE-v3.md 描述的架构与代码路径不一致 | 三份文档仍在描述旧 `lib/pipeline/scan.ts` 链路 |

## 中期（两周内）

- `app/result/[sessionId]/page.tsx` 1200 行（超阈值 1.5×）
- `_ALLOWED_MARKETS` / `MAX_MARKETS` / `MAX_DOCX_*` 三个常量在三处重复
- 前端未使用的 npm 依赖（`@google/generative-ai` / `@fingerprintjs/fingerprintjs` / `mammoth` / `sharp` / `openai`）
- ~~CSP `'unsafe-inline'` 常驻~~ **已评估暂缓（2026-09-10）**：实测 nonce 化要求全站动态渲染，而 /upload 等页为 SSG 预渲染，nonce+strict-dynamic 会直接阻断其 JS；需先做动态化专项
- export modules (compliance / decision / roadmap) 缺快照测试
- `generator.py:225` agent_trace 维护陷阱（紧邻 P0 修复，需加固防回退）
- `npm audit` + depcheck 上 CI

## 长期（持续）

- rag-service 单 worker 内存 700-960MB 波动（已 900→1300M 缓解，并发仍是瓶颈）
- observability：缺 `/metrics` 端点、OpenTelemetry 未导出
- BM25 index 按 region 预构建 + LRU cache（已有 `_FILTER_BM25_CACHE`）

---

## 维度 1 · 死代码 / 未启用功能 / 占位实现

### 1.1 [新发现·高] `lib/pipeline/scan.ts` (470) + `scan-queue.ts` (467) 整条管线是死代码
- **位置**:
  - `/workspace/me/attrax/lib/pipeline/scan.ts`
  - `/workspace/me/attrax/lib/pipeline/scan-queue.ts`
- **现状**: 这两个文件组成的 ~937 行管线**在生产代码中没有任何路由引用**。
  - `runScan` 仅被 `scan-queue.ts` 导入
  - `enqueueScan` 在生产代码中**完全无引用**
  - 实际扫描流程：`/app/api/scan/route.ts → createScan()（v1-adapter）→ RAG /api/v1/scans`
- **影响**: 高（误导新人 + 文档/代码脱节 + 维护负担 + 测试覆盖浪费）
- **修复成本**: 中（保留测试代码先标 deprecated；删时一并删测试）
- **建议方案**:
  1. 顶部加 `@deprecated` JSDoc 注释，标注"v1.5 deprecated; use `lib/rag-client/v1-adapter.ts`"
  2. CI 加 `noUnusedImports` 校验
  3. 删时一并删 `tests/unit/scan-pipeline.test.ts`、`scan-queue.test.ts`、`scan-post-route.test.ts`、`scan-comprehensive.test.ts`、`scan-extract-cost.test.ts`
  4. 同步更新 README/CLAUDE.md/PROJECT_ANALYSIS.md

### 1.2 [CLAUDE.md 已隐含·高] `components/upload/UploadForm.tsx` 整文件为死代码
- **位置**: `/workspace/me/attrax/components/upload/UploadForm.tsx` (509 行)
- **现状**:
  - 文件顶部第 11 行 `@deprecated Do not re-enable or import into a page.` 显式标记
  - 被 `app/upload/page.tsx` 完全弃用（新版是直接 inline 的 CompliPilot flow）
  - 仅 `tests/unit/upload-form.test.tsx` 引用
  - CLAUDE.md/README.md 仍把它列在目录树
- **影响**: 中（误导 + bundle 分析噪音）
- **修复成本**: 低
- **建议方案**: 删除文件 + 测试 + 文档条目；保留 upload-form 测试就失去了意义

### 1.3 [新发现·中] `LegacyResultView` / `DegradedBanner` / `SourceNotice` 组件未被任何路由渲染
- **位置**:
  - `/workspace/me/attrax/components/result/LegacyResultView.tsx` (90 行)
  - `/workspace/me/attrax/components/result/DegradedBanner.tsx`
  - `/workspace/me/attrax/components/result/SourceNotice.tsx`
- **现状**:
  - `LegacyResultView` 只在 `tests/unit/result-imagecarousel-legacy.test.tsx` 出现，没有任何 app/page 渲染它
  - `DegradedBanner` 整个 `result/` 目录下**零引用**（仅 `lib/rag-client/errors.ts` 注释提及）。CLAUDE.md P0-1 提到加红色 `DegradedBanner`，但实际渲染实现缺失
  - `SourceNotice` 组件本身**不被渲染**；只有其 `ReportLocale` 类型在 `DownloadButtons.tsx`、`ReportPanels.tsx` 被 `import type`
- **影响**: 中（CLAUDE.md 描述的红色 banner 实际未渲染，P0-1 修复不完整）
- **修复成本**: 低
- **建议方案**: 要么在 `app/result/[sessionId]/page.tsx` 真正接入 `DegradedBanner` + `SourceNotice` 渲染，要么删除 `LegacyResultView` + `SourceNotice` 组件并删测试；`DegradedBanner` 要么用，要么删

### 1.4 [CLAUDE.md 已记录但误导·低] `cohere_reranker.py` / `cohere_embedder.py` 文件不存在
- **位置**: 整个 repo `find -name "cohere_reranker*"` 仅命中 `node_modules` 和 `rag_service/.venv/site-packages/cohere/`
- **现状**:
  - CLAUDE.md 第 171-172 行、README 第 364-365 行、PROJECT-STATUS.md 第 167-168 行都说"`cohere_reranker.py` 已实现但未接入管线"
  - **实际源码不存在这两个文件**
  - `requirements-prod.txt` 仍安装 `cohere==6.1.0`（第 53 行），但 `hybrid_retriever._probe_embedders` 只探测 ModelScope
  - `PROJECT_ANALYSIS.md:145` 把"删 cohere_embedder/local_embedder 死代码"列为待办，事实上已删（任务名义未完成）
- **影响**: 低（文档失真，但不影响运行）
- **修复成本**: 低
- **建议方案**:
  1. 所有提到 `cohere_reranker.py` / `cohere_embedder.py` "已实现"的文档改为"未实现 / 不在生产路径"
  2. 同步从 `requirements-prod.txt` 删 `cohere==6.1.0`（除非有真正引用）
  3. 从 `requirements.txt` 删同条目

### 1.5 [新发现·低] `lib/pipeline/upload-storage.ts` 在生产路径上仍部分被引用但语义变化
- **位置**: `/workspace/me/attrax/lib/pipeline/upload-storage.ts`
- **现状**:
  - `lib/pipeline/scan.ts` 调 `logUserActivity`（死代码）
  - `scan-queue.ts` 也调 `logUserActivity`（死代码）
  - 生产路径实际上不调用 upload-storage（v1 API 在 Python 后端自己用 `FileBackend` 存 uploads，文件路径见 `rag_service/infrastructure/file_backend.py:147` `save_upload`）
  - `session-store.ts:5` 引 `removeAllUploads/removeUploadsForSession`，但 `clearStore()` 仅在测试中调用（`globalThis.__scanStore`）
- **影响**: 低（函数存在但几乎不走）
- **修复成本**: 低
- **建议方案**: 给 upload-storage 顶部加 `@deprecated` 或注释说明"仅在 `lib/pipeline/scan.ts` 链路使用，主路径走 RAG FileBackend"

### 1.6 [新发现·中] 前端未使用的 npm 依赖（package.json 冗余）
- **位置**: `/workspace/me/attrax/package.json`
- **现状**: 通过 `grep -rln "from 'X'"` 确认下列包在前端代码中**零引用**：
  - `@google/generative-ai@^0.24.1`（仅在 lockfile 与 docs 中提到）
  - `@fingerprintjs/fingerprintjs@^5.2.0`（CLAUDE.md 提到限流客户端指纹改多维度，但实际代码用 `request.headers` 多维哈希，CLAUDE.md 第 359 行 P1-6）
  - `mammoth@^1.12.0`（DOCX 解析实际在 Python 端用 `python-docx`）
  - `sharp@^0.35.3`（无 import）
  - `openai@^6.34.0`（前端无 import；LLM 调用走 Python urllib 直连 minimax API）
- **影响**: 中（每多一个 prod 依赖，next bundle / npm i 时长 / 攻击面都增加）
- **修复成本**: 低
- **建议方案**: 跑 `npx depcheck` 系统扫一遍；确认无用后删上述 5 个

### 1.7 [CLAUDE.md 已记录·中] Python 后端 `requirements.txt` 冗余 500+ 条
- **位置**:
  - `/workspace/me/attrax/rag_service/requirements.txt` (563 行)
  - `requirements-prod.txt` (62 行)
  - `requirements-dev.txt` (5 行)
- **现状**: `requirements.txt` 包含 tensorflow / torch / jupyter / selenium / whisper / cohere / google-genai / google-generativeai 等 RAG 服务从不 import 的包（CLAUDE.md L338 已记录）。Docker 用 `requirements-prod.txt` 已隔离
- **影响**: 中（仅本地开发体验差；prod 不受影响）
- **修复成本**: 低
- **建议方案**:
  - `requirements.txt` 头部注释已说明"DO NOT install — 仅为可复现快照"
  - README 加 `pip install -r requirements-prod.txt` 唯一推荐命令
  - 删 `requirements.txt`（保留改名 `requirements-snapshot.txt`）

### 1.8 [新发现·低] Demo 数据仍固化在 `app/api/regulations/updates/data.ts`
- **位置**: `/workspace/me/attrax/app/api/regulations/updates/data.ts` (1020 行)
- **现状**: 文件第 1-5 行注释"Static demo data. ... curated examples and are not fetched or verified live."——是硬编码示例数据，但文件 1020 行超过 CLAUDE.md 第 271 行的 800 行阈值
- **影响**: 低（功能正常但维护负担）
- **修复成本**: 中（拆分需保持类型一致）
- **建议方案**: 拆分到按市场分目录（`data/eu.ts`、`data/us.ts`...），或挪到 `lib/mock/regulations.ts`

---

## 维度 2 · 性能瓶颈 / 资源问题

### 2.1 [CLAUDE.md 已记录·中] rag-service worker 内存 700-960MB 波动
- **位置**: CLAUDE.md L370 + `scripts/ecosystem.config.cjs:max_memory_restart`
- **现状**: 单 worker 串行扫 BM25 多市场索引构建推高到 ~960MB；已通过 900M→1300M 缓解但仍是瓶颈
- **影响**: 中（并发扫描必串行等待）
- **修复成本**: 高
- **建议方案**:
  - **短期**: BM25 索引启动期按 region 预构建并 LRU cache（已有 `_FILTER_BM25_CACHE`，继续扩展）
  - **长期**: 拆 worker 为 pool

### 2.2 [CLAUDE.md 已记录但有残留·中] `agent_trace` 在 Send() fan-out + refine 循环下的乘法风险
- **位置**: `/workspace/me/attrax/rag_service/orchestrator/nodes/generator.py:225`
- **现状**:
  - `state.py` 第 5-17 行注释明示"节点 MUST 返回仅新 entry"
  - 但 `generator.py:225` 仍有 `full_trace = state.get("agent_trace", []) + [trace_entry]`
  - 紧跟第 243 行 `agent_trace: [trace_entry]`（仅新条目，给 reducer）
  - `generator.py:236` `agent_trace=full_trace` 是给 `report_package`，不会进 graph state
  - **该模式是维护陷阱**——后续修改若把 `full_trace` 误返回 state 会立刻重现 32k+ entries 的 P0 bug
- **影响**: 中（隐性 bug 风险）
- **修复成本**: 低
- **建议方案**: 重构成
  ```python
  report_package.trace = state.get("agent_trace", []) + [trace_entry]
  return {"agent_trace": [trace_entry], "report_package": {...report_package, trace}}
  ```
  明确隔离两个用途。或在 line 225 加注释"DO NOT return full_trace from this function — see state.py audit 2026-06-29"

### 2.3 [新发现·中] `lib/pipeline/session-store.ts` 同步 fs 在 polling 高频路径
- **位置**: `/workspace/me/attrax/lib/pipeline/session-store.ts:185-203` (`persistSession`)；调用方 `/workspace/me/attrax/lib/pipeline/scan.ts:160, 166, 172, 252, 256, 277, 283, 451`
- **现状**:
  - 每次 `updateSession()` 触发同步 `writeJsonAtomic` + 3 次 `renameSync` 失败重试
  - 扫描期间多次调用
  - 但 `scan.ts` 本身是死代码
  - **实际生产路径**已经走 RAG v1 API，但前端还有 `app/api/scan/[sessionId]/route.ts` 走 `lib/rag-client/v1-adapter.getScan`（GET 路径不写）
  - 生产写入主要来自 `createScan` 的响应，频率不高
- **影响**: 低（仅死代码路径；v1 路径不再 fs 写入 session）
- **修复成本**: 低
- **建议方案**: 随 1.1 一起删

### 2.4 [CLAUDE.md 已记录·低] FAISS meta 分片加载已修但原 95MB 文件仍存在
- **位置**: CLAUDE.md L380 + `rag_service/retrieval/faiss_retriever.py:FaissRetriever.split_meta_to_shards`
- **现状**:
  - 已分片 50 个 ~3MB，加载器自动识别
  - 但**原 95MB 文件作为 fallback 仍存在**
  - 冷启动若识别失败仍会一次性加载
- **影响**: 低（fallback 路径）
- **修复成本**: 低
- **建议方案**:
  1. 验证 fallback 仅在 `legal_chunks_meta_shards/` 不存在时才触发，否则直接报错
  2. 移除原 95MB 文件需运维审批

### 2.5 [新发现·中] `app/result/[sessionId]/page.tsx` 1200 行（超大客户端组件）
- **位置**: `/workspace/me/attrax/app/result/[sessionId]/page.tsx` (1200 行, "use client")
- **现状**:
  - 单文件超 CLAUDE.md L271 的 800 行阈值三倍
  - 含"扫描结果视图模型合成 + 渲染 + i18n + 下载按钮"
  - CLAUDE.md 提到已"956 → 261 行（-73%）"，但显然又增长回去
- **影响**: 中（客户端 bundle 体积 + 维护负担 + hydration 阻塞）
- **修复成本**: 中
- **建议方案**:
  1. 抽离 `scanResultToComplianceView()` 到 `lib/pipeline/report-package.ts` 或新文件 `lib/result-adapters/scan-to-compliance.ts`
  2. 下载/下载集成按钮移到独立 client component
  3. 把视图模型拆为多个 memo 子组件

### 2.6 [新发现·低] `lib/i18n/translations.ts` 775 行硬编码字典
- **位置**: `/workspace/me/attrax/lib/i18n/translations.ts`
- **现状**: zh + en 静态字典放单文件，超过 800 行阈值就触发违规。`scripts/check_i18n_consistency.py` 已对账
- **影响**: 低
- **修复成本**: 低
- **建议方案**: 按 namespace 拆分（`translations/common.ts`、`home.ts`、`upload.ts` 等）

### 2.7 [新发现·低] `application/scans.py:621` `_normalize_result` 一次解析大量字典
- **位置**: `/workspace/me/attrax/rag_service/application/scans.py:527-621`
- **现状**: 函数 95 行（超 50 行阈值）；内嵌 `_camelize` 递归 + 多种 `_nested` 调用
- **影响**: 低
- **修复成本**: 低
- **建议方案**: 把 hard reasons / warnings 拆出 `_collect_hard_reasons` 和 `_collect_warnings` 子函数

---

## 维度 3 · 安全性 / 鉴权

### 3.1 [CLAUDE.md P0-6 已记录·低] RAG_INTERNAL_SECRET fail-closed 已修
- **位置**: `rag_service/main.py:_enforce_secret_policy`
- **现状**: 生产空 secret 拒绝启动；非 prod 自动生成 ephemeral secret。已修
- **建议**: 保持现状；E2E 测试覆盖应监控（`tests/e2e/api-integration.spec.ts`）

### 3.2 [CLAUDE.md 已记录·低] Bearer token 仅从 Authorization 读
- **位置**: `/workspace/me/attrax/lib/pipeline/session-auth.ts:21-30`
- **现状**: 仅 `Bearer` header；查询字符串 token 显式禁止。`tests/unit/session-auth.test.ts` 有回归测试。已合规

### 3.3 [新发现·中] `rag_service/api/v1.py` 路径白名单缺失
- **位置**: `/workspace/me/attrax/rag_service/api/v1.py:39-54`
- **现状**:
  - `_IMAGE_TYPES`、`_DOCUMENT_TYPES` 白名单仅做 mime 校验，**但没有限制文件扩展名的白名单字符集**
  - `_SESSION_ID` 用正则 `^scan_[A-Za-z0-9_-]{1,64}$` 防注入（已做）
  - `_id` 在 `file_backend.py:54` 用 `^[A-Za-z0-9_-]+$` 全名校验过，路径遍历已防
- **影响**: 中（已校验；但 ALLOWED_MARKETS 与后端 `_ALLOWED_MARKETS` 在 `application/scans.py:22` 和 `main.py:_enforce_secret_policy` 重复）
- **修复成本**: 低
- **建议方案**:
  - 提取常量 `_ALLOWED_MARKETS = {"EU","US","UK","CN","AU","SA","AE","JP"}` 到 `config.py`
  - 消除三处重复（`scans.py:22`、`v1.py:39`、`app/api/scan/route.ts:26`）

### 3.4 [新发现·中] `app/api/scan/route.ts` 非 prod 下 accessToken 通过 JSON 返回
- **位置**: `/workspace/me/attrax/app/api/scan/route.ts:218-220`
- **现状**:
  - `if (process.env.NODE_ENV !== "production") payload.accessToken = created.accessToken;`
  - dev/staging 把 token 写进响应体，可能被误部署到 prod
  - **生产安全**，但 `NODE_ENV` 在 K8s/Docker 镜像可能不是 `production`，需要更严格条件
- **影响**: 中（生产误配会导致 token 经响应体泄露）
- **修复成本**: 低
- **建议方案**:
  ```typescript
  if (process.env.ATTRAX_DEBUG_TOKEN === "1") payload.accessToken = created.accessToken;
  ```
  显式 opt-in；或仅在 `process.env.VERCEL_ENV !== "production"`

### 3.5 [CLAUDE.md P1-6 已记录·低] middleware.ts `RATE_LIMIT_TRUST_XFF` 默认关闭
- **位置**: `/workspace/me/attrax/lib/rate-limit.ts:58-61`
- **现状**: 默认 `false`，多维指纹降级到 UA+accept-language+accept-encoding 哈希。已合规

### 3.6 [新发现·低] CORS 白名单默认值仅 localhost
- **位置**: `/workspace/me/attrax/rag_service/config.py:64-69`
- **现状**: `RAG_ALLOWED_ORIGINS` 默认 `http://localhost:3000,http://127.0.0.1:3000`。生产需手动设
- **影响**: 中（部署时漏设会让前端跨域失败但不会泄露数据）
- **修复成本**: 低
- **建议方案**: 部署脚本（`scripts/deploy.sh`）强校验 prod env 含此变量，缺则 fail

### 3.7 [新发现·中] CSP `'unsafe-inline'` for scripts/styles 始终开启
- **位置**: `/workspace/me/attrax/middleware.ts:23-24`
- **现状**:
  - `script-src 'self' 'unsafe-inline'` + `style-src 'self' 'unsafe-inline'`
  - 始终放开 inline script/style，与注释"生产保持严格,不加 'unsafe-eval'"自相矛盾
  - unsafe-eval 是额外加，但 unsafe-inline 已常驻
- **影响**: 中（XSS 风险面扩大）
- **修复成本**: 中（迁移到 nonce/hash 需要所有 inline 脚本走 `next/script` + nonce API）
- **建议方案**: 引入 nonce 化 CSP（Next.js 16 支持 `useServerActions`），分阶段去掉 `'unsafe-inline'`

### 3.8 [新发现·低] `app/api/scan/route.ts` FormData entry name 大小未单独限制
- **位置**: `/workspace/me/attrax/app/api/scan/route.ts:111-112`
- **现状**:
  - `formData.getAll("images").filter(isFile)` 假设所有上传都是 file
  - 客户端 `category`/`markets`/`query` 用 `String(formData.get(...))` 转
  - **没有限制 `images` 字段同名 entry 总大小**
  - content-length 已限制 50MB（line 94），防护足够
- **影响**: 低（已防）
- **修复成本**: 低
- **建议方案**: 保持现状

### 3.9 [新发现·中] `lib/pipeline/scan.ts` demo 模式 `result: { source: "fallback" }` 易给真实用户呈现假成功
- **位置**: `/workspace/me/attrax/lib/pipeline/scan.ts:252-265`
- **现状**:
  - rag 不可用时 `updateSession({ status: "degraded", degradedReason: errorCode, progress: 100, result: createMockComplianceReportResult() })`
  - 把 mock 数据塞进 result
  - CLAUDE.md P0-1 已加 `DegradedBanner`，但 1.3 已发现 `DegradedBanner` 没被渲染
- **影响**: 中（CLAUDE.md 说修了，但实际渲染层缺失）
- **修复成本**: 低（解决 1.3 后自动消失）

---

## 维度 4 · 测试覆盖率

### 4.1 [现状·低] 端到端覆盖相对充分
- **位置**:
  - `/workspace/me/attrax/tests/unit/` (67 个测试文件)
  - `tests/e2e/` (8 个 spec 文件)
  - `rag_service/tests/` (46 个 pytest 文件)
- **现状**: 前端 vitest 67 个 + Playwright 8 个 + pytest 46 个 = ~120 个测试文件。CLAUDE.md 提到 pytest 327/328 通过 + 1 pre-existing failure
- **建议**: 加 `tests/unit/result-page-degraded-banner.test.tsx`（验证 3.9 / 1.3 修复）

### 4.2 [新发现·中] `compliance.ts` / `decision.ts` / `roadmap.ts` export 模块无 vitest 覆盖
- **位置**:
  - `/workspace/me/attrax/lib/report-export-modules/compliance.ts`
  - `decision.ts`
  - `roadmap.ts`
- **现状**:
  - 仅有 `tests/unit/report-export-shared.test.ts`、`report-export.test.ts`、`profit-report-structured-fields.test.ts` 间接覆盖
  - 没有针对 `compliance.ts`/`decision.ts`/`roadmap.ts` 渲染产物的快照测试
  - 导出 PDF/DOCX 是付费用户关键功能
- **影响**: 中
- **修复成本**: 中（PDF/DOCX 渲染断言需要解析二进制）
- **建议方案**: 加 `tests/unit/export-compliance-snapshot.test.ts`，验证 markdown → PDF 文本提取与固定 fixture 字符串匹配

### 4.3 [新发现·中] `profit-report.ts` / `report-package.ts` 关键合成逻辑覆盖不足
- **位置**:
  - `/workspace/me/attrax/lib/pipeline/profit-report.ts` (813 行)
  - `report-package.ts`
- **现状**:
  - `profit-report.test.ts`、`profit-report-structured-fields.test.ts`、`profit-report-synthesized-finance.test.ts`、`profit-report-view.test.tsx`、`profit-render-model.test.ts`、`reporting-real-profit.test.ts` 覆盖一些
  - `synthesizeFinancialSummaryIfMissing`（`profit-report.ts`）/ `normalizeReportPackage` 边界用例不全
- **影响**: 中
- **修复成本**: 低
- **建议方案**: 补 `tests/unit/profit-report-fallback-edge.test.ts`（覆盖：原 package 缺失 `profitReport`/`markdown` 字段 / 空字符串 / 中文 unicode 字符）

### 4.4 [新发现·低] `lib/pipeline/upload-validation.ts` 边界用例可能不够
- **位置**: `/workspace/me/attrax/lib/upload-validation.ts`
- **现状**: 仅 `tests/unit/upload-validation.test.ts`；PNG/JPEG/WebP 魔术字节 + 文件大小限制已覆盖
- **建议**: 加 polyglot file attack 测试（一个声称 `image/jpeg` 但头是 PDF 字节）

### 4.5 [新发现·中] `rag_service/api/v1.py` zip bomb / DOCX zip bomb 测试
- **位置**: `/workspace/me/attrax/rag_service/api/v1.py:36-38`
- **现状**:
  - `MAX_DOCX_EXPANDED_SIZE = 50MB`、`MAX_DOCX_MEMBERS = 500` 等限额已设
  - 但 `test_api_v1.py` 是否覆盖 zip bomb 攻击不清楚
- **影响**: 中（DOCX 是 zip，可膨胀）
- **修复成本**: 低
- **建议方案**: 加 `tests/test_zip_bomb_docx.py`，构造一个解压率 1:1000 的恶意 DOCX

### 4.6 [新发现·低] `lib/pipeline/scan-queue.ts` 测试覆盖了 dead code
- **位置**: `/workspace/me/attrax/tests/unit/scan-queue.test.ts`
- **现状**: 467 行的 dead code 有完整测试
- **建议**: 跟随 1.1 删除

### 4.7 [新发现·低] 压力测试仅 smoke/load 两档
- **位置**: `/workspace/me/attrax/tests/pressure/` (3 个脚本)
- **现状**: `package.json` 提供 `npm run test:pressure` 和 `test:pressure:load`；未在 CI 强制运行
- **建议**: CI 在 nightly job 跑 `test:pressure:load`，防止 7-18 事故重现

---

## 维度 5 · 代码质量

### 5.1 [新发现·中] 函数 > 50 行、文件 > 800 行违规清单
- **超过 800 行的 TS 文件**:
  - `app/result/[sessionId]/page.tsx` (1200) ⚠️ 见 2.5
  - `lib/rag-client/types.gen.ts` (1144, 自动生成, OK)
  - `app/api/regulations/updates/data.ts` (1020) ⚠️ 见 1.8
  - `app/upload/page.tsx` (916)
  - `lib/mock/scan-result.ts` (874)
  - `lib/pipeline/profit-report.ts` (813) ⚠️ 见 4.3
  - `lib/i18n/translations.ts` (775)
- **超过 800 行的 Python 文件**:
  - `rag_service/generate/report_generator.py` (959)
  - `rag_service/main.py` (872)
  - `rag_service/application/scans.py` (621, 主函数 `_normalize_result` 95 行) ⚠️ 见 2.7
  - `rag_service/tests/test_graph_e2e.py` (467, 测试 OK)
- **超过 50 行的函数**:
  - `application/scans.py:_normalize_result` (95 行)
  - `application/scans.py:_build_runner_payload` (50 行)
  - `main.py:_run_scan_request` (90+ 行)
  - `main.py:profit_report` (handler 60+ 行)
- **影响**: 中（违反项目自己的约定）
- **修复成本**: 中
- **建议方案**:
  1. 配合 1.1 删 `scan.ts`/`scan-queue.ts`
  2. 拆分 `app/result/[sessionId]/page.tsx`（见 2.5）
  3. 把 `application/scans.py:_normalize_result` 拆 4 个子函数（见 2.7）

### 5.2 [现状·低] 不可变模式（CLAUDE.md CRITICAL）执行情况
- **位置**: `lib/pipeline/session-store.ts:updateSession` 已严格遵守（`{ ...current, ...patchWithoutHash, accessTokenHash: current.accessTokenHash }`）
- **现状**: 大部分遵守；但 `lib/pipeline/scan.ts:294` `const reportPackage = normalizeReportPackage(...)` 看起来 OK。`application/scans.py:_camelize` 递归返回新 dict，正确
- **建议**: 用 ESLint `no-param-reassign` 或 `functional/immutable-data` 规则机械保证

### 5.3 [现状·低] Zod Schema 验证执行情况
- **位置**: `lib/schemas.ts` (234 行)、`app/api/scan/route.ts` (手工 `parseMarkets`/`buildQuery`)
- **现状**: 多个 schema 已定义；但 `app/api/scan/route.ts:46-70` 的 `parseMarkets()` 没有走 Zod，直接 split + filter 校验
- **影响**: 低（手工校验与 schema 重复）
- **修复成本**: 低
- **建议方案**: 用 Zod schema 替换手工校验：`z.array(MarketSchema).min(1).max(5)`

### 5.4 [新发现·中] 错误处理一致性
- **位置**: 全代码库
- **现状**:
  - `try { ... } catch { return null }` 模式出现 ~10 处（`hybrid_retriever.py:209`、`main.py:40` 等）
  - `console.warn` / `console.error` 128 次 / 24 次，前端日志格式不统一
  - Python `logger.error`/`logger.warning` 24 处
- **影响**: 中（监控时难以聚合）
- **修复成本**: 低
- **建议方案**: 用集中 logger 包装：`logger.scan({ sessionId, stage, error })`；统一 JSON 结构供日志聚合（`middleware.ts:emitSafeRequestLog` 已示范）

### 5.5 [新发现·中] 重复代码 / 可抽取的公共模式
- **位置**:
  - `_ALLOWED_MARKETS` 在 `application/scans.py:22`、`rag_service/api/v1.py:39`、`app/api/scan/route.ts:26` 重复三次
  - `MAX_MARKETS_PER_SCAN=5` / `MAX_MARKETS=5` 重复
  - 图片魔术字节校验 `main.py:_validate_image_upload` 与 `v1.py:_IMAGE_TYPES` 重复
- **影响**: 中（修改一处需同步 3 处）
- **修复成本**: 低
- **建议方案**: 抽 `rag_service/constants.py` 与前端 `lib/constants.ts` 同步生成

### 5.6 [新发现·低] TypeScript `as` 类型断言泛滥
- **位置**: `lib/pipeline/scan.ts:74` + `as Parameters<typeof updateSession>[1]["result"]` (line 460) 是 `as` 强转
- **影响**: 低
- **修复成本**: 低
- **建议方案**: 把 `updateSession` 的参数类型 `Patch` 抽出，避免行内 `as` 断言

---

## 维度 6 · 文档 / DevOps

### 6.1 [新发现·高] CLAUDE.md / README.md / PROJECT_ANALYSIS.md 描述的架构与代码不一致
- **位置**: 多处
- **现状**:
  - CLAUDE.md L127-148 目录树仍列出 `lib/pipeline/scan.ts` + `scan-queue.ts` 为现行
  - CLAUDE.md L78-88 流程图描述前端 → `/api/scan` → `lib/pipeline/scan-queue.ts → scan.ts`，实际走 `lib/rag-client/v1-adapter.ts → RAG /api/v1/scans`
  - CLAUDE.md L171-172 / README L364-365 / RAG-ARCHITECTURE-v3.md L112 说 `cohere_reranker.py` "存在"，实际不存在
  - CLAUDE.md L176 称 `rag_service/regulation_collectors/` 含 `base/eu_rdf/powershell_fetcher`，但实际是 `__init__.py/base.py/eu_rdf.py/powershell_fetcher.py`（一致）；无问题
- **影响**: 高（误导新人 + 决策基于错误信息）
- **修复成本**: 低（文档改写）
- **建议方案**:
  1. 一次性同步三份文档
  2. CLAUDE.md 加一段"当前生产路径 vs 旧路径"明示

### 6.2 [新发现·低] `PROJECT_ANALYSIS.md:145` 列待办但实际已完成
- **位置**: `/workspace/me/attrax/PROJECT_ANALYSIS.md`
- **现状**:
  - "删 cohere_embedder/local_embedder 死代码" / "UploadForm URL 缓存" 等条目对照表中 `✓` 状态与代码不一致
  - 145 行说 cohere 删除 "✗ 未做（被引用）"，但文件实际不存在
- **建议**: 项目审计后清空此文档（一次性文档，过期了）

### 6.3 [CLAUDE.md 已记录·低] `docs/SERVER-VERSION.md` 跟踪落后
- **位置**: CLAUDE.md + CHANGELOG.md L13-15
- **现状**: 2026-07-20 → 2026-08-10 12 个 commit 漏写 CHANGELOG。已通过 566c4ae commit 补登
- **建议**: 加 CI 强制检查：`scripts/preflight-deploy.mjs` 部署前要求 CHANGELOG.md 同步更新

### 6.4 [新发现·中] monitoring / logging / observability 缺口
- **位置**: 全代码库
- **现状**:
  - 没有 metrics 端点（Prometheus `/metrics`）；`/health` 已最小化但 `/ready` 是 k8s liveness，不是 metrics
  - `dense_dim_mismatch_count` 暴露在 `/health`（privileged）但**没有导出为 metric**
  - 没有 tracing；`X-Request-Id` 在 middleware 加但未贯穿 RAG 服务
  - `agent_trace` 已是结构化 trace 但**未导出 OpenTelemetry**
- **影响**: 中（生产事故定位仍依赖 grep 日志，2026-07-18 事故后已部分改进）
- **修复成本**: 高
- **建议方案**:
  - 加 `prometheus_client` 或 `opentelemetry` 在 RAG 服务
  - FAISS load time / BM25 build time / LLM call count 都应暴露

### 6.5 [新发现·低] 部署脚本 `scripts/deploy.sh` 仅 85 字节
- **位置**: `/workspace/me/attrax/scripts/deploy.sh` (85 B), `scripts/deploy.ps1` (111 B), `scripts/deploy-now.sh` (3470 B)
- **现状**: `deploy.sh` 似乎只是 stub；真实部署走 `deploy-now.sh`（3470 B）或 `build-deploy-tarball.sh`
- **影响**: 低
- **修复成本**: 低
- **建议方案**: 把 `deploy.sh` 改为 `echo "Use deploy-now.sh or build-deploy-tarball.sh; deploy.sh deprecated"`，避免误用

### 6.6 [新发现·低] `start-all.bat` / `start-rag.bat` Windows 启动器
- **位置**: 根目录 `start-all.bat` (798 B)、`start-rag.bat` (1171 B)、`scripts/start_rag.bat` (1040 B)
- **现状**: 三个 Windows batch 脚本功能可能重复；CLAUDE.md 命令行章节推荐 `start-all.bat`
- **建议**: 合并到一个 `scripts/start-windows.bat`，删其他

---

## 维度 7 · 依赖管理

### 7.1 [新发现·低] `package-lock.json` 与 `package.json` 一致性
- **位置**: `/workspace/me/attrax/package-lock.json` (548580 B, ~7200 行)
- **现状**: 大概率一致（依赖未明显改动）。`overrides` 字段（esbuild, postcss, js-yaml, ws）已固定关键依赖
- **建议**: CI 加 `npm ci` 校验

### 7.2 [新发现·中] 过时的依赖
- **位置**: `package.json`
- **现状**:
  - `next@^16.2.6` / `react@19.2.4` 是最新
  - `lucide-react@^1.9.0` — 当前最新版是 0.4xx 系列（`^1.9.0` 范围可疑）
  - `@types/node@^20` 而非 `^22`（Node 22 是当前 LTS）
  - `eslint@^9` 是最新，`vitest@^4.1.5` 是最新
- **影响**: 中（`lucide-react@^1.9.0` 范围可疑，可能装了 dev 版本）
- **修复成本**: 低
- **建议方案**: 跑 `npm outdated` 审计；确认 `lucide-react` 版本号意图

### 7.3 [新发现·中] 不必要的依赖（dev 依赖被 prod 安装）
- **位置**: `package.json:devDependencies`
- **现状**:
  - `pm2@^7.0.0` 在 devDependencies 但 `scripts/ecosystem.config.cjs` 走 prod pm2 运行
  - `playwright@^1.59.1` 是 E2E test 工具，应该 devDependencies（已正确）
  - `tsx@^4.21.0` 仅 CLI 用，应 dev
  - `openapi-typescript@^7.13.0` codegen 工具，应 dev
- **影响**: 低（已 dev）但 `pm2` 在 dev 装在 prod 容器里会引入无用依赖
- **修复成本**: 低
- **建议方案**: prod 部署用 `--omit=dev`；`Dockerfile` 已用 multi-stage 但需复核 `npm install` 阶段是否含 `devDependencies`

### 7.4 [新发现·中] 安全漏洞版本
- **位置**: `package.json`
- **现状**:
  - `next@^16.2.6` — 16 是最新版，需查 CVE
  - `jspdf@^4.2.1` — 已知 jspdf 早期版本有 XSS（CVE-2025-26791 等针对 jspdf；当前 4.2.x 应安全）
  - `mammoth@^1.12.0` 已不需（见 1.6）
  - `docx@^9.6.1` 较新，但 `docx` 库曾在 prototype pollution 漏洞
  - `sharp@^0.35.3` 不需（见 1.6）
- **建议**: 跑 `npm audit --production`；考虑 `pnpm audit` 或 `npm audit --json` 加到 CI

### 7.5 [CLAUDE.md 已记录·低] Python requirements 锁版本与 prod 不一致
- **位置**: `rag_service/requirements.txt` (563 行) vs `requirements-prod.txt` (62 行)
- **现状**: prod 文件已严格 pin；dev 文件膨胀
- **建议**: 7.1 配套删 dev 文件或改名为 snapshot

---

## 总体优先级排序（建议执行顺序）

| 顺序 | 编号 | 优先级 | 内容 |
|---|---|---|---|
| 1 | 1.1 | 极高 | 删/废弃 `scan.ts` + `scan-queue.ts` —— 删除 937 行死代码 |
| 2 | 1.3 + 3.9 | 高 | 让 `DegradedBanner` 在结果页真正渲染 —— P0-1 修复实际未闭环 |
| 3 | 6.1 | 高 | 同步 CLAUDE.md/README.md/PROJECT_ANALYSIS.md/RAG-ARCHITECTURE-v3.md 与实际代码 |
| 4 | 1.4 | 中 | 清理"cohere_reranker.py 存在"误导 + 删 requirements 中的 `cohere==6.1.0` |
| 5 | 1.2 | 中 | 删 `components/upload/UploadForm.tsx` + 相关测试 |
| 6 | 1.6 + 7.4 | 中 | 跑 `npm audit` + `depcheck`，删无用 prod 依赖 |
| 7 | 2.5 | 中 | 拆 `app/result/[sessionId]/page.tsx` 1200 行 |
| 8 | 5.1 + 5.5 | 中 | 抽 `_ALLOWED_MARKETS`/`MAX_MARKETS` 共享常量，消除三处复制 |
| 9 | 3.7 | 中 | 引入 nonce CSP |
| 10 | 4.2 + 4.3 | 中 | 补 export/profit-report 边界测试 |
| 11 | 2.2 | 中 | `generator.py:225` 维护陷阱加固 |
| 12 | 1.7 + 7.5 | 低 | 清理 dev requirements 文件 |
| 13 | 1.5 / 1.8 / 6.5 / 6.6 | 低 | 散点清理 |
| 14 | 2.1 / 6.4 | 高·长期 | 内存 + observability 投入 |

---

## 关键事实总结

### CLAUDE.md 已记录且仍在生效
P0-6 fail-closed、P1-6 多维限流指纹、FAISS HNSW 转换、agent_trace reducer 修复、cohere 未接入、requirements 冗余 — 全部已落地，本次扫描无新增

### CLAUDE.md 描述但实际未实现
- `cohere_reranker.py` / `cohere_embedder.py` 文件不存在
- `DegradedBanner` 组件定义但未被任何页面渲染
- CLAUDE.md "P0-1 红色 banner 修复"在生产渲染层未闭环

### 新发现重大问题
整个 `lib/pipeline/scan.ts` (470) + `scan-queue.ts` (467) = ~937 行被实际生产路径绕过，但有完整测试覆盖 + 文档反复描述为现行架构 — 最大的"文档/代码脱节"债务

### 新发现组件级死代码
`LegacyResultView`、`DegradedBanner`、`SourceNotice`（组件本身不渲染）

### 未使用 npm 依赖
`@google/generative-ai`、`@fingerprintjs/fingerprintjs`、`mammoth`、`sharp`、`openai`

### Python 后端实测
报告生成走 `urllib.request` 直连 minimax API，**未使用 anthropic SDK**（虽然 `requirements.txt` 列出 `anthropic` 等 SDK）

### 最大文件 / 函数违规
`app/result/[sessionId]/page.tsx` 1200 行（CLAUDE.md 800 行阈值 ×1.5）；`application/scans.py:_normalize_result` 95 行（50 行阈值 ×1.9）

---

## 参考

- `CLAUDE.md` — 项目配置和约定（2026-06-29 更新）
- `README.md` — 项目说明
- `PROJECT_ANALYSIS.md` — 项目分析（已过期）
- `RAG-ARCHITECTURE-v3.md` — RAG 架构
- `docs/plans/ATTRAX_REMEDIATION_PLAN_2026-06-18.md` — 上一次审计后的修复路线图
- `docs/plans/2026-05-23-full-remediation-design.md` — 5 月份的修复设计

---

*报告生成时间: 2026-09-09*
*扫描方式: 只读系统性代码扫描（grep + read）*
*未做任何修改*