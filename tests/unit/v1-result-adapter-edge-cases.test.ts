import { describe, it, expect } from "vitest";
import { normalizeV1ScanResult } from "@/lib/rag-client/v1-result-adapter";
import type { V1SessionData } from "@/lib/rag-client/v1-adapter";

describe("normalizeV1ScanResult - Edge Cases & Resilient Fallbacks", () => {
  it("returns undefined when session has no result", () => {
    const raw = { sessionId: "sess-empty", status: "completed" } as V1SessionData;
    const adapted = normalizeV1ScanResult(raw);
    expect(adapted).toBeUndefined();
  });

  it("assigns neutral score 50/C to UNKNOWN status when no risks present", () => {
    const raw: V1SessionData = {
      sessionId: "sess-unknown",
      status: "completed",
      result: {
        complianceStatus: "UNKNOWN",
      },
    };
    const adapted = normalizeV1ScanResult(raw);

    expect(adapted).toBeDefined();
    expect(adapted?.complianceScore).toBe(50);
    expect(adapted?.scoreGrade).toBe("C");
  });

  it("filters invalid target markets and preserves valid MARKET_IDS", () => {
    const raw: V1SessionData = {
      sessionId: "sess-markets",
      status: "completed",
      result: {
        targetMarkets: ["EU", "INVALID_MARKET_XYZ", "us", "Mars"],
      },
    };
    const adapted = normalizeV1ScanResult(raw);

    expect(adapted).toBeDefined();
    expect(adapted?.targetMarkets).toEqual(["EU", "US"]);
  });

  it("handles missing evidenceBundles in reportPackage without throwing", () => {
    const raw: V1SessionData = {
      sessionId: "sess-nobundle",
      status: "completed",
      result: {
        productName: "Test Gadget",
        reportPackage: {
          auditMetadata: {
            schemaVersion: "report-package/v1",
            generatedAt: "2026-09-13T00:00:00Z",
            provider: "de-rag",
          },
          productDossier: {
            name: "Test Gadget",
            category: "electronics",
            markets: ["EU"],
          },
          complianceReport: "# Compliance Report",
        },
      },
    };
    const adapted = normalizeV1ScanResult(raw);

    expect(adapted).toBeDefined();
    expect(adapted?.productName).toBe("Test Gadget");
    expect(adapted?.reportPackage?.evidenceBundles?.visual).toBeUndefined();
    expect(adapted?.reportPackage?.evidenceBundles?.retrieval).toBeUndefined();
  });

  it("maps CRITICAL and HIGH severities correctly from decisionView nodes", () => {
    const rawHigh: V1SessionData = {
      sessionId: "sess-high",
      status: "completed",
      result: {
        reportPackage: {
          decisionView: {
            verdict: "WARN",
            riskLevel: "HIGH",
            nodes: [
              {
                id: "node-1",
                label: "Manual Font Size",
                severity: "warning",
                confidence: 0.8,
              },
            ],
          },
        },
      },
    };
    const adaptedHigh = normalizeV1ScanResult(rawHigh);
    expect(adaptedHigh?.riskPoints).toHaveLength(1);
    expect(adaptedHigh?.complianceScore).toBe(65); // HIGH maps to 65/C
    expect(adaptedHigh?.scoreGrade).toBe("C");

    const rawCritical: V1SessionData = {
      sessionId: "sess-crit",
      status: "completed",
      result: {
        reportPackage: {
          decisionView: {
            verdict: "REJECTED",
            riskLevel: "CRITICAL",
            nodes: [
              {
                id: "node-2",
                label: "Dangerous Fire Hazard",
                severity: "critical",
                confidence: 0.99,
              },
            ],
          },
        },
      },
    };
    const adaptedCritical = normalizeV1ScanResult(rawCritical);
    expect(adaptedCritical?.riskPoints).toHaveLength(1);
    expect(adaptedCritical?.complianceScore).toBe(35); // CRITICAL maps to 35/D
    expect(adaptedCritical?.scoreGrade).toBe("D");
  });

  it("marks source as fallback when session status is degraded", () => {
    const raw: V1SessionData = {
      sessionId: "sess-degraded",
      status: "degraded",
      result: {
        complianceStatus: "WARN",
      },
    };
    const adapted = normalizeV1ScanResult(raw);

    expect(adapted).toBeDefined();
    expect(adapted?.source).toBe("fallback");
  });

  // Audit 2026-09-13 P0-2: pipeline-stage decision nodes (audit /
  // consistency check / cite verification) must NOT be promoted into
  // risk points. The audit reference session
  // scan_11cd3b56a7244d348e5688c5db1e6838 had 6 decisionView nodes
  // including "一致性校验" being rendered as the verdict headline.
  describe("pipeline-stage node filtering", () => {
    it("drops audit/consistency/citation-check decision nodes", () => {
      const raw: V1SessionData = {
        sessionId: "sess-pipeline-nodes",
        status: "completed",
        result: {
          reportPackage: {
            decisionView: {
              verdict: "WARN",
              riskLevel: "HIGH",
              nodes: [
                { id: "audit:trace:1", type: "audit", label: "Audit trail", severity: "info" },
                { id: "consistency-1", type: "consistency", label: "一致性校验", severity: "info" },
                { id: "cite-1", type: "cite_check", label: "引用核对", severity: "info" },
                { id: "process-1", type: "process", label: "流程节点", severity: "info" },
                // The actual finding should survive filtering
                {
                  id: "vision-issue-1",
                  type: "vision",
                  label: "铭牌无 CCC 标志",
                  severity: "high",
                  confidence: 0.9,
                  bbox: { x: 0.2, y: 0.2, w: 0.4, h: 0.1 },
                },
              ],
            },
          },
        },
      };
      const adapted = normalizeV1ScanResult(raw);
      expect(adapted?.riskPoints).toHaveLength(1);
      expect(adapted?.riskPoints[0].riskId).toBe("vision-issue-1");
      expect(adapted?.riskPoints[0].title).toBe("铭牌无 CCC 标志");
    });

    it("filters by Chinese labels too (一致性校验 / 引用核对 / 流程节点)", () => {
      const raw: V1SessionData = {
        sessionId: "sess-cn-labels",
        status: "completed",
        result: {
          reportPackage: {
            decisionView: {
              verdict: "WARN",
              nodes: [
                { id: "x1", type: "synthesis", label: "一致性校验通过", severity: "info" },
                { id: "x2", type: "verification", label: "引用校验", severity: "info" },
                { id: "x3", type: "trace", label: "流程节点总结", severity: "info" },
              ],
            },
          },
        },
      };
      const adapted = normalizeV1ScanResult(raw);
      expect(adapted?.riskPoints).toHaveLength(0);
    });
  });

  // Plan 2026-09-13 §6 — checklist-mode scans carry v2 observations. The
  // adapter must remap vision-image-N ids to the session image asset ids
  // (same discipline as riskPoints) and drop unusable regions.
  describe("inspection observations v2", () => {
    it("maps observations with image id remap and region passthrough", () => {
      const raw: V1SessionData = {
        sessionId: "scan_abc123",
        status: "completed",
        result: {
          reportPackage: {
            decisionView: { verdict: "WARN", nodes: [] },
            observations: [
              {
                observationId: "scan_abc123-img0-obs0",
                checkId: "common.nameplate.readability",
                imageId: "vision-image-0",
                visibility: "present_readable",
                observedText: "ACME 5V⎓2A",
                description: "铭牌可见",
                region: {
                  kind: "bbox",
                  coordinateSpace: "normalized_canonical_image",
                  bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.15 },
                  verified: true,
                },
              },
              {
                observationId: "scan_abc123-img0-obs1",
                checkId: "common.warning_text.language",
                imageId: "vision-image-0",
                visibility: "not_in_view",
                observedText: null,
                description: "正面照未覆盖警告标签",
                region: null,
              },
            ],
            selectedCheckIds: [
              "common.nameplate.readability",
              "common.warning_text.language",
            ],
          },
        },
      };
      const adapted = normalizeV1ScanResult(raw);
      expect(adapted?.inspectionObservations).toHaveLength(2);
      const first = adapted?.inspectionObservations?.[0];
      expect(first?.imageId).toBe("scan_abc123-image-0");
      expect(first?.visibility).toBe("present_readable");
      expect(first?.region?.bbox).toEqual({ x: 0.1, y: 0.1, w: 0.3, h: 0.15 });
      expect(first?.region?.verified).toBe(true);
      const second = adapted?.inspectionObservations?.[1];
      expect(second?.region).toBeNull();
      expect(second?.visibility).toBe("not_in_view");
      expect(adapted?.selectedCheckIds).toEqual([
        "common.nameplate.readability",
        "common.warning_text.language",
      ]);
    });

    it("drops observations with invalid bbox regions", () => {
      const raw: V1SessionData = {
        sessionId: "scan_bad_bbox",
        status: "completed",
        result: {
          reportPackage: {
            decisionView: { verdict: "WARN", nodes: [] },
            observations: [
              {
                observationId: "o1",
                checkId: "c",
                imageId: "vision-image-0",
                visibility: "present_readable",
                region: { kind: "bbox", bbox: { x: -1, y: 0, w: 0.2, h: 0.2 } },
              },
            ],
          },
        },
      };
      const adapted = normalizeV1ScanResult(raw);
      const first = adapted?.inspectionObservations?.[0];
      expect(first?.region).toBeNull();
      // visibility preserved — the observation itself is valid, only the
      // grounding is unusable
      expect(first?.visibility).toBe("present_readable");
    });

    it("defaults unknown visibility to not_assessed", () => {
      const raw: V1SessionData = {
        sessionId: "scan_weird_vis",
        status: "completed",
        result: {
          reportPackage: {
            decisionView: { verdict: "WARN", nodes: [] },
            observations: [
              {
                observationId: "o1",
                checkId: "c",
                imageId: "vision-image-0",
                visibility: "quantum_superposition",
              },
            ],
          },
        },
      };
      const adapted = normalizeV1ScanResult(raw);
      expect(adapted?.inspectionObservations?.[0]?.visibility).toBe("not_assessed");
    });
  });
});
