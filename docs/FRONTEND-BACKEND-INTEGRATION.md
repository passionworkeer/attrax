# Attrax 独立后端接入手册

这份文档是新前端接入的唯一入口。新前端只依赖 FastAPI 的 `/api/v1` 和 `/openapi.json`，不需要复制 `app/api`、`lib/pipeline`、Next.js middleware 或任何旧前端代码。

## 1. 服务地址与启动

本地默认地址：`http://localhost:8001`。

```powershell
# 仅启动独立后端（推荐联调方式）
$env:DEMO_MODE='true'
$env:ATTRAX_RUNTIME_DIR='./data/backend'
python -m uvicorn rag_service.main:app --host 127.0.0.1 --port 8001

# 或使用容器；旧 Next.js web 服务不是必需项
docker compose up -d rag-service
```

生产环境必须设置真实的 `MINIMAX_API_KEY`、`RAG_INTERNAL_SECRET` 和新前端的 `RAG_ALLOWED_ORIGINS`（embedding 已随 de-RAG 删除，无需 PAI/ModelScope key）。运行状态持久化在 `ATTRAX_RUNTIME_DIR`；Compose 默认映射为宿主机 `./data/backend`。

## 2. 唯一公开流程

### 2.1 创建扫描

`POST /api/v1/scans`，请求类型为 `multipart/form-data`。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | string | 是 | 用户的合规问题，最长 2,000 字符 |
| `product` | string | 否 | 产品名称或型号 |
| `category` | string | 是 | 产品分类，默认 `electronics` |
| `markets` | string | 是 | JSON 数组字符串或逗号分隔，如 `["EU","US"]` |
| `images` | File[] | 是 | 1–8 个 JPEG/PNG/WebP |
| `documents` | File[] | 否 | 最多 5 个 PDF/DOCX/TXT/HTML |

```bash
curl -X POST http://localhost:8001/api/v1/scans \
  -F 'query=检查该充电器出口欧盟和美国的合规要求' \
  -F 'product=USB Charger' \
  -F 'category=electronics' \
  -F 'markets=["EU","US"]' \
  -F 'images=@front.png;type=image/png' \
  -F 'documents=@manual.pdf;type=application/pdf'
```

成功返回 `202`：

```json
{
  "data": {
    "sessionId": "scan_...",
    "accessToken": "...",
    "status": "processing",
    "pollUrl": "/api/v1/scans/scan_..."
  },
  "error": null,
  "meta": { "requestId": "req_..." }
}
```

`accessToken` 只在创建时返回。前端应将它与 `sessionId` 一起保存在当前用户会话中，不得写日志、埋点或公开 URL。

### 2.2 查询状态与结果

```http
GET /api/v1/scans/{sessionId}
Authorization: Bearer <accessToken>
```

状态只有四种：

- `processing`：继续轮询。
- `ready`：真实 RAG 结果已经生成。
- `degraded`：显式演示或降级结果，不得在 UI 中伪装成真实完成。
- `failed`：任务失败，显示 `error` 并允许用户重新提交。

建议从 800 ms 开始轮询，逐步退避到 4 s，最长等待 5 分钟。最终业务字段均为 camelCase；前端直接读取 `result.reportPackage`、`result.agentTrace` 和结构化字段，不需要用正则解析 Markdown。

### 2.3 辅助结果与删除

以下接口使用相同 Bearer token：

- ~~`GET /api/v1/scans/{sessionId}/roadmap`~~ — ⚠️ **deprecated 2026-09-14 cleanup**：结果页已合并内联面板，roadmap 不再有前端消费者（`lib/rag-client/v1-adapter.ts` 不再导出 `getRoadmap`）。路由与 OpenAPI 类型保留以防生态工具生成器需要。
- ~~`GET /api/v1/scans/{sessionId}/trace`~~ — ⚠️ **deprecated 2026-09-14 cleanup**：同 roadmap。`AgentTraceView` 改成读 `result.reportPackage.agentTrace` 内联字段，不再走独立端点。
- `DELETE /api/v1/scans/{sessionId}`，成功为 `204`

探针无需 token：

- `GET /api/v1/health`：进程存活。
- `GET /api/v1/ready`：RAG、索引、配置及扫描服务是否可接流量。

### 2.4 补充证据 + 重扫（J10, 2026-09-14）

用户上传图后被要求补拍或补资料（plan §5.3 EvidenceRequest）时走这两条：

#### `POST /api/v1/scans/{sessionId}/evidence`

`multipart/form-data`，Bearer token。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `images` | File[] | 否 | 补拍的 JPEG/PNG/WebP |
| `documents` | File[] | 否 | 补的 PDF/DOCX/TXT/HTML |
| `idempotency_key` | string | 否 | 客户端生成（UUID），同 key 重发得到 `already_applied` |

返回 `202`：

```json
{
  "data": {
    "status": "stored",
    "storedCount": 3,
    "uploads": [{ "type": "image", "index": 0, "size": 234567, "sha256": "..." }]
  },
  "error": null
}
```

`status` 为 `stored`（首次）或 `already_applied`（重发同 idempotency_key）。

#### `POST /api/v1/scans/{sessionId}/revisions`

JSON 体，Bearer token：

```json
{ "idempotencyKey": "uuid-v4" }
```

返回 `202`：

```json
{ "data": { "status": "queued", "revision": 2, "jobId": "..." } }
```

`status` 为 `queued` 或 `already_queued`。后端基于 `evidence_state` 重跑 vision/generate/verify；前端通过 `GET /api/v1/scans/{sessionId}` 轮询新 revision。

## 3. 浏览器调用示例

> ⚠️ **当前生产前端（Next.js）不直接调用 `/api/v1`**。浏览器经 Next.js BFF (`app/api/scan/*`) 转发到 RAG，由 BFF 处理 rate-limit、origin check、cookie 移交、`normalizeV1ScanResult` 等。下面的示例适用于**新独立前端**（非当前 Next.js 前端），它确实直接调 `/api/v1`，并自带 cookie / auth / cors 处理。

```ts
const API_BASE = import.meta.env.VITE_ATTRAX_API_URL ?? "http://localhost:8001";

export async function startScan(input: {
  query: string;
  product?: string;
  category: string;
  markets: string[];
  images: File[];
  documents?: File[];
}) {
  const form = new FormData();
  form.set("query", input.query);
  form.set("product", input.product ?? "");
  form.set("category", input.category);
  form.set("markets", JSON.stringify(input.markets));
  input.images.forEach((file) => form.append("images", file));
  input.documents?.forEach((file) => form.append("documents", file));

  const response = await fetch(`${API_BASE}/api/v1/scans`, { method: "POST", body: form });
  const envelope = await response.json();
  if (!response.ok) throw new Error(envelope.error?.code ?? "SCAN_CREATE_FAILED");
  return envelope.data as {
    sessionId: string;
    accessToken: string;
    status: "processing";
    pollUrl: string;
  };
}

export async function getScan(sessionId: string, accessToken: string) {
  const response = await fetch(`${API_BASE}/api/v1/scans/${sessionId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const envelope = await response.json();
  if (!response.ok) throw new Error(envelope.error?.code ?? "SCAN_READ_FAILED");
  return envelope.data;
}
```

浏览器不能手动设置 multipart 的 `Content-Type`；`fetch` 会自动生成带 boundary 的正确请求头。

### 3.1 当前生产前端如何用 — Next.js BFF 替代

当前 Next.js 前端的真实调用链是浏览器 → `/api/scan`（BFF，HttpOnly cookie）→ RAG `/api/v1/scans`（Bearer）。对应文件：

- `lib/rag-client/v1-adapter.ts` — `createScan()` / `getScan()` / `appendEvidence()` / `requestRevision()`
- `app/api/scan/route.ts` — `POST /api/scan` 创建扫描
- `app/api/scan/[sessionId]/route.ts` — `GET /api/scan/[sessionId]` 轮询
- `app/api/scan/[sessionId]/evidence/route.ts` — `POST /api/scan/[sessionId]/evidence` 补证据（J10）
- `app/api/scan/[sessionId]/revisions/route.ts` — `POST /api/scan/[sessionId]/revisions` 排重扫（J10）

如果接入的是当前 Next.js 前端扩展，**不要**直接打 `/api/v1`，永远走 `/api/scan/*`。

## 4. 错误处理

所有非 `204` 的 v1 响应使用统一 envelope：

```json
{
  "data": null,
  "error": {
    "code": "INVALID_FILE_SIGNATURE",
    "message": "File content does not match its type",
    "details": null
  },
  "meta": { "requestId": "req_..." }
}
```

前端按 `error.code` 分支，`message` 只作为兜底。主要错误码：

| 错误码 | 来源 | 含义 |
|---|---|---|
| `INVALID_REQUEST` | v1 / BFF | 请求体 schema 错误 |
| `INVALID_FILE_TYPE` / `INVALID_FILE_SIGNATURE` | v1 / BFF | 文件类型 / magic bytes 校验失败 |
| `INVALID_DOCX_ARCHIVE` | v1（`append_evidence`） | docX  zip 头无效 |
| `IMAGE_REQUIRED` / `TOO_MANY_IMAGES` / `TOO_MANY_DOCUMENTS` | v1 | 数量上限 |
| `FILE_TOO_LARGE` / `REQUEST_TOO_LARGE` / `BAD_CONTENT_LENGTH` | v1 / BFF | 大小 / chunked 编码问题 |
| `INVALID_CATEGORY` / `INVALID_MARKETS` | BFF | 不在 `MARKET_IDS` allow-list |
| `RATE_LIMITED` | BFF（`lib/rate-limit.ts`） | 同一 client 60s 内 ≥10 次 |
| `CROSS_ORIGIN_FORBIDDEN` | BFF | Origin 不在白名单 |
| `UNAUTHORIZED` / `NOT_FOUND` / `NOT_READY` | v1 / BFF | 鉴权 / 状态 |
| `SCAN_QUEUE_UNAVAILABLE` / `SCAN_SERVICE_UNAVAILABLE` | v1 / BFF | rag-service 不可达 |
| `DEMO_MODE_REQUIRED` | BFF | demo 模式下访问需要 API Key 的端点 |

排障时可把 `meta.requestId` 提供给后端，但不要提供 access token。

## 5. OpenAPI 与类型生成

`GET /openapi.json` 是唯一契约源。新前端项目可直接生成 TypeScript：

```bash
npx openapi-typescript http://localhost:8001/openapi.json -o src/api/attrax.gen.ts
```

后端改动后的仓库维护命令：

```powershell
npm run codegen:openapi
npm run codegen:rag-types
npm run check:rag-contract
```

旧 `/scan`、`/scan-multipart`、`/profit-report` 接口仅为现有 Next.js 前端的迁移兼容面。新前端不得接入这些旧接口。
