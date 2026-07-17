// @vitest-environment node
/**
 * scan-integration.test.ts — TRUE integration test for POST /api/scan (handoff).
 *
 * After the v1-adapter rewire, this route is a thin forwarder to FastAPI
 * `/api/v1/scans` (no local pipeline). This test exercises:
 *   1. The route handler actually calls the v1-adapter with multipart body
 *   2. The BFF returns the wire-shape the upload page reads
 *      (`{ sessionId, status, pollUrl, accessToken }`)
 *   3. Validation rejections don't trigger any adapter call
 *   4. V1 envelope errors propagate to the client with their HTTP status
 *
 * The seam we mock is `lib/rag-client/v1-adapter` — that's the single
 * forwarder the route uses. Everything inside the route handler is real
 * (form parsing, validation, multipart assembly, response shaping).
 *
 * Run with: npx vitest run tests/unit/scan-integration.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock ONLY the v1-adapter boundary. Everything inside the route handler
// (form parsing, validation, multipart assembly, response shaping) is real.
const { mockCreateScan, mockGetScan } = vi.hoisted(() => ({
  mockCreateScan: vi.fn(),
  mockGetScan: vi.fn(),
}));

vi.mock("@/lib/rag-client/v1-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rag-client/v1-adapter")>(
    "@/lib/rag-client/v1-adapter",
  );
  return {
    ...actual,
    createScan: mockCreateScan,
    getScan: mockGetScan,
  };
});

const { POST } = await import("@/app/api/scan/route");

// ── Helpers ─────────────────────────────────────────────────────────────────

// Minimal valid JPEG bytes (passes the route's image mime-type check).
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

// ── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/scan — handoff BFF (no v1 network)", () => {
  beforeEach(() => {
    mockCreateScan.mockReset();
    mockGetScan.mockReset();
    // Default: v1 returns a valid CreatedScanData response.
    mockCreateScan.mockResolvedValue({
      sessionId: "scan_test123",
      accessToken: "tok_test",
      status: "processing",
      pollUrl: "/api/v1/scans/scan_test123",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 202 with sessionId, accessToken, and a remapped pollUrl", async () => {
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData(),
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sessionId).toBe("scan_test123");
    expect(body.accessToken).toBe("tok_test");
    expect(body.status).toBe("processing");
    // CRITICAL: pollUrl is remapped from /api/v1/scans/{id} to /api/scan/{id}
    // so the upload page keeps using the BFF route.
    expect(body.pollUrl).toBe("/api/scan/scan_test123");
  });

  it("forwards images, category, and markets to the v1 adapter", async () => {
    const images = [makeImage("front.jpg"), makeImage("back.jpg")];
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData({ images, category: "toy", markets: "EU,US,UK" }),
    });
    await POST(req);

    expect(mockCreateScan).toHaveBeenCalledTimes(1);
    const [input] = mockCreateScan.mock.calls[0];
    expect(input.images).toHaveLength(2);
    expect(input.images[0].originalName).toBe("front.jpg");
    expect(input.images[0].mimeType).toBe("image/jpeg");
    expect(input.images[0].buffer).toBeInstanceOf(Buffer);
    expect(input.category).toBe("toy");
    expect(input.markets).toEqual(["EU", "US", "UK"]);
  });

  it("surfaces v1 4xx errors with their original HTTP status (validation passthrough)", async () => {
    const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
    mockCreateScan.mockRejectedValueOnce(
      new V1EnvelopeError("INVALID_MARKET", "unknown market XX", 400, "req-1"),
    );

    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData({ markets: "XX" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_MARKET");
  });

  it("collapses v1 5xx / network errors to 502 RAG_SERVICE_UNAVAILABLE", async () => {
    mockCreateScan.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData(),
    });
    const res = await POST(req);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("RAG_SERVICE_UNAVAILABLE");
  });

  it("rejects requests with no images at the validation layer (no adapter call)", async () => {
    const fd = new FormData();
    fd.append("category", "electronics");
    fd.append("markets", "EU");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("BAD_INPUT");
    expect(mockCreateScan).not.toHaveBeenCalled();
  });

  it("forwards documents when supplied alongside images", async () => {
    const fd = buildFormData();
    // Minimal valid PDF (just the header so the mime-type check passes).
    const pdfBytes = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xc7, 0xec, 0x8f, 0xa2, 0x0a,
    ]);
    const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
    new Uint8Array(pdfBuffer).set(pdfBytes);
    fd.append("documents", new File([pdfBuffer], "manual.pdf", { type: "application/pdf" }));

    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: fd,
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    const [input] = mockCreateScan.mock.calls[0];
    expect(input.documents).toHaveLength(1);
    expect(input.documents[0].mimeType).toBe("application/pdf");
  });
});

describe("GET /api/scan/[sessionId] — handoff BFF (no v1 network)", () => {
  beforeEach(() => {
    mockCreateScan.mockReset();
    mockGetScan.mockReset();
  });

  it("demo short-circuits without calling the adapter", async () => {
    const { GET } = await import("@/app/api/scan/[sessionId]/route");
    const req = new Request("http://localhost/api/scan/demo");
    const ctx = { params: Promise.resolve({ sessionId: "demo" }) };

    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessionId).toBe("demo");
    expect(body.status).toBe("ready");
    expect(mockGetScan).not.toHaveBeenCalled();
  });

  it("returns 401 when no token is supplied", async () => {
    const { GET } = await import("@/app/api/scan/[sessionId]/route");
    const req = new Request("http://localhost/api/scan/scan_abc");
    const ctx = { params: Promise.resolve({ sessionId: "scan_abc" }) };

    const res = await GET(req, ctx);

    expect(res.status).toBe(401);
    expect(mockGetScan).not.toHaveBeenCalled();
  });

  it("forwards sessionId + Bearer token to v1 and returns the mapped status", async () => {
    mockGetScan.mockResolvedValueOnce({
      sessionId: "scan_abc",
      status: "ready",
      progress: 100,
      stageText: "完成",
      category: "electronics",
      markets: ["EU"],
      createdAt: "2026-07-17T00:00:00Z",
      updatedAt: "2026-07-17T00:01:00Z",
      result: { sessionId: "scan_abc", complianceScore: 85, scoreGrade: "B" },
      error: null,
    });

    const { GET } = await import("@/app/api/scan/[sessionId]/route");
    const req = new Request("http://localhost/api/scan/scan_abc", {
      headers: { authorization: "Bearer tok_abc" },
    });
    const ctx = { params: Promise.resolve({ sessionId: "scan_abc" }) };

    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessionId).toBe("scan_abc");
    expect(body.status).toBe("ready");
    expect(body.result.complianceScore).toBe(85);
    expect(mockGetScan).toHaveBeenCalledWith({
      sessionId: "scan_abc",
      accessToken: "tok_abc",
    });
  });

  it("maps v1 NOT_FOUND to 404 with NOT_FOUND code", async () => {
    const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
    mockGetScan.mockRejectedValueOnce(
      new V1EnvelopeError("NOT_FOUND", "no such session", 404, "req-x"),
    );

    const { GET } = await import("@/app/api/scan/[sessionId]/route");
    const req = new Request("http://localhost/api/scan/scan_missing", {
      headers: { authorization: "Bearer t" },
    });
    const ctx = { params: Promise.resolve({ sessionId: "scan_missing" }) };

    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
