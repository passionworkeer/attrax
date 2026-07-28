# Actual Financial Report Integrity Implementation Plan

> **For Codex:** Required execution skills: `systematic-debugging`, `test-driven-development`, and `verification-before-completion`.

**Goal:** Make the profit page and its PDF/DOCX exports derive every real-scan financial figure from one validated structured payload, while keeping prose available and refusing detailed financial output when that payload is absent or invalid.

**Architecture:** The FastAPI report-package boundary validates a typed `profitReport.structuredFields.costComparison` payload and records finance-specific validation errors without replacing the prose report. The Next.js adapter accepts only this validated payload for a real scan, constructs a provenance-tagged `FinancialSummary`, and lets the page plus both export formats consume a single `ProfitRenderModel`. Demo data remains an explicit, arithmetically self-consistent fixture.

**Tech Stack:** Python 3.11/pytest/Pydantic v2, FastAPI report generator, TypeScript/Next.js, Vitest, Playwright, jsPDF, docx, LibreOffice, Poppler.

---

### Task 1: Define and validate the authoritative financial contract at the Python boundary

**Files:**
- Modify: `rag_service/schemas/report_package.py`
- Modify: `rag_service/generate/report_generator.py`
- Modify: `rag_service/tests/test_report_package_schema.py`
- Modify: `rag_service/tests/test_generator_node.py` (only if its package fixtures require the newly typed field)

**Step 1: Write the failing tests.**

Add schema cases that call `normalize_report_package` with `profitReport.structuredFields.costComparison`:

- accept complete `barebone` and `compliant` numeric cost summaries where every value is finite and non-negative and `asp - total == gp` within a documented two-decimal currency tolerance;
- reject a missing scenario, a string/NaN/infinite/negative value, and an equation mismatch by preserving `profitReport.markdown`, omitting the unusable financial payload, and adding a stable `financial_*` validation error plus `validationStatus: invalid`;
- preserve unrelated `ProfitReport` extension fields and existing packages that contain no structured finance.

Run `python -m pytest rag_service/tests/test_report_package_schema.py -q` and observe the new cases fail before implementation.

**Step 2: Implement the smallest typed validation boundary.**

In `rag_service/schemas/report_package.py`:

- introduce typed models for the numeric fields already represented by the frontend `CostSummary`: `bom`, `packaging`, `cert`, `epr`, `logistics`, `warranty`, `asp`, `total`, and `gp`;
- introduce a typed `costComparison` requiring both `barebone` and `compliant`, nested in a typed `structuredFields` model while retaining `FlexibleModel` support for non-financial extension fields;
- add a shared finite/non-negative validator and an after-validation invariant for each scenario: `abs((asp - total) - gp) <= 0.01` (or an explicitly named currency-rounding tolerance);
- during `normalize_report_package`, validate the structured field independently of the surrounding package. On failure, remove only the finance field, append deterministic finance validation messages to `auditMetadata.validationErrors`, and set `validationStatus` to `invalid`; do not overwrite markdown or inject fallback values.

**Step 3: Request the contract from the generator.**

Extend the JSON schema/example in `rag_service/generate/report_generator.py` so the single model response asks for numeric `profitReport.structuredFields.costComparison.barebone` and `.compliant` values, states the equation requirement, and explicitly says to omit the object rather than inventing a value. Do not add a second LLM call or change the retrieval/verification graph.

**Step 4: Verify the backend contract.**

Run:

```powershell
python -m pytest rag_service/tests/test_report_package_schema.py rag_service/tests/test_generator_node.py -q
```

Expected: all targeted tests pass; omitted finance remains an honest unavailable state, not a mock payload.

### Task 2: Replace markdown-derived real finance with a provenance-aware frontend adapter

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/types.blaze-hawks.ts`
- Modify: `lib/pipeline/profit-report.ts`
- Modify: `tests/unit/profit-report-structured-fields.test.ts`
- Replace/modify: `tests/unit/profit-report-synthesized-finance.test.ts`

**Step 1: Write failing adapter tests.**

Add cases for a real `ScanResult` with a valid `structuredFields.costComparison` payload:

- its baseline is the selected scenario `asp`, the total chain cost is `total`, and net is `gp`;
- known component rows plus a labelled residual operating-cost row exactly sum to `total`;
- all values are from the structured payload and `provenance` is `validated-backend`;
- markdown-only real input returns `null` for detailed finance even if a regex can extract numbers;
- malformed structured input returns `null`, never a demo fixture;
- an explicit demo summary is preserved, carries `provenance: demo`, and has `retailBaseline = chainCost + net`.

Run `npx vitest run tests/unit/profit-report-structured-fields.test.ts tests/unit/profit-report-synthesized-finance.test.ts --pool=forks --maxWorkers=1` and observe the new assertions fail.

**Step 2: Add explicit finance metadata.**

In `lib/types.blaze-hawks.ts`, add an explicit numeric `retailBaseline`, currency code/symbol metadata as needed by presentation, and `provenance: "demo" | "validated-backend"` to `FinancialSummary`. Keep amounts in existing display fields only at the presentation boundary; do not re-introduce a second hard-coded baseline.

In `lib/types.ts`, replace the loose `Record<string, unknown>` documentation with a TypeScript shape mirroring the validated backend contract. Keep API compatibility for unknown extension fields, but expose a narrow type guard for the authoritative cost comparison.

**Step 3: Make the adapter honor the source of truth.**

In `lib/pipeline/profit-report.ts`:

- add one exported helper that obtains detailed finance for a `ScanResult`: explicit demo `financialSummary` stays permitted; real data must be converted only from a complete structured cost comparison;
- derive cost rows from the active scenario's components. Calculate `residualOperatingCost = total - (bom + packaging + cert + epr + logistics + warranty)` with a small rounding tolerance. If positive, render it with a neutral label such as “Other reported operating cost”; if negative beyond tolerance, fail closed;
- use `asp`, `total`, and `gp` directly, and recheck `asp - total == gp` before returning a summary;
- remove the markdown/regex route from `synthesizeFinancialSummaryIfMissing` for real scans. Retain markdown in the report view, but return `null` for detailed board/export finance when no validated field exists;
- update legacy conversion helpers only where they feed active real-scan buttons, so legacy unit-level export tests continue to cover their explicitly supplied `ProfitReportResult` inputs without granting a markdown-only scan new financial authority.

**Step 4: Verify the adapter.**

Run the two focused Vitest files from Step 1. Expected: valid structured input is consistent; markdown-only and invalid real inputs are unavailable; demo is labelled and balanced.

### Task 3: Remove duplicated cost math from page and export model, and gate every active export entry point

**Files:**
- Modify: `app/profit/[sessionId]/page.tsx`
- Modify: `app/profit/[sessionId]/profit-export-panel.tsx`
- Modify: `lib/report-export-modules/profit-render-model.ts`
- Modify: `app/result/[sessionId]/page.tsx`
- Modify: `app/result/[sessionId]/result-export-button.tsx`
- Modify: `components/result/ProfitReportView.tsx` (if it still exposes a detailed profit export for markdown-only real data)
- Modify: `tests/unit/profit-export-render-model.test.ts`
- Modify: `tests/unit/profit-report-view.test.tsx`
- Modify: `tests/unit/reporting-real-profit.test.ts`

**Step 1: Write the failing consistency and gating tests.**

Add or extend tests that prove:

- the render model has no literal `128` baseline and its `retailBaseline`, `totalChainCost`, and `finalNetNumber` satisfy `baseline - chainCost == net` for each displayed mode;
- PDF and DOCX receive the same `ProfitRenderModel` values as the page and preserve the residual row label/value;
- a real markdown-only result displays the unavailable state and disables both detailed-profit download actions;
- a validated structured result enables both actions;
- demo exports still work and use a mathematically balanced fixture.

Run the relevant Vitest files with one worker and observe failing assertions before changing production code.

**Step 2: Centralize render math.**

In `lib/report-export-modules/profit-render-model.ts`, make `buildProfitRenderModel` the only chain-math owner:

- consume `FinancialSummary.retailBaseline` instead of `128`;
- calculate all chain nodes, total, final net, margin signal, and break-even buffer from the same chosen cost scenario;
- compare the calculated net to the supplied validated net and return no model (or a typed failure result) when they differ beyond the rounding tolerance;
- derive the final display value from that calculation, not independently from a string field.

Update `app/profit/[sessionId]/page.tsx` to request the single adapter summary/model before rendering, display the existing prose report with a clear unavailable message when no model exists, and consume model values instead of reimplementing chain calculations.

**Step 3: Apply the same availability rule to all user-reachable export buttons.**

Update `profit-export-panel`, result-page synthesis, and `result-export-button` to call the one adapter/model creation path and disable only the detailed finance PDF/DOCX actions when finance is unavailable. Preserve other report exports and compliance-report navigation. Do not make a markdown-only real result look like demo data.

**Step 4: Verify frontend behavior.**

Run:

```powershell
npx vitest run tests/unit/profit-export-render-model.test.ts tests/unit/profit-report-structured-fields.test.ts tests/unit/profit-report-synthesized-finance.test.ts tests/unit/profit-report-view.test.tsx tests/unit/reporting-real-profit.test.ts --pool=forks --maxWorkers=1
```

Expected: all pass, no hard-coded retail baseline remains in active profit-page/render-model code, and all active export paths share the same gate.

### Task 4: Build and inspect the browser/PDF/DOCX artefacts before release

**Files:**
- Modify only if a test fixture or existing Playwright test requires it: `tests/e2e/upload-scan-result.spec.ts`
- Verify: generated local PDF/DOCX artefacts (do not add binary outputs to Git)

**Step 1: Add or update a browser fixture path.**

Create a deterministic local/e2e fixture containing a valid structured financial payload and a markdown-only counterpart. Assert that the former renders balanced values and enabled downloads, while the latter retains prose and disabled detailed exports.

**Step 2: Build and run browser checks.**

Run the production build, start the local production server using the repository scripts, and run the targeted Playwright test. Capture browser console output and confirm no page exception occurs.

**Step 3: Render documents visually.**

Download one PDF and one DOCX from the valid fixture. Render the PDF with Poppler and DOCX through LibreOffice to PDF then Poppler using ASCII temporary paths and a file-URI `UserInstallation` profile. Inspect every rendered page for:

- page/PDF/DOCX identical baseline, total cost, net profit, and residual cost row;
- readable dark text on light PDF backgrounds;
- no clipping, blank pages, or unlabelled derived values.

Do not claim visual success based on generated bytes or unit tests alone.

### Task 5: Final regression, source traceability, and release handoff

**Files:**
- Modify if needed: deployment documentation or artifact manifest already used by this repository; do not alter server files in this task without separate deployment approval.

**Step 1: Run focused regression suites.**

Run the targeted TypeScript suites from Task 3 and:

```powershell
python -m pytest rag_service/tests/test_report_package_schema.py rag_service/tests/test_generator_node.py rag_service/tests/test_graph_e2e.py rag_service/tests/test_citation_verifier.py -q
```

Record any environment-only warnings separately from test failures.

**Step 2: Verify scope and source traceability.**

Run `git diff --check`, inspect `git status --short --branch`, and record the exact commit. Confirm that the existing degraded-verifier optimization remains unchanged and that no generated exports, browser sessions, credentials, or server artefacts are staged.

**Step 3: Request deployment authorization rather than deploy implicitly.**

The public PDF currently serves an older compiled artifact. After local verification, present the exact source commit and build artefact checks to the user and ask for explicit authorization to transfer/restart production. Once authorized, deploy only the reviewed artefact, restart the affected PM2 service, re-check `/api/v1/health`/`ready`, repeat the public download/render test, and record the deployed source identifier.

---

## Completion criteria

- Real detailed financial page/PDF/DOCX values originate only from validated structured finance and balance to currency rounding.
- A real report lacking validated finance remains readable as prose but cannot yield a fabricated detailed finance board or export.
- Demo data is visibly/provenance-marked and self-consistent.
- The performance retry optimization is untouched.
- Targeted Python/TypeScript tests, production build, browser downloads, and visual document renders pass.
- Production is not changed without explicit authorization, and any deployment becomes traceable to an exact reviewed commit.
