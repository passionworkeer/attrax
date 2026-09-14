/**
 * J17 red-team tests — upload wizard category-switch slot behavior +
 * conditional-question answer submission (plan §5.4 / J09).
 *
 *  a. A file uploaded into slot 4 of a 4-slot category (battery) must NOT be
 *     silently dropped when the user switches to a 3-slot category (toy) —
 *     it is still valid evidence and must ride along as supplementary
 *     evidence, with the visible 「补充证据」 notice matching the behavior.
 *  b. Answered conditional questions must land in the submitted FormData as
 *     `userDeclaredFacts` JSON (the field the BFF now forwards to the
 *     backend as declared_facts).
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
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
  useOptionalBlazeLocale: () => null,
}));

import UploadPage from "@/app/upload/page";
import type { ProductCategory } from "@/lib/types";

function changeCategory(next: ProductCategory) {
  const select = screen.getByLabelText(/产品品类/) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: next } });
}

function makeImageFile(name: string): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], name, {
    type: "image/png",
  });
}

/** Click the "否" option of the conditional question whose text matches the
 * given pattern (several YES_NO questions render several 否 buttons). */
function answerNoTo(questionPattern: RegExp) {
  const group = screen
    .getAllByRole("group")
    .find((node) => questionPattern.test(node.getAttribute("aria-label") ?? ""));
  if (!group) {
    throw new Error(`conditional question group not found for ${questionPattern}`);
  }
  const noButton = within(group as HTMLElement).getByRole("button", { name: "否" });
  fireEvent.click(noButton);
}

describe("J17 red-team: 品类切换后旧槽位文件不泄漏/不丢失", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    });
  });

  it("4 槽品类(battery)第 4 槽上传后切到 3 槽品类(toy)：文件保留并明确提示按补充证据提交", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "scan_slot_leak",
          status: "processing",
          pollUrl: "/api/scan/scan_slot_leak",
        }),
      }),
    );

    render(<UploadPage />);

    // Battery category has 4 slots.
    changeCategory("battery");
    const slotInputs = screen.getAllByLabelText(/上传到.+槽位/) as HTMLInputElement[];
    expect(slotInputs).toHaveLength(4);

    // Upload into slot 4 (index 3) — the slot that disappears on toy.
    const fourthSlotFile = makeImageFile("transport-marks.png");
    await fireEvent.change(slotInputs[3], { target: { files: [fourthSlotFile] } });

    // Switch to toy (3 slots).
    changeCategory("toy");
    expect(screen.getAllByLabelText(/上传到.+槽位/)).toHaveLength(3);

    // The extra file must be explicitly acknowledged as supplementary
    // evidence — not silently dropped, and not silently submitted either.
    expect(await screen.findByText(/另外 1 张图片会作为补充证据/)).toBeInTheDocument();

    // Submit: the 4th file must be INCLUDED in the images payload.
    const submit = screen.getByRole("button", { name: /开始检测|上传 1 张图片后开始检测/ });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    const [endpoint, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(endpoint).toBe("/api/scan");
    const formData = init.body as FormData;
    const imageNames = formData.getAll("images").map((f) => (f as File).name);
    expect(imageNames).toContain("transport-marks.png");
  });

  it("已上传文件在槽内但不提交重复/丢失：3 槽内每槽一张，全部提交", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "scan_all_slots",
          status: "processing",
          pollUrl: "/api/scan/scan_all_slots",
        }),
      }),
    );

    render(<UploadPage />);

    const slotInputs = screen.getAllByLabelText(/上传到.+槽位/) as HTMLInputElement[];
    expect(slotInputs).toHaveLength(3);
    for (const [index, input] of slotInputs.entries()) {
      await fireEvent.change(input, {
        target: { files: [makeImageFile(`view-${index}.png`)] },
      });
    }

    const submit = screen.getByRole("button", { name: /开始检测|上传 1 张图片后开始检测|可开始基础预检/ });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const formData = init.body as FormData;
    const imageNames = formData.getAll("images").map((f) => (f as File).name);
    expect(imageNames).toEqual(["view-0.png", "view-1.png", "view-2.png"]);
  });
});

describe("J17 red-team: 条件问题答案随提交进入 userDeclaredFacts（J09 通路）", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    });
  });

  it("玩具品类回答「是否含电池=否」后提交，userDeclaredFacts JSON 包含该答案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "scan_facts",
          status: "processing",
          pollUrl: "/api/scan/scan_facts",
        }),
      }),
    );

    render(<UploadPage />);
    changeCategory("toy");

    const slotInputs = screen.getAllByLabelText(/上传到.+槽位/) as HTMLInputElement[];
    await fireEvent.change(slotInputs[0], {
      target: { files: [makeImageFile("toy.png")] },
    });

    // Answer the battery conditional question with 否.
    answerNoTo(/是否含电池/);

    const submit = screen.getByRole("button", { name: /开始检测|上传 1 张图片后开始检测/ });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const formData = init.body as FormData;
    const declaredRaw = formData.get("userDeclaredFacts");
    expect(declaredRaw).toBeTruthy();
    const declared = JSON.parse(String(declaredRaw)) as Record<string, string>;
    // The toy manifest's battery question id is "battery".
    expect(declared.battery).toBe("否");
  });

  it("未回答任何条件问题时，不附带 userDeclaredFacts 字段", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "scan_nofacts",
          status: "processing",
          pollUrl: "/api/scan/scan_nofacts",
        }),
      }),
    );

    render(<UploadPage />);
    changeCategory("toy");

    const slotInputs = screen.getAllByLabelText(/上传到.+槽位/) as HTMLInputElement[];
    await fireEvent.change(slotInputs[0], {
      target: { files: [makeImageFile("toy.png")] },
    });

    fireEvent.click(screen.getByRole("button", { name: /开始检测|上传 1 张图片后开始检测/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const formData = init.body as FormData;
    expect(formData.get("userDeclaredFacts")).toBeNull();
  });

  it("切换品类清空旧答案（旧答案不进入新品类的声明）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "scan_switch",
          status: "processing",
          pollUrl: "/api/scan/scan_switch",
        }),
      }),
    );

    render(<UploadPage />);
    changeCategory("toy");

    const slotInputs = screen.getAllByLabelText(/上传到.+槽位/) as HTMLInputElement[];
    await fireEvent.change(slotInputs[0], {
      target: { files: [makeImageFile("toy.png")] },
    });

    // Answer toy's battery question…
    answerNoTo(/是否含电池/);
    // …then switch to electronics (different question set).
    changeCategory("electronics");

    fireEvent.click(screen.getByRole("button", { name: /开始检测|上传 1 张图片后开始检测/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const formData = init.body as FormData;
    // The electronics manifest's builtin_battery question was never answered;
    // the toy battery answer was cleared on switch → no facts at all.
    expect(formData.get("userDeclaredFacts")).toBeNull();
  });
});
