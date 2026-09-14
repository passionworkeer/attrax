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

生产环境必须设置真实的 `MINIMAX_API_KEY`、`PAI_API_KEY`、`RAG_INTERNAL_SECRET` 和新前端的 `RAG_ALLOWED_ORIGINS`。运行状态持久化在 `ATTRAX_RUNTIME_DIR`；Compose 默认映射为宿主机 `./data/backend`。

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

- `GET /api/v1/scans/{sessionId}/roadmap`
- `GET /api/v1/scans/{sessionId}/trace`
- `DELETE /api/v1/scans/{sessionId}`，成功为 `204`

探针无需 token：

- `GET /api/v1/health`：进程存活。
- `GET /api/v1/ready`：RAG、索引、配置及扫描服务是否可接流量。

## 3. 浏览器调用示例

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

前端按 `error.code` 分支，`message` 只作为兜底。主要错误码：`INVALID_REQUEST`、`IMAGE_REQUIRED`、`TOO_MANY_IMAGES`、`TOO_MANY_DOCUMENTS`、`INVALID_FILE_TYPE`、`INVALID_FILE_SIGNATURE`、`FILE_TOO_LARGE`、`UNAUTHORIZED`、`NOT_FOUND`、`NOT_READY`、`SCAN_QUEUE_UNAVAILABLE`。

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
