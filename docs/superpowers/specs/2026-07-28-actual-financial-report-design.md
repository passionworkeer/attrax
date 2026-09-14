# Actual Financial Report Integrity Design

> ⚠️ **SUPERSEDED — 2026-07-28 历史设计 spec**。该设计中提出的 financial report integrity 修复已全部落地（`lib/pipeline/profit-report.ts:synthesizeFinancialSummaryIfMissing` 在缺结构化字段时返回 null 而非伪造；`lib/rag-client/v1-adapter.ts` 透传后端真实 `backend profitReport.markdown`；利润页 PDF/DOCX 改走 RenderModel 唯一真值源）。

Date: 2026-07-28

## Goal

Keep the existing Next.js BFF and FastAPI RAG architecture, while ensuring that
the profit page and its PDF/DOCX exports never present fabricated or mutually
inconsistent financial figures for a real scan.

## Evidence

- Real v1 sessions currently carry `profitReport.markdown`; the frontend may
  parse it with regular expressions because the optional `structuredFields`
  contract is not consistently emitted by the generator.
- The profit page and `ProfitRenderModel` independently hard-code a retail
  baseline of 128 while displaying `FinancialSummary.trueNetProfit`. This
  permits `retail != chain_cost + net_profit`.
- The public demo currently exhibits that failure: retail 128, visible costs
  about 141.5, and displayed net profit 7.46. The same model feeds PDF and
  DOCX exports.
- Public PDF output is missing the local dark-on-light text treatment covered
  by `da3f816`; therefore the production compiled artifact must be rebuilt
  from the reviewed source before release.

## Non-goals

- No change to the FastAPI endpoint topology, BFF routes, access-token model,
  scan queue, retrieval stack, or verification routing.
- No invented business pricing, costs, or profit figures.
- No silent replacement of a real report with a demo fixture.

## Design

### 1. Authoritative financial payload

`profitReport.structuredFields.costComparison` becomes the authoritative
financial source for a real report. It contains numeric bare and compliant
cost summaries (`asp`, `total`, `gp`, and the known cost components).

The Python report-package schema validates finite non-negative values and
validates the compliant equation, allowing only normal currency rounding:

`asp - total = gp`

The report generator prompt requests these fields in its single JSON response.
If the model omits or violates them, normalization records a financial-data
validation error. The prose report remains available, but the detailed
financial board is not treated as valid data.

### 2. Frontend and export adaptation

For a real scan, the frontend uses the validated structured fields and never
uses regex-derived numbers as a substitute for an unavailable financial board.
The original backend markdown remains visible for review.

`FinancialSummary` gains explicit provenance and an explicit retail baseline.
`ProfitRenderModel` receives one financial source and derives every displayed
amount from it. The cost chain consists of known components plus a clearly
labelled residual operating-cost row when needed to reconcile to `total`.
It refuses to create a detailed board unless the values satisfy the same
equation. The page, PDF, and DOCX use that one model.

For the explicit demo route only, the fixture is marked `demo` and its retail
baseline is derived from its displayed cost total plus displayed net profit.
It remains a demo rather than an asserted market price, but is arithmetically
self-consistent.

### 3. Unavailable state

When a real report has no validated structured financial payload:

- preserve the backend markdown and report identity;
- show a concise `financial details unavailable` state;
- disable the detailed profit PDF/DOCX actions rather than generating a
  document with demo or regex-derived figures.

### 4. Regression tests and release gate

Tests will be written before production changes and cover:

1. valid structured financial data is accepted and maps to one consistent
   page/export model;
2. omitted or arithmetically invalid data is unavailable, never mock;
3. demo data is explicitly marked and self-consistent;
4. PDF/DOCX contain the same values as the page model and use readable dark
   text on their light backgrounds;
5. existing text-overlap verifier routing remains unchanged.

Release requires targeted TypeScript and Python tests, a local production
build, browser downloads for demo plus a structured-real fixture, and raster
inspection of each generated PDF/DOCX. Production deployment is a separate
authorized step: transfer the reviewed build artifacts, restart the affected
PM2 service, then re-check health and the public export flow.
