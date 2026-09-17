# Mock vs 真实 RAG：字段对照与漂移清单

> 最后更新：2026-09-14（重写 §1 调用路径与全部 cohere/MIMOTALK/ModelScope/FaissRetriever 引用）
> 这份文档是**前端 mock 数据**与**真实 RAG 响应**的对照基线。任何一端字段变动都要同步更新这里。
>
> 维护者：当前 mock 由 `lib/mock/blaze-scan-result.ts` 产出，真实由 `rag_service/main.py` + `rag_service/schemas/report_package.py` 产出。

---

## 1. 调用路径

```
前端 UI (app/upload, app/result/[sessionId], app/profit/[sessionId])
  ├─ 真实：app/api/scan/route.ts
  │    └─ lib/rag-client/v1-adapter.ts (createScan)
  │         └─ fetch(RAG_SERVICE_URL/api/v1/scans, ...)
  │              └─ RAG 服务自管会话/队列（rag_service/infrastructure/file_backend.py）
  └─ 降级：app/api/scan/route.ts
       └─ lib/mock/blaze-scan-result.ts → createMockComplianceReportResult / createMockProfitReport
                                              + lib/rag-client/v1-adapter.ts (getScan)
                                              + lib/rag-client/v1-result-adapter.ts (字段映射)
                                              + lib/pipeline/profit-report.ts (RenderModel 合成)
```

两条路径最终都返回 `ComplianceReportResult` 给 UI。**前端 UI 不应该区分来源**——但字段一致性靠这份文档 + 契约测试（`tests/unit/report-package-contract.test.ts`）保障。

> ⚠️ 旧 `lib/pipeline/scan.ts` + `scan-queue.ts` 已于 2026-09-10 删除，本文档不再维护它们。

---

## 2. 顶层字段对照

`ComplianceReportResult` 是**前端内部**的扁平化结构（`lib/types.ts`），它把 RAG 响应的 `report_package` 包了一层。下表对照"前端字段 ← 来源"。

| 前端字段 | 真实来源 | Mock 来源 | 状态 |
|----------|----------|-----------|------|
| `sessionId` | RAG `/api/v1/scans/{id}` | 入参 | ✅ |
| `scanTime` | RAG `generatedAt` | `new Date().toISOString()` | ✅ |
| `productCategory` | 入参 | 入参（默认 `electronics`） | ✅ |
| `productName` | 入参 | 入参或预设 | ✅ |
| `targetMarkets` | 入参 | 入参 | ✅ |
| `complianceScore` / `scoreGrade` | `v1-result-adapter.ts` 启发式映射（resultReady 时取 decisionView.verdict → severityFor → scoreFor） | severity / verdict 硬编码 | ✅ |
| `complianceReport` | `reportPackage.complianceReport` | `buildComplianceReportZh()` | ✅ |
| `complianceReportEn` | 后端 schema **无此字段**；前端 `lib/report-localization.ts` 组装：`result.complianceReportEn ?? reportPackage?.complianceReportEn ?? 英文框架回退` | `buildComplianceReportEn()` | ✅ |
| `complianceStatus` | `decisionView.verdict` / `riskLevel` | 写死 `"REJECTED"` | ✅ |
| `agentTrace` | RAG `agent_trace`（线性 3 步：vision / generate / verify） | 手写若干条 | ✅ 字段名一致 |
| `retrievedChunks` | `reportPackage.retrievedChunks` | 手写若干条 | ✅ |
| `reportPackage` | RAG `/api/v1/scans/{id}` 的 `report_package` | `createMockReportPackage()` | ✅ |
| `modelInfo.ragProvider` | RAG `metadata.provider`（恒 `"minimax"`，见 `report_generator.py` provider property） | `"fallback-mock"` | ✅ |
| `source` | `"real"` | `"fallback"` | ✅ |

---

## 3. ReportPackage 字段对照

`ReportPackage` 是**真实**与 **mock** 共用的核心结构。下面只列**当前可能不一致**的字段。

### 3.1 `decisionView`

| 字段 | 真实（Pydantic） | Mock（TS） | 状态 |
|------|------------------|-----------|------|
| `summary` / `keyFindings` / `recommendedAction` | ✅ | ✅ | ✅ |
| `nodes[].id` / `type` / `label` / `labelEn` / `status` / `duration` / `confidence` / `reasoning` / `reasoningEn` | ✅ | ✅ | ✅ |
| `decisionView.verdict` | ✅ 顶层存在 | ✅ 顶层存在 | ✅ |
| `decisionView.riskLevel` | ✅ 顶层存在 | ✅ 顶层存在 | ✅ |
| `nodes[].severity` | ✅ 后端产出（`findings_builder.py` _RULES 字典按 `(semantic, visibility)` 配 severity；2026-09-15 P0-1/P0-2 hazard matcher 重写不影响 severity 真值源） | ✅ mock 显式带 `severity` | ✅ |
| `nodes[].icon` | ❌ 后端不返回 | ✅ 前端 UI 自管 | ⚠️ UI 自管 |

### 3.2 `roadmap`

`items[]` 字段（`id` / `date` / `title` / `titleEn` / `description` / `descriptionEn` / `type` / `status` / `estimatedDays` / `cost` / `documents` / `documentsEn`）完全对齐（✅）。`lib/mock/roadmap.ts` 提供 mock 数据，被结果页 inline roadmap 引用（cleanup subagent 反向纠错：本以为可删，实际仍被引用）。

### 3.3 `evidenceBundles`

| 字段 | 真实 | Mock | 状态 |
|------|------|------|------|
| `visual[]` | ✅ 1 条（vision_result） | ✅ 1 条 | ✅ |
| `retrieval[]` | ✅ ≤ 24 条 chunks（`schemas/report_package.py:204` + `generate/report_generator.py:_build_source_context` 默认 `max_chunks=24`），user docs 不在 schema 限额内（上传上限来自 Zod schema `documentCount.max(5)`） | ✅ 占位若干 | ✅ |
| `generation[]` | ✅ 合规报告 + 包键名 + trace | ✅ 占位 | ✅ |

### 3.4 `auditMetadata`

| 字段 | 真实 | Mock | 状态 |
|------|------|------|------|
| `schemaVersion` | ✅ `"report-package/v1"` | ✅ | ✅ |
| `generatedAt` | ✅ ISO 8601 | ✅ | ✅ |
| `validationStatus` | ✅ `"normalized"` / `"fallback"` / `"invalid"` | ✅ `"normalized"` | ✅ |
| `validationErrors` | ✅ `[]` | ✅ | ✅ |
| `provider` | ✅ `"minimax"`（唯一 LLM；embedding 栈已删，无 `"pai"` 值） | ✅ `"mock"` | ✅ |
| `traceNodeCount` | ✅ | ✅ | ✅ |

### 3.5 `productDossier`

| 字段 | 真实 | Mock | 状态 |
|------|------|------|------|
| `product` / `category` / `markets` / `query` | ✅ 由 `normalize_report_package` 自动补 | ✅ | ✅ |
| `sourceCounts` | ✅ `{retrievedChunks, userDocuments, visualItems, ...}` | ✅ | ✅ |

### 3.6 `profitReport`

| 字段 | 真实 | Mock | 状态 |
|------|------|------|------|
| `markdown` | ✅ 必填 | ✅ | ✅ |
| `keyConclusion` / `premiumPct` / `breakevenUnits` / `pricingStrategy` / `riskNote` / `conclusions` / `references` | ✅ 全部 Pydantic 字段 | ✅ 写死 | ✅ |

**结论**：mock 路径与真实路径同源字段已对齐。前端 `ProfitReportResult`（`lib/types.ts`）由 `lib/pipeline/profit-report.ts:synthesizeFinancialSummaryIfMissing` + `buildProfitRenderModelFromProfitReport`（用于 PDF/DOCX）从 `reportPackage.profitReport` 派生。

---

## 4. AgentTrace 字段对照

**真实**（`agent_trace` 数组每条结构）：

来源：线性 3 步管线节点自己写（`rag_service/pipeline/nodes/{vision,generator,verifier,findings_builder,visual_checks}.py`），**没有 Pydantic schema 约束**。已知字段：

```typescript
{
  node: string;             // "vision" | "generate" | "verify" | "findings_builder" | "visual_checks" | "refine"
  status?: string;          // "OK" | "WARN" | "FAIL" | "DEMO" | "MOCK" | "FALLBACK" | ...
  duration_ms?: number;
  score?: number;
  docs_retrieved?: number;
  message?: string;
  error?: string;
  [key: string]: unknown;   // 节点可能写任意额外字段
}
```

**Mock**（`lib/mock/blaze-scan-result.ts`）：

```typescript
[
  { node: "vision", status: "MOCK", duration_ms: 0, score: 0.7 },
  { node: "generate", status: "MOCK", duration_ms: 0, score: 0.68 },
  { node: "verify", status: "WARN", duration_ms: 0, score: 0.62 },
]
```

**状态**：✅ 字段名一致。但真实节点可能写更复杂的对象（如 `citations[]` / `subQueries[]`），前端 UI 要用 `String(trace.node)`、`Number(trace.duration_ms) ?? 0` 这类宽容读取。

> ⚠️ 旧文档此处列了 "retriever" / "query_planner" / "refine" / "synthesis" / "fan_out" 等 LangGraph 节点——这些节点随 LangGraph 形态塌缩已不存在（de-RAG §7.7，2026-09-14）。

---

## 5. ProfitReport 字段对照

`ProfitReportResult`（`lib/types.ts`）是**前端内部**的扁平结构。真实 RAG 返回 `ProfitReport`（Pydantic @ `rag_service/schemas/report_package.py`），结构化字段（`barebone` / `compliant` / `bareboneRiskExposure` 等）由前端 `lib/pipeline/profit-report.ts:buildProfitReportFromMarkdown` 从 markdown 重新解析。

| 前端 `ProfitReportResult` 字段 | 真实来源 | Mock 来源 | 状态 |
|-------------------------------|----------|-----------|------|
| `report` / `reportEn` | `reportPackage.profitReport.markdown` | `buildProfitReport` 拼 markdown | ✅ |
| `barebone` / `compliant` (CostSummary) | `buildProfitReportFromMarkdown` 解析 | 写死 | ⚠️ 解析风险 |
| `bareboneRiskExposure` / `compliantRiskExposure` | 同上 | 写死 | ⚠️ |
| `bareboneGpm` / `compliantGpm` | 计算 | 计算 | ✅ |
| `keyConclusion` / `conclusions` / `references` | markdown 解析 | 写死 | ⚠️ |
| `premiumPct` / `breakevenUnits` / `pricingStrategy` / `riskNote` | markdown 解析 | 写死 | ⚠️ |

**已知风险**：`buildProfitReportFromMarkdown` 用了一堆正则（`RE_S4_HEADER` / `RE_BREAKEVEN` / `RE_PREMIUM_PCT` 等），真实 LLM 输出的 markdown 微调就可能解析失败。**这是真实路径下的潜在静默退化点**。

**建议**：未来给 `ProfitReport` Pydantic 加 `structuredFields` 子结构（LLM 一次性输出 JSON 表 + markdown），前端不再正则解析。

---

## 6. CI 自动校验

- `tests/unit/report-package-contract.test.ts` 会喂 mock 输出给 `normalizeReportPackage`，断言不抛错 + 关键字段存在
- `tests/unit/profit-report-render-model.test.ts` 验证 `buildProfitRenderModelFromProfitReport` 的 RenderModel 派生
- CI 门控① `check:rag-contract`：由快照重生 `lib/rag-client/types.gen.ts` 并 diff，后端改字段时 PR 会 fail
- CI 门控② `check:rag-openapi`：直接比对 `rag_service` 的真实路由与 `openapi.snapshot.json`，防止快照本身落后于后端（详见 `FRONTEND-BACKEND-INTEGRATION.md` §5）

---

*最后更新：2026-09-17*