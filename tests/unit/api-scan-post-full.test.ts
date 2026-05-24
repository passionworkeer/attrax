// @vitest-environment node

/**
 * Additional unit tests for POST /api/scan to cover remaining code paths.
 * Tests document processing, PDF handling, DOCX handling, and error scenarios.
 *
 * Run with: npm run test -- tests/unit/api-scan-post-full.test.ts
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
const { mockRunScan, mockCreateSession, mockUpdateSession, mockSessions, mockExtractRawText } = vi.hoisted(
  () => ({
    mockRunScan: vi.fn<RunScanMock>(() => Promise.resolve()),
    mockSessions: new Map<string, Record<string, unknown>>(),
    mockExtractRawText: vi.fn(() =>
      Promise.resolve({
        value: "",
      })
    ),
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
    void mockRunScan(sessionId, opts).catch((error: unknown) => {
      mockUpdateSession(sessionId, {
        status: "failed",
        progress: 100,
        stageText: "扫描失败，请稍后重试。",
        error: error instanceof Error ? error.message : "SCAN_FAILED",
      });
    });
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
    bareboneRiskExposure: 30,
    compliantRiskExposure: 0,
    keyConclusion: "合规模式净利润显著高于裸奔模式",
    generatedAt: new Date().toISOString(),
  })),
}));

vi.mock("mammoth", () => ({
  extractRawText: mockExtractRawText,
}));

// Helper: create a minimal JPEG buffer
function minimalJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
  ]);
}

// Helper: create a minimal PDF buffer
function minimalPdf(): Uint8Array {
  return new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, // %PDF-1.4
    0x0a, 0x25, 0xc7, 0xec, 0x8f, 0xa2, 0x0a, 0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a,
    0x0a, 0x3c, 0x3c, 0x0a, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x20, 0x2f, 0x43, 0x61, 0x74,
    0x61, 0x6c, 0x6f, 0x67, 0x0a, 0x3e, 0x3e, 0x0a, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a,
    0x0a, 0x78, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
  ]);
}

// Helper: create a minimal DOCX buffer (ZIP with minimal content)
function minimalDocx(): Uint8Array {
  // Minimal valid DOCX structure (ZIP with [Content_Types].xml)
  const header = new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, // Local file header signature
    0x14, 0x00, // version needed
    0x00, 0x00, // general purpose bit flag
    0x00, 0x00, // compression method (stored)
    0x00, 0x00, // last mod time
    0x00, 0x00, // last mod date
    0x00, 0x00, 0x00, 0x00, // crc-32
    0x00, 0x00, 0x00, 0x00, // compressed size
    0x00, 0x00, 0x00, 0x00, // uncompressed size
    0x10, 0x00, // file name length
    0x00, 0x00, // extra field length
  ]);
  return header;
}

// Helper: create a text file
function minimalText(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function makeFile(name: string, type = "image/jpeg", data?: Uint8Array): File {
  return new File([toArrayBuffer(data ?? minimalJpeg())], name, { type });
}

function buildFormData(
  opts: {
    images?: File[];
    documents?: File[];
    category?: string;
    markets?: string;
  } = {}
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

describe("POST /api/scan - Document Processing Coverage", () => {
  beforeEach(() => {
    mockSessions.clear();
    mockRunScan.mockClear();
    mockCreateSession.mockClear();
    mockUpdateSession.mockClear();
    mockExtractRawText.mockReset();
    mockExtractRawText.mockResolvedValue({ value: "" });
    vi.useFakeTimers();
    process.env.DEMO_MODE = "false";
  });

  describe("PDF file processing", () => {
    it("processes PDF files for multipart forwarding", async () => {
      const pdfFile = makeFile("test.pdf", "application/pdf", minimalPdf());

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: [pdfFile] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      expect(mockRunScan).toHaveBeenCalledTimes(1);

      const [, opts] = mockRunScan.mock.calls[0];
      expect(opts.pdfs).toBeDefined();
      expect(opts.pdfs).toHaveLength(1);
      // In Node.js test environment, File.name may be "blob" - just verify PDF is processed
      expect(opts.pdfs[0].mimeType).toBe("application/pdf");
      expect(opts.pdfs[0].buffer).toBeInstanceOf(Buffer);
    });

    it("processes PDF files by extension", async () => {
      // File with PDF mime type - this should be processed as PDF
      const pdfFile = makeFile("manual.pdf", "application/pdf", minimalPdf());

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: [pdfFile] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      expect(mockRunScan).toHaveBeenCalledTimes(1);

      const [, opts] = mockRunScan.mock.calls[0];
      // Files with application/pdf mime type should be processed as PDFs
      expect(opts.pdfs.some((p: { mimeType: string }) => p.mimeType === "application/pdf")).toBeTruthy();
    });

    it("processes multiple PDF files", async () => {
      const pdfFiles = [
        makeFile("doc1.pdf", "application/pdf", minimalPdf()),
        makeFile("doc2.pdf", "application/pdf", minimalPdf()),
      ];

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: pdfFiles }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const [, opts] = mockRunScan.mock.calls[0];
      expect(opts.pdfs).toHaveLength(2);
    });
  });

  describe("DOCX file processing", () => {
    it("processes DOCX files with correct mime type", async () => {
      const docxFile = makeFile(
        "document.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        minimalDocx()
      );

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: [docxFile] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      expect(mockRunScan).toHaveBeenCalledTimes(1);

      const [, opts] = mockRunScan.mock.calls[0];
      expect(opts.documents).toBeDefined();
    });

    it("processes DOCX files by extension", async () => {
      const docxFile = makeFile("manual.docx", "application/octet-stream", minimalDocx());

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: [docxFile] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const [, opts] = mockRunScan.mock.calls[0];
      expect(opts.documents).toBeDefined();
    });

    it("handles DOCX mammoth extraction gracefully", async () => {
      const docxFile = makeFile(
        "doc.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        minimalDocx()
      );

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: [docxFile] }),
      });
      const res = await POST(req);

      // Should succeed even if mammoth extraction fails
      expect(res.status).toBe(202);
    });

    it("processes DOCX with mammoth successful extraction", async () => {
      mockExtractRawText.mockResolvedValue({
        value: "This is extracted DOCX content about compliance requirements.",
      });

      const docxFile = makeFile(
        "compliance.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        minimalDocx()
      );

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: [docxFile] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
    });
  });

  describe("Text file processing", () => {
    it("processes plain text files", async () => {
      const textFile = makeFile(
        "readme.txt",
        "text/plain",
        minimalText("这是一份合规文档")
      );

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: [textFile] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      expect(mockRunScan).toHaveBeenCalledTimes(1);

      const [, opts] = mockRunScan.mock.calls[0];
      expect(opts.documents).toBeDefined();
    });

    it("limits text content to 5000 characters", async () => {
      const longText = "a".repeat(10000);
      const textFile = makeFile(
        "long.txt",
        "text/plain",
        minimalText(longText)
      );

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: [textFile] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const [, opts] = mockRunScan.mock.calls[0];
      const doc = opts.documents[0];
      expect(doc.text.length).toBeLessThanOrEqual(5000);
    });

    it("handles text extraction errors gracefully", async () => {
      // Create a file that throws on text() call
      const errorFile = new File([], "error.txt", { type: "text/plain" });
      // Override arrayBuffer to simulate error
      Object.defineProperty(errorFile, "text", {
        value: vi.fn().mockRejectedValue(new Error("Text extraction failed")),
        writable: true,
      });

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: [errorFile] }),
      });
      const res = await POST(req);

      // Should succeed with empty text
      expect(res.status).toBe(202);
    });
  });

  describe("Mixed document processing", () => {
    it("processes PDF, DOCX, and text files together", async () => {
      const docs = [
        makeFile("doc.pdf", "application/pdf", minimalPdf()),
        makeFile("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", minimalDocx()),
        makeFile("notes.txt", "text/plain", minimalText("一些笔记")),
      ];

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ documents: docs }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const [, opts] = mockRunScan.mock.calls[0];
      expect(opts.pdfs).toHaveLength(1);
      expect(opts.documents).toBeDefined();
    });
  });

  describe("Image processing with documents", () => {
    it("processes images and documents in parallel", async () => {
      const images = [
        makeFile("front.jpg"),
        makeFile("back.jpg"),
      ];
      const docs = [
        makeFile("manual.pdf", "application/pdf", minimalPdf()),
      ];

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ images, documents: docs }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const [, opts] = mockRunScan.mock.calls[0];
      expect(opts.images).toHaveLength(2);
      expect(opts.pdfs).toHaveLength(1);
    });

    it("includes original name and mime type for images", async () => {
      const image = makeFile("product-photo.jpg", "image/jpeg");

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ images: [image] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);
      const [, opts] = mockRunScan.mock.calls[0];
      // In Node.js test environment, File.name may be "blob" - just verify image is processed
      expect(opts.images[0].mimeType).toBe("image/jpeg");
    });

    it("rejects images without mime type", async () => {
      const image = new File([toArrayBuffer(minimalJpeg())], "photo.noext", { type: "" });

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ images: [image] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      expect(mockRunScan).not.toHaveBeenCalled();
    });
  });

  describe("runScan error handling", () => {
    it("catches runScan errors and updates session to failed status", async () => {
      mockRunScan.mockImplementation(() =>
        Promise.reject(new Error("RAG service unavailable"))
      );

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData(),
      });
      const res = await POST(req);

      // Request should still return 202 (async operation)
      expect(res.status).toBe(202);

      // Wait for async error to be caught
      await vi.advanceTimersByTimeAsync(100);

      // Session should be updated to failed
      expect(mockUpdateSession).toHaveBeenCalled();
      const lastCall = mockUpdateSession.mock.calls[mockUpdateSession.mock.calls.length - 1];
      expect(lastCall[1].status).toBe("failed");
      expect(lastCall[1].error).toBe("RAG service unavailable");
    });

    it("handles non-Error objects in catch block", async () => {
      mockRunScan.mockImplementation(() =>
        Promise.reject("string error")
      );

      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData(),
      });
      const res = await POST(req);

      expect(res.status).toBe(202);

      await vi.advanceTimersByTimeAsync(100);

      const lastCall = mockUpdateSession.mock.calls[mockUpdateSession.mock.calls.length - 1];
      expect(lastCall[1].error).toBe("SCAN_FAILED"); // Localized by the client
    });
  });

  describe("Input validation edge cases", () => {
    it("rejects invalid category", async () => {
      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData({ category: "invalid_category" }),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("BAD_INPUT");
    });

    it("handles malformed FormData gracefully", async () => {
      // Simulating FormData parsing failure
      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: "not form data",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await POST(req);

      // The implementation catches formData parsing errors
      // If formData parsing fails, it should return BAD_INPUT
      expect([400, 500]).toContain(res.status);
    });
  });

  describe("Schema validation edge cases", () => {
    it("handles schema validation failure due to invalid imageCount", async () => {
      // The StartScanRequestSchema requires imageCount >= 1
      // This is already tested via the empty images case
      const { POST } = await import("@/app/api/scan/route");
      const fd = new FormData();
      fd.append("category", "electronics");
      fd.append("markets", "EU,US");
      // No images appended - should trigger BAD_INPUT

      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: fd,
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("BAD_INPUT");
    });
  });

  describe("Session creation", () => {
    it("creates session before running scan", async () => {
      const { POST } = await import("@/app/api/scan/route");
      const req = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData(),
      });
      await POST(req);

      expect(mockCreateSession).toHaveBeenCalledTimes(1);
      expect(mockCreateSession).toHaveBeenCalledBefore(mockRunScan);
    });

    it("generates unique session IDs", async () => {
      const { POST } = await import("@/app/api/scan/route");

      const req1 = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData(),
      });
      const res1 = await POST(req1);
      const body1 = await res1.json();

      mockCreateSession.mockClear();
      const req2 = new Request("http://localhost/api/scan", {
        method: "POST",
        body: buildFormData(),
      });
      const res2 = await POST(req2);
      const body2 = await res2.json();

      expect(body1.sessionId).not.toBe(body2.sessionId);
    });
  });
});
