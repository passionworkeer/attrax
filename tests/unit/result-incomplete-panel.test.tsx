import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("@/components/complipilot/flow-shell", () => ({ CompliPilotFlowBackdrop: () => null, CompliPilotFlowHeader: () => null }));
vi.mock("@/components/result/DegradedBanner", () => ({ DegradedBanner: () => null }));
import { ResultIncompletePanel } from "@/app/result/[sessionId]/result-state-panels";
import type { ScanResult } from "@/lib/types";
describe("incomplete result guidance", () => {
  it.each(["zh", "en"] as const)("shows the supplied message and actionable guidance in %s", (locale) => {
    render(<ResultIncompletePanel locale={locale} displayMessage="Specific scan status" result={{ source: "real" } as ScanResult} />);
    expect(screen.getByRole("status")).toHaveTextContent("Specific scan status");
    expect(screen.getByText(locale === "zh" ? /请补充清晰的铭牌/ : /Add clear label/)).toBeInTheDocument();
    expect(screen.queryByText(/decisionView/)).not.toBeInTheDocument();
  });
});
