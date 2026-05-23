import { describe, expect, it } from "vitest";
import contractPackage from "../fixtures/report-package.contract.json";
import { normalizeReportPackage } from "@/lib/pipeline/report-package";

describe("ReportPackage cross-language contract", () => {
  it("preserves Python schema fields through the TS normalizer", () => {
    const normalized = normalizeReportPackage(contractPackage);

    expect(normalized).toBeDefined();
    expect(normalized?.productDossier?.product).toBe("USB-C power adapter");
    expect(normalized?.evidenceBundles?.retrieval?.[0]?.source).toBe("RoHS Guide");
    expect(normalized?.auditMetadata?.schemaVersion).toBe("report-package/v1");
    expect(normalized?.auditMetadata?.validationStatus).toBe("normalized");
    expect(normalized?.roadmap?.items?.[0]?.titleEn).toBe("Complete nameplate and warning labels");
    expect(normalized?.decisionView?.nodes?.[0]?.labelEn).toBe("Four-scene generation");
    expect(normalized?.decisionView?.nodes?.[0]?.reasoningEn).toContain("one pass");
  });
});
