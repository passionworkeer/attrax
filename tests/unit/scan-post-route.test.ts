vi.stubEnv("ATTRAX_DEBUG_TOKEN", "1"); // 审计 3.4：token 仅显式 opt-in 时进响应体
// @vitest-environment node

/**
 * Unit tests for POST /api/scan (handoff BFF).
 *
 * The route is now a thin forwarder to FastAPI /api/v1/scans via
 * `lib/rag-client/v1-adapter`. We mock the adapter module directly so the
 * tests stay hermetic and don't need a running RAG service.
 *
 * Run with: npx vitest run tests/unit/scan-post-route.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateScan } = vi.hoisted(() => ({
  mockCreateScan: vi.fn(),
}));

vi.mock("@/lib/rag-client/v1-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rag-client/v1-adapter")>(
    "@/lib/rag-client/v1-adapter",
  );
  return {
    ...actual,
    createScan: mockCreateScan,
  };
vi.unstubAllEnvs();
});

// Helper: create a minimal JPEG buffer
function minimalJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
  ]);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function makeFile(name: string, type = "image/jpeg"): File {
  return new File([toArrayBuffer(minimalJpeg())], name, { type });
}

function buildFormData(
  opts: { images?: File[]; documents?: File[]; category?: string; markets?: string } = {},
): FormData {
  const fd = new FormData();
  for (const img of opts.images ?? [makeFile("test.jpg")]) {
    fd.append("images", img);
  }
  for (const doc of opts.documents ?? []) {
    fd.append("documents", doc);
  }
  fd.append("category", opts.category ?? "electronics");
  fd.append("markets", opts.markets ?? "EU,US");
  return fd;
}

describe("POST /api/scan", () => {
  beforeEach(() => {
    mockCreateScan.mockReset();
    mockCreateScan.mockResolvedValue({
      sessionId: "scan_abc123",
      accessToken: "tok_test",
      status: "processing",
      pollUrl: "/api/v1/scans/scan_abc123",
    });
  });

  it("returns 202 with sessionId for valid image upload", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    const res = await POST(req);

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.sessionId).toMatch(/^scan_/);
    expect(body.status).toBe("processing");
    expect(body.pollUrl).toContain(body.sessionId);
  });

  it("returns accessToken alongside sessionId so callers can send Bearer header on subsequent polls", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    const res = await POST(req);
    const body = await res.json();

    expect(body.accessToken).toBe("tok_test");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("set-cookie")).toContain("attrax_scan_scan_abc123");
  });

  it("remaps the v1 pollUrl to the Next.js BFF route /api/scan/{id}", async () => {
    mockCreateScan.mockResolvedValue({
      sessionId: "scan_xyz",
      accessToken: "tok",
      status: "processing",
      pollUrl: "/api/v1/scans/scan_xyz",
    });
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    const res = await POST(req);
    const body = await res.json();

    expect(body.pollUrl).toBe("/api/scan/scan_xyz");
  });

  it("forwards the createScan input with images, category, and markets", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    await POST(req);

    expect(mockCreateScan).toHaveBeenCalledTimes(1);
    const [input] = mockCreateScan.mock.calls[0];
    expect(input.category).toBe("electronics");
    expect(input.markets).toEqual(["EU", "US"]);
    expect(input.images).toHaveLength(1);
    expect(input.images[0].buffer).toBeInstanceOf(Buffer);
    expect(input.images[0].mimeType).toBe("image/jpeg");
    expect(typeof input.images[0].originalName).toBe("string");
  });

  it("returns 400 when no images provided", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const fd = buildFormData({ images: [] });
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(mockCreateScan).not.toHaveBeenCalled();
  });

  it("parses comma-separated markets correctly", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const fd = buildFormData({ markets: "EU, UK, US" });
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    await POST(req);

    const [input] = mockCreateScan.mock.calls[0];
    expect(input.markets).toEqual(["EU", "UK", "US"]);
  });

  it("accepts multiple images", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const images = [makeFile("a.jpg"), makeFile("b.jpg"), makeFile("c.jpg")];
    const fd = buildFormData({ images });
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    await POST(req);

    const [input] = mockCreateScan.mock.calls[0];
    expect(input.images).toHaveLength(3);
  });

  it("maps V1EnvelopeError to its httpStatus", async () => {
    const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
    mockCreateScan.mockRejectedValueOnce(
      new V1EnvelopeError("INVALID_REQUEST", "bad markets", 400, "req-1"),
    );

    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.message).toBe("bad markets");
  });

  it("collapses infrastructure errors (5xx) to 502 RAG_SERVICE_UNAVAILABLE", async () => {
    const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
    mockCreateScan.mockRejectedValueOnce(
      new V1EnvelopeError("RAG_SERVICE_UNAVAILABLE", "boom", 503, null),
    );

    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    const res = await POST(req);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("RAG_SERVICE_UNAVAILABLE");
  });

  it("maps non-V1EnvelopeError to 502 RAG_SERVICE_UNAVAILABLE", async () => {
    mockCreateScan.mockRejectedValueOnce(new Error("network"));

    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    const res = await POST(req);

    expect(res.status).toBe(502);
  });

  it("returns 400 for image over 12MB", async () => {
    const { POST } = await import("@/app/api/scan/route");
    // 13MB JPEG
    const big = new Uint8Array(13 * 1024 * 1024);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    const arrBuf = new ArrayBuffer(big.byteLength);
    new Uint8Array(arrBuf).set(big);
    const bigFile = new File([arrBuf], "huge.jpg", { type: "image/jpeg" });

    const fd = new FormData();
    fd.append("images", bigFile);
    fd.append("category", "electronics");
    fd.append("markets", "EU,US");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("IMAGE_TOO_LARGE");
    expect(mockCreateScan).not.toHaveBeenCalled();
  });

  it("returns 400 for image with unsupported mime type", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const gif = new File([new Uint8Array([0, 0, 0])], "anim.gif", { type: "image/gif" });

    const fd = new FormData();
    fd.append("images", gif);
    fd.append("category", "electronics");
    fd.append("markets", "EU,US");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    expect(mockCreateScan).not.toHaveBeenCalled();
  });

  it("rejects more than 8 images", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const images = Array.from({ length: 9 }, (_, i) => makeFile(`img-${i}.jpg`));
    const fd = buildFormData({ images });
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockCreateScan).not.toHaveBeenCalled();
  });
});
