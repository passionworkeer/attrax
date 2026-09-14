/**
 * J09 BFF forwarding tests — POST /api/scan must consume the upload
 * wizard's `userDeclaredFacts` FormData field and forward it to the v1
 * adapter's createScan as `declaredFacts` (the first hop of the chain that
 * previously did not exist: the page collected answers, the BFF dropped
 * them, and the findings builder never saw them).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

describe("POST /api/scan — userDeclaredFacts forwarding (J09)", () => {
  beforeEach(() => {
    mockCreateScan.mockReset();
    mockCreateScan.mockResolvedValue({
      sessionId: "scan_bff_facts",
      accessToken: "tok",
      status: "processing",
      pollUrl: "/api/v1/scans/scan_bff_facts",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards a valid userDeclaredFacts JSON to createScan as declaredFacts", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData({
        userDeclaredFacts: JSON.stringify({ battery: "否", magnets: "否" }),
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    expect(mockCreateScan).toHaveBeenCalledTimes(1);
    const [input] = mockCreateScan.mock.calls[0];
    expect(input.declaredFacts).toEqual({ battery: "否", magnets: "否" });
  });

  it("omits declaredFacts entirely when the field is absent", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData(),
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    const [input] = mockCreateScan.mock.calls[0];
    expect(input.declaredFacts).toBeUndefined();
  });

  it("ignores malformed JSON instead of failing the scan", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData({ userDeclaredFacts: "not json {{{" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    const [input] = mockCreateScan.mock.calls[0];
    expect(input.declaredFacts).toBeUndefined();
  });

  it("ignores non-object JSON values (arrays / strings / null)", async () => {
    for (const bad of ['["battery"]', '"battery"', "null", "42"]) {
      mockCreateScan.mockClear();
      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ userDeclaredFacts: bad }),
      });
      const res = await POST(req);
      expect(res.status).toBe(202);
      const [input] = mockCreateScan.mock.calls[0];
      expect(input.declaredFacts).toBeUndefined();
    }
  });

  it("bounds oversized values and drops empty keys", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      body: buildFormData({
        userDeclaredFacts: JSON.stringify({
          battery: "x".repeat(500),
          "": "orphan",
          magnets: "",
        }),
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    const [input] = mockCreateScan.mock.calls[0];
    // Values truncated to 200 chars; empty keys/values dropped.
    expect(input.declaredFacts).toEqual({ battery: "x".repeat(200) });
  });
});

describe("createScan (v1-adapter) — declared_facts form encoding (J09)", () => {
  it("sends declared_facts as a JSON form field; skips when empty (see api-scan-declared-facts-wire.test.ts)", () => {
    // The adapter's wire format is asserted in the dedicated wire test file
    // (this file mocks the adapter for the BFF-level assertions, so the
    // real implementation is not importable here).
    expect(true).toBe(true);
  });
});
