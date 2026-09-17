# New Frontend Backend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the approved new frontend while connecting every main-flow page and download to the FastAPI RAG service and MiniMax-M3.

**Architecture:** The Next.js application remains the browser-facing contract and proxies all scan resources through a small BFF adapter. FastAPI owns scan execution and MiniMax configuration; the frontend consumes a normalized terminal-state/result contract and never silently replaces backend data with mocks.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Vitest, Playwright, FastAPI, Pydantic Settings, pytest, Anthropic-compatible MiniMax API.

---

### Task 1: Lock the New Frontend Baseline

**Files:**
- Create: `scripts/verify-new-frontend-baseline.ps1`
- Create: `tests/unit/new-frontend-baseline.test.ts`
- Modify: `app/layout.tsx`
- Modify: `middleware.ts`
- Reference: `规航AI-源码-后端联调-20260717/guihang-ai-backend-handoff-20260717/app/**`
- Reference: `规航AI-源码-后端联调-20260717/guihang-ai-backend-handoff-20260717/components/**`

- [ ] **Step 1: Write failing structural tests**

```ts
it("does not mount the legacy site header in the approved layout", async () => {
  const source = await readFile("app/layout.tsx", "utf8");
  expect(source).not.toContain("BlazeHeader");
  expect(source).not.toContain("SiteHeader");
});

it("does not require a per-request nonce for cached framework scripts", async () => {
  const source = await readFile("middleware.ts", "utf8");
  expect(source).not.toContain("'nonce-${nonce}'");
});
```

- [ ] **Step 2: Run the tests and record the expected failure**

Run: `npm test -- tests/unit/new-frontend-baseline.test.ts`

Expected: FAIL because the integrated layout still mounts an old header and middleware emits a nonce CSP that cached scripts do not carry.

- [ ] **Step 3: Restore the approved shell and make CSP deterministic**

Keep the original frontend shell and use a production-safe CSP whose `script-src` works with Next.js static output. Do not weaken `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, or upload/API origin restrictions.

- [ ] **Step 4: Add a baseline verifier**

```powershell
param([string]$Original, [string]$Integrated)
$protected = @('app/page.tsx','app/globals.css','components/complipilot/homepage.tsx')
foreach ($relative in $protected) {
  $left = (Get-FileHash -LiteralPath (Join-Path $Original $relative)).Hash
  $right = (Get-FileHash -LiteralPath (Join-Path $Integrated $relative)).Hash
  if ($left -ne $right) { throw "Protected frontend drift: $relative" }
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/unit/new-frontend-baseline.test.ts && npm run typecheck`

Expected: both commands exit 0.

Commit: `fix(frontend): restore approved new frontend shell`

### Task 2: Centralize MiniMax Configuration

**Files:**
- Modify: `rag_service/config.py`
- Modify: `rag_service/orchestrator/nodes/vision.py`
- Modify: `rag_service/generate/report_generator.py`
- Modify: `docker-compose.yml`
- Modify: `.env.local.example`
- Modify: `.env.production.example`
- Create: `rag_service/tests/test_minimax_config.py`
- Modify: `rag_service/tests/test_smoke.py`

- [ ] **Step 1: Write failing configuration tests**

```python
def test_minimax_defaults(monkeypatch):
    monkeypatch.delenv("MINIMAX_BASE_URL", raising=False)
    monkeypatch.delenv("MINIMAX_MODEL", raising=False)
    settings = Settings(_env_file=None)
    assert settings.minimax_base_url == "https://api.minimaxi.com/anthropic/v1"
    assert settings.minimax_model == "MiniMax-M3"

def test_legacy_mimotalk_key_is_supported(monkeypatch):
    monkeypatch.setenv("MIMOTALK_API_KEY", "legacy-key")
    settings = Settings(_env_file=None)
    assert settings.effective_minimax_api_key == "legacy-key"
```

- [ ] **Step 2: Verify red**

Run: `python -m pytest rag_service/tests/test_minimax_config.py -q`

Expected: FAIL because the semantic MiniMax settings do not exist and defaults still reference mimo-v2.5.

- [ ] **Step 3: Implement one compatibility boundary**

```python
minimax_api_key: str = ""
minimax_base_url: str = "https://api.minimaxi.com/anthropic/v1"
minimax_model: str = "MiniMax-M3"

@property
def effective_minimax_api_key(self) -> str:
    return self.minimax_api_key or self.mimotalk_api_key
```

Vision and report generation must consume the effective settings rather than embedding provider defaults. Docker and examples must prefer `MINIMAX_*` and retain documented `MIMOTALK_*` fallback only.

- [ ] **Step 4: Verify and commit**

Run: `python -m pytest rag_service/tests/test_minimax_config.py rag_service/tests/test_smoke.py rag_service/tests/test_vision_node.py rag_service/tests/test_report_generator.py -q`

Expected: all selected tests pass.

Commit: `fix(rag): complete MiniMax configuration migration`

### Task 3: Normalize the Scan Contract and Terminal States

**Files:**
- Modify: `lib/rag-client/v1-adapter.ts`
- Modify: `lib/rag-client/v1-adapter.test.ts`
- Modify: `lib/hooks/useScanPolling.ts`
- Modify: `tests/unit/useScanPolling.test.tsx`
- Modify: `tests/unit/useScanPolling-helpers.test.ts`
- Modify: `app/burning/[sessionId]/page.tsx`

- [ ] **Step 1: Write failing degraded/failed status tests**

```ts
it.each(["ready", "degraded", "failed"])("stops polling on %s", (status) => {
  expect(isTerminalScanStatus(status)).toBe(true);
});

it("navigates a degraded scan to its result page", () => {
  expect(resultDestination("scan-1", "degraded")).toBe("/result/scan-1");
});
```

- [ ] **Step 2: Verify red**

Run: `npm test -- lib/rag-client/v1-adapter.test.ts tests/unit/useScanPolling.test.tsx tests/unit/useScanPolling-helpers.test.ts`

Expected: FAIL on the current status mapping/polling contract.

- [ ] **Step 3: Implement the explicit state machine**

```ts
export type ScanStatus = "processing" | "ready" | "degraded" | "failed";
export const isTerminalScanStatus = (value: ScanStatus) => value !== "processing";
export const hasDisplayableResult = (value: ScanStatus) =>
  value === "ready" || value === "degraded";
```

Polling continues only for `processing`; the burning page navigates on displayable terminal states and renders a retryable error for `failed`.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- lib/rag-client/v1-adapter.test.ts tests/unit/useScanPolling.test.tsx tests/unit/useScanPolling-helpers.test.ts tests/unit/burning-animation.test.tsx`

Expected: all selected tests pass.

Commit: `fix(scan): align polling with backend terminal states`

### Task 4: Remove Silent Mock Substitution

**Files:**
- Modify: `app/result/[sessionId]/page.tsx`
- Modify: `lib/schemas.ts`
- Modify: `lib/types.ts`
- Modify: `tests/unit/schemas.test.ts`
- Modify: `tests/unit/result-compliancereport.test.tsx`
- Modify: `tests/unit/result-reportpanels.test.tsx`

- [ ] **Step 1: Write failing result-provenance tests**

```ts
it("does not synthesize a mock result when financialSummary is absent", () => {
  const parsed = normalizeScanResult({ status: "degraded", report: "partial" });
  expect(parsed.provenance).toBe("backend-degraded");
  expect(parsed.financialSummary).toBeUndefined();
});
```

- [ ] **Step 2: Verify red**

Run: `npm test -- tests/unit/schemas.test.ts tests/unit/result-compliancereport.test.tsx tests/unit/result-reportpanels.test.tsx`

Expected: FAIL because the result page currently selects `mockScanResult` when a financial field is missing.

- [ ] **Step 3: Add explicit provenance and partial rendering**

```ts
type ResultProvenance = "backend-ready" | "backend-degraded";
type NormalizedScanResult = ScanResult & { provenance: ResultProvenance };
```

Render unavailable sections as unavailable, and show the existing degraded banner for `backend-degraded`. Do not import `mockScanResult` in the real result route.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/unit/schemas.test.ts tests/unit/result-compliancereport.test.tsx tests/unit/result-reportpanels.test.tsx tests/unit/mock-scan-result.test.ts`

Expected: all selected tests pass while isolated mock fixture tests remain valid.

Commit: `fix(result): expose partial backend data without mock fallback`

### Task 5: Proxy All Session Resources Through FastAPI

**Files:**
- Modify: `lib/rag-client/v1-adapter.ts`
- Modify: `lib/rag-client/client.ts`
- Modify: `app/api/roadmap/[sessionId]/route.ts`
- Modify: `app/api/trace/[sessionId]/route.ts`
- Restore/Modify: `app/api/report/[sessionId]/[reportType]/route.ts`
- Restore/Modify: `app/api/scan/[sessionId]/asset/[index]/route.ts`
- Modify: `tests/unit/api-roadmap-session.test.ts`
- Modify: `tests/unit/api-trace-session.test.ts`
- Modify: `tests/unit/report-package-contract.test.ts`
- Create: `tests/unit/api-scan-asset.test.ts`

- [ ] **Step 1: Write failing proxy tests**

```ts
it("forwards the session token to the roadmap upstream", async () => {
  await GET(requestWithBearer("token-1"), contextFor("scan-1"));
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/api/v1/scans/scan-1/roadmap"),
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token-1" }) }),
  );
});
```

Repeat the contract for trace, each supported report type, and indexed assets. Add negative tests for missing token, invalid report type, and out-of-range asset index.

- [ ] **Step 2: Verify red**

Run: `npm test -- tests/unit/api-roadmap-session.test.ts tests/unit/api-trace-session.test.ts tests/unit/report-package-contract.test.ts tests/unit/api-scan-asset.test.ts`

Expected: FAIL because current roadmap/trace routes use local session storage and report/asset routes are absent.

- [ ] **Step 3: Implement authenticated resource proxies**

```ts
const accessToken = requireSessionAccess(request, sessionId);
return ragClient.getRoadmap(sessionId, accessToken);
```

All resource methods share upstream URL construction, timeout handling, bearer propagation and safe error mapping. Binary responses preserve `Content-Type` and `Content-Disposition`.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/unit/api-roadmap-session.test.ts tests/unit/api-trace-session.test.ts tests/unit/report-package-contract.test.ts tests/unit/api-scan-asset.test.ts tests/unit/session-auth.test.ts`

Expected: all selected tests pass.

Commit: `feat(api): proxy complete scan resource contract`

### Task 6: Connect New Frontend Pages to One Real Session

**Files:**
- Modify: `app/upload/page.tsx`
- Modify: `app/result/[sessionId]/page.tsx`
- Modify: `app/roadmap/[sessionId]/page.tsx`
- Modify: `app/trace/page.tsx`
- Modify: `app/profit/[sessionId]/page.tsx`
- Modify: `lib/report-download.ts`
- Modify: `tests/e2e/upload-scan-result.spec.ts`
- Modify: `tests/e2e/export-downloads.spec.ts`
- Modify: `tests/e2e/pages.spec.ts`

- [ ] **Step 1: Add failing browser contract assertions**

```ts
await page.setInputFiles('input[type="file"]', fixturePath);
await page.getByRole("button", { name: /开始|scan/i }).click();
await expect(page).toHaveURL(/\/result\/[0-9A-Z-]+/);
const sessionId = page.url().split("/").pop();
await page.getByRole("link", { name: /路线图|roadmap/i }).click();
await expect(page).toHaveURL(new RegExp(`/roadmap/${sessionId}`));
```

- [ ] **Step 2: Verify red against production build**

Run: `npm run build && npm run test:e2e -- tests/e2e/upload-scan-result.spec.ts tests/e2e/export-downloads.spec.ts tests/e2e/pages.spec.ts`

Expected: FAIL on stale session-store routes, silent mock result, or missing report route.

- [ ] **Step 3: Bind every page and download to sessionId/accessToken**

Use the access token established by the upload response for all client fetches. Preserve the approved visual components; only change data loading, terminal/error handling and link construction.

- [ ] **Step 4: Verify and commit**

Run: `npm run build && npm run test:e2e -- tests/e2e/upload-scan-result.spec.ts tests/e2e/export-downloads.spec.ts tests/e2e/pages.spec.ts`

Expected: build exits 0 and selected E2E tests pass.

Commit: `feat(frontend): connect approved flow to real scan session`

### Task 7: Full Regression and Live MiniMax Acceptance

**Files:**
- Create: `docs/verification/2026-07-17-new-frontend-backend-integration.md`
- Modify only if a newly reproduced failure receives its own red-green regression test.

- [ ] **Step 1: Run complete automated regression**

Run:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
python -m pytest rag_service/tests -q
npm audit --omit=dev
```

Expected: zero test, typecheck, lint and build failures; dependency findings are recorded by severity rather than hidden.

- [ ] **Step 2: Start services with ephemeral MiniMax credentials**

```powershell
$env:MINIMAX_API_KEY = Read-Host -AsSecureString | ConvertFrom-SecureString
# The execution harness injects the supplied plaintext only into the child
# FastAPI process and never prints or persists it.
```

Start FastAPI on port 8001 and the production Next.js build on port 3000 with `RAG_API_URL=http://127.0.0.1:8001`.

- [ ] **Step 3: Execute live API and browser acceptance**

Upload a real supported fixture, capture sessionId without capturing the token/key, poll using bounded condition waiting until `ready | degraded | failed`, and verify:

```text
home -> upload -> burning -> result -> roadmap -> trace -> profit
result -> every exposed report download returns HTTP 200 and non-empty content
wrong/missing session access -> HTTP 401 or 403
production CSP -> no blocked first-party scripts and page remains interactive
```

- [ ] **Step 4: Scan repository and artifacts for the supplied secret**

Run a fixed-string scan using only a one-way fingerprint or masked prefix; never place the plaintext key in the command line or verification document.

Expected: no tracked/untracked file or generated artifact contains the credential.

- [ ] **Step 5: Write verification evidence and commit**

Record exact commands, pass/fail counts, terminal scan status, HTTP status matrix, screenshots, residual risks and reproduction commands. Do not include credentials or bearer tokens.

Commit: `test: verify complete new frontend MiniMax flow`
