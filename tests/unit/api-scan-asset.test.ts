import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetScanAsset = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rag-client/v1-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rag-client/v1-adapter")>(
    "@/lib/rag-client/v1-adapter",
  );
  return { ...actual, getScanAsset: mockGetScanAsset };
});

describe("GET /api/scan/[sessionId]/asset/[index]", () => {
  beforeEach(() => mockGetScanAsset.mockReset());

  it("returns authenticated upstream image bytes", async () => {
    mockGetScanAsset.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });
    const { GET } = await import("@/app/api/scan/[sessionId]/asset/[index]/route");

    const response = await GET(
      new Request("http://localhost/api/scan/scan_real1/asset/0", {
        headers: { authorization: "Bearer token-1" },
      }),
      { params: Promise.resolve({ sessionId: "scan_real1", index: "0" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(mockGetScanAsset).toHaveBeenCalledWith({
      sessionId: "scan_real1",
      accessToken: "token-1",
      index: 0,
    });
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
    expect(mockGetScanAsset).not.toHaveBeenCalled();
  });
});
