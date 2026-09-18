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

  it("submits the scan form from the form submit button and prevents duplicate submission", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const { container } = render(<UploadPage />);
    const submitBtn = container.querySelector<HTMLButtonElement>("#scan-submit")!;
    expect(submitBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("批量上传产品图片"), { target: { files: [new File(["photo"], "label.jpg", { type: "image/jpeg" })] } });
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);
    expect(submitBtn).toBeDisabled();
    fireEvent.click(submitBtn);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/scan");
    expect((request?.body as FormData).getAll("images")).toHaveLength(1);
    finish({ ok: true, json: async () => ({ sessionId: "scan_shared_form", status: "processing" }) } as Response);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/burning/scan_shared_form"));
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
    expect(screen.getAllByRole("button", { name: /开始检测/ }).at(-1)!).toBeEnabled();
  });

  it.each([
    ["Anker A2332 充电器", "electronics", "EU"],
    ["小米智能电热水壶 2 Pro", "appliance", "EU"],
    ["LEGO 76429 分院帽（18+）", "toy", "US"],
  ])("loads %s and submits three real files", async (title, category, market) => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (url === "/api/scan") return { ok: true, json: async () => ({ sessionId: "scan_sample", status: "processing" }) } as Response;
      return { ok: true, blob: async () => new Blob(["photo"], { type: "image/jpeg" }) } as Response;
    });
    render(<UploadPage />);
    fireEvent.click(screen.getByRole("button", { name: title }));
    fireEvent.click(screen.getByRole("button", { name: "载入三张照片" }));
    await screen.findByText("已载入三张照片。请确认目标市场与资料，再点击开始检测。");
    await waitFor(() => expect(screen.getAllByRole("button", { name: /开始检测/ }).at(-1)!).toBeEnabled());
    expect(push).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getAllByRole("button", { name: /开始检测/ }).at(-1)!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/burning/scan_sample"));
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/scan")!;
    const body = request[1]!.body as FormData;
    expect(body.getAll("images")).toHaveLength(3);
    expect(body.getAll("documents")).toHaveLength(0);
    expect(body.get("category")).toBe(category);
    expect(body.get("markets")).toBe(market);
  });

  it("includes the summary only when selected", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => ({ ok: true, blob: async () => new Blob(["asset"], { type: String(url).endsWith(".txt") ? "text/plain" : "image/jpeg" }) }) as Response);
    render(<UploadPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: /同时载入案例资料/ }));
    fireEvent.click(screen.getByRole("button", { name: "载入三张照片" }));
    await screen.findByText("anker-a2332-spec.txt");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("preserves existing uploads if any sample asset fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
    render(<UploadPage />);
    fireEvent.change(screen.getByLabelText("批量上传产品图片"), { target: { files: [new File(["photo"], "original.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: "载入三张照片" }));
    await screen.findByText(/样例资料加载失败/);
    expect(screen.getByText("1/3 张已就绪")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps untouched preview URLs alive when a different slot changes", async () => {
    const { unmount } = render(<UploadPage />);
    const inputs = screen.getAllByLabelText(/上传到.+槽位/);
    fireEvent.change(inputs[0], {target: {files: [new File(["one"], "one.jpg", {type: "image/jpeg"})]}});
    fireEvent.change(inputs[1], {target: {files: [new File(["two"], "two.jpg", {type: "image/jpeg"})]}});
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:one.jpg");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one.jpg");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:two.jpg");
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
