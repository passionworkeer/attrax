/**
 * J09 BFF forwarding tests — POST /api/scan must not drop the upload
 * wizard's `declared_facts` FormData field on its way to the RAG service.
 *
 * Before the streaming rewrite the BFF parsed `userDeclaredFacts`, bounded
 * it, and re-encoded it as `declaredFacts` on the buffered `createScan`
 * input. The page now sends the backend's own field name (`declared_facts`,
 * see app/upload/page.tsx) and the BFF forwards the multipart body
 * byte-for-byte, so the BFF-level contract is "the field travels verbatim".
 * Parsing/clamping lives in the RAG service (`clamp_declared_facts`,
 * rag_service/application/scans.py, covered by rag_service/tests/
 * test_declared_facts_chain.py); the adapter's own encoding for the
 * buffered `createScan` path is covered in lib/rag-client/v1-adapter.test.ts.
 *
 * @vitest-environment node
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

function minimalJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
  ]);
}

function makeImage(name = "test.jpg"): File {
  const buffer = new ArrayBuffer(minimalJpeg().byteLength);
  new Uint8Array(buffer).set(minimalJpeg());
  return new File([buffer], name, { type: "image/jpeg" });
}

function buildFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.append("images", makeImage());
  fd.append("category", fields.category ?? "toy");
  fd.append("markets", fields.markets ?? "EU");
  for (const [key, value] of Object.entries(fields)) {
    fd.append(key, value);
  }
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

describe("POST /api/scan — declared_facts forwarding (J09)", () => {
  beforeEach(() => {
    mockCreateScanStream.mockReset();
    mockCreateScanStream.mockResolvedValue({
      sessionId: "scan_bff_facts",
      accessToken: "tok",
      status: "processing",
      pollUrl: "/api/v1/scans/scan_bff_facts",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards a valid declared_facts JSON to the adapter verbatim", async () => {
    const payload = JSON.stringify({ battery: "否", magnets: "否" });
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData({ declared_facts: payload }),
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    expect(mockCreateScanStream).toHaveBeenCalledTimes(1);
    const text = await forwardedBodyText();
    expect(multipartFieldValue(text, "declared_facts")).toBe(payload);
  });

  it("omits declared_facts from the forwarded body when the client sends none", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData(),
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    const text = await forwardedBodyText();
    expect(text).not.toContain('name="declared_facts"');
  });

  it("forwards a malformed declared_facts value untouched instead of failing the scan", async () => {
    // The BFF no longer parses the field; a garbage payload reaches the RAG
    // service, which ignores non-JSON under `clamp_declared_facts` and still
    // creates the session.
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData({ declared_facts: "not json {{{" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    const text = await forwardedBodyText();
    expect(multipartFieldValue(text, "declared_facts")).toBe("not json {{{");
  });

  it("forwards non-object declared_facts values untouched (upstream owns validation)", async () => {
    for (const bad of ['["battery"]', '"battery"', "null", "42"]) {
      mockCreateScanStream.mockClear();
      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ declared_facts: bad }),
      });
      const res = await POST(req);
      expect(res.status).toBe(202);
      const text = await forwardedBodyText();
      expect(multipartFieldValue(text, "declared_facts")).toBe(bad);
    }
  });

  it("forwards an oversized declared_facts payload untouched (clamping lives in the RAG service)", async () => {
    // `clamp_declared_facts` (rag_service/application/scans.py) bounds keys to
    // 32 entries / 64 chars and values to 200 chars on arrival. The BFF is a
    // byte-for-byte forwarder, so it must not alter the payload.
    const payload = JSON.stringify({
      battery: "x".repeat(500),
      "": "orphan",
      magnets: "",
    });
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData({ declared_facts: payload }),
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    const text = await forwardedBodyText();
    expect(multipartFieldValue(text, "declared_facts")).toBe(payload);
  });
});
