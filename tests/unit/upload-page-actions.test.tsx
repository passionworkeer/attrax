import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean }) => {
    const { fill, unoptimized, ...imageProps } = props;
    void fill;
    void unoptimized;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...imageProps} alt={imageProps.alt ?? ""} />;
  },
}));

vi.mock("@/components/blaze-hawks/locale", () => ({
  useBlazeLocale: () => ({ locale: "zh" }),
}));

import UploadPage from "@/app/upload/page";

describe("upload page entry points", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    });
  });

  it("uses an independent multi-file input for the large upload area", () => {
    render(<UploadPage />);

    const bulkInput = screen.getByLabelText("批量上传产品图片") as HTMLInputElement;
    expect(bulkInput.multiple).toBe(true);

    const slotInputs = screen.getAllByLabelText(/上传到.+槽位/);
    expect(slotInputs).toHaveLength(3);
    slotInputs.forEach((input) => expect((input as HTMLInputElement).multiple).toBe(false));

    const files = [
      new File(["front"], "front.png", { type: "image/png" }),
      new File(["ports"], "ports.png", { type: "image/png" }),
      new File(["label"], "label.png", { type: "image/png" }),
    ];
    fireEvent.change(bulkInput, { target: { files } });

    expect(screen.getByText("3/3 张已就绪")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开始检测/ })).toBeEnabled();
  });

  it("opens the preset result directly without creating a scan", async () => {
    render(<UploadPage />);

    fireEvent.click(screen.getByRole("button", { name: "直接演示" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/result/demo"));
    expect(fetch).not.toHaveBeenCalled();
  });
});
