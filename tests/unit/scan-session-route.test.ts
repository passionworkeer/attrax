/**
 * Unit tests for the Next.js /api/scan/[sessionId] route (GET, handoff BFF).
 *
 * The route forwards to FastAPI /api/v1/scans/{id} via the v1 adapter. We
 * mock the adapter so tests stay hermetic. Demo short-circuit and auth
 * (Bearer header + ?token= fallback) are exercised here.
 *
 * Run with: npx vitest run tests/unit/scan-session-route.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetScan } = vi.hoisted(() => ({
  mockGetScan: vi.fn(),
}));

vi.mock("@/lib/rag-client/v1-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rag-client/v1-adapter")>(
    "@/lib/rag-client/v1-adapter",
  );
  return {
    ...actual,
    getScan: mockGetScan,
  };
});

describe("GET /api/scan/[sessionId]", () => {
  beforeEach(() => {
    mockGetScan.mockReset();
  });

  describe("demo session", () => {
    it("returns mock result for demo sessionId without calling v1 adapter", async () => {
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/demo");
      const ctx = { params: Promise.resolve({ sessionId: "demo" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessionId).toBe("demo");
      expect(body.status).toBe("ready");
      expect(body.result).toBeDefined();
      expect(mockGetScan).not.toHaveBeenCalled();
    });
  });

  describe("auth", () => {
    it("returns 401 when no token is provided (neither header nor query)", async () => {
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_abc");
      const ctx = { params: Promise.resolve({ sessionId: "scan_abc" }) };

      const res = await GET(req, ctx);

      expect(res.status).toBe(401);
      expect(mockGetScan).not.toHaveBeenCalled();
    });

    it("accepts Bearer header token", async () => {
      mockGetScan.mockResolvedValueOnce({
        sessionId: "scan_abc",
        status: "processing",
        progress: 50,
        stageText: "匹配中",
        category: "electronics",
        markets: ["EU"],
        createdAt: "2026-07-17T00:00:00Z",
        updatedAt: "2026-07-17T00:01:00Z",
        result: null,
        error: null,
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_abc", {
        headers: { authorization: "Bearer my-token" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_abc" }) };

      await GET(req, ctx);

      expect(mockGetScan).toHaveBeenCalledWith({
        sessionId: "scan_abc",
        accessToken: "my-token",
      });
    });

    it("rejects ?token= query params to keep tokens out of access logs", async () => {
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_abc?token=query-token");
      const ctx = { params: Promise.resolve({ sessionId: "scan_abc" }) };

      const response = await GET(req, ctx);

      expect(response.status).toBe(401);
      expect(mockGetScan).not.toHaveBeenCalled();
    });

    it("accepts the HttpOnly BFF session cookie", async () => {
      mockGetScan.mockResolvedValueOnce({
        sessionId: "scan_abc",
        status: "processing",
        progress: 10,
        stageText: "processing",
        category: "electronics",
        markets: ["EU"],
        createdAt: "2026-07-17T00:00:00Z",
        updatedAt: "2026-07-17T00:01:00Z",
        result: null,
        error: null,
      });
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const response = await GET(
        new Request("http://localhost/api/scan/scan_abc", {
          headers: { cookie: "attrax_scan_scan_abc=cookie-token" },
        }),
        { params: Promise.resolve({ sessionId: "scan_abc" }) },
      );

      expect(response.status).toBe(200);
      expect(mockGetScan).toHaveBeenCalledWith({
        sessionId: "scan_abc",
        accessToken: "cookie-token",
      });
    });

    it("prefers Bearer header over ?token= query param", async () => {
      mockGetScan.mockResolvedValueOnce({
        sessionId: "scan_abc",
        status: "ready",
        progress: 100,
        stageText: "complete",
        category: "electronics",
        markets: ["EU"],
        createdAt: "2026-07-17T00:00:00Z",
        updatedAt: "2026-07-17T00:01:00Z",
        result: {},
        error: null,
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request(
        "http://localhost/api/scan/scan_abc?token=query-token",
        { headers: { authorization: "Bearer header-token" } },
      );
      const ctx = { params: Promise.resolve({ sessionId: "scan_abc" }) };

      await GET(req, ctx);

      expect(mockGetScan).toHaveBeenCalledWith({
        sessionId: "scan_abc",
        accessToken: "header-token",
      });
    });
  });

  describe("happy path", () => {
    it("returns session data when found and authenticated", async () => {
      mockGetScan.mockResolvedValueOnce({
        sessionId: "scan_real123",
        status: "ready",
        progress: 100,
        stageText: "完成",
        category: "electronics",
        markets: ["EU"],
        createdAt: "2026-07-17T00:00:00Z",
        updatedAt: "2026-07-17T00:01:00Z",
        result: {
          sessionId: "scan_real123",
          complianceScore: 55,
          scoreGrade: "C",
          complianceStatus: "WARN",
        },
        error: null,
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_real123", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_real123" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessionId).toBe("scan_real123");
      expect(body.status).toBe("ready");
      expect(body.progress).toBe(100);
      expect(body.result.complianceScore).toBe(65);
      expect(body.result.scoreGrade).toBe("C");
      expect(body.result.source).toBe("real");
    });

    it("returns processing state correctly", async () => {
      mockGetScan.mockResolvedValueOnce({
        sessionId: "scan_processing",
        status: "processing",
        progress: 45,
        stageText: "匹配法规库",
        category: "electronics",
        markets: ["EU"],
        createdAt: "2026-07-17T00:00:00Z",
        updatedAt: "2026-07-17T00:01:00Z",
        result: null,
        error: null,
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_processing", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_processing" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("processing");
      expect(body.progress).toBe(45);
    });

    it("infers stageKey=done when status is ready", async () => {
      mockGetScan.mockResolvedValueOnce({
        sessionId: "scan_xyz",
        status: "ready",
        progress: 100,
        stageText: "完成",
        category: "electronics",
        markets: ["EU"],
        createdAt: "2026-07-17T00:00:00Z",
        updatedAt: "2026-07-17T00:01:00Z",
        result: null,
        error: null,
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_xyz", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_xyz" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.stageKey).toBe("done");
    });
  });

  describe("error mapping", () => {
    it("returns 404 when v1 returns NOT_FOUND", async () => {
      const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
      mockGetScan.mockRejectedValueOnce(
        new V1EnvelopeError("NOT_FOUND", "not found", 404, null),
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

    it("returns 401 when v1 returns UNAUTHORIZED", async () => {
      const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
      mockGetScan.mockRejectedValueOnce(
        new V1EnvelopeError("UNAUTHORIZED", "bad token", 401, null),
      );

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_abc", {
        headers: { authorization: "Bearer wrong" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_abc" }) };

      const res = await GET(req, ctx);

      expect(res.status).toBe(401);
    });

    it("returns 502 when the v1 fetch throws a non-V1 error", async () => {
      mockGetScan.mockRejectedValueOnce(new Error("network down"));

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_abc", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_abc" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.error.code).toBe("RAG_SERVICE_UNAVAILABLE");
    });
  });
});
