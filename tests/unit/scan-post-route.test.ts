vi.stubEnv("ATTRAX_DEBUG_TOKEN", "1"); // 审计 3.4：token 仅显式 opt-in 时进响应体
// @vitest-environment node

/**
 * Unit tests for POST /api/scan (handoff BFF).
 *
 * The route is a thin forwarder to FastAPI /api/v1/scans via
 * `lib/rag-client/v1-adapter`. We mock the adapter module directly so the
 * tests stay hermetic and don't need a running RAG service. After the
 * streaming refactor (H2/H3), the route passes the inbound body straight
 * through to `createScanStream`; per-file signature / type / size checks
 * live on the RAG side (`python-multipart` + `_valid_signature`). BFF-side
 * assertions now exercise header-level + boundary checks only.
 *
 * Run with: npx vitest run tests/unit/scan-post-route.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateScanStream } = vi.hoisted(() => ({
  mockCreateScanStream: vi.fn(),
}));

vi.mock("@/lib/rag-client/v1-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rag-client/v1-adapter")>(
    "@/lib/rag-client/v1-adapter",
  );
  return {
    ...actual,
    createScanStream: mockCreateScanStream,
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
    mockCreateScanStream.mockReset();
    mockCreateScanStream.mockResolvedValue({
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
    mockCreateScanStream.mockResolvedValue({
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

  it("streams the original body byte-for-byte to the RAG adapter", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    await POST(req);

    expect(mockCreateScanStream).toHaveBeenCalledTimes(1);
    const [input] = mockCreateScanStream.mock.calls[0];
    expect(input.body).toBeInstanceOf(ReadableStream);
    expect(input.headers.contentType).toMatch(/^multipart\/form-data; boundary=/);
  });

  it("returns 400 when no images provided (upstream rejection surfaces as 400)", async () => {
    // Streaming refactor moved image-required check to FastAPI. The route
    // maps an upstream 400 IMAGE_REQUIRED to BFF 400 with that error code.
    const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
    mockCreateScanStream.mockRejectedValueOnce(
      new V1EnvelopeError("IMAGE_REQUIRED", "At least one image is required", 400, "req-1"),
    );

    const { POST } = await import("@/app/api/scan/route");
    const fd = buildFormData({ images: [] });
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("IMAGE_REQUIRED");
  });

  it("returns 400 when markets cannot be parsed (upstream INVALID_REQUEST)", async () => {
    const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
    mockCreateScanStream.mockRejectedValueOnce(
      new V1EnvelopeError("INVALID_REQUEST", "Use one to five supported markets", 400, "req-1"),
    );

    const { POST } = await import("@/app/api/scan/route");
    const fd = buildFormData({ markets: "EU, UK, US" });
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockCreateScanStream).toHaveBeenCalledTimes(1);
  });

  it("accepts multiple images (count enforcement moved upstream)", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const images = [makeFile("a.jpg"), makeFile("b.jpg"), makeFile("c.jpg")];
    const fd = buildFormData({ images });
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);

    expect(res.status).toBe(202);
    const [input] = mockCreateScanStream.mock.calls[0];
    expect(input.body).toBeInstanceOf(ReadableStream);
  });

  it("rejects requests with no multipart Content-Type (400 BAD_INPUT)", async () => {
    // The scan route keeps the pre-rewrite code/status (400 BAD_INPUT); the
    // evidence route's non-multipart rejection is 400 INVALID_REQUEST.
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_INPUT");
    expect(mockCreateScanStream).not.toHaveBeenCalled();
  });

  it("rejects an unsupported category before streaming (400 INVALID_CATEGORY)", async () => {
    // The BFF peeks the first 8KB for `category`; the upload wizard puts its
    // text fields before the file parts so the peek can see them. Upstream
    // re-validates too, so a miss only costs a cheap early rejection.
    const { POST } = await import("@/app/api/scan/route");
    const fd = new FormData();
    fd.append("category", "not-a-real-category");
    fd.append("markets", "EU,US");
    fd.append("images", makeFile("test.jpg"));
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_CATEGORY");
    expect(mockCreateScanStream).not.toHaveBeenCalled();
  });

  it("rejects a body over the 50MB Content-Length cap (413 REQUEST_TOO_LARGE)", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=---x",
        "content-length": String(60 * 1024 * 1024),
      },
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      // Node's undici fetch/Request requires duplex when the body is a stream.
      duplex: "half",
    } as RequestInit);
    const res = await POST(req);

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("REQUEST_TOO_LARGE");
    expect(mockCreateScanStream).not.toHaveBeenCalled();
  });

  it("maps V1EnvelopeError to its httpStatus", async () => {
    const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
    mockCreateScanStream.mockRejectedValueOnce(
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

  it("collapses infrastructure errors (5xx) to 502 SCAN_SERVICE_UNAVAILABLE", async () => {
    const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
    mockCreateScanStream.mockRejectedValueOnce(
      new V1EnvelopeError("SCAN_SERVICE_UNAVAILABLE", "boom", 503, null),
    );

    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    const res = await POST(req);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("SCAN_SERVICE_UNAVAILABLE");
  });

  it("maps non-V1EnvelopeError to 502 SCAN_SERVICE_UNAVAILABLE", async () => {
    mockCreateScanStream.mockRejectedValueOnce(new Error("network"));

    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    const res = await POST(req);

    expect(res.status).toBe(502);
  });

  it("surfaces the upstream per-file size cap as 413 FILE_TOO_LARGE", async () => {
    // The per-file size cap moved to the RAG service's `_read_uploads`
    // (rag_service/api/v1.py) — 413 FILE_TOO_LARGE. The BFF streams the
    // body unconditionally and maps the upstream rejection through.
    const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
    mockCreateScanStream.mockRejectedValueOnce(
      new V1EnvelopeError("FILE_TOO_LARGE", "Uploaded file is too large", 413, "req-1"),
    );

    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData({ images: [makeFile("huge.jpg")] }),
    });
    const res = await POST(req);

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("FILE_TOO_LARGE");
    expect(mockCreateScanStream).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when upstream rejects unsupported mime type", async () => {
    const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
    mockCreateScanStream.mockRejectedValueOnce(
      new V1EnvelopeError("INVALID_FILE_TYPE", "Unsupported file type", 400, "req-1"),
    );

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
    expect(body.error.code).toBe("INVALID_FILE_TYPE");
  });

  it("returns 400 when upstream rejects too many images", async () => {
    const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
    mockCreateScanStream.mockRejectedValueOnce(
      new V1EnvelopeError("TOO_MANY_IMAGES", "Too many images", 400, "req-1"),
    );

    const { POST } = await import("@/app/api/scan/route");
    const images = Array.from({ length: 9 }, (_, i) => makeFile(`img-${i}.jpg`));
    const fd = buildFormData({ images });
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockCreateScanStream).toHaveBeenCalledTimes(1);
  });

  it("DEMO_MODE parses the real form and builds a demo session without touching the adapter", async () => {
    const previous = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "true";
    try {
      const { POST } = await import("@/app/api/scan/route");
      const fd = buildFormData({ category: "toy", markets: "EU,US" });
      const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.sessionId).toMatch(/^scan_demo_/);
      expect(body.status).toBe("processing");
      expect(body.pollUrl).toBe(`/api/scan/${body.sessionId}`);
      expect(res.headers.get("set-cookie")).toContain(`attrax_scan_${body.sessionId}`);
      // The demo branch short-circuits before the RAG forwarder.
      expect(mockCreateScanStream).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = previous;
    }
  });
});
