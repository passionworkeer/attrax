// @vitest-environment node

/**
 * Extended unit tests for POST /api/scan (handoff BFF).
 *
 * The route is a thin forwarder to FastAPI /api/v1/scans via
 * `lib/rag-client/v1-adapter`. After the streaming rewrite the route passes
 * the inbound multipart body straight through to `createScanStream`; per-file
 * signature / type / size / count checks live on the RAG side
 * (`rag_service/api/v1.py::_read_uploads`). These tests cover the seam:
 * byte-for-byte forwarding of documents/images, header-level rejections, and
 * upstream-error mapping.
 *
 * Run with: npm run test -- tests/unit/api-scan-post-full.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
});

// Helper: create a minimal JPEG buffer
function minimalJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
  ]);
}

function minimalPdf(): Uint8Array {
  return new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xc7, 0xec, 0x8f, 0xa2, 0x0a,
  ]);
}

function minimalText(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function makeFile(name: string, type = "image/jpeg", data?: Uint8Array): File {
  return new File([toArrayBuffer(data ?? minimalJpeg())], name, { type });
}

function buildFormData(
  opts: {
    images?: File[];
    documents?: File[];
    category?: string;
    markets?: string;
  } = {},
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

/** Read back the multipart payload the route streamed to `createScanStream`. */
async function forwardedBodyText(callIndex = 0): Promise<string> {
  const [input] = mockCreateScanStream.mock.calls[callIndex] as [
    { body: ReadableStream<Uint8Array> },
  ];
  return await new Response(input.body).text();
}

/** Extract a text field's value from a serialized multipart body. */
function multipartFieldValue(text: string, name: string): string | null {
  const match = text.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r\\n]*)`));
  return match ? match[1] : null;
}

describe("POST /api/scan - Validation and Error Coverage", () => {
  beforeEach(() => {
    mockCreateScanStream.mockReset();
    mockCreateScanStream.mockResolvedValue({
      sessionId: "scan_test",
      accessToken: "tok",
      status: "processing",
      pollUrl: "/api/v1/scans/scan_test",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Body forwarding", () => {
    it("forwards PDF document files to v1", async () => {
      const pdfFile = makeFile("manual.pdf", "application/pdf", minimalPdf());

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: [pdfFile] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const text = await forwardedBodyText();
      expect(text).toContain('name="documents"; filename="manual.pdf"');
      expect(text).toContain("Content-Type: application/pdf");
    });

    it("forwards multiple PDF files", async () => {
      const pdfs = [
        makeFile("doc1.pdf", "application/pdf", minimalPdf()),
        makeFile("doc2.pdf", "application/pdf", minimalPdf()),
      ];

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: pdfs }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const text = await forwardedBodyText();
      expect(text).toContain('filename="doc1.pdf"');
      expect(text).toContain('filename="doc2.pdf"');
    });

    it("forwards plain text files", async () => {
      const txt = makeFile(
        "notes.txt",
        "text/plain",
        minimalText("这是一份合规文档"),
      );

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: [txt] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const text = await forwardedBodyText();
      expect(text).toContain('filename="notes.txt"');
      expect(text).toContain("Content-Type: text/plain");
      expect(text).toContain("这是一份合规文档");
    });

    it("forwards multiple images", async () => {
      const images = [makeFile("front.jpg"), makeFile("back.jpg")];

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ images, documents: [makeFile("doc.pdf", "application/pdf", minimalPdf())] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const text = await forwardedBodyText();
      expect(text).toContain('filename="front.jpg"');
      expect(text).toContain('filename="back.jpg"');
      expect(text).toContain('filename="doc.pdf"');
    });

    it("preserves originalName and mimeType on every image", async () => {
      const image = makeFile("product-photo.jpg", "image/jpeg");

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ images: [image] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const text = await forwardedBodyText();
      expect(text).toContain('filename="product-photo.jpg"');
      expect(text).toContain("Content-Type: image/jpeg");
    });
  });

  describe("Input validation", () => {
    it("returns 400 when a multipart request carries no body (BAD_INPUT)", async () => {
      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=---x" },
      });

      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("BAD_INPUT");
      expect(mockCreateScanStream).not.toHaveBeenCalled();
    });

    it("rejects uploads with no images via the upstream IMAGE_REQUIRED 400", async () => {
      // The image-required check moved to the RAG service
      // (rag_service/api/v1.py `_read_uploads`); the BFF forwards the body
      // and maps the upstream rejection through unchanged.
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
      expect(mockCreateScanStream).toHaveBeenCalledTimes(1);
    });

    it("rejects too many images via the upstream TOO_MANY_IMAGES 400", async () => {
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
      const body = await res.json();
      expect(body.error.code).toBe("TOO_MANY_IMAGES");
      expect(mockCreateScanStream).toHaveBeenCalledTimes(1);
    });

    it("rejects unsupported image mime type via the upstream INVALID_FILE_TYPE 400", async () => {
      const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
      mockCreateScanStream.mockRejectedValueOnce(
        new V1EnvelopeError("INVALID_FILE_TYPE", "Unsupported file type", 400, "req-1"),
      );

      const { POST } = await import("@/app/api/scan/route");
      const gif = makeFile("anim.gif", "image/gif");

      const fd = new FormData();
      fd.append("images", gif);
      fd.append("category", "electronics");
      fd.append("markets", "EU,US");
      const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_FILE_TYPE");
      expect(mockCreateScanStream).toHaveBeenCalledTimes(1);
    });

    it("accepts all valid product categories and forwards them verbatim", async () => {
      const { POST } = await import("@/app/api/scan/route");
      const categories = ["electronics", "appliance", "3c", "toy", "home", "other"];
      for (const category of categories) {
        mockCreateScanStream.mockClear();
        const req = new Request("http://localhost/api/scan", {
          method: "POST",
          body: buildFormData({ category }),
        });
        const res = await POST(req);

        expect(res.status).toBe(202);
        const text = await forwardedBodyText();
        expect(multipartFieldValue(text, "category")).toBe(category);
      }
    });
  });

  describe("Response shape", () => {
    it("returns sessionId, status, pollUrl, and accessToken at top level (ok() spread)", async () => {
    vi.stubEnv("ATTRAX_DEBUG_TOKEN", "1"); // 审计 3.4：token 仅显式 opt-in 时进响应体
      mockCreateScanStream.mockResolvedValueOnce({
        sessionId: "scan_unique",
        accessToken: "tok_unique",
        status: "processing",
        pollUrl: "/api/v1/scans/scan_unique",
      });

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
      const res = await POST(req);
      const body = await res.json();

      // Top-level fields (legacy page contract)
      expect(body.sessionId).toBe("scan_unique");
      expect(body.status).toBe("processing");
      expect(body.pollUrl).toBe("/api/scan/scan_unique"); // remapped from /api/v1/...
      expect(body.accessToken).toBe("tok_unique");
      expect(body.success).toBe(true);
      vi.unstubAllEnvs();
    });

    it("returns unique sessionId per request", async () => {
      const ids = new Set<string>();
      const { POST } = await import("@/app/api/scan/route");
      for (let i = 0; i < 3; i++) {
        mockCreateScanStream.mockResolvedValueOnce({
          sessionId: `scan_unique_${i}`,
          accessToken: "tok",
          status: "processing",
          pollUrl: "/api/v1/scans/x",
        });
        const req = new Request("http://localhost/api/scan", {
          method: "POST",
          body: buildFormData(),
        });
        const res = await POST(req);
        const body = await res.json();
        ids.add(body.sessionId);
      }
      expect(ids.size).toBe(3);
    });
  });

  describe("V1EnvelopeError mapping", () => {
    it("4xx envelope errors map to their httpStatus", async () => {
      const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
      mockCreateScanStream.mockRejectedValueOnce(
        new V1EnvelopeError("INVALID_MARKET", "unknown market XX", 400, "req-x"),
      );

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe("INVALID_MARKET");
    });

    it("5xx envelope errors collapse to 502 SCAN_SERVICE_UNAVAILABLE", async () => {
      const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
      mockCreateScanStream.mockRejectedValueOnce(
        new V1EnvelopeError("SCAN_SERVICE_UNAVAILABLE", "down", 503, null),
      );

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
      const res = await POST(req);

      expect(res.status).toBe(502);
    });

    it("SCAN_SERVICE_TIMEOUT from adapter is treated as infrastructure failure (502)", async () => {
      // v1 adapter returns 504 for upstream timeouts, but the BFF collapses
      // all 5xx upstream errors to 502 (Bad Gateway) since the client is
      // talking to a BFF, not directly to the scan service.
      const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
      mockCreateScanStream.mockRejectedValueOnce(
        new V1EnvelopeError("SCAN_SERVICE_TIMEOUT", "slow", 504, null),
      );

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
      const res = await POST(req);

      expect(res.status).toBe(502);
    });
  });
});
