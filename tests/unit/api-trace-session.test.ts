import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashAccessToken } from "@/lib/pipeline/session-auth";

const mockSessions = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/pipeline/session-store", () => ({
  getSession: vi.fn((id: string) => mockSessions.get(id) ?? undefined),
}));

vi.mock("@/lib/rag-client/v1-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rag-client/v1-adapter")>(
    "@/lib/rag-client/v1-adapter",
  );
  return {
    ...actual,
    getTrace: vi.fn(),
    getScan: vi.fn(),
  };
});

function session(result?: Record<string, unknown>) {
  return {
    sessionId: "scan_local",
    status: result ? "ready" : "processing",
    progress: result ? 100 : 50,
    stageText: result ? "complete" : "processing",
    result,
  };
}

describe("GET /api/trace/[sessionId] truthful contract", () => {
  beforeEach(() => {
    mockSessions.clear();
  });

  it("returns 401 before probing an unknown real session", async () => {
    const { GET } = await import("@/app/api/trace/[sessionId]/route");
    const response = await GET(
      new Request("http://localhost/api/trace/scan_missing"),
      { params: Promise.resolve({ sessionId: "scan_missing" }) },
    );

    expect(response.status).toBe(401);
  });

  it("requires access for protected legacy sessions", async () => {
    mockSessions.set("scan_protected", {
      ...session({ agentTrace: [{ node: "vision" }] }),
      sessionId: "scan_protected",
      accessTokenHash: hashAccessToken("secret"),
    });
    const { GET } = await import("@/app/api/trace/[sessionId]/route");
    const response = await GET(
      new Request("http://localhost/api/trace/scan_protected"),
      { params: Promise.resolve({ sessionId: "scan_protected" }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 when no real execution trace exists", async () => {
    mockSessions.set(
      "scan_no_trace",
      session({
        complianceScore: 95,
        scoreGrade: "A",
        reportPackage: {
          decisionView: {
            nodes: [{ id: "generated-copy", label: "AI-generated narrative" }],
          },
        },
      }),
    );
    const { GET } = await import("@/app/api/trace/[sessionId]/route");
    const response = await GET(
      new Request("http://localhost/api/trace/scan_no_trace"),
      { params: Promise.resolve({ sessionId: "scan_no_trace" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("uses only actual trace timings and retrieved evidence", async () => {
    mockSessions.set(
      "scan_trace",
      session({
        complianceScore: 85,
        scoreGrade: "B",
        targetMarkets: ["EU", "US"],
        agentTrace: [
          { node: "vision", status: "success", duration_ms: 3200, score: 0.95 },
          { node: "retriever", status: "success", durationMs: 1800 },
          { node: "generate", status: "success", duration: 2100 },
        ],
        retrievedChunks: [
          { region: "EU", docName: "Low Voltage Directive" },
          { region: "US", docName: "FCC Part 15" },
          { region: "EU", docName: "Low Voltage Directive" },
        ],
      }),
    );
    const { GET } = await import("@/app/api/trace/[sessionId]/route");
    const response = await GET(
      new Request("http://localhost/api/trace/scan_trace"),
      { params: Promise.resolve({ sessionId: "scan_trace" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totalTime).toBe("7.100");
    expect(body.steps).toBe(3);
    expect(body.markets).toBe(2);
    expect(body.regulations).toBe(2);
    expect(body.score).toBe(85);
    expect(body.grade).toBe("B");
    expect(body.traceNodes).toHaveLength(3);
    expect(body.traceNodes[0]).toMatchObject({
      type: "vision",
      status: "success",
      duration: "3.200s",
      confidence: 0.95,
    });
  });

  it("does not fabricate score, grade, market, or regulation counts", async () => {
    mockSessions.set(
      "scan_minimal",
      session({
        agentTrace: [{ node: "verify", status: "unknown" }],
      }),
    );
    const { GET } = await import("@/app/api/trace/[sessionId]/route");
    const response = await GET(
      new Request("http://localhost/api/trace/scan_minimal"),
      { params: Promise.resolve({ sessionId: "scan_minimal" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.score).toBe(0);
    expect(body.grade).toBe("UNKNOWN");
    expect(body.markets).toBe(0);
    expect(body.regulations).toBe(0);
    expect(body.totalTime).toBe("0.000");
  });
});
