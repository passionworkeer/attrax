import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FallbackNotice } from "@/components/result/FallbackNotice";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "result.partialFallbackNotice":
          "本次报告使用了规则+模板兜底生成，LLM 实际未产出引用",
      };
      return map[key] ?? key;
    },
    locale: "zh" as const,
  }),
}));

describe("FallbackNotice", () => {
  beforeEach(() => {
    // render resets between tests
  });

  it("renders nothing when validationStatus is not 'fallback'", () => {
    const { container } = render(<FallbackNotice validationStatus="normalized" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when validationStatus is undefined", () => {
    const { container } = render(<FallbackNotice />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a soft-yellow notice when validationStatus is 'fallback'", () => {
    render(<FallbackNotice validationStatus="fallback" />);
    expect(screen.getByTestId("fallback-notice")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/LLM 实际未产出引用/);
  });

  it("shows the fallback reason when provided", () => {
    render(
      <FallbackNotice validationStatus="fallback" fallbackReason="markdown_fallback" />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/markdown_fallback/);
  });
});