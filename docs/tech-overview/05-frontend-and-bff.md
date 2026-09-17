# 05 · 前端与 BFF（Next.js）

## 核心要点（30 秒读完）

- **栈**：Next.js 16.2.6 standalone + React 19 + TypeScript strict；前端 + BFF 都在 Next.js（`app/`、`components/`、`lib/`）。
- **BFF**：浏览器永远走 Next.js `/api/scan/*`，再由 BFF 转发到 RAG 8001；不直接走 8001（避免 CORS 暴露）。
- **限流双层**：nginx 10 r/s + BFF 10 / 60s（差 60 倍）；BFF 是真实成本控制。BFF `clientId` 取 `X-Real-IP`（nginx `proxy_set_header` 覆盖），XFF 默认不信任。
- **会话鉴权**：32-byte random token → SHA-256 hash 落盘，HttpOnly cookie + `Authorization: Bearer` 双轨，URL 不带 `?token=`；`sessionId` 校验 `^scan_[A-Za-z0-9_-]{1,64}$`。
- **结果页**：4 个内联面板（ComplianceReportView / InspectionChecklistPanel / AgentTraceView / DownloadButtons + EvidenceRequestPanel）+ J10 补充证据 / 重扫流程。
- **下载**：md / csv 走服务端 `/api/report/[sessionId]/[reportType]`；PDF / DOCX 客户端 jsPDF + Packer，无服务端依赖。
- **OpenAPI 契约门控**：CI 双门控（`check:rag-contract` + `check:rag-openapi`），前端 `types.gen.ts` 与 RAG 真实路由必须保持一致。

> 数据快照：2026-09-17。Next.js 16.2.6 + React 19 + TypeScript strict。Standalone 构建产物由 nginx 在 443 反代到 127.0.0.1:3000。浏览器从不直连 RAG 8001。

## 组件图

```
Browser
  │
  ├── /                          首页（i18n + Hero + CTA）
  ├── /upload                    上传页（图片 + 类别 + 市场 + 文档）
  ├── /burning/[sessionId]       扫描中动画页（轮询 progress）
  ├── /result/[sessionId]        结果页（合规 + 利润 + 决策 + 路线图 + 引用证据）
  │     ├── 利润独立链接 /profit/[sessionId]
  │     └── 决策 / 路线图 / 利润 都在结果页内联面板
  ├── /pricing                   商业方案
  ├── /regulations               法规更新列表
  └── /api/*                     BFF（同源，无 CORS 暴露）
        │
        ▼
app/api/scan/route.ts        POST   创建扫描（cookie 移交）
app/api/scan/[sessionId]/route.ts
                              GET    轮询
app/api/scan/[sessionId]/evidence/route.ts
                              POST   补充证据（J10）
app/api/scan/[sessionId]/revisions/route.ts
                              POST   重扫（J10）
app/api/regulations/updates/route.ts
                              GET    法规更新列表
app/api/regulations/[docId]/route.ts
                              GET    单条法规原文
app/api/health/route.ts
                              GET    健康
app/api/report/[sessionId]/[reportType]/route.ts
                              GET    md / csv 文本导出
```

## BFF 关键代码

### `app/api/scan/route.ts`（POST 创建扫描）

`lib/rate-limit.ts:checkRateLimit('scan:${clientId}', 10, 60_000)`：

- 固定窗口 60s，10 次 / client。`resetAt` 绝对时间戳（不是滑动窗口）。
- `clientId` 优先取 `X-Real-IP`（nginx `proxy_set_header X-Real-IP $remote_addr`），哈希后入桶；XFF 默认不信任（`$proxy_add_x_forwarded_for` 会把客户端给的 spoofed 值附加，leftmost 不可信），开关 `RATE_LIMIT_TRUST_XFF=true` 才接受 XFF。
- 存储不可用 → 降级到进程内 Map（`globalThis.__rateLimitBuckets`），同窗口、同 key，仅失去跨重启持久化；既不静默放行也不全站 429。
- 单进程假设：pm2 fork 模式 + 未设 `instances`，文件锁/进程内锁等价；将来扩到多实例要重新引入跨进程锁（注释里写明）。

`lib/pipeline/session-auth.ts`：会话 token 32-byte base64url，SHA-256 hash 存盘，`timingSafeEqual` 常量时间比对。Bearer + HttpOnly cookie 双轨；URL 上不带 `?token=`。

请求 → RAG `/api/v1/scans`（multipart），把 `accessToken` 通过 `Set-Cookie: attrax_scan=...; HttpOnly; Secure; SameSite=Lax` 下发，响应 body 也回 `accessToken`（`ATTRAX_DEBUG_TOKEN=1` 时）。

### `app/api/scan/[sessionId]/route.ts`（GET 轮询）

校验 `sessionId`（`^scan_[0-9A-Za-z_-]{1,50}$`，Zod）；取 cookie 或 Bearer，调 RAG `/api/v1/scans/{id}`；结果经 `lib/rag-client/v1-result-adapter.ts:normalizeV1ScanResult` 映射成前端需要字段。

### 补充证据 / 重扫（J10）

`app/api/scan/[sessionId]/evidence/route.ts`：multipart 上传图片 / 文档 → RAG `POST /api/v1/scans/{id}/evidence`（带 `idempotency_key`，同 key 重发得 `already_applied`）。

`app/api/scan/[sessionId]/revisions/route.ts`：JSON body `{ idempotencyKey }` → RAG `POST /api/v1/scans/{id}/revisions`，返回 `{ status: queued, revision, jobId }`。前端继续轮询 GET 看新 revision 出现。

## RAG v1 客户端（`lib/rag-client/v1-adapter.ts`）

唯一的 RAG HTTP 封装（旧的 `rag-client/client.ts` 已删）。函数清单：

- `createScan(input: StartScanRequest): Promise<CreatedScan>`
- `getScan(sessionId: string): Promise<ScanResult>`
- `appendEvidence(sessionId, files, idempotencyKey)`
- `requestRevision(sessionId, idempotencyKey)`

`RAG_SERVICE_URL`（默认 `http://localhost:8001`）通过 Next.js `process.env` 暴露。所有请求带 Bearer token；请求体 / 响应都走统一的 `{ data, error, meta }` 信封（`lib/api-response.ts:ok/fail/unwrapApiData`）。

OpenAPI 契约快照（`lib/rag-client/openapi.snapshot.json`）由 FastAPI app 对象直接导出（`scripts/check-rag-openapi-drift.mjs` 校验快照 vs 真实路由）。前端 `lib/rag-client/types.gen.ts` 从快照生成。两个门控：

- `check:rag-contract`（`frontend` job）：types.gen.ts 与快照一致。
- `check:rag-openapi`（`backend-unit` job）：快照 vs rag_service 真实路由。

## 关键页面

### `app/upload/page.tsx`

图片上传 + 类别下拉（10 个单数品类） + 市场多选（默认 EU/US）+ PDF / DOCX 附件。提交即 `createScan()`，拿到 `sessionId` + accessToken 后跳 `/burning/{sessionId}`。

### `app/burning/[sessionId]/page.tsx`

轮询 hook `lib/hooks/useScanPolling.ts`，递增 backoff（800ms → 4s，最长 5 分钟），5 分钟到点给「still processing」按钮。

阶段进度从 `agent_trace` 与 progress 字段渲染；动画全部走 CSS（`framer-motion` 已删，依赖 `tw-animate-css`）。

### `app/result/[sessionId]/page.tsx`

四个内联面板：

1. **ComplianceReportView**：扫描结果主视图，含 riskFindings、decisionView、citation chips（带 match_status 颜色）。
2. **InspectionChecklistPanel**：视觉检查清单，hazard「已观察 / 需补拍 / 已确认」三态 badge（2026-09-15 P0 修复：hazard+0 findings 不再无条件显示绿色「已观察」，按 visibility 区分）。
3. **AgentTraceView**：从 `report_package.agentTrace` 内联渲染（已废弃独立 `/trace` 端点）。
4. **DownloadButtons + EvidenceRequestPanel**：导出 md / pdf / docx（jspdf + docx 客户端打包）+ J10 补充证据 UI。

统一 ViewModel：`lib/result/inspection-view-model.ts:buildInspectionResultViewModel`，负责 finding↔observation↔image 真实 join + 引用去重 + 产品名 fallback + evidence request 合并。

### `app/regulations/page.tsx`

法规更新列表（`GET /api/regulations/updates`） + 跳转 `/regulations/[docId]`。

`app/regulations/[docId]/page.tsx`：DocViewer 拉 `/api/v1/regulations/{doc_id}`，按 `human_view_url` 提供跳转；private_with_summary 法规只显示 metadata + key_points + purchase_url。

## i18n

- `lib/i18n.tsx`：`BlazeLocaleProvider`（`components/blaze-hawks/`）作为 locale 真值源；`useTranslation()` hook 从 `translations.ts` 取字段。
- 中英双语（zh / en），URL 前缀 `[locale]/` 切换；不写死字符串到组件，统一从文案表读。

## 文件上传安全

`lib/upload-validation.ts`：

- MIME + 文件扩展名双重校验（白名单）。
- magic bytes：JPEG `FF D8 FF`、PNG `89 50 4E 47`、WEBP `RIFF....WEBP`、PDF `%PDF`、DOCX `PK 03 04` / `PK 05 06`。
- 大小上限：图片 10MB / PDF 15MB / DOCX 15MB / 总 50MB。

## 错误响应（统一信封）

```json
{ "success": false, "error": { "code": "BAD_INPUT", "message": "..." } }
```

错误码（取自 `docs/FRONTEND-BACKEND-INTEGRATION.md §4`）：

| code | 来源 | 含义 |
|---|---|---|
| `INVALID_REQUEST` | v1 / BFF | 请求体 schema 错误 |
| `INVALID_FILE_TYPE` / `INVALID_FILE_SIGNATURE` | v1 / BFF | 文件类型 / magic bytes 校验失败 |
| `INVALID_DOCX_ARCHIVE` | v1（`append_evidence`） | DOCX zip 头无效 |
| `IMAGE_REQUIRED` / `TOO_MANY_IMAGES` / `TOO_MANY_DOCUMENTS` | v1 | 数量上限 |
| `FILE_TOO_LARGE` / `REQUEST_TOO_LARGE` / `BAD_CONTENT_LENGTH` | v1 / BFF | 大小 / chunked 编码问题 |
| `INVALID_CATEGORY` / `INVALID_MARKETS` | BFF | 不在 `MARKET_IDS` allow-list |
| `RATE_LIMITED` | BFF | 60s 内 ≥10 次 |
| `CROSS_ORIGIN_FORBIDDEN` | BFF | Origin 不在白名单 |
| `UNAUTHORIZED` / `NOT_FOUND` / `NOT_READY` | v1 / BFF | 鉴权 / 状态 |
| `SCAN_QUEUE_UNAVAILABLE` / `SCAN_SERVICE_UNAVAILABLE` | v1 / BFF | rag-service 不可达 |
| `DEMO_MODE_REQUIRED` | BFF | demo 模式下访问需要 API Key 的端点 |

## 报告导出

- md / csv：`GET /api/report/[sessionId]/[reportType]` 走服务端组装（合规 / 利润 / 决策 / 路线图 / evidence-pack）。
- PDF / DOCX：客户端 jsPDF + Packer 打包（`lib/report-export-modules/`），无服务端依赖。
- 「点击下载」入口都在 `components/result/DownloadButtons.tsx`。

## 中间件（`middleware.ts`）

简单重写 / 安全 header，目前未做 CSP nonce（已评估为暂缓，详见 `attrax/docs/plans/2026-09-09-optimization-audit.md §3.7` 与仓库 `CLAUDE.md §部署雷区`：全站 SSG 化前 nonce 化会让部分页 500）。

## 关键文件清单

- [`app/`](file:///workspace/me/attrax/app)：App Router 页面与 BFF 路由。
- [`components/result/`](file:///workspace/me/attrax/components/result)：结果页组件。
- [`components/regulation/`](file:///workspace/me/attrax/components/regulation)：CitationChip / DocViewer / LinkBackToReport。
- [`components/blaze-hawks/BlazeLocaleProvider.tsx`](file:///workspace/me/attrax/components/blaze-hawks)：locale 真值源。
- [`lib/rag-client/v1-adapter.ts`](file:///workspace/me/attrax/lib/rag-client/v1-adapter.ts)：唯一的 RAG HTTP 封装。
- [`lib/rate-limit.ts`](file:///workspace/me/attrax/lib/rate-limit.ts)：BFF 单进程固定窗口限流。
- [`lib/pipeline/session-auth.ts`](file:///workspace/me/attrax/lib/pipeline/session-auth.ts)：会话 token（哈希 + 常量时间比对）。
- [`lib/result/inspection-view-model.ts`](file:///workspace/me/attrax/lib/result/inspection-view-model.ts)：结果页统一 ViewModel。
- [`lib/upload-validation.ts`](file:///workspace/me/attrax/lib/upload-validation.ts)：MIME + magic bytes + 大小校验。
- [`lib/report-export-modules/`](file:///workspace/me/attrax/lib/report-export-modules)：报告导出（PDF/DOCX 客户端、md/csv BFF）。
- [`lib/types.ts`](file:///workspace/me/attrax/lib/types.ts)：共享类型 + `PRODUCT_CATEGORIES` / `MARKET_IDS` 白名单（scan 请求校验内联在 `app/api/scan/route.ts` 的 `ALLOWED_MARKETS` / `ALLOWED_CATEGORIES` Set）。
- [`docs/FRONTEND-BACKEND-INTEGRATION.md`](file:///workspace/me/attrax/docs/FRONTEND-BACKEND-INTEGRATION.md)：现行 API 契约（推荐阅读）。