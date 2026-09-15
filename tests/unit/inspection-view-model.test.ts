/**
 * tests/unit/inspection-view-model.test.ts
 *
 * Plan 2026-09-14 §4.3 — 统一结果契约 ViewModel 单元测试（J03/J15）。
 *
 * Covers the hard contract rules:
 *   1. finding → observationIds → imageId/region join uses the real keys
 *   2. findings without a region never produce image anchors
 *   3. citations dedupe on doc_id + article_id + quote span (19 dupes → 1)
 *   4. evidenceRequests merge findings that require the SAME view set
 *   5. productName fallback chain: structured → category + （型号待确认）
 *   6. summary counts derive from the same entity sets as the lists
 *   7. empty-observations / empty-findings boundary behavior
 *   8. selection helpers resolve check/finding → imageId + observationId
 */
import { describe, expect, it } from "vitest";
import {
  buildInspectionResultViewModel,
  resolveSelectionFromCheck,
  resolveSelectionFromFinding,
} from "@/lib/result/inspection-view-model";
import type { ScanResult } from "@/lib/types";

// ── fixture builder ───────────────────────────────────────────────────────

function baseResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    sessionId: "scan_vm_test",
    scanTime: "2026-09-14T08:00:00Z",
    productCategory: "electronics",
    targetMarkets: ["EU", "UK"],
    complianceScore: 65,
    scoreGrade: "C",
    images: [
      {
        imageId: "scan_vm_test-image-0",
        url: "/api/scan/scan_vm_test/asset/0",
        thumbnail: "/api/scan/scan_vm_test/asset/0",
        width: 0,
        height: 0,
        fileName: "front.png",
      },
      {
        imageId: "scan_vm_test-image-1",
        url: "/api/scan/scan_vm_test/asset/1",
        thumbnail: "/api/scan/scan_vm_test/asset/1",
        width: 0,
        height: 0,
        fileName: "nameplate.png",
      },
    ],
    documents: [],
    riskPoints: [],
    checklist: [],
    generatedAt: "2026-09-14T08:01:00Z",
    ...overrides,
  };
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    observationId: "obs-0",
    checkId: "common.nameplate.readability",
    imageId: "scan_vm_test-image-1",
    visibility: "present_readable",
    observedText: "ACME 5V⎓2A",
    description: "铭牌可见",
    region: {
      kind: "bbox",
      coordinateSpace: "normalized_canonical_image",
      bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.15 },
      verified: true,
    },
    ...overrides,
  };
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    findingId: "scan_vm_test-finding-1",
    checkId: "common.nameplate.readability",
    title: "铭牌电气参数（电压/电流/功率/频率）",
    assessment: "evidence_needed",
    applicability: "applicable",
    severity: "medium",
    observationIds: ["obs-0"],
    citationIds: ["KB-electronics-EU-LVD-2014-35"],
    suggestedAction: "补拍清晰的铭牌照片",
    requiredEvidence: ["补拍视角：nameplate_closeup"],
    ...overrides,
  };
}

// ── 1. finding → observation → imageId/region join ─────────────────────────

describe("buildInspectionResultViewModel — finding/observation join", () => {
  it("joins findings to observations via real observationIds foreign keys", () => {
    const result = baseResult({
      inspectionObservations: [observation()],
      inspectionFindings: [finding()],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });

    expect(vm.findings).toHaveLength(1);
    const vmFinding = vm.findings[0];
    expect(vmFinding.observations).toHaveLength(1);
    expect(vmFinding.observations[0].observationId).toBe("obs-0");
    // The expanded observation carries imageId + region bbox (normalized).
    expect(vmFinding.observations[0].imageId).toBe("scan_vm_test-image-1");
    expect(vmFinding.observations[0].bbox).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.15 });
    // locatedAnchors mirrors the join: imageId + bbox + finding linkage.
    expect(vmFinding.locatedAnchors).toHaveLength(1);
    expect(vmFinding.locatedAnchors[0]).toMatchObject({
      observationId: "obs-0",
      findingId: "scan_vm_test-finding-1",
      checkId: "common.nameplate.readability",
      imageId: "scan_vm_test-image-1",
      bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.15 },
    });
    // anchorsByImage groups the anchor under the correct image.
    expect(vm.anchorsByImage["scan_vm_test-image-1"]).toHaveLength(1);
    expect(vm.anchorsByImage["scan_vm_test-image-0"]).toBeUndefined();
  });

  it("drops dangling observationIds instead of fabricating anchors", () => {
    const result = baseResult({
      inspectionObservations: [observation()],
      inspectionFindings: [
        finding({ observationIds: ["obs-gone", "obs-0"], findingId: "scan_vm_test-finding-2" }),
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });

    expect(vm.findings[0].observations).toHaveLength(1);
    expect(vm.findings[0].observations[0].observationId).toBe("obs-0");
  });

  it("keeps multi-image observations per check and exposes all of them", () => {
    const result = baseResult({
      inspectionObservations: [
        observation({
          observationId: "obs-a",
          imageId: "scan_vm_test-image-0",
          visibility: "not_in_view",
          region: null,
        }),
        observation({
          observationId: "obs-b",
          imageId: "scan_vm_test-image-1",
          visibility: "present_readable",
        }),
      ],
      inspectionFindings: [finding({ observationIds: ["obs-a", "obs-b"] })],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });

    const check = vm.checks.find((item) => item.checkId === "common.nameplate.readability");
    expect(check?.observations).toHaveLength(2);
    // best observation = the readable one, which happens to be located too.
    expect(check?.bestObservation?.observationId).toBe("obs-b");
  });
});

// ── 2. no region → no hotspot ──────────────────────────────────────────────

describe("ungrounded findings never become hotspots", () => {
  it("findings whose observations have no region stay list-only", () => {
    const result = baseResult({
      inspectionObservations: [
        observation({ region: null, visibility: "not_in_view", observationId: "obs-noview" }),
      ],
      inspectionFindings: [
        finding({
          observationIds: ["obs-noview"],
          assessment: "evidence_needed",
          suggestedAction: "补拍nameplate_closeup（本次照片未覆盖该区域）",
        }),
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });

    // The finding still renders in the list...
    expect(vm.findings).toHaveLength(1);
    expect(vm.findings[0].observations).toHaveLength(1);
    // ...but provides NO located anchors.
    expect(vm.findings[0].locatedAnchors).toEqual([]);
    // And no anchors exist on ANY image (the whole anchorsByImage map is
    // empty for this scan).
    expect(Object.keys(vm.anchorsByImage)).toHaveLength(0);
  });

  it("document-gap findings (zero observationIds) have no anchors either", () => {
    const result = baseResult({
      inspectionObservations: [observation()],
      inspectionFindings: [
        finding({
          observationIds: [],
          checkId: "electronics.emc.test_report",
          title: "EMC 测试报告",
          assessment: "evidence_needed",
          requiredEvidence: ["检测报告：EMC 测试报告"],
        }),
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });

    const docGap = vm.findings.find((f) => f.checkId === "electronics.emc.test_report");
    expect(docGap?.observations).toEqual([]);
    expect(docGap?.locatedAnchors).toEqual([]);
    // The located observation from the OTHER check still anchors.
    expect(vm.anchorsByImage["scan_vm_test-image-1"]).toHaveLength(1);
    expect(vm.anchorsByImage["scan_vm_test-image-1"][0].checkId).toBe(
      "common.nameplate.readability",
    );
  });

  it("treats invalid bboxes (negative origin / zero extent) as ungrounded", () => {
    const result = baseResult({
      inspectionObservations: [
        observation({
          observationId: "obs-bad",
          region: { kind: "bbox", bbox: { x: -0.5, y: 0.1, w: 0.2, h: 0.2 } },
        }),
      ],
      inspectionFindings: [finding({ observationIds: ["obs-bad"] })],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.findings[0].observations[0].bbox).toBeNull();
    expect(vm.findings[0].locatedAnchors).toEqual([]);
  });
});

// ── 3. citation dedupe ─────────────────────────────────────────────────────

describe("citation dedupe", () => {
  it("collapses repeated doc_id+article_id entries into a single citation", () => {
    // Sample B shape: 19 raw entries, all pointing at the same doc/article.
    const dupes = Array.from({ length: 19 }, (_, index) => ({
      doc_id: "EU-2014-35",
      article_id: "art-7",
      official_citation: "LVD Art. 7",
      quote: index === 4 ? "最长的一段引文用于展示去重保留策略" : "同一条文",
      match_status: "fallback_article_only",
    }));
    const result = baseResult({
      reportPackage: {
        citations: dupes,
      } as unknown as ScanResult["reportPackage"],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });

    expect(vm.citations).toHaveLength(1);
    expect(vm.citations[0].docId).toBe("EU-2014-35");
    expect(vm.citations[0].articleId).toBe("art-7");
    expect(vm.citations[0].duplicates).toBe(19);
    // Longest quote wins among duplicates.
    expect(vm.citations[0].quote).toContain("最长的一段引文");
    expect(vm.citations[0].matchStatus).toBe("fallback_article_only");
    expect(vm.summary.citationCount).toBe(1);
  });

  it("keeps distinct articles separate even in the same document", () => {
    const result = baseResult({
      reportPackage: {
        citations: [
          { doc_id: "EU-2009-48", article_id: "art-5" },
          { doc_id: "EU-2009-48", article_id: "art-6" },
          { doc_id: "EU-2009-48", article_id: "art-5" },
        ],
      } as unknown as ScanResult["reportPackage"],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.citations).toHaveLength(2);
  });

  it("defaults missing match_status to unverified, never matched (J05)", () => {
    const result = baseResult({
      reportPackage: {
        citations: [{ doc_id: "EU-2014-30", article_id: "annex-ii" }],
      } as unknown as ScanResult["reportPackage"],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.citations[0].matchStatus).toBe("unverified");
  });

  it("drops entries without doc_id or article_id (no undefined chips)", () => {
    const result = baseResult({
      reportPackage: {
        citations: [
          { doc_id: "", article_id: "art-1" },
          { article_id: "art-2" },
          { doc_id: "EU-2014-35", article_id: "art-7" },
        ],
      } as unknown as ScanResult["reportPackage"],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.citations).toHaveLength(1);
    expect(vm.citations[0].docId).toBe("EU-2014-35");
  });

  it("merges citations and evidencePack lists with shared dedupe keys", () => {
    const result = baseResult({
      reportPackage: {
        citations: [{ doc_id: "EU-2014-35", article_id: "art-7", match_status: "matched" }],
        evidencePack: [
          { doc_id: "EU-2014-35", article_id: "art-7", match_status: "unmatched" },
        ],
      } as unknown as ScanResult["reportPackage"],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.citations).toHaveLength(1);
    // Strongest verification status wins across the two sources.
    expect(vm.citations[0].matchStatus).toBe("matched");
    expect(vm.citations[0].duplicates).toBe(2);
  });

  it("accepts legacy camelCased citation fields and normalizes them", () => {
    const result = baseResult({
      reportPackage: {
        citations: [
          { docId: "EU-2014-35", articleId: "art-7", matchStatus: "matched" },
          { docId: "EU-2014-35", articleId: "art-7", matchStatus: "matched" },
        ],
      } as unknown as ScanResult["reportPackage"],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.citations).toHaveLength(1);
    expect(vm.citations[0].matchStatus).toBe("matched");
    expect(vm.summary.citationCount).toBe(1);
  });
});

// ── 4. evidence request merging ───────────────────────────────────────────

describe("evidenceRequests merging", () => {
  it("merges findings that need the SAME view set into one request", () => {
    const result = baseResult({
      inspectionObservations: [
        observation({
          observationId: "obs-1",
          checkId: "common.nameplate.readability",
          region: null,
          visibility: "not_in_view",
        }),
        observation({
          observationId: "obs-2",
          checkId: "common.brand_model.visible",
          region: null,
          visibility: "not_in_view",
        }),
      ],
      inspectionFindings: [
        finding({
          findingId: "f1",
          checkId: "common.nameplate.readability",
          observationIds: ["obs-1"],
          title: "铭牌/标签信息可读性",
          suggestedAction: "补拍铭牌近照（当前照片未覆盖该区域）",
          requiredEvidence: ["补拍视角：nameplate_closeup"],
        }),
        finding({
          findingId: "f2",
          checkId: "common.brand_model.visible",
          observationIds: ["obs-2"],
          title: "品牌与型号标识",
          suggestedAction: "补拍清晰的正面与背面照片以覆盖品牌型号",
          requiredEvidence: ["补拍视角：nameplate_closeup"],
        }),
        finding({
          findingId: "f3",
          checkId: "electronics.interface.plug_pins",
          observationIds: [],
          title: "接口与插脚形态",
          suggestedAction: "补拍接口近照",
          requiredEvidence: ["补拍视角：ports_closeup"],
        }),
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });

    // f1 + f2 share the nameplate_closeup view → merged; f3 stands alone.
    expect(vm.evidenceRequests).toHaveLength(2);
    const nameplate = vm.evidenceRequests.find((request) =>
      request.requiredViews.includes("nameplate_closeup"),
    );
    expect(nameplate).toBeDefined();
    expect(nameplate?.resolvesCheckIds).toEqual(
      expect.arrayContaining(["common.nameplate.readability", "common.brand_model.visible"]),
    );
    expect(nameplate?.findingIds).toEqual(["f1", "f2"]);
    expect(nameplate?.status).toBe("needed");
    expect(nameplate?.type).toBe("photo");
    const ports = vm.evidenceRequests.find((request) =>
      request.requiredViews.includes("ports_closeup"),
    );
    expect(ports?.findingIds).toEqual(["f3"]);
  });

  it("groups document-material findings by their material list, not all together", () => {
    const result = baseResult({
      inspectionFindings: [
        finding({
          findingId: "f-doc-1",
          checkId: "electronics.emc.test_report",
          observationIds: [],
          title: "EMC 测试报告",
          requiredEvidence: ["检测报告：EMC 测试报告"],
        }),
        finding({
          findingId: "f-doc-2",
          checkId: "electronics.safety.electrical_test",
          observationIds: [],
          title: "电气安全测试报告",
          requiredEvidence: ["检测报告：电气安全测试报告"],
        }),
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });

    expect(vm.evidenceRequests).toHaveLength(2);
    expect(vm.evidenceRequests.every((request) => request.type === "document")).toBe(true);
  });

  it("produces no requests when there are no evidence_needed findings", () => {
    const result = baseResult({
      inspectionObservations: [observation()],
      inspectionFindings: [
        finding({ assessment: "suspected_issue", requiredEvidence: [] }),
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.evidenceRequests).toEqual([]);
  });
});

// ── 5. productName fallback chain ──────────────────────────────────────────

describe("productName fallback chain", () => {
  it("uses the structured productName first", () => {
    const vm = buildInspectionResultViewModel({
      result: baseResult({ productName: "65W GaN 充电器" }),
      sessionId: "scan_vm_test",
    });
    expect(vm.product.title).toBe("65W GaN 充电器");
  });

  it("falls back to the dossier product name when the top field is empty", () => {
    const result = baseResult({
      productName: "",
      reportPackage: {
        productDossier: { product: "充电盒（iQOO）" },
      } as unknown as ScanResult["reportPackage"],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.product.title).toBe("充电盒（iQOO）");
  });

  it("falls back to category label + （型号待确认）when nothing is set", () => {
    const vm = buildInspectionResultViewModel({
      result: baseResult({ productCategory: "toy" }),
      sessionId: "scan_vm_test",
    });
    expect(vm.product.title).toBe("玩具（型号待确认）");
  });

  it("falls back to 未知产品-style label for unknown categories", () => {
    const vm = buildInspectionResultViewModel({
      result: baseResult({ productCategory: "other" }),
      sessionId: "scan_vm_test",
    });
    expect(vm.product.title).toBe("其他（型号待确认）");
    expect(vm.product.title.length).toBeGreaterThan(0);
  });

  it("never yields an empty or undefined title", () => {
    const cases = [
      baseResult({ productName: "" }),
      baseResult({ productName: "   " }),
      baseResult({ productCategory: "electronics", productName: undefined }),
    ];
    for (const r of cases) {
      const vm = buildInspectionResultViewModel({ result: r, sessionId: "scan_vm_test" });
      expect(vm.product.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("extracts real product title from observations when structured name is missing", () => {
    const ankerResult = baseResult({
      productName: "",
      productCategory: "electronics",
      inspectionObservations: [
        observation({
          checkId: "common.nameplate.readability",
          observedText: "Anker 535 Charger (65W) 充电器 型号: A2332 输入: 100-240V~ 1.8A",
        }),
      ],
    });
    const vmAnker = buildInspectionResultViewModel({ result: ankerResult, sessionId: "scan_anker" });
    expect(vmAnker.product.title).toBe("Anker 535 Charger (65W) 充电器 A2332");

    const legoResult = baseResult({
      productName: "",
      productCategory: "toy",
      inspectionObservations: [
        observation({
          observationId: "o-1",
          checkId: "common.nameplate.readability",
          observedText: undefined,
        }),
        observation({
          observationId: "o-2",
          checkId: "common.nameplate.readability",
          observedText:
            "LEGO / Harry Potter / Talking Sorting Hat / 76429 / 561 pcs/pzs / Building Set / Ensemble de construction / Set de construccion / WIZARDING WORLD",
        }),
        observation({
          observationId: "o-3",
          checkId: "common.brand_model.visible",
          observedText: "LEGO; 76429; 561 pcs/pzs",
        }),
      ],
    });
    const vmLego = buildInspectionResultViewModel({ result: legoResult, sessionId: "scan_lego" });
    expect(vmLego.product.title).toBe("LEGO 76429 (Harry Potter Talking Sorting Hat)");
  });
});

// ── 6. summary consistency ─────────────────────────────────────────────────

describe("summary counts are computed from the same entity sets", () => {
  it("issueCount === suspected+confirmed findings length; evidenceNeededCount matches", () => {
    const result = baseResult({
      inspectionObservations: [observation()],
      inspectionFindings: [
        finding({ findingId: "f-sus", assessment: "suspected_issue" }),
        finding({ findingId: "f-conf", assessment: "confirmed_issue" }),
        finding({ findingId: "f-ev1", assessment: "evidence_needed" }),
        finding({ findingId: "f-ev2", assessment: "evidence_needed" }),
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });

    expect(vm.summary.issueCount).toBe(2);
    expect(vm.summary.issueCount).toBe(
      vm.findings.filter(
        (f) => f.assessment === "suspected_issue" || f.assessment === "confirmed_issue",
      ).length,
    );
    expect(vm.summary.evidenceNeededCount).toBe(2);
    expect(vm.summary.evidenceNeededCount).toBe(
      vm.findings.filter((f) => f.assessment === "evidence_needed").length,
    );
    expect(vm.summary.observationCount).toBe(vm.findings[0].observations.length);
  });

  it("citationCount equals the deduped citations list length", () => {
    const result = baseResult({
      reportPackage: {
        citations: [
          { doc_id: "EU-2014-35", article_id: "art-7" },
          { doc_id: "EU-2014-35", article_id: "art-7" },
          { doc_id: "EU-2014-30", article_id: "annex-ii" },
        ],
      } as unknown as ScanResult["reportPackage"],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.summary.citationCount).toBe(vm.citations.length);
    expect(vm.summary.citationCount).toBe(2);
  });

  it("derives status WARN from suspected findings when decisionView is missing", () => {
    const result = baseResult({
      inspectionFindings: [finding({ assessment: "suspected_issue" })],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.summary.status).toBe("WARN");
  });

  it("derives status REJECTED from confirmed findings", () => {
    const result = baseResult({
      inspectionFindings: [
        finding({ assessment: "confirmed_issue" }),
        finding({ findingId: "f2", assessment: "suspected_issue" }),
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.summary.status).toBe("REJECTED");
  });

  it("prefers the explicit decisionView verdict when present", () => {
    const result = baseResult({
      inspectionFindings: [finding({ assessment: "suspected_issue" })],
      reportPackage: {
        decisionView: { verdict: "PASS", nodes: [] },
      } as unknown as ScanResult["reportPackage"],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.summary.status).toBe("PASS");
  });

  it("revision is pinned to 1 (backend has no revision field yet)", () => {
    const vm = buildInspectionResultViewModel({
      result: baseResult(),
      sessionId: "scan_vm_test",
    });
    expect(vm.summary.revision).toBe(1);
  });
});

// ── 7. empty-state boundaries ──────────────────────────────────────────────

describe("empty observations / findings boundaries", () => {
  it("observations with zero findings → observation mode", () => {
    const result = baseResult({
      inspectionObservations: [
        observation({ region: null, visibility: "present_readable" }),
      ],
      inspectionFindings: [],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });

    expect(vm.summary.observationOnly).toBe(true);
    expect(vm.summary.observationCount).toBe(1);
    expect(vm.summary.issueCount).toBe(0);
    expect(vm.summary.status).toBe("UNKNOWN");
    expect(vm.checks).toHaveLength(1); // the checklist still renders
  });

  it("findings without observations (document gaps) still render", () => {
    const result = baseResult({
      inspectionObservations: [],
      inspectionFindings: [
        finding({ observationIds: [], checkId: "electronics.emc.test_report" }),
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });

    expect(vm.findings).toHaveLength(1);
    expect(vm.checks).toHaveLength(1);
    expect(vm.checks[0].coverage).toBe("not_assessed");
    expect(vm.summary.observationOnly).toBe(false);
    expect(vm.summary.evidenceNeededCount).toBe(1);
  });

  it("fully empty result still yields a valid, renderable VM", () => {
    const vm = buildInspectionResultViewModel({
      result: baseResult(),
      sessionId: "scan_vm_test",
    });
    expect(vm.checks).toEqual([]);
    expect(vm.findings).toEqual([]);
    expect(vm.citations).toEqual([]);
    expect(vm.evidenceRequests).toEqual([]);
    expect(vm.summary.status).toBe("UNKNOWN");
    expect(vm.summary.observationOnly).toBe(false);
    expect(vm.product.title).toBeTruthy(); // never empty
    expect(vm.images).toHaveLength(2);
  });

  it("guards against malformed stored payloads (missing arrays, wrong shapes)", () => {
    const result = baseResult({
      // Simulate a legacy/damaged session: fields exist but with wrong shapes.
      inspectionObservations: "not-an-array" as unknown as ScanResult["inspectionObservations"],
      inspectionFindings: { nope: true } as unknown as ScanResult["inspectionFindings"],
      selectedCheckIds: [42, "common.nameplate.readability"],
      reportPackage: {
        citations: "garbage",
      } as unknown as ScanResult["reportPackage"],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.findings).toEqual([]);
    expect(vm.citations).toEqual([]);
    expect(vm.evidenceRequests).toEqual([]);
    // selectedCheckIds with a valid string still yields a not_assessed row.
    expect(vm.checks).toHaveLength(1);
    expect(vm.checks[0].coverage).toBe("not_assessed");
  });
});

// ── 8. check rows: titles, coverage, selection helpers ─────────────────────

describe("check rows and selection linkage", () => {
  it("uses finding title as the business title, keeping checkId as diagnostics", () => {
    const result = baseResult({
      inspectionObservations: [observation()],
      inspectionFindings: [finding({ title: "铭牌电气参数" })],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    const check = vm.checks[0];
    expect(check.title).toBe("铭牌电气参数");
    expect(check.checkId).toBe("common.nameplate.readability");
  });

  it("falls back to catalog title or checkId's last segment when there is no finding title", () => {
    const result = baseResult({
      inspectionObservations: [
        observation({ checkId: "toy.small_parts.visible" }),
        observation({ checkId: "custom.unknown_module.custom_field" }),
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(vm.checks[0].title).toBe("可见小附件(含脱落风险目视)");
    expect(vm.checks[0].checkId).toBe("toy.small_parts.visible");
    expect(vm.checks[1].title).toBe("Custom Field");
    expect(vm.checks[1].checkId).toBe("custom.unknown_module.custom_field");
  });

  it("resolveSelectionFromCheck returns the located image + observation", () => {
    const result = baseResult({
      inspectionObservations: [observation()],
      inspectionFindings: [finding()],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    const selection = resolveSelectionFromCheck(vm, "common.nameplate.readability");
    expect(selection).toEqual({
      imageId: "scan_vm_test-image-1",
      observationId: "obs-0",
    });
  });

  it("resolveSelectionFromCheck returns null for ungrounded checks", () => {
    const result = baseResult({
      inspectionObservations: [
        observation({ region: null, visibility: "not_in_view" }),
      ],
      inspectionFindings: [
        finding({ observationIds: ["obs-0"], requiredEvidence: ["补拍视角：nameplate_closeup"] }),
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(resolveSelectionFromCheck(vm, "common.nameplate.readability")).toBeNull();
  });

  it("resolveSelectionFromFinding maps a finding id to its located anchor", () => {
    const result = baseResult({
      inspectionObservations: [observation()],
      inspectionFindings: [finding()],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });
    expect(resolveSelectionFromFinding(vm, "scan_vm_test-finding-1")).toEqual({
      imageId: "scan_vm_test-image-1",
      observationId: "obs-0",
    });
    expect(resolveSelectionFromFinding(vm, "nope")).toBeNull();
  });

  it("multi-image scan: anchors only draw on their own image (T05 discipline)", () => {
    const result = baseResult({
      inspectionObservations: [
        observation({
          observationId: "obs-front",
          checkId: "common.product.overview",
          imageId: "scan_vm_test-image-0",
          region: {
            kind: "bbox",
            bbox: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 },
          },
        }),
        observation({
          observationId: "obs-plate",
          checkId: "common.nameplate.readability",
          imageId: "scan_vm_test-image-1",
        }),
      ],
      inspectionFindings: [
        finding({ observationIds: ["obs-front"], checkId: "common.product.overview" }),
        finding({
          findingId: "f-plate",
          observationIds: ["obs-plate"],
          checkId: "common.nameplate.readability",
        }),
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_vm_test" });

    expect(vm.anchorsByImage["scan_vm_test-image-0"].map((a) => a.observationId)).toEqual([
      "obs-front",
    ]);
    expect(vm.anchorsByImage["scan_vm_test-image-1"].map((a) => a.observationId)).toEqual([
      "obs-plate",
    ]);
    // Clicking the nameplate check switches to image 1, not image 0.
    expect(resolveSelectionFromCheck(vm, "common.nameplate.readability")?.imageId).toBe(
      "scan_vm_test-image-1",
    );
    expect(resolveSelectionFromCheck(vm, "common.product.overview")?.imageId).toBe(
      "scan_vm_test-image-0",
    );
  });
});
