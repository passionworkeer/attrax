# Mock vs 真实 RAG：字段对照与漂移清单

> 这份文档是**前端 mock 数据**与**真实 RAG 响应**的对照基线。任何一端字段变动都要同步更新这里。
>
> 维护者：当前 mock 由 `lib/mock/scan-result.ts` 产出，真实由 `rag_service/main.py` + `rag_service/schemas/report_package.py` 产出。

---

## 1. 调用路径

```
前端 UI
  └─ lib/pipeline/scan.ts
      ├─ 真实：lib/rag-client/client.ts → RAG_SERVICE_URL/scan-multipart
      └─ 降级：lib/mock/scan-result.ts → createMockComplianceReportResult / createMockProfitReport
```

两条路径最终都返回 `ComplianceReportResult` 给 session store。**前端 UI 不应该区分来源**——但字段一致性靠这份文档 + 契约测试保障。

---

## 2. 顶层字段对照

`ComplianceReportResult` 是**前端内部**的扁平化结构（`lib/types.ts:115-159`），它把 RAG 响应的 `report_package` 包了一层。下表对照"前端字段 ← 来源"。

| 前端字段 | 真实来源 | Mock 来源 | 状态 |
|----------|----------|-----------|------|
| `sessionId` | 入参 | 入参 | ✅ |
| `scanTime` | `new Date().toISOString()` | `new Date().toISOString()` | ✅ |
| `productCategory` | 入参 | `"electronics"` 硬编码 | ⚠️ Mock 硬编码 |
| `productName` | `input.query` | `PRODUCT_NAME` 硬编码 | ⚠️ Mock 硬编码 |
| `targetMarkets` | 入参 | `["EU","US"]` 硬编码 | ⚠️ Mock 硬编码 |
| `complianceScore` | `ragResponse.status` 启发式 85/55/25 | `45` 硬编码 | ⚠️ 都未校准 |
| `scoreGrade` | 同上 B/C/D | `"D"` 硬编码 | ⚠️ |
| `complianceReport` | `reportPackage.complianceReport ?? ragResponse.report` | `buildComplianceReportZh()` | ✅ |
| `complianceReportEn` | `reportPackage.complianceReportEn` | `buildComplianceReportEn()` | ✅ |
| `complianceStatus` | `ragResponse.status` | `"REJECTED"` 硬编码 | ⚠️ |
| `agentTrace` | `ragResponse.agent_trace` | 手写 4 条 | ⚠️ 字段不同 |
| `loopCount` | `ragResponse.loop_count` | `0` | ✅ |
| `retrievedChunks` | `ragResponse.documents[:15]` | 手写 6 条 | ✅ |
| `reportPackage` | `ragResponse.report_package` (Pydantic) | `createMockReportPackage()` | ⚠️ 见 §3 |
| `riskPoints` | `undefined`（真实不回） | `undefined` | ✅ |
| `checklist` | `undefined`（真实不回） | `undefined` | ✅ |
| `modelInfo.ragProvider` | **硬编码 `"cohere-anthropic"`** | `"fallback-mock"` | ❌ Bug |
| `source` | `"real"` | `"fallback"` | ✅ |

> `modelInfo.ragProvider: "cohere-anthropic"` 是 `lib/pipeline/scan.ts:305` 写死的错误值，**与实际 LLM 无关**。阶段 B 会改为读取 `MIMOTALK_PROVIDER` env 或注释掉。

---

## 3. ReportPackage 字段对照

`ReportPackage` 是**真实**与**mock**共用的核心结构。下面只列**有差异**的字段。

### 3.1 `decisionView`

| 字段 | 真实（Pydantic） | Mock（TS） | 状态 |
|------|------------------|-----------|------|
| `summary` | ✅ | ✅ | ✅ |
| `keyFindings` | ✅ | ✅ | ✅ |
| `recommendedAction` | ✅ | ✅ | ✅ |
| `nodes[].id` | ✅ | ✅ | ✅ |
| `nodes[].type` | ✅ | ✅ | ✅ |
| `nodes[].label` / `labelEn` | ✅ | ✅ | ✅ |
| `nodes[].status` | ✅ | ✅ | ✅ |
| `nodes[].duration` | ✅ | ✅ | ✅ |
| `nodes[].confidence` | ✅ | ✅ | ✅ |
| `nodes[].reasoning` / `reasoningEn` | ✅ | ✅ | ✅ |
| **`decisionView.verdict`** | ❌ 不存在 | ✅ `"REJECTED"` | ❌ **漂移** |
| **`decisionView.riskLevel`** | ❌ 不存在 | ✅ `"HIGH"` | ❌ **漂移** |
| **`nodes[].icon`** | ❌ 不存在 | ✅ `"eye" / "search" / ...` | ⚠️ 前端 UI 自管 |

**修复方案（阶段 C2）**：把 `verdict` / `riskLevel` 移到 `nodes[0].metadata.verdict` / `nodes[0].metadata.riskLevel`，并写契约测试断言"mock 喂给 `normalizeReportPackage` 不丢这些字段"。

### 3.2 `roadmap`

| 字段 | 真实 | Mock | 状态 |
|------|------|------|------|
| `totalDays` / `totalCost` / `progress` | ✅ | ✅ | ✅ |
| `items[].id` / `date` / `title` / `titleEn` | ✅ | ✅ | ✅ |
| `items[].description` / `descriptionEn` | ✅ | ✅ | ✅ |
| `items[].type` / `status` / `estimatedDays` | ✅ | ✅ | ✅ |
| `items[].cost` | ✅ | ✅ | ✅ |
| `items[].documents` / `documentsEn` | ✅ | ✅ | ✅ |

✅ 完全对齐。

### 3.3 `evidenceBundles`

| 字段 | 真实 | Mock | 状态 |
|------|------|------|------|
| `visual[]` | ✅ 1 条（vision_result） | ❌ 缺失 | ⚠️ Mock 缺 |
| `retrieval[]` | ✅ ≤ 24 条 chunks + 12 条 user docs | ❌ 缺失 | ⚠️ Mock 缺 |
| `generation[]` | ✅ 1 条合规报告 + 1 条包键名 + 12 条 trace | ❌ 缺失 | ⚠️ Mock 缺 |

**影响**：前端 UI 如果读 `evidenceBundles.visual.length` 拿图，mock 会显示空。**修复方案**：mock 至少补 1 条 `visual` + 2 条 `retrieval` 满足演示。

### 3.4 `auditMetadata`

| 字段 | 真实 | Mock | 状态 |
|------|------|------|------|
| `schemaVersion` | ✅ `"report-package/v1"` | ❌ 缺失 | ⚠️ |
| `generatedAt` | ✅ ISO 8601 | ❌ 缺失 | ⚠️ |
| `validationStatus` | ✅ `"normalized" \| "fallback" \| "invalid"` | ❌ 缺失 | ⚠️ |
| `validationErrors` | ✅ `[]` | ❌ 缺失 | ⚠️ |
| `provider` | ✅ `"mimo"` | ❌ 缺失 | ⚠️ |
| `traceNodeCount` | ✅ | ❌ 缺失 | ⚠️ |

**修复方案**：mock `createMockReportPackage` 补完整 `auditMetadata`，`provider: "mock"`，`validationStatus: "normalized"`。

### 3.5 `productDossier`

| 字段 | 真实 | Mock | 状态 |
|------|------|------|------|
| `product` / `category` / `markets` / `query` | ✅ 由 `normalize_report_package` 自动补 | ❌ 缺失 | ⚠️ |
| `sourceCounts` | ✅ `{retrievedChunks, userDocuments, visualItems, ...}` | ❌ 缺失 | ⚠️ |

**修复方案**：mock 补一份占位 `productDossier`。

### 3.6 `profitReport`

| 字段 | 真实 | Mock | 状态 |
|------|------|------|------|
| `markdown` | ✅ 必填 | ❌ 缺失 | ❌ |
| `keyConclusion` / `premiumPct` / `breakevenUnits` / `pricingStrategy` / `riskNote` / `conclusions` / `references` | ✅ 全部 Pydantic 字段 | ❌ 缺失 | ❌ |

**影响**：mock 模式下，如果前端走"从 `reportPackage.profitReport` 取数"路径会全空。**当前 mock 把这些字段放到 `ProfitReportResult` 顶层**（`lib/types.ts:381-411`），由 `buildProfitReportFromMarkdown` 在 mock 路径上从 `buildProfitReport` 的 markdown 解析——**这条独立路径**实际上不读 `reportPackage.profitReport`。

**结论**：`profitReport` 在 mock 路径下与真实路径数据来源不同，**前端 UI 必须能容忍两种**。阶段 C1 引入 OpenAPI 生成类型后，会强制统一。

---

## 4. AgentTrace 字段对照

**真实**（`agent_trace` 数组每条结构）：

来源：LangGraph 节点自己写（`rag_service/orchestrator/nodes/*.py`），**没有 Pydantic schema 约束**。已知字段：

```typescript
{
  node: string;             // "vision" | "query_planner" | "retrieve" | "synthesis" | "generate" | "verify" | "refine"
  status?: string;          // "OK" | "WARN" | "FAIL" | "DEMO" | "MOCK" | "FALLBACK" | ...
  duration_ms?: number;
  score?: number;
  docs_retrieved?: number;
  message?: string;
  error?: string;
  [key: string]: unknown;   // 节点可能写任意额外字段
}
```

**Mock**（`lib/mock/scan-result.ts:460-464`）：

```typescript
[
  { node: "vision", status: "MOCK", duration_ms: 0, score: 0.7 },
  { node: "retriever", status: "FALLBACK", duration_ms: 0, docs_retrieved: 6 },
  { node: "generator", status: "MOCK", duration_ms: 0, score: 0.68 },
  { node: "verifier", status: "WARN", duration_ms: 0, score: 0.62 },
]
```

**状态**：✅ 字段名一致。但真实节点可能写更复杂的对象（如 `citations[]` / `subQueries[]`），前端 UI 要用 `String(trace.node)`、`Number(trace.duration_ms) ?? 0` 这类宽容读取。

---

## 5. ProfitReport 字段对照

`ProfitReportResult`（`lib/types.ts:381-411`）是**前端内部**的扁平结构。真实 RAG 只回 `ProfitReport`（Pydantic @ `rag_service/schemas/report_package.py:35-43`），结构化字段（`barebone` / `compliant` / `bareboneRiskExposure` 等）由前端 `lib/pipeline/profit-report.ts:buildProfitReportFromMarkdown` 从 markdown 重新解析。

| 前端 `ProfitReportResult` 字段 | 真实来源 | Mock 来源 | 状态 |
|-------------------------------|----------|-----------|------|
| `report` / `reportEn` | `/profit-report` 端点直接给 | `buildProfitReport` 拼 markdown | ✅ |
| `barebone` / `compliant` (CostSummary) | `buildProfitReportFromMarkdown` 解析 | 写死 | ⚠️ 解析风险 |
| `bareboneRiskExposure` / `compliantRiskExposure` | 同上 | 写死 | ⚠️ |
| `bareboneGpm` / `compliantGpm` | 计算 | 计算 | ✅ |
| `keyConclusion` / `conclusions` / `references` | markdown 解析 | 写死 | ⚠️ |
| `premiumPct` / `breakevenUnits` / `pricingStrategy` / `riskNote` | markdown 解析 | 写死 | ⚠️ |

**已知风险**：`buildProfitReportFromMarkdown` 用了一堆正则（`RE_S4_HEADER` / `RE_BREAKEVEN` / `RE_PREMIUM_PCT` 等），真实 LLM 输出的 markdown 微调就可能解析失败。**这是真实路径下的潜在静默退化点**。

**建议**：阶段 D 之后考虑给 `ProfitReport` Pydantic 加 `structuredFields` 子结构（LLM 一次性输出 JSON 表 + markdown），前端不再正则解析。

---

## 6. CI 自动校验

- `tests/unit/report-package-contract.test.ts` 会喂 mock 输出给 `normalizeReportPackage`，断言不抛错 + 关键字段存在
- CI 步骤 `codegen:rag-types` 会重新生成 `lib/rag-client/types.gen.ts`，后端改字段时 PR 会 fail

---

*最后更新：2026-07-14*
