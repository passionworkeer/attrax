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
    it("maps backend compliance statuses to the new frontend score contract", async () => {
      const statuses = [
        ["PASS", 90, "A"],
        ["WARN", 65, "C"],
        ["REJECTED", 35, "D"],
        ["UNKNOWN", 50, "C"],
      ] as const;
      for (const [complianceStatus, complianceScore, scoreGrade] of statuses) {
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
              // a2235dd 解耦后前端从 node.severity 派生分数;fixture 给个
              // representative node 让 rollup 不回退到 UNKNOWN→info 90/A。
              agentTrace: [{ node: "synthesis", severity: "medium" }],
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
        expect(body.result.complianceScore).toBe(complianceScore);
        expect(body.result.scoreGrade).toBe(scoreGrade);
        expect(body.result.source).toBe("real");
      }
    });

    it("derives visible risk citations from backend trace package and chunks", async () => {
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
            reportPackage: {
              decisionView: {
                nodes: [
                  { id: "risk-1", label: "LVD evidence", reasoning: "Missing evidence", status: "warning" },
                ],
              },
              roadmap: { items: [] },
            },
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
      expect(body.result.riskPoints).toHaveLength(1);
      expect(body.result.riskPoints[0].regulations).toHaveLength(1);
      expect(body.result.riskPoints[0].regulations[0]).toHaveProperty("regId", "EU-CE-LVD");
    });

    // ── J01-a (plan 2026-09-14 §4.1): the BFF resultReady fallback contract ──
    // An OLD backend deployment does not emit `resultReady` at all. The BFF
    // computes `resultReady = terminal && data.resultReady !== false && result
    // != null` so the missing field degrades to "true" when a result payload is
    // addressable — legacy sessions must complete, not deadlock at 99%.
    it("J01-a: degraded session WITHOUT resultReady field (legacy backend) still maps resultReady=true when a result exists", async () => {
      mockGetScan.mockResolvedValue(
        sessionFixture({
          // fixture omits resultReady entirely — simulates the old backend
          status: "degraded",
          progress: 100,
          result: {
            sessionId: "scan_legacy",
            complianceScore: 50,
            scoreGrade: "C",
            complianceStatus: "UNKNOWN",
          },
        }),
      );

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_legacy", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_legacy" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("degraded");
      expect(body.resultReady).toBe(true);
      expect(body.result).not.toBeNull();
      expect(body.degradedReason).toBe("BACKEND_DEGRADED");
    });

    it("J01-a: an explicit resultReady=false from the backend caps resultReady (never fake-complete)", async () => {
      mockGetScan.mockResolvedValue({
        ...sessionFixture({
          status: "ready",
          progress: 100,
          result: null,
        }),
        resultReady: false,
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_x", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_x" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      // ready + resultReady=false + no result → must NOT claim complete.
      expect(body.resultReady).toBe(false);
    });

    it("J01-a: processing sessions never claim resultReady", async () => {
      mockGetScan.mockResolvedValue(
        sessionFixture({ status: "processing", progress: 40, result: null }),
      );

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_x", {
        headers: { authorization: "Bearer t" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_x" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.resultReady).toBe(false);
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

    it("does not fall through to query-string tokens", async () => {
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_x?token=via-query", {
        headers: { authorization: "" },
      });
      const ctx = { params: Promise.resolve({ sessionId: "scan_x" }) };

      const res = await GET(req, ctx);

      expect(res.status).toBe(401);
      expect(mockGetScan).not.toHaveBeenCalled();
    });
  });
});
