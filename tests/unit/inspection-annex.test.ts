/**
 * tests/unit/inspection-annex.test.ts
 *
 * Plan 2026-09-14 §4.5 (J06) — unit tests for the 图像证据附录
 * (`appendInspectionAnnexToPdf`) appended to the compliance report PDF.
 *
 * Coverage required by the plan:
 *   1. observation + region → jsPDF addImage + rect (bbox overlay) called
 *   2. webp assets → skipped with an explicit note, addImage NOT called
 *   3. image fetch failure → 「图片 N 加载失败」 note, no throw, export continues
 *   4. VM without findings/observations (demo/legacy) → caller skips the annex
 *   5. CJK titles go through setFont("NotoSansSC", ...) — never Helvetica
 *
 * The jsPDF instance is mocked (MockJsPDF pattern from report-export.test.ts)
 * and fetch is stubbed to return a 1x1 PNG's bytes.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ComplianceReportResult, ScanResult } from "@/lib/types";

// ─── Mock jsPDF (hoisted so the factory can reference it) ───────────────────
const jsPDFMethods = vi.hoisted(() => {
  const inst = {
    addFont: vi.fn(), addFileToVFS: vi.fn(), setFont: vi.fn(), addPage: vi.fn(),
    getNumberOfPages: vi.fn(() => 1), setPage: vi.fn(),
    getTextWidth: vi.fn(() => 20), roundedRect: vi.fn(), line: vi.fn(),
    setFontSize: vi.fn(), setTextColor: vi.fn(), setDrawColor: vi.fn(),
    setFillColor: vi.fn(), setLineWidth: vi.fn(), text: vi.fn(),
    rect: vi.fn(), addImage: vi.fn(),
    splitTextToSize: vi.fn((t: string) => String(t).split("\n")),
    save: vi.fn(),
    // Return a REAL Blob so downloadBlob → URL.createObjectURL works under
    // the jsdom/Node URL implementation (the {} stand-in from report-export
    // tests relies on a stubbed global URL we do not need here).
    output: vi.fn(() => new Blob(["pdf"], { type: "application/pdf" })),
    internal: {
      pageSize: {
        getWidth: vi.fn(() => 210), getHeight: vi.fn(() => 297),
      },
    },
  };
  return inst;
});

function MockJsPDF(opts: unknown) {
  void opts;
  return jsPDFMethods;
}
const mockJsPDFCtor = vi.hoisted(() => vi.fn(MockJsPDF) as unknown as new (opts?: unknown) => typeof jsPDFMethods);

vi.mock("jspdf", () => ({ jsPDF: mockJsPDFCtor }));

// Mock docx (compliance.ts imports it statically for the DOCX path).
vi.mock("docx", () => {
  function Ctor(this: Record<string, unknown>, opts: Record<string, unknown>) {
    Object.assign(this, opts);
  }
  const mk = () => vi.fn(Ctor) as unknown as Record<string, unknown> & { mockClear?: () => void };
  return {
    AlignmentType: { CENTER: "center" },
    BorderStyle: { NONE: "none", SINGLE: "single" },
    Document: mk(),
    Packer: { toBlob: vi.fn(async () => new Blob()) },
    Paragraph: mk(),
    HeadingLevel: { HEADING_1: "Heading1", HEADING_2: "Heading2", HEADING_3: "Heading3" },
    Table: mk(),
    TableCell: mk(),
    TableRow: mk(),
    TextRun: mk(),
    WidthType: { PERCENTAGE: "percentage" },
  };
});

// ─── System under test (imported AFTER mocks are registered) ─────────────────
import { appendInspectionAnnexToPdf } from "@/lib/report-export-modules/inspection-annex";
import { buildInspectionResultViewModel } from "@/lib/result/inspection-view-model";
import { downloadReportAsPdf } from "@/lib/report-export-modules/compliance";

// ─── 1x1 PNG bytes (67-byte valid PNG: IHDR + IDAT + IEND) ──────────────────
const PNG_1X1_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

// ─── fixtures ────────────────────────────────────────────────────────────────

function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    sessionId: "scan_annex_test",
    scanTime: "2026-09-14T08:00:00Z",
    productCategory: "electronics",
    targetMarkets: ["EU"],
    complianceScore: 65,
    scoreGrade: "C",
    images: [
      {
        imageId: "scan_annex_test-image-0",
        url: "/api/scan/scan_annex_test/asset/0",
        thumbnail: "/api/scan/scan_annex_test/asset/0",
        width: 0,
        height: 0,
        fileName: "front.png",
      },
    ],
    documents: [],
    riskPoints: [],
    checklist: [],
    generatedAt: "2026-09-14T08:01:00Z",
    inspectionObservations: [
      {
        observationId: "obs-0",
        checkId: "common.nameplate.readability",
        imageId: "scan_annex_test-image-0",
        visibility: "present_unreadable",
        observedText: null,
        description: "铭牌可见但模糊",
        region: {
          kind: "bbox",
          coordinateSpace: "normalized_canonical_image",
          bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.15 },
          verified: true,
        },
      },
    ],
    inspectionFindings: [
      {
        findingId: "scan_annex_test-finding-1",
        checkId: "common.nameplate.readability",
        title: "铭牌电气参数（电压/电流/功率/频率）",
        assessment: "evidence_needed",
        applicability: "applicable",
        severity: "medium",
        observationIds: ["obs-0"],
        citationIds: [],
        suggestedAction: "补拍清晰铭牌",
        requiredEvidence: ["补拍视角：nameplate_closeup"],
      },
    ],
    ...overrides,
  } as ScanResult;
}

function makeVm(overrides: Partial<ScanResult> = {}) {
  const result = makeScanResult(overrides);
  return {
    vm: buildInspectionResultViewModel({ result, sessionId: "scan_annex_test" }),
    result,
  };
}

/** fetch stub: PNG bytes for the asset route; anything else fails. */
function stubFetchWithPng() {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/scan/")) {
      return {
        ok: true,
        headers: { get: () => "image/png" },
        arrayBuffer: async () => PNG_1X1_BYTES.slice().buffer,
      };
    }
    return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  });
}

function stubFetchWithWebp() {
  return vi.fn(async () => ({
    ok: true,
    headers: { get: () => "image/webp" },
    arrayBuffer: async () => new Uint8Array([0x52, 0x49, 0x46, 0x46]).slice().buffer,
  }));
}

function stubFetchFailure() {
  return vi.fn(async () => ({
    ok: false,
    status: 401,
    headers: { get: () => null },
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("appendInspectionAnnexToPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("draws addImage + a rect for a located observation (bbox overlay)", async () => {
    const { vm } = makeVm();
    vi.stubGlobal("fetch", stubFetchWithPng());
    const doc = new mockJsPDFCtor();

    await appendInspectionAnnexToPdf(doc, vm, { sessionId: "scan_annex_test", accessToken: "tok-1" });

    // The image is embedded...
    expect(jsPDFMethods.addImage).toHaveBeenCalledTimes(1);
    const addImageArgs = jsPDFMethods.addImage.mock.calls[0];
    expect(String(addImageArgs?.[1])).toBe("png");
    // ...with a dataURL payload built from the fetched bytes.
    expect(String(addImageArgs?.[0])).toContain("base64");
    // The located anchor draws a red rect (finding box) on top.
    expect(jsPDFMethods.rect).toHaveBeenCalled();
    // Bearer token goes on the asset fetch (BFF route requires it).
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer tok-1" },
    });
  });

  it("skips webp assets with an explicit note and never calls addImage", async () => {
    const { vm } = makeVm({
      images: [
        {
          imageId: "scan_annex_test-image-0",
          url: "/api/scan/scan_annex_test/asset/0",
          thumbnail: "",
          width: 0,
          height: 0,
          fileName: "shot.webp",
        },
      ],
    });
    vi.stubGlobal("fetch", stubFetchWithWebp());
    const doc = new mockJsPDFCtor();

    await appendInspectionAnnexToPdf(doc, vm, { sessionId: "scan_annex_test", accessToken: "tok-1" });

    expect(jsPDFMethods.addImage).not.toHaveBeenCalled();
    const texts = jsPDFMethods.text.mock.calls.map((c) => String(c?.[0]));
    expect(texts.some((t) => t.includes("webp"))).toBe(true);
    // And the export continues: the coverage table + disclaimer still render.
    expect(texts.some((t) => t.includes("图像证据附录"))).toBe(true);
  });

  it("notes 加载失败 when the image fetch fails and does not throw", async () => {
    const { vm } = makeVm();
    vi.stubGlobal("fetch", stubFetchFailure());
    const doc = new mockJsPDFCtor();

    await expect(
      appendInspectionAnnexToPdf(doc, vm, { sessionId: "scan_annex_test", accessToken: "tok-1" }),
    ).resolves.toBeUndefined();

    expect(jsPDFMethods.addImage).not.toHaveBeenCalled();
    const texts = jsPDFMethods.text.mock.calls.map((c) => String(c?.[0]));
    expect(texts.some((t) => t.includes("图 1 加载失败"))).toBe(true);
  });

  it("renders unlocated findings as text cards (no bbox rect for them)", async () => {
    // A document-gap finding with zero observations + a located one.
    const { vm } = makeVm({
      inspectionFindings: [
        {
          findingId: "scan_annex_test-finding-doc",
          checkId: "electronics.emc.test_report",
          title: "EMC 测试报告缺失",
          assessment: "evidence_needed",
          applicability: "applicable",
          severity: "medium",
          observationIds: [],
          citationIds: [],
          suggestedAction: "提交 EMC 报告",
          requiredEvidence: ["检测报告：EMC 测试报告"],
        },
        {
          findingId: "scan_annex_test-finding-1",
          checkId: "common.nameplate.readability",
          title: "铭牌电气参数（电压/电流/功率/频率）",
          assessment: "evidence_needed",
          applicability: "applicable",
          severity: "medium",
          observationIds: ["obs-0"],
          citationIds: [],
          suggestedAction: "补拍清晰铭牌",
          requiredEvidence: ["补拍视角：nameplate_closeup"],
        },
      ],
    });
    vi.stubGlobal("fetch", stubFetchWithPng());
    const doc = new mockJsPDFCtor();

    await appendInspectionAnnexToPdf(doc, vm, { sessionId: "scan_annex_test", accessToken: "tok-1" });

    const texts = jsPDFMethods.text.mock.calls.map((c) => String(c?.[0]));
    // The unlocated finding is listed textually...
    expect(texts.some((t) => t.includes("EMC 测试报告缺失"))).toBe(true);
    expect(texts.some((t) => t.includes("无定位观察项"))).toBe(true);
    // ...and the located one still gets its image + box.
    expect(jsPDFMethods.addImage).toHaveBeenCalledTimes(1);
    expect(jsPDFMethods.rect).toHaveBeenCalled();
  });

  it("renders the coverage table + 「本图未见异常 ≠ 全面合规」 disclaimer", async () => {
    const { vm } = makeVm();
    vi.stubGlobal("fetch", stubFetchWithPng());
    const doc = new mockJsPDFCtor();

    await appendInspectionAnnexToPdf(doc, vm, { sessionId: "scan_annex_test", accessToken: "tok-1" });

    const texts = jsPDFMethods.text.mock.calls.map((c) => String(c?.[0]));
    expect(texts.some((t) => t.includes("检查覆盖表"))).toBe(true);
    expect(texts.some((t) => t.includes("本图未见异常 ≠ 全面合规"))).toBe(true);
    // Coverage rows carry the check's business title + visibility status.
    expect(texts.some((t) => t.includes("铭牌电气参数"))).toBe(true);
  });

  it("uses NotoSansSC for CJK labels (never the Helvetica mojibake path)", async () => {
    const { vm } = makeVm();
    vi.stubGlobal("fetch", stubFetchWithPng());
    const doc = new mockJsPDFCtor();

    await appendInspectionAnnexToPdf(doc, vm, { sessionId: "scan_annex_test", accessToken: "tok-1" });

    expect(jsPDFMethods.setFont).toHaveBeenCalledWith("NotoSansSC", "bold");
    expect(jsPDFMethods.setFont).toHaveBeenCalledWith("NotoSansSC", "normal");
    const fontCalls = jsPDFMethods.setFont.mock.calls.map((c) => String(c?.[0]));
    expect(fontCalls.every((f) => f === "NotoSansSC")).toBe(true);
  });

  it("passes no Authorization header when accessToken is null and sessionStorage is empty", async () => {
    const { vm } = makeVm();
    const fetchMock = stubFetchWithPng();
    vi.stubGlobal("fetch", fetchMock);
    // jsdom has sessionStorage, but `scan-token:` key is unset → null token.
    window.sessionStorage.clear();
    const doc = new mockJsPDFCtor();

    await appendInspectionAnnexToPdf(doc, vm, { sessionId: "scan_annex_test", accessToken: null });

    const call = fetchMock.mock.calls[0];
    expect(call?.[1]).toMatchObject({ headers: {} });
  });

  it("falls back to sessionStorage scan-token:{id} when accessToken is omitted", async () => {
    const { vm } = makeVm();
    const fetchMock = stubFetchWithPng();
    vi.stubGlobal("fetch", fetchMock);
    window.sessionStorage.setItem("scan-token:scan_annex_test", "stored-tok");
    const doc = new mockJsPDFCtor();

    await appendInspectionAnnexToPdf(doc, vm, { sessionId: "scan_annex_test" });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer stored-tok" },
    });
    window.sessionStorage.clear();
  });
});

// ─── caller wiring (compliance.ts) ───────────────────────────────────────────

describe("downloadReportAsPdf — inspection annex wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jsPDFMethods.getNumberOfPages.mockReturnValue?.();
    // Font fetch (embedFont) + asset fetches go through the same stub.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/fonts/")) {
          return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).slice().buffer };
        }
        if (url.includes("/api/scan/")) {
          return {
            ok: true,
            headers: { get: () => "image/png" },
            arrayBuffer: async () => PNG_1X1_BYTES.slice().buffer,
          };
        }
        return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function complianceInput(overrides: Record<string, unknown> = {}): ComplianceReportResult {
    return {
      sessionId: "scan_annex_test",
      scanTime: "2026-09-14T08:00:00Z",
      productCategory: "electronics",
      productName: "USB 加湿器",
      targetMarkets: ["EU"],
      complianceScore: 65,
      scoreGrade: "C",
      complianceReport: "# 概述\n\n测试。",
      complianceStatus: "PASS",
      kind: "real",
      agentTrace: [],
      loopCount: 0,
      retrievedChunks: [],
      images: [],
      documents: [],
      generatedAt: "2026-09-14T08:00:00Z",
      modelInfo: { ragProvider: "mock", latencyMs: 100 },
      ...overrides,
    } as unknown as ComplianceReportResult;
  }

  it("appends the annex when the result carries inspection observations", async () => {
    const scan = makeScanResult();
    const input = complianceInput({
      inspectionObservations: scan.inspectionObservations,
      inspectionFindings: scan.inspectionFindings,
      selectedCheckIds: scan.selectedCheckIds,
      images: scan.images,
    });

    await downloadReportAsPdf(input, "zh");

    // The annex started a new page and drew the image with its anchor box.
    expect(jsPDFMethods.addImage).toHaveBeenCalled();
    expect(jsPDFMethods.rect).toHaveBeenCalled();
    const texts = jsPDFMethods.text.mock.calls.map((c) => String(c?.[0]));
    expect(texts.some((t) => t.includes("图像证据附录"))).toBe(true);
  });

  it("skips the annex entirely for demo/legacy results (no observations/findings)", async () => {
    await downloadReportAsPdf(complianceInput(), "zh");

    expect(jsPDFMethods.addImage).not.toHaveBeenCalled();
    const texts = jsPDFMethods.text.mock.calls.map((c) => String(c?.[0]));
    expect(texts.some((t) => t.includes("图像证据附录"))).toBe(false);
    // The core report still exports normally.
    expect(jsPDFMethods.text).toHaveBeenCalled();
  });

  it("continues the core export when the annex throws (additive failure isolation)", async () => {
    const scan = makeScanResult();
    const input = complianceInput({
      inspectionObservations: scan.inspectionObservations,
      inspectionFindings: scan.inspectionFindings,
      images: scan.images,
    });
    // Font fetch succeeds (core report renders); ONLY the asset fetch dies,
    // which the annex itself already tolerates — so to force an annex-level
    // throw we make fetch reject entirely on the asset route.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (inputUrl: unknown) => {
        const url = String(inputUrl);
        if (url.includes("/fonts/")) {
          return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).slice().buffer };
        }
        throw new Error("network down");
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(downloadReportAsPdf(input, "zh")).resolves.toBeUndefined();
    // Core export completed (PDF bytes produced) even though the asset fetch
    // rejected — fetchImageAsset catches, notes the failure, and the guard
    // isolates any residual annex error from the main flow.
    expect(jsPDFMethods.output).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
