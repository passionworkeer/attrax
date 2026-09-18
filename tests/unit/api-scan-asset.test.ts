import { beforeEach, describe, expect, it, vi } from "vitest";

// The streaming rewrite replaced the buffered `getScanAsset` with
// `streamScanAsset`, which hands back the unread upstream Response so the
// route can pipe `response.body` instead of buffering every image.
const mockStreamScanAsset = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rag-client/v1-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rag-client/v1-adapter")>(
    "@/lib/rag-client/v1-adapter",
  );
  return { ...actual, streamScanAsset: mockStreamScanAsset };
});

describe("GET /api/scan/[sessionId]/asset/[index]", () => {
  beforeEach(() => mockStreamScanAsset.mockReset());

  it("pipes authenticated upstream image bytes through", async () => {
    mockStreamScanAsset.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "3" },
      }),
    );
    const { GET } = await import("@/app/api/scan/[sessionId]/asset/[index]/route");

    const response = await GET(
      new Request("http://localhost/api/scan/scan_real1/asset/0", {
        headers: { authorization: "Bearer token-1" },
      }),
      { params: Promise.resolve({ sessionId: "scan_real1", index: "0" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(mockStreamScanAsset).toHaveBeenCalledWith({
      sessionId: "scan_real1",
      accessToken: "token-1",
      index: 0,
    });
  });

  it("maps upstream envelope errors (e.g. NOT_FOUND) to their status", async () => {
    const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
    mockStreamScanAsset.mockRejectedValueOnce(
      new V1EnvelopeError("NOT_FOUND", "Scan asset not found", 404, "req-1"),
    );
    const { GET } = await import("@/app/api/scan/[sessionId]/asset/[index]/route");

    const response = await GET(
      new Request("http://localhost/api/scan/scan_real1/asset/0", {
        headers: { authorization: "Bearer token-1" },
      }),
      { params: Promise.resolve({ sessionId: "scan_real1", index: "0" }) },
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  it("rejects missing auth and invalid indexes", async () => {
    const { GET } = await import("@/app/api/scan/[sessionId]/asset/[index]/route");
    const missing = await GET(
      new Request("http://localhost/api/scan/scan_real1/asset/0"),
      { params: Promise.resolve({ sessionId: "scan_real1", index: "0" }) },
    );
    const invalid = await GET(
      new Request("http://localhost/api/scan/scan_real1/asset/nope", {
        headers: { authorization: "Bearer token-1" },
      }),
      { params: Promise.resolve({ sessionId: "scan_real1", index: "nope" }) },
    );

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(404);
    expect(mockStreamScanAsset).not.toHaveBeenCalled();
  });
});
