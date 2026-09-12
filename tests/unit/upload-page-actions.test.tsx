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

  it("opens the preset scan stage without creating a backend scan", async () => {
    render(<UploadPage />);

    fireEvent.click(screen.getByRole("button", { name: "直接演示" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining("/burning/demo?preset=charger")));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders the document upload toggle in collapsed state by default", () => {
    render(<UploadPage />);

    const docInput = screen.getByLabelText(/添加产品规格书/);
    expect(docInput).toBeInTheDocument();
    expect((docInput as HTMLInputElement).type).toBe("file");
    expect((docInput as HTMLInputElement).multiple).toBe(true);
  });

  it("accepts a valid PDF document and renders it in the list", async () => {
    render(<UploadPage />);

    // Upload at least one image so the submit button is enabled.
    const bulkInput = screen.getByLabelText("批量上传产品图片") as HTMLInputElement;
    fireEvent.change(bulkInput, {
      target: {
        files: [new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "spec.pdf", { type: "application/pdf" })],
      },
    });

    const docInput = screen.getByLabelText(/添加产品规格书/) as HTMLInputElement;
    fireEvent.change(docInput, {
      target: {
        files: [
          new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], "spec.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("document-list")).toBeInTheDocument();
    });
    expect(screen.getByText("spec.pdf")).toBeInTheDocument();
  });

  it("surfaces an error when an oversize file is attached", async () => {
    render(<UploadPage />);

    const docInput = screen.getByLabelText(/添加产品规格书/) as HTMLInputElement;
    // 16MB > MAX_DOCUMENT_SIZE_BYTES (15MB)
    const oversized = new Uint8Array(16 * 1024 * 1024);
    oversized.set([0x25, 0x50, 0x44, 0x46], 0); // valid PDF magic at the head
    fireEvent.change(docInput, {
      target: { files: [new File([oversized], "big.pdf", { type: "application/pdf" })] },
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/15MB/);
    });
    expect(screen.queryByTestId("document-list")).not.toBeInTheDocument();
  });

  it("surfaces an error when a mismatched signature is attached", async () => {
    render(<UploadPage />);

    const docInput = screen.getByLabelText(/添加产品规格书/) as HTMLInputElement;
    // PNG magic bytes but .pdf extension → signature mismatch.
    const notPdf = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fireEvent.change(docInput, {
      target: { files: [new File([notPdf], "fake.pdf", { type: "application/pdf" })] },
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/格式|扩展名/);
    });
  });
});
