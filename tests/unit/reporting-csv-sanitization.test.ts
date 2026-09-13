import { describe, it, expect } from "vitest";
import { sanitizeCsvCell, buildRoadmapCsv } from "@/lib/reporting";
import { mockScanResult } from "@/lib/mock/blaze-scan-result";

describe("CSV Formula Injection Defense & Export", () => {
  it("escapes dangerous formula trigger prefixes (=, +, -, @, \\t, \\r)", () => {
    expect(sanitizeCsvCell("=SUM(A1:A10)")).toBe("\"'=SUM(A1:A10)\"");
    expect(sanitizeCsvCell("+123456789")).toBe("\"'+123456789\"");
    expect(sanitizeCsvCell("-5+10")).toBe("\"'-5+10\"");
    expect(sanitizeCsvCell("@cmd|' /C calc'!A0")).toBe("\"'@cmd|' /C calc'!A0\"");
    expect(sanitizeCsvCell("\tcmd.exe")).toBe("\"'\tcmd.exe\"");
    expect(sanitizeCsvCell("\rcmd.exe")).toBe("\"'\rcmd.exe\"");
  });

  it("leaves normal plain text unmodified within quotes", () => {
    expect(sanitizeCsvCell("Standard Product Name")).toBe('"Standard Product Name"');
    expect(sanitizeCsvCell("CE / UKCA Marking")).toBe('"CE / UKCA Marking"');
    expect(sanitizeCsvCell("Phase 1: Material Freeze")).toBe('"Phase 1: Material Freeze"');
  });

  it("handles null, undefined, and numbers safely", () => {
    expect(sanitizeCsvCell(null)).toBe('""');
    expect(sanitizeCsvCell(undefined)).toBe('""');
    expect(sanitizeCsvCell(42)).toBe('"42"');
    expect(sanitizeCsvCell(0)).toBe('"0"');
    expect(sanitizeCsvCell(-10)).toBe("\"'-10\"");
  });

  it("escapes internal quotes safely", () => {
    expect(sanitizeCsvCell('Product "Pro" Max')).toBe('"Product ""Pro"" Max"');
  });

  it("generates well-formed CSV with dynamic roadmap items without formula execution vulnerabilities", () => {
    const maliciousResult = {
      ...mockScanResult,
      productName: "=cmd|' /C calc'!A0",
      checklist: [
        {
          id: "chk_malicious",
          category: "+FormulaInjection",
          title: "@HYPERLINK(\"http://evil.com\")",
          estimatedTime: "-1 day",
          actionRequired: "=2+2",
        },
      ],
    };

    const csvZh = buildRoadmapCsv(maliciousResult, "zh");
    expect(csvZh).toBeDefined();

    const lines = csvZh.trim().split("\n");
    // Header
    expect(lines[0]).toBe('"阶段","动作","输出","备注"');

    // All cells starting with formula chars must be prefixed with single quote
    const dataRows = lines.slice(1);
    for (const row of dataRows) {
      expect(row).not.toMatch(/^"[=+\-@]/);
    }

    const csvEn = buildRoadmapCsv(maliciousResult, "en");
    expect(csvEn).toBeDefined();
    expect(csvEn.split("\n")[0]).toBe('"Phase","Action","Output","Note"');
  });
});
