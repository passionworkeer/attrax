/**
 * Unit tests for POST /api/scan route.
 * Run with: npx vitest run tests/unit/scan-post-route.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks — must be declared before vi.mock calls
const { mockRunScan, mockCreateSession, mockUpdateSession, mockSessions } = vi.hoisted(
  () => ({
    mockRunScan: vi.fn(() => Promise.resolve()),
    mockSessions: new Map<string, Record<string, unknown>>(),
    mockCreateSession: vi.fn((id: string) => {
      mockSessions.set(id, { sessionId: id, status: "processing", progress: 0, stageText: "准备中…" });
      return mockSessions.get(id)!;
    }),
    mockUpdateSession: vi.fn((id: string, patch: Record<string, unknown>) => {
      const current = mockSessions.get(id);
      if (current) mockSessions.set(id, { ...current, ...patch });
    }),
  })
);

vi.mock("@/lib/pipeline/scan", () => ({
  runScan: mockRunScan,
}));

vi.mock("@/lib/pipeline/session-store", () => ({
  createSession: mockCreateSession,
  updateSession: mockUpdateSession,
  getSession: vi.fn((id: string) => mockSessions.get(id)),
}));

vi.mock("@/lib/mock/scan-result", () => ({
  createMockScanResult: vi.fn((id: string) => ({
    sessionId: id,
    complianceScore: 72,
    scoreGrade: "B",
  })),
  createMockProfitReport: vi.fn((id: string) => ({
    sessionId: id,
    reportType: "profit" as const,
    productType: "充电宝",
    market: "EU",
    report: "## 利润报告\n\n成本对比...",
    barebone: { bom: 9.2, packaging: 0.25, cert: 0.05, epr: 0, logistics: 6, asp: 19.99, gp: 0.71 },
    compliant: { bom: 13.5, packaging: 0.65, cert: 0.45, epr: 0.35, logistics: 6, asp: 39.99, gp: 11.48 },
    bareboneRiskExposure: 25,
    compliantRiskExposure: 0,
    keyConclusion: "合规模式期望利润显著高于裸奔模式",
    generatedAt: new Date().toISOString(),
  })),
}));

// Helper: create a minimal JPEG buffer
function minimalJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
  ]);
}

function makeFile(name: string, type = "image/jpeg"): File {
  return new File([minimalJpeg()], name, { type });
}

function buildFormData(
  opts: { images?: File[]; documents?: File[]; category?: string; markets?: string } = {}
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
    mockSessions.clear();
    mockRunScan.mockClear();
    mockCreateSession.mockClear();
    mockUpdateSession.mockClear();
    vi.useFakeTimers();
    process.env.DEMO_MODE = "false";
  });

  it("returns 202 with sessionId for valid image upload", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    const res = await POST(req);

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.sessionId).toMatch(/^scan_[A-Z0-9]+$/);
    expect(body.status).toBe("processing");
    expect(body.pollUrl).toContain(body.sessionId);
  });

  it("creates a session in the store", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    const res = await POST(req);
    const body = await res.json();

    expect(mockCreateSession).toHaveBeenCalledWith(body.sessionId);
    const session = mockSessions.get(body.sessionId);
    expect(session).toBeDefined();
    expect(session!.status).toBe("processing");
  });

  it("calls runScan with correct arguments", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    await POST(req);

    expect(mockRunScan).toHaveBeenCalledTimes(1);
    const [sessionId, opts] = mockRunScan.mock.calls[0];
    expect(sessionId).toMatch(/^scan_/);
    expect(opts.category).toBe("electronics");
    expect(opts.markets).toEqual(["EU", "US"]);
    expect(opts.images).toHaveLength(1);
  });

  it("returns 400 when no images provided", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const fd = buildFormData({ images: [] });
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when category is invalid", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const fd = buildFormData({ category: "invalid_category_xyz" });
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("parses comma-separated markets correctly", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const fd = buildFormData({ markets: "EU, UK, US" });
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    await POST(req);

    expect(mockRunScan).toHaveBeenCalledTimes(1);
    const [, opts] = mockRunScan.mock.calls[0];
    expect(opts.markets).toEqual(["EU", "UK", "US"]);
  });

  it("accepts multiple images", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const images = [makeFile("a.jpg"), makeFile("b.jpg"), makeFile("c.jpg")];
    const fd = buildFormData({ images });
    const req = new Request("http://localhost/api/scan", { method: "POST", body: fd });
    await POST(req);

    expect(mockRunScan).toHaveBeenCalledTimes(1);
    const [, opts] = mockRunScan.mock.calls[0];
    expect(opts.images).toHaveLength(3);
  });

  it("demo mode does not call runScan and schedules simulation", async () => {
    process.env.DEMO_MODE = "true";
    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", { method: "POST", body: buildFormData() });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.sessionId).toMatch(/^scan_/);
    expect(mockRunScan).not.toHaveBeenCalled();

    // Advance timers to let demo simulation complete
    await vi.advanceTimersByTimeAsync(5000);
    const session = mockSessions.get(body.sessionId);
    expect(session!.status).toBe("ready");
    expect(session!.progress).toBe(100);
    expect(session!.result).toBeDefined();
  });
});
