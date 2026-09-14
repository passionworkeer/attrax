/**
 * J03 red-team tests — the ViewModel citation contract (plan §4.3).
 *
 * The confusion under attack: findings carry `citationIds` whose values are
 * KB ANCHOR ids (e.g. "EU-2009-48-toy" / "KB-toy-EU-2009-48"), while the
 * citation ENTITIES on the VM are de-duplicated doc_id+article_id records
 * keyed like "EU-2009-48::art-10". Any consumer that joins
 * `finding.citationIds` against `vm.citations` (by key, docId, or articleId)
 * silently finds nothing — the exact J04-family "undefined citation" bug.
 *
 * This suite pins:
 *   1. vm.citations derives EXCLUSIVELY from reportPackage.citations /
 *      evidencePack — never from finding.citationIds.
 *   2. finding.citationIds values do NOT match any vm.citations key/docId —
 *      i.e. the two namespaces are provably disjoint in the fixture shapes
 *      the backend produces.
 *   3. dangling observationIds are dropped (existing behavior, pinned).
 *   4. citationCount reflects the deduped entity set, not raw entries.
 */
import { describe, expect, it } from "vitest";
import { buildInspectionResultViewModel } from "@/lib/result/inspection-view-model";
import type { ScanResult } from "@/lib/types";

function baseResult(overrides: Record<string, unknown> = {}): ScanResult {
  return {
    sessionId: "scan_cite_test",
    scanTime: "2026-09-14T08:00:00Z",
    productCategory: "toy",
    targetMarkets: ["EU"],
    images: [],
    documents: [],
    riskPoints: [],
    checklist: [],
    generatedAt: "2026-09-14T08:01:00Z",
    ...overrides,
  } as unknown as ScanResult;
}

describe("J03: VM citations come from reportPackage, not finding.citationIds", () => {
  it("derives citations ONLY from reportPackage.citations — a finding citing an anchor id cannot inject a citation entity", () => {
    const result = baseResult({
      inspectionObservations: [
        {
          observationId: "obs-1",
          checkId: "toy.age_range.label",
          imageId: "scan_cite_test-image-0",
          visibility: "absent_in_visible_scope",
          region: null,
        },
      ],
      inspectionFindings: [
        {
          findingId: "scan_cite_test-finding-1",
          checkId: "toy.age_range.label",
          title: "年龄适用范围标注",
          assessment: "suspected_issue",
          applicability: "applicable",
          severity: "medium",
          // KB anchor ids — NOT citation entity ids.
          observationIds: ["obs-1"],
          citationIds: ["EU-2009-48-toy", "US-ASTM-F963-toy"],
          suggestedAction: "核对其他标识位置",
          requiredEvidence: [],
        },
      ],
      // NO reportPackage.citations at all → the VM must have ZERO citation
      // entities even though the finding references two anchor ids.
      reportPackage: {},
    });

    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_cite_test" });
    expect(vm.citations).toEqual([]);
    expect(vm.summary.citationCount).toBe(0);
    // The anchor refs survive on the finding for display, unchanged.
    expect(vm.findings[0].citationIds).toEqual(["EU-2009-48-toy", "US-ASTM-F963-toy"]);
  });

  it("KB anchor ids in finding.citationIds never match a vm.citations key/docId/articleId", () => {
    // The realistic mixed shape: real citation entities exist AND the
    // finding carries anchor refs. The two namespaces must stay disjoint —
    // "EU-2009-48-toy" must not accidentally resolve against the
    // doc_id="EU-2009-48" citation entity.
    const result = baseResult({
      inspectionObservations: [
        {
          observationId: "obs-1",
          checkId: "toy.age_range.label",
          imageId: "scan_cite_test-image-0",
          visibility: "absent_in_visible_scope",
          region: null,
        },
      ],
      inspectionFindings: [
        {
          findingId: "scan_cite_test-finding-1",
          checkId: "toy.age_range.label",
          title: "年龄适用范围标注",
          assessment: "suspected_issue",
          applicability: "applicable",
          severity: "medium",
          observationIds: ["obs-1"],
          citationIds: ["EU-2009-48-toy"],
          suggestedAction: "",
          requiredEvidence: [],
        },
      ],
      reportPackage: {
        citations: [
          {
            doc_id: "EU-2009-48",
            article_id: "art-11",
            official_citation: "Directive 2009/48/EC",
            quote: "警告语要求",
            match_status: "fallback_article_only",
          },
        ],
      },
    });

    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_cite_test" });
    expect(vm.citations).toHaveLength(1);
    const citation = vm.citations[0];

    // Namespace disjointness: the anchor id matches NEITHER the citation's
    // key, docId, nor articleId. A join attempt on any of them must fail —
    // which is exactly why consumers must use the entity set, not ids.
    const anchorId = "EU-2009-48-toy";
    expect(citation.key).not.toBe(anchorId);
    expect(citation.docId).not.toBe(anchorId);
    expect(citation.articleId).not.toBe(anchorId);
    // And the finding's citationIds were not rewritten into entity keys.
    expect(vm.findings[0].citationIds).toEqual(["EU-2009-48-toy"]);
  });

  it("citationCount counts the deduped entities, not raw citation entries", () => {
    const result = baseResult({
      reportPackage: {
        citations: [
          { doc_id: "EU-2009-48", article_id: "art-10", quote: "a", match_status: "fallback_article_only" },
          { doc_id: "EU-2009-48", article_id: "art-10", quote: "a", match_status: "fallback_article_only" },
          { doc_id: "EU-2009-48", article_id: "art-11", quote: "b", match_status: "fallback_article_only" },
        ],
        evidencePack: [
          { doc_id: "EU-2009-48", article_id: "art-10", quote: "a", match_status: "fallback_article_only" },
        ],
      },
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_cite_test" });
    // art-10 (×3 collapsed) + art-11 → 2 entities.
    expect(vm.citations).toHaveLength(2);
    expect(vm.summary.citationCount).toBe(2);
    expect(vm.citations.find((c) => c.articleId === "art-10")?.duplicates).toBe(3);
  });

  it("drops dangling observationIds instead of fabricating observations or anchors", () => {
    const result = baseResult({
      inspectionObservations: [
        {
          observationId: "obs-real",
          checkId: "toy.small_parts.visible",
          imageId: "scan_cite_test-image-0",
          visibility: "present_readable",
          region: {
            kind: "bbox",
            bbox: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
          },
        },
      ],
      inspectionFindings: [
        {
          findingId: "scan_cite_test-finding-1",
          checkId: "toy.small_parts.visible",
          title: "小附件",
          assessment: "suspected_issue",
          applicability: "applicable",
          severity: "medium",
          observationIds: ["obs-gone", "obs-real"],
          citationIds: [],
          suggestedAction: "",
          requiredEvidence: [],
        },
      ],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_cite_test" });
    expect(vm.findings).toHaveLength(1);
    // Only the surviving observation joins.
    expect(vm.findings[0].observations.map((o) => o.observationId)).toEqual(["obs-real"]);
    // The dangling id contributes no anchor.
    expect(vm.findings[0].locatedAnchors.map((a) => a.observationId)).toEqual(["obs-real"]);
  });

  it("anchorsByImage keys are imageIds, and unknown-image observations still anchor under their own imageId", () => {
    // A finding whose observation references an imageId that is not in
    // result.images: the anchor must key under the OBSERVATION's imageId
    // (the join is observation→image), never fall back to image[0].
    const result = baseResult({
      images: [{ imageId: "scan_cite_test-image-0", url: "/a/0", fileName: "a.png" }],
      inspectionObservations: [
        {
          observationId: "obs-2",
          checkId: "common.nameplate.readability",
          imageId: "vision-image-9",
          visibility: "present_unreadable",
          region: { kind: "bbox", bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
        },
      ],
      inspectionFindings: [],
    });
    const vm = buildInspectionResultViewModel({ result, sessionId: "scan_cite_test" });
    expect(Object.keys(vm.anchorsByImage)).toEqual(["vision-image-9"]);
    expect(vm.anchorsByImage["scan_cite_test-image-0"]).toBeUndefined();
  });
});
