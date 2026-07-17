/**
 * Extended unit tests for GET /api/scan/[sessionId] (handoff BFF).
 *
 * Now that the route forwards to /api/v1/scans/{id} via the v1 adapter, these
 * tests cover the contract the pages consume: the demo short-circuit,
 * status/progress mapping, error surfacing, and demo-vs-real precedence.
 *
 * Run with: npm run test -- tests/unit/api-scan-session-full.test.ts
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

function sessionFixture(overrides: Partial<{
  sessionId: string;
  status: string;
  progress: number;
  stageText: string;
  result: Record<string, unknown> | null;
  error: string | null;
}> = {}) {
  return {
    sessionId: overrides.sessionId ?? "scan_x",
    status: overrides.status ?? "processing",
    progress: overrides.progress ?? 0,
    stageText: overrides.stageText ?? "...",
    category: "electronics",
    markets: ["EU"],
    createdAt: "2026-07-17T00:00:00Z",
    updatedAt: "2026-07-17T00:01:00Z",
    result: overrides.result ?? null,
    error: overrides.error ?? null,
  };
}

describe("GET /api/scan/[sessionId] - Extended Coverage", () => {
  beforeEach(() => {
    mockGetScan.mockReset();
  });

  describe("Demo session edge cases", () => {
    it("demo session returns a complete mock ScanStatus", async () => {
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/demo");
      const ctx = { params: Promise.resolve({ sessionId: "demo" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessionId).toBe("demo");
      expect(body.status).toBe("ready");
      expect(body.progress).toBe(100);
      expect(body.stageText).toBe("完成");
      expect(body.result).toBeDefined();
      expect(body.result.complianceScore).toBeDefined();
    });

    it("demo short-circuit takes precedence even when v1 would 404", async () => {
      // Adapter is intentionally not set up to return anything; demo must
      // short-circuit BEFORE we ever call into v1.
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/demo");
      const ctx = { params: Promise.resolve({ sessionId: "demo" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.status).toBe("ready");
      expect(mockGetScan).not.toHaveBeenCalled();
    });
  });

  describe("Result structure variations", () => {
    it("passes through all compliance statuses from v1", async () => {
      const statuses = ["PASS", "WARN", "REJECTED", "UNKNOWN"];
      for (const complianceStatus of statuses) {
        mockGetScan.mockReset();
        mockGetScan.mockResolvedValue(
          sessionFixture({
            status: "ready",
            progress: 100,
            result: {
              sessionId: "scan_x",
              complianceScore: 80,
              scoreGrade: "B",
              complianceStatus,
              agentTrace: [],
              retrievedChunks: [],
            },
          }),
        );

        const { GET } = await import("@/app/api/scan/[sessionId]/route");
        const req = new Request("http://localhost/api/scan/scan_x", {
          headers: { authorization: "Bearer t" },
        });
        const ctx = { params: Promise.resolve({ sessionId: "scan_x" }) };

        const res = await GET(req, ctx);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.result.complianceStatus).toBe(complianceStatus);
      }
    });

    it("passes through agentTrace and retrievedChunks in result", async () => {
      mockGetScan.mockResolvedValue(
        sessionFixture({
          status: "ready",
          progress: 100,
          result: {
            sessionId: "scan_chunks",
            complianceScore: 85,
            scoreGrade: "B",
            complianceStatus: "PASS",
            agentTrace: [
              { node: "vision", duration_ms: 1000 },
              { node: "retriever", duration_ms: 2000 },
            ],
            retrievedChunks: [
              { regId: "EU-CE-LVD", docName: "LVD", articleNo: "Art. 4", region: "EU", score: 0.95 },
            ],
          },
        }),
      );

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_chunks", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_chunks" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.result.agentTrace).toHaveLength(2);
      expect(body.result.retrievedChunks).toHaveLength(1);
      expect(body.result.retrievedChunks[0]).toHaveProperty("regId");
    });
  });

  describe("stageKey inference", () => {
    it("infers stageKey=retrieval from stageText containing 'retriev'", async () => {
      mockGetScan.mockResolvedValue(
        sessionFixture({ status: "processing", stageText: "matching retrieval..." }),
      );

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_x", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_x" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.stageKey).toBe("retrieval");
    });

    it("infers stageKey=vision from stageText containing 'vision'", async () => {
      mockGetScan.mockResolvedValue(
        sessionFixture({ status: "processing", stageText: "running vision model" }),
      );

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_x", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_x" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.stageKey).toBe("vision");
    });

    it("infers stageKey=failed when status is failed", async () => {
      mockGetScan.mockResolvedValue(
        sessionFixture({ status: "failed", error: "RAG_SERVICE_TIMEOUT" }),
      );

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_x", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_x" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.stageKey).toBe("failed");
    });

    it("falls back to stageKey=queued for unrecognized stageText", async () => {
      mockGetScan.mockResolvedValue(
        sessionFixture({ status: "processing", stageText: "warming up" }),
      );

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_x", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_x" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.stageKey).toBe("queued");
    });
  });

  describe("Error surfacing", () => {
    it("returns error field when present in v1 response", async () => {
      mockGetScan.mockResolvedValue(
        sessionFixture({ status: "failed", error: "IMAGE_PROCESSING_FAILED" }),
      );

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_x", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_x" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.error).toBe("IMAGE_PROCESSING_FAILED");
      expect(body.status).toBe("failed");
    });

    it("returns the v1 4xx status code (e.g. 404, 401) verbatim", async () => {
      const { V1EnvelopeError } = await import("@/lib/rag-client/v1-adapter");
      mockGetScan.mockRejectedValue(
        new V1EnvelopeError("NOT_FOUND", "not found", 404, "req-1"),
      );

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_missing", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_missing" }) };

      const res = await GET(req, ctx);

      expect(res.status).toBe(404);
    });
  });

  describe("Auth precedence", () => {
    it("returns 401 when neither Bearer header nor ?token= query is present", async () => {
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_x");
      const ctx = { params: Promise.resolve({ sessionId: "scan_x" }) };

      const res = await GET(req, ctx);

      expect(res.status).toBe(401);
      expect(mockGetScan).not.toHaveBeenCalled();
    });

    it("accepts empty Authorization header by falling through to ?token= check", async () => {
      mockGetScan.mockResolvedValue(sessionFixture({ status: "processing" }));

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_x?token=via-query", {
        headers: { authorization: "" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_x" }) };

      const res = await GET(req, ctx);

      expect(res.status).toBe(200);
      expect(mockGetScan).toHaveBeenCalledWith({
        sessionId: "scan_x",
        accessToken: "via-query",
      });
    });
  });
});
