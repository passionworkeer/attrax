# API 契约：RAG Service

> 新前端接入请只使用版本化 `/api/v1`，完整流程见 [`FRONTEND-BACKEND-INTEGRATION.md`](./FRONTEND-BACKEND-INTEGRATION.md)。本文件后续章节保留旧接口契约，供现有 Next.js 迁移期兼容。

> 版本基线：FastAPI 自动生成于 `rag_service/main.py`，**OpenAPI 规范文件**在 [`lib/rag-client/openapi.snapshot.json`](../lib/rag-client/openapi.snapshot.json)（CI 会校验它与代码生成的一致性）。
>
> 在线访问：启动 RAG 服务后访问 [`/openapi.json`](http://localhost:8001/openapi.json) 和 [`/docs`](http://localhost:8001/docs)。

---

## 1. 端点清单

| 端点 | 方法 | 用途 | 鉴权 | 限流 | 超时 | 主要状态码 |
|------|------|------|------|------|------|------------|
| `/scan` | POST | JSON 形态的扫描（无文件上传） | 生产非 Demo：`X-Internal-Secret` | 60s 内同 IP ≤ 30 次 | 280s | 200 / 400 / 413 / 429 / 500 / 504 |
| `/scan-multipart` | POST | Form 形态的扫描（带图片+PDF） | 同上 | 同上 | 280s | 同上 |
| `/profit-report` | POST | 生成合规成本/利润报告 | 同上 | 同上 | 60s | 200 / 400 / 413 / 429 / 500 / 504 |
| `/health` | GET | 存活探针 | 无 | 无 | — | 200 |
| `/ready` | GET | 就绪探针（检查 FAISS/BM25/Key） | 无 | 无 | — | 200 / 503 |
| `/openapi.json` | GET | OpenAPI 3 规范 | 无 | 无 | — | 200 |
| `/docs` | GET | Swagger UI | 无 | 无 | — | 200 |

> 限流窗口是**应用层**（`main.py:protect_requests`），独立于前端 `lib/rate-limit.ts` 的 `DAILY_FREE_SCAN_LIMIT` 计数。两者都会卡。

---

## 2. 公共约束

### 2.1 鉴权：内部共享密钥

| 场景 | 行为 |
|------|------|
| `DEMO_MODE=true` | 写接口开放（密钥缺失也允许） |
| `RAG_INTERNAL_SECRET` 已设置 | 必须通过 `X-Internal-Secret: <value>` header 鉴权（生产姿态） |
| 非 Demo + 空密钥 + `app_env ∈ {production, prod}` | **启动期 RuntimeError**，服务不会起来 |
| 非 Demo + 空密钥 + 非生产 | 自动签临时密钥并启动，写接口 401（loud warning） |
| `RAG_ALLOW_INSECURE=true` | 显式 opt-out，loud warning |

**已知缺口**：`main.py` 当前**没有读取 `RAG_INTERNAL_SECRET` 校验**（只在 `_enforce_secret_policy` 里被 ref，但请求路径未消费）。这一节描述的是**已声明的契约**，但实现尚未完成。前端若要主动发 `X-Internal-Secret`，目前会被忽略，不会失败也不会通过——见 `lib/rag-client/errors.ts` 注释。

### 2.2 CORS

- 允许来源由 `RAG_ALLOWED_ORIGINS` 逗号分隔控制（默认 `http://localhost:3000,http://127.0.0.1:3000`）
- 允许方法：`GET`, `POST`
- 允许 header：`Content-Type`
- **不带** `Authorization` / `X-Internal-Secret` 的预检——浏览器跨域时不带后者会失败；建议在容器同源或前置一层 Nginx 转发

### 2.3 限流

- 窗口：60s
- 桶大小：30
- 键：客户端 IP（取 `X-Forwarded-For` 第一段，或 `request.client.host`）
- 触发：写接口（`/scan` / `/scan-multipart` / `/profit-report`）
- 触发后：返回 429 + `{"error": "Too many requests"}`
- 注：这是**未认证**的 IP 级限流；前端 `DAILY_FREE_SCAN_LIMIT` 是**认证后**的每日计数

### 2.4 大小限制

| 限制 | 值 | 触发 |
|------|------|------|
| `Content-Length` 头 | 50MB | >50MB → 413 `Request too large` |
| 单图 | 10MB | >10MB → 413 `Image too large` |
| 单 PDF | 15MB | >15MB → 413 `PDF too large` |

### 2.5 幂等 / 重试

- 服务**无幂等保证**。重发同样的 `query` + `images` 会重新跑一次完整 LangGraph。
- 客户端建议：每个 `sessionId` 只发起一次扫描；失败由 `degradedReason` 决定前端降级，不在后端重试。

---

## 3. 写端点规范

### 3.1 `POST /scan`

**请求体**（`application/json`）

```typescript
interface ScanRequest {
  query: string;                              // 必填，空字符串 → 400
  product?: string;                           // 默认 ""
  category?: string;                          // 默认 ""
  markets?: string[];                         // 默认 ["EU"]
  vision_result?: Record<string, unknown>;    // 预计算的视觉分析结果
  images?: Array<{                            // base64 编码
    buffer: string;                           // base64
    mime_type: string;                        // "image/jpeg" | "image/png" | "image/webp"
    name: string;
  }>;
  documents?: Array<{
    name: string;
    mime_type: string;
    text: string;                             // 已提取的纯文本
  }>;
  pdfs?: Array<{                              // 会在服务端用 pdfplumber 提取
    name: string;
    buffer: string;                           // base64
  }>;
}
```

**响应体**（200）

```typescript
interface ScanResponse {
  status: "PASS" | "WARN" | "REJECTED" | "UNKNOWN";
  report: string;                             // markdown
  agent_trace: Array<Record<string, unknown>>; // LangGraph 节点日志
  loop_count: number;                         // 0 = 单次，1+ = 重新检索
  documents?: Array<{                         // 上限 15 条
    id: string;
    doc_name?: string;
    article_no?: string;
    region?: string;
    score?: number;
  }>;
  report_package?: ReportPackage;             // 报告包，详见 §4
}
```

**错误码**

| 状态 | 触发 | `detail` |
|------|------|----------|
| 400 | `query` 为空 | `query is required` |
| 400 | JSON 解析失败 | 框架默认 |
| 413 | `Content-Length > 50MB` | `Request too large` |
| 429 | 60s 内同 IP > 30 次 | `Too many requests` |
| 500 | 内部异常（被 `global_exception_handler` 吞掉） | `Internal server error`（不泄漏 stack） |
| 504 | 扫描超过 280s | `Scan request timed out. Please try again.` |

### 3.2 `POST /scan-multipart`

**请求体**（`multipart/form-data`）—— 前端 `lib/rag-client/client.ts:scanMultipart()` 的实际调用方式

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索查询文本 |
| `product` | string | 否 | 产品名（默认 ""） |
| `category` | string | 否 | 品类（默认 ""） |
| `markets` | string | 否 | JSON 字符串或逗号分隔（默认 `["EU"]`） |
| `documents` | string | 否 | JSON 字符串，结构同 `/scan` 的 `documents` |
| `images` | file[] | 否 | ≤ 8 张，单张 ≤ 10MB，`image/jpeg` / `image/png` / `image/webp` |
| `pdfs` | file[] | 否 | ≤ 5 个，单个 ≤ 15MB，`application/pdf` |

**服务端校验**（`main.py:_validate_image_upload` / `_validate_pdf_upload`）

- MIME 不在白名单 → 400 `Unsupported image type` / `Unsupported PDF type`
- 文件名不匹配 MIME → 400
- 魔数不匹配 → 400 `Invalid image content` / `Invalid PDF content`
  - JPEG：`FF D8 FF`
  - PNG：`89 50 4E 47`
  - WEBP：`52 49 46 46` + `57 45 42 50`
  - PDF：`25 50 44 46`

**响应**：同 `/scan` 的 `ScanResponse`。

**Demo 模式**：返回 `status="DEMO"`，`report` 是说明性 markdown，`agent_trace` 单条 `{"node":"demo","status":"DEMO","message":"..."}`，`loop_count=0`，**无 `report_package`**。

### 3.3 `POST /profit-report`

**请求体**（`application/json`）

```typescript
interface ProfitReportRequest {
  product?: string;     // 默认 ""
  category?: string;    // 默认 ""
  markets?: string[];   // 默认 ["EU"]
}
```

**响应体**（200）

```typescript
interface ProfitReportResponse {
  status: "SUCCESS" | "DEMO";
  report: string;       // markdown，含 6 章节
  product: string;      // 由 request.product / .category 兜底
  market: string;       // 取 markets[0]，兜底 "EU"
}
```

**错误码**

| 状态 | 触发 |
|------|------|
| 504 | 超过 60s |

**Demo 模式**：`status="DEMO"`，`report` 是说明性 markdown。

---

## 4. 报告包（ReportPackage）—— 核心交付

**Schema 版本**：`report-package/v1`（Pydantic `extra="allow"`，允许前端扩展）

**顶层字段**

```typescript
interface ReportPackage {
  productDossier: {
    product?: string;
    category?: string;
    markets: string[];
    query?: string;
    sourceCounts?: Record<string, number>;
  };
  complianceReport: string;                    // 必填非空 markdown
  profitReport: {
    markdown: string;                          // 必填
    keyConclusion?: string;
    premiumPct?: string;                       // "37%"
    breakevenUnits?: string;
    pricingStrategy?: string;
    riskNote?: string;
    conclusions?: string;
    references?: string;
  };
  roadmap: {
    totalDays: number;                         // 0 默认
    totalCost: string;                         // "¥24K-72K"
    progress: number;                          // 0-100 钳制
    items: Array<{
      id: string;                              // 必填
      date?: string;
      title?: string;
      titleEn?: string;
      description?: string;
      descriptionEn?: string;
      type?: "apply" | "test" | "certify" | "complete";
      status?: "pending" | "in-progress" | "completed";
      estimatedDays?: number;
      cost?: string;
      documents?: string[];
      documentsEn?: string[];
    }>;
  };
  decisionView: {
    summary?: string;
    keyFindings?: string[];
    recommendedAction?: string;
    nodes: Array<{
      id: string;                              // 必填
      type?: string;
      label?: string;
      labelEn?: string;
      status?: string;
      duration?: string;
      confidence?: number;
      reasoning?: string;
      reasoningEn?: string;
    }>;
  };
  evidenceBundles: {
    visual: EvidenceItem[];
    retrieval: EvidenceItem[];
    generation: EvidenceItem[];
  };
  auditMetadata: {
    schemaVersion: string;                     // "report-package/v1"
    generatedAt: string;                       // ISO 8601 UTC
    validationStatus: "normalized" | "fallback" | "invalid";
    validationErrors: string[];
    provider: string;                          // "mimo" | "fallback" | "mock" | ...
    traceNodeCount: number;
  };
}

interface EvidenceItem {
  id: string;                                  // 必填
  layer: "visual" | "retrieval" | "generation" | "audit";
  source?: string;
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}
```

**前端 snake↔camel 兼容**

后端 Pydantic 输出 camelCase。前端 `lib/pipeline/report-package.ts:normalizeReportPackage` 接受两种 key 命名（向后兼容历史 snake_case 输出）。新接入建议**只发 camelCase**。

---

## 5. 健康端点

### 5.1 `GET /health`

```json
{ "status": "ok", "version": "0.3.0", "demo_mode": false }
```

200 永远。`status` 当前**不**反映内部错误（FAISS 加载失败不会让 health 变红）。需要真实健康度请用 `/ready`。

### 5.2 `GET /ready`

```json
{
  "ready": true,
  "checks": {
    "faiss": true,
    "bm25": true,
    "mimotalk_api_key": true,
    "modelscope_api_key": true,
    "config_loaded": true
  },
  "demo_mode": false,
  "version": "0.3.0"
}
```

503 当且仅当 `checks` 任一为 `false`（非 Demo 模式下两个 API Key 缺失也算 false）。

---

## 6. 降级行为（前端视角）

> 详细分层见 [`docs/ARCHITECTURE.md` §降级状态](./ARCHITECTURE.md#降级状态-不要混淆)。这里只列 RAG 端点会触发的几种。

| 触发 | 表现 |
|------|------|
| `RAG_SERVICE_URL` 不可达 | 前端捕获 `RagServiceError` → `degradedReason="RAG_SERVICE_UNAVAILABLE"` → `result.source="fallback"` → 走 `createMockComplianceReportResult` |
| 响应超过 `RAG_SERVICE_TIMEOUT_MS=300_000`（前端）vs 280s（后端） | `degradedReason="RAG_SERVICE_TIMEOUT"` |
| HTTP 4xx/5xx | `degradedReason="RAG_SERVICE_HTTP_<status>"` |
| 响应 Zod 校验失败 | `degradedReason="RAG_SERVICE_INVALID_RESPONSE"` |
| 单独 `/profit-report` 失败 | 退到 `createMockProfitReport`，但 `/scan-multipart` 成功时仍保留真实 `complianceReport` |
| `DEMO_MODE=true` | 后端 `status="DEMO"`，前端视作"半真实"——`report_package` 缺失，仅 `report` 字段有占位 markdown |

---

## 7. 已知漂移（mock vs 真实）

完整对照见 [`docs/MOCK-REAL-MAPPING.md`](./MOCK-REAL-MAPPING.md)。高优先级：

| 问题 | 影响 | 修复 |
|------|------|------|
| `mock.decisionView.verdict` / `riskLevel` 真实不存在 | 前端 UI 写死读这两字段会拿到 `undefined` | 移到 `decisionView.nodes[*].metadata.verdict` |
| `mock.agentTrace` 用 `duration_ms` 字段，真实未约束 | 展示错位 | 改读 `duration` 字符串或保留 `duration_ms` 作为已知字段 |
| 真实 `ProfitReport` 不含 `barebone` / `compliant` 结构化字段 | 前端靠 `buildProfitReportFromMarkdown` 重新解析 | 已实现，但有 markdown 格式漂移风险 |
| 真实端点**未消费** `RAG_INTERNAL_SECRET` | 鉴权失效 | 修复 `main.py` 写端点（独立任务） |

---

## 8. 修改本契约时的流程

1. 改 `rag_service/schemas/report_package.py` 或 `main.py`（Pydantic / FastAPI 自动重算 OpenAPI）
2. 跑 `npm run codegen:openapi` —— 重新抓 `/openapi.json` 到 `lib/rag-client/openapi.snapshot.json`
   > ⚠️ **手动步骤**——这不是 CI 自动跑的。需要 RAG 服务在 `RAG_SERVICE_URL`（默认 `http://localhost:8001`）可达时手动执行。脚本实现见 `scripts/capture-openapi.mjs`。
3. 跑 `npm run codegen:rag-types` —— 重生 `lib/rag-client/types.gen.ts`
4. 跑 `npm run test` —— 报告包契约测试应自动捕获漂移并 fail
5. 同步更新 `docs/API-CONTRACT.md` §3/§4 与 `docs/MOCK-REAL-MAPPING.md`
6. CI 步骤（[`.github/workflows/ci.yml` §frontend → RAG contract check](../../.github/workflows/ci.yml)）会校验 `openapi.snapshot.json` 与 `types.gen.ts` 一致

---

*最后更新：2026-07-14*
