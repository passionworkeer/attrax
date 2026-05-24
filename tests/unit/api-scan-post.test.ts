// @vitest-environment node

/**
 * Unit tests for POST /api/scan route.
 * Tests specified scenarios per requirements.
 *
 * Run with: npm run test -- tests/unit/api-scan-post.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type RunScanOptions = {
  images: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown> & { mimeType: string; text: string }>;
  pdfs: Array<Record<string, unknown> & { mimeType: string }>;
  category: string;
  markets: string[];
};
type RunScanMock = (sessionId: string, opts: RunScanOptions) => Promise<void>;

// Hoisted mocks
const { mockRunScan, mockCreateSession, mockUpdateSession, mockSessions } = vi.hoisted(
  () => ({
    mockRunScan: vi.fn<RunScanMock>(() => Promise.resolve()),
    mockSessions: new Map<string, Record<string, unknown>>(),
    mockCreateSession: vi.fn((id: string) => {
      mockSessions.set(id, {
        sessionId: id,
        status: "processing",
        progress: 0,
        stageText: "准备中…",
      });
      return mockSessions.get(id)!;
    }),
    mockUpdateSession: vi.fn((id: string, patch: Record<string, unknown>) => {
      const current = mockSessions.get(id);
      if (current) mockSessions.set(id, { ...current, ...patch });
    }),
  })
);

vi.mock("@/lib/pipeline/scan-queue", () => ({
  enqueueScan: (sessionId: string, opts: RunScanOptions) => {
    void mockRunScan(sessionId, opts);
  },
}));

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
    complianceScore: 85,
    scoreGrade: "B",
    complianceStatus: "PASS",
  })),
  createMockComplianceReportResult: vi.fn((id: string) => ({
    sessionId: id,
    complianceScore: 85,
    scoreGrade: "B",
    complianceStatus: "PASS",
    report: "## 合规报告",
    agentTrace: [],
    retrievedChunks: [],
    targetMarkets: ["EU"],
  })),
  createMockProfitReport: vi.fn((id: string) => ({
    sessionId: id,
    reportType: "profit" as const,
    productType: "测试产品",
    market: "EU",
    report: "## 利润报告",
    barebone: { bom: 10, packaging: 1, cert: 0.5, epr: 0.3, logistics: 5, asp: 25, gp: 8.2 },
    compliant: { bom: 15, packaging: 1.5, cert: 1, epr: 0.5, logistics: 5, asp: 45, gp: 22 },
    bareboneRiskExposure: 30,
    compliantRiskExposure: 0,
    keyConclusion: "合规模式净利润显著高于裸奔模式",
    generatedAt: new Date().toISOString(),
  })),
}));

// Helper: create a minimal JPEG buffer
function minimalJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
  ]);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function makeFile(name: string, type = "image/jpeg"): File {
  return new File([toArrayBuffer(minimalJpeg())], name, { type });
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

  describe("Scenario 1: Normal request", () => {
    it("returns { success: true, data: { sessionId: '...' } } format", async () => {
      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData(),
      });
      const res = await POST(req);
      const body = await res.json();

      // Verify response structure matches requirement
      expect(body).toHaveProperty("sessionId");
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("pollUrl");

      // Verify sessionId format
      expect(body.sessionId).toMatch(/^scan_[A-Z0-9]+$/);

      // Verify status
      expect(body.status).toBe("processing");

      // Verify pollUrl contains sessionId
      expect(body.pollUrl).toContain(body.sessionId);

      // Verify session was created
      expect(mockCreateSession).toHaveBeenCalledWith(body.sessionId);

      // Verify runScan was called with correct parameters
      expect(mockRunScan).toHaveBeenCalledTimes(1);
      const [sessionId, opts] = mockRunScan.mock.calls[0];
      expect(sessionId).toBe(body.sessionId);
      expect(opts.category).toBe("electronics");
      expect(opts.markets).toEqual(["EU", "US"]);
      expect(opts.images).toHaveLength(1);
    });

    it("handles multiple images correctly", async () => {
      const { POST } = await import("@/app/api/scan/route");
      const images = [
        makeFile("product-front.jpg"),
        makeFile("product-back.jpg"),
        makeFile("nameplate.jpg"),
      ];
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ images }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      expect(mockRunScan).toHaveBeenCalledTimes(1);
      const [, opts] = mockRunScan.mock.calls[0];
      expect(opts.images).toHaveLength(3);
    });

    it("accepts valid categories", async () => {
      const categories = ["electronics", "appliance", "3c", "toy", "home", "other"];

      for (const category of categories) {
        mockRunScan.mockClear();
        const { POST } = await import("@/app/api/scan/route");
        const req = new Request("http://localhost/api/scan", {
          method: "POST",
          body: buildFormData({ category }),
        });
        const res = await POST(req);
        expect(res.status).toBe(202);
      }
    });
  });

  describe("Scenario 2: No images request (imageCount=0)", () => {
    it("returns { success: false, error: { code: 'BAD_INPUT' } } format", async () => {
      const { POST } = await import("@/app/api/scan/route");
      const fd = buildFormData({ images: [] });
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: fd,
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();

      // Verify error structure
      expect(body).toHaveProperty("error");
      expect(body.error).toHaveProperty("code");
      expect(body.error.code).toBe("BAD_INPUT");
      expect(body.error.reason).toBe("UPLOAD_AT_LEAST_ONE_IMAGE");
      expect(body.error).toHaveProperty("message");
      expect(body.error.message).toContain("图片");
      expect(body.error.messageEn).toContain("image");
    });

    it("does not create session when validation fails", async () => {
      const { POST } = await import("@/app/api/scan/route");
      const fd = buildFormData({ images: [] });
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: fd,
      });
      await POST(req);

      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockRunScan).not.toHaveBeenCalled();
    });
  });

  describe("Scenario 3: DEMO_MODE", () => {
    it("does not require real RAG service", async () => {
      process.env.DEMO_MODE = "true";

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData(),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const body = await res.json();

      expect(body.sessionId).toMatch(/^scan_/);
      expect(mockRunScan).not.toHaveBeenCalled();

      // Advance timers to trigger demo simulation
      await vi.advanceTimersByTimeAsync(5000);

      // Verify demo simulation updated session
      const session = mockSessions.get(body.sessionId);
      expect(session).toBeDefined();
      expect(session!.status).toBe("ready");
      expect(session!.progress).toBe(100);
      expect(session!.result).toBeDefined();
    });
  });

  describe("Additional edge cases", () => {
    it("returns 400 when documents exceed limit (5)", async () => {
      const { POST } = await import("@/app/api/scan/route");
      const documents = [
        makeFile("doc1.pdf", "application/pdf"),
        makeFile("doc2.pdf", "application/pdf"),
        makeFile("doc3.pdf", "application/pdf"),
        makeFile("doc4.pdf", "application/pdf"),
        makeFile("doc5.pdf", "application/pdf"),
        makeFile("doc6.pdf", "application/pdf"), // 6th doc - exceeds limit
      ];
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents }),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("BAD_INPUT");
      expect(body.error.reason).toBe("TOO_MANY_DOCUMENTS");
    });

    it("uses default markets when not provided", async () => {
      const { POST } = await import("@/app/api/scan/route");
      const fd = new FormData();
      fd.append("images", makeFile("test.jpg"));
      fd.append("category", "electronics");
      // markets not provided

      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: fd,
      });
      await POST(req);

      expect(mockRunScan).toHaveBeenCalledTimes(1);
      const [, opts] = mockRunScan.mock.calls[0];
      expect(opts.markets).toEqual(["EU", "US"]); // Default markets
    });

    it("handles invalid category gracefully", async () => {
      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ category: "invalid_category" }),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("BAD_INPUT");
      expect(body.error.reason).toBe("INVALID_REQUEST");
    });
  });
});
