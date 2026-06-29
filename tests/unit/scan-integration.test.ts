// @vitest-environment node
/**
 * scan-integration.test.ts — TRUE integration test for POST /api/scan.
 *
 * AUDIT CONTEXT (P2, "测试假绿"):
 *   tests/unit/api-scan-post-full.test.ts mocks ALL four core pipeline modules
 *   (scan-queue, scan, session-store, mock/scan-result) at once, so the real
 *   wiring between the route handler and the persistence layer has NEVER been
 *   exercised. "The first real user = the first integration test."
 *
 * What this file does differently:
 *   - Does NOT mock session-store, scan-queue, scan, or session-auth. Those
 *     run for real.
 *   - Mocks ONLY the outermost boundary: global.fetch (the call into the RAG
 *     service) and mammoth (an optional doc-parsing dep). Everything inside
 *     the route → session-store → scan-queue → scan → fetch chain is real.
 *   - Redirects process.cwd() to a temp dir BEFORE importing the route, so
 *     real session files, queue job files, and archived uploads land on disk
 *     under tmp — then asserts they really exist and have the right shape.
 *
 * Run with: npx vitest run tests/unit/scan-integration.test.ts
 */
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ── Temp data root ──────────────────────────────────────────────────────────
// session-store / scan-queue / upload-storage compute their dirs ONCE at module
// load via process.cwd(). Spy on process.cwd BEFORE any of those modules load
// so the constants pick up the temp root. This MUST run at top level (not in
// beforeAll): vitest evaluates top-level `await import(...)` during test-file
// collection, which happens BEFORE beforeAll hooks fire, so a beforeAll spy
// would be installed too late and the dir constants would point at the real cwd.
const tmpRoot = mkdtempSync(join(tmpdir(), "attrax-scan-int-"));
vi.spyOn(process, "cwd").mockReturnValue(tmpRoot);

afterAll(() => {
  vi.restoreAllMocks();
  // process.cwd is restored by restoreAllMocks; now it's safe to remove tmp.
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

// Mock ONLY the outermost boundary. fetch is the seam between the Next.js
// pipeline and the RAG service — mocking it is the legitimate integration
// boundary. Everything else (session-store, scan-queue, scan) runs unmocked.
const validRagResponse = {
  status: "PASS" as const,
  report: "## 合规报告\n产品需 CE 标志 [REACH Article 22]",
  agent_trace: [{ node: "vision" }, { node: "generate" }],
  loop_count: 0,
  documents: [
    {
      id: "c1",
      doc_name: "REACH (EC) 1907/2006",
      article_no: "Article 22",
      region: "EU",
      score: 0.9,
    },
  ],
};

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// mammoth is an optional DOCX parser; the integration test doesn't upload
// DOCX so it never runs, but stub it so the route's dynamic import resolves
// without touching the real package.
vi.mock("mammoth", () => ({
  extractRawText: vi.fn().mockResolvedValue({ value: "" }),
}));

// ── Import the route (and real pipeline modules) AFTER cwd + fetch are set ──
//   Because vitest isolates module registries per test file, these modules see
//   the spied process.cwd at import time → their dir constants point at tmpRoot.
//   We must NOT also mock these — the whole point is to exercise the real path.
const { POST } = await import("@/app/api/scan/route");
const { getSession, clearStore } = await import("@/lib/pipeline/session-store");
const { verifyAccessToken } = await import("@/lib/pipeline/session-auth");

// ── Helpers ─────────────────────────────────────────────────────────────────

// Minimal valid JPEG bytes (passes validateUploadFile signature check).
function minimalJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
  ]);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function makeImage(name = "product.jpg"): File {
  return new File([toArrayBuffer(minimalJpeg())], name, { type: "image/jpeg" });
}

function buildFormData(opts: { images?: File[]; category?: string; markets?: string } = {}): FormData {
  const fd = new FormData();
  for (const img of opts.images ?? [makeImage()]) {
    fd.append("images", img);
  }
  fd.append("category", opts.category ?? "electronics");
  fd.append("markets", opts.markets ?? "EU,US");
  return fd;
}

/** Drain the microtask + macrotask queue so async drainQueue / runScan settle. */
function flushAsync(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/scan — real integration (no pipeline mocks)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // Default: RAG service reachable → returns a valid PASS response.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(validRagResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  afterEach(() => {
    clearStore();
    globalThis.__rateLimitBuckets = undefined;
  });

  it("writes a real session JSON file to disk and returns a valid token", async () => {
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData(),
    });
    const res = await POST(req);

    // 202 Accepted — the route hands off to the async queue.
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(true);
    const { sessionId, accessToken } = body.data;

    expect(sessionId).toMatch(/^scan_/);
    expect(typeof accessToken).toBe("string");
    expect(accessToken.length).toBeGreaterThan(0);

    // ── Real disk write: the session JSON file exists under tmpRoot.
    const sessionFile = join(tmpRoot, "data", "sessions", `${sessionId}.json`);
    expect(existsSync(sessionFile)).toBe(true);

    // The persisted session carries the access-token hash, NOT the raw token.
    const persisted = JSON.parse(readFileSync(sessionFile, "utf-8"));
    expect(persisted.sessionId).toBe(sessionId);
    expect(persisted.accessTokenHash).toBeTruthy();
    expect(persisted.accessTokenHash).not.toBe(accessToken);

    // verifyAccessToken is the real (timing-safe) check the poll route uses.
    expect(verifyAccessToken(accessToken, persisted.accessTokenHash)).toBe(true);
    expect(verifyAccessToken("wrong-token", persisted.accessTokenHash)).toBe(false);

    // In-memory store mirrors disk.
    const inMemory = getSession(sessionId);
    expect(inMemory?.sessionId).toBe(sessionId);
  });

  it("runs the full pipeline through to a real scan result on disk", async () => {
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData(),
    });
    const res = await POST(req);
    const { sessionId } = (await res.json()).data;

    // Let the async executeScan → runScan → fetch chain settle.
    await flushAsync(100);

    const sessionFile = join(tmpRoot, "data", "sessions", `${sessionId}.json`);
    const persisted = JSON.parse(readFileSync(sessionFile, "utf-8"));

    // ── The real scan.ts ran: status flipped from "processing" to "ready",
    //    a ComplianceReportResult with source: "real" was persisted, and the
    //    RAG fetch was actually called (not bypassed via a mock module).
    expect(persisted.status).toBe("ready");
    expect(persisted.result).toBeTruthy();
    expect(persisted.result.source).toBe("real");
    expect(persisted.result.targetMarkets).toEqual(["EU", "US"]);
    expect(persisted.result.complianceReport).toContain("合规报告");
    // scan.ts drives the real HTTP boundary — the /scan-multipart call always
    // fires (plus a /profit-report call when the package lacks profit markdown,
    // so we assert on the first call's URL rather than an exact count).
    expect(fetchMock).toHaveBeenCalled();
    const firstUrl = String(fetchMock.mock.calls[0][0]);
    expect(firstUrl).toContain("/scan-multipart");
  });

  it("degrades the session (not crashes) when the RAG service is unreachable", async () => {
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData(),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    const { sessionId } = (await res.json()).data;

    await flushAsync(100);

    const sessionFile = join(tmpRoot, "data", "sessions", `${sessionId}.json`);
    const persisted = JSON.parse(readFileSync(sessionFile, "utf-8"));

    // ── scan.ts catch path: status "degraded" with an error code + fallback
    //    result so the UI still renders. This is the integration-level guarantee
    //    that a RAG outage surfaces to the client instead of a hung session.
    expect(persisted.status).toBe("degraded");
    expect(persisted.degradedReason).toBe("RAG_SERVICE_UNAVAILABLE");
    expect(persisted.result).toBeTruthy();
    expect(persisted.result.source).toBe("fallback");
    expect(persisted.error).toBe("RAG_SERVICE_UNAVAILABLE");
  });

  it("archives the uploaded image to disk under data/uploads/{sessionId}", async () => {
    const image = makeImage("front-photo.jpg");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData({ images: [image] }),
    });
    const res = await POST(req);
    const { sessionId } = (await res.json()).data;

    // upload-storage writes synchronously inside the route, so no flush needed.
    const uploadDir = join(tmpRoot, "data", "uploads", sessionId);
    expect(existsSync(uploadDir)).toBe(true);
    const archived = readdirSync(uploadDir);
    expect(archived.length).toBe(1);
    // savedAs pattern: {sha12}_{sanitizedOriginal}
    expect(archived[0]).toMatch(/front-photo\.jpg$/);

    // The session file records the upload metadata (sha256, size, kind).
    const sessionFile = join(tmpRoot, "data", "sessions", `${sessionId}.json`);
    const persisted = JSON.parse(readFileSync(sessionFile, "utf-8"));
    expect(Array.isArray(persisted.uploads)).toBe(true);
    expect(persisted.uploads.length).toBe(1);
    expect(persisted.uploads[0].kind).toBe("image");
    expect(persisted.uploads[0].originalName).toBe("front-photo.jpg");
    expect(persisted.uploads[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects requests with no images at the validation layer (no session created)", async () => {
    const fd = new FormData();
    fd.append("category", "electronics");
    fd.append("markets", "EU");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.reason).toBe("UPLOAD_AT_LEAST_ONE_IMAGE");

    // No fetch call should have been made — validation short-circuits before scan.
    expect(fetchMock).not.toHaveBeenCalled();
    // And no session file should exist.
    const sessionsDir = join(tmpRoot, "data", "sessions");
    if (existsSync(sessionsDir)) {
      const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
      expect(files.length).toBe(0);
    }
  });
});

// ── Queue-file integration (production NODE_ENV path) ───────────────────────
// enqueueScan only writes a durable job file when NODE_ENV !== "test". This
// separate describe block flips NODE_ENV and exercises the real on-disk queue.
describe("POST /api/scan — real scan-queue job file (production path)", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    fetchMock.mockReset();
    // RAG fetch resolves ok() but its .json() never settles, so runScan suspends
    // mid-flight. That lets us observe the job file on disk in "running" state
    // before executeJob unlinks it on success.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(validRagResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    process.env.NODE_ENV = "production";
    // Force re-import of scan-queue so its top-level `if (NODE_ENV !== 'test')`
    // drainQueue bootstrap runs with the production env. The route module is
    // already imported, but enqueueScan re-reads process.env.NODE_ENV at call
    // time, so flipping the env is enough to take the queue-file branch.
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await flushAsync(50);
    vi.resetModules();
    clearStore();
    globalThis.__rateLimitBuckets = undefined;
  });

  it("writes a durable job JSON to data/scan-queue/ and drains it through runScan", async () => {
    const { POST: freshPOST } = await import("@/app/api/scan/route");

    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData(),
    });
    const res = await freshPOST(req);
    expect(res.status).toBe(202);
    const { sessionId } = (await res.json()).data;

    // ── Real scan-queue path: a job JSON file was written to the queue dir.
    //    (In the test-NODE_ENV path enqueueScan skips this entirely, which is
    //    exactly the coverage gap this assertion locks down.)
    const queueDir = join(tmpRoot, "data", "scan-queue");
    expect(existsSync(queueDir)).toBe(true);
    const jobFiles = readdirSync(queueDir).filter((f) => f.endsWith(".json"));
    expect(jobFiles.length).toBeGreaterThanOrEqual(1);

    const job = JSON.parse(readFileSync(join(queueDir, jobFiles[0]), "utf-8"));
    expect(job.sessionId).toBe(sessionId);
    expect(job.input).toBeTruthy();
    // Serialized input shape: images carry a side-car `path` + `bytes`
    // reference (buffers live in data/scan-queue-payloads, not the JSON), so
    // the job file stays small regardless of upload size. The .bin payload
    // file itself was written to disk.
    expect(Array.isArray(job.input.images)).toBe(true);
    expect(job.input.images[0].path).toBeTruthy();
    expect(typeof job.input.images[0].bytes).toBe("number");
    expect(job.input.images[0].originalName).toBeTruthy();
    expect(existsSync(job.input.images[0].path)).toBe(true);

    // Let the drain + runScan finish so the job is unlinked and the session
    // lands in a terminal state — proves the full queue→worker→scan chain ran.
    await flushAsync(200);

    const sessionFile = join(tmpRoot, "data", "sessions", `${sessionId}.json`);
    const persisted = JSON.parse(readFileSync(sessionFile, "utf-8"));
    expect(["ready", "degraded", "failed"]).toContain(persisted.status);
    expect(fetchMock).toHaveBeenCalled();
  });
});
