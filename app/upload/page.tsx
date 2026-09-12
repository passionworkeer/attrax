"use client";

import Image from "next/image";
import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  FileImage,
  FileText,
  PackageCheck,
  Play,
  PlugZap,
  Upload,
  X,
} from "lucide-react";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import { Button } from "@/components/ui/button";
import {
  GlowPill,
  SectionEyebrow,
} from "@/components/blaze-hawks/ui";
import {
  CompliPilotFlowBackdrop,
  CompliPilotFlowFooter,
  CompliPilotFlowHeader,
} from "@/components/complipilot/flow-shell";
import { getCompliPilotCopy } from "@/lib/complipilot/copy";
import { MARKET_IDS, type Market, type ProductCategory } from "@/lib/types";
import { validateUploadFile } from "@/lib/upload-validation";
import styles from "./upload.module.css";

type ScanStartPayload = {
  sessionId: string;
  accessToken?: string;
  status: "processing";
  pollUrl: string;
};

const REQUIRED_UPLOAD_SLOTS = 3;
const MAX_UPLOAD_FILES = 8;
const MAX_DOCUMENT_FILES = 5;
const MAX_FILE_SIZE_BYTES = 12 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ACCEPTED_DOCUMENT_EXTENSIONS = ".pdf,.docx,.txt,.html,.htm";
const FEATURED_MARKETS: Market[] = ["EU", "US", "UK", "CN", "JP", "AU"];

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const presetConfigs: Array<{
  category: ProductCategory;
  markets: Market[];
  previewImage: string;
}> = [
  {
    category: "electronics",
    markets: ["EU", "UK"],
    previewImage: "/mock-fixtures/preset-charger-photo.png",
  },
  {
    category: "appliance",
    markets: ["EU", "US"],
    previewImage: "/mock-fixtures/preset-humidifier-photo.png",
  },
  {
    category: "toy",
    markets: ["EU", "US"],
    previewImage: "/mock-fixtures/preset-toy-blocks-photo.png",
  },
];

/**
 * NOTE (B-3): the preset selection chips below ONLY change the preview image
 * shown while the user has not uploaded yet, then `router.push("/result/demo")`
 * navigates to the prebuilt demo result page — it does NOT submit a scan.
 * The primary "Start scan" button is the only way to actually run an upload
 * through `/api/scan`. The header's "查看预制 Demo" link is a plain anchor
 * that skips this page entirely. Do NOT add Server Actions or form submissions
 * here: dd6cbf5 deliberately removed that path (the legacy `formData.append(
 * "preset", "true")` approach broke uploads; see the commit message).
 */

export default function UploadPage() {
  const router = useRouter();
  const { locale } = useBlazeLocale();
  const copy = getCompliPilotCopy(locale);
  const [files, setFiles] = useState<Array<File | null>>([]);
  const [previewUrls, setPreviewUrls] = useState<Array<string | null>>([]);
  const bulkUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedMarkets, setSelectedMarkets] = useState<Market[]>(["EU", "UK"]);
  const [category, setCategory] = useState<ProductCategory>("electronics");
  const [selectedPresetIndex, setSelectedPresetIndex] = useState(0);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [previewMode, setPreviewMode] = useState<"upload" | "preset">("preset");
  const [showAllMarkets, setShowAllMarkets] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadedFiles = files.filter((file): file is File => Boolean(file));
  const uploadProgress = files.slice(0, REQUIRED_UPLOAD_SLOTS).filter(Boolean).length;
  const uploadedPreviewEntries = previewUrls.flatMap((url, index) =>
    url ? [{ index, url }] : []
  );
  const selectedPreset = presetConfigs[selectedPresetIndex] ?? presetConfigs[0];
  const activeUploadPreview =
    previewUrls[activePreviewIndex] ?? uploadedPreviewEntries[0]?.url ?? null;
  const usingUploadedPreview = previewMode === "upload" && Boolean(activeUploadPreview);
  const primaryPreviewSrc = usingUploadedPreview
    ? activeUploadPreview
    : selectedPreset.previewImage;
  const readinessLabel =
    uploadProgress === 0
      ? locale === "zh" ? "示例已选择" : "Sample selected"
      : uploadProgress === 1
        ? locale === "zh" ? "可开始基础预检" : "Basic scan ready"
        : uploadProgress === 2
          ? locale === "zh" ? "信息覆盖良好" : "Good coverage"
          : locale === "zh" ? "推荐图片已齐" : "Recommended set ready";
  const selectedMarketNames = selectedMarkets.map((market) => copy.upload.marketLabels[market]);
  const selectedMarketLabel =
    selectedMarketNames.length <= 3
      ? selectedMarketNames.join(" + ")
      : locale === "zh"
        ? `${selectedMarketNames.slice(0, 2).join(" + ")} 等 ${selectedMarketNames.length} 个市场`
        : `${selectedMarketNames.slice(0, 2).join(" + ")} + ${selectedMarketNames.length - 2} more`;
  const categoryLabel =
    category === "electronics"
      ? copy.upload.previewPill
      : locale === "zh"
        ? "多品类模式"
        : "multi-category";
  const slotCopy =
    locale === "zh"
      ? [
          {
            title: "正面主视图",
            hint: "完整机身、品牌与外观轮廓",
            icon: Camera,
          },
          {
            title: "接口 / 侧面细节",
            hint: "插头、端口、规格结构",
            icon: PlugZap,
          },
          {
            title: "铭牌 / 包装标签",
            hint: "CE、UKCA、FCC 与警示语",
            icon: PackageCheck,
          },
        ]
      : [
          {
            title: "Front view",
            hint: "Full body, brand, and outline",
            icon: Camera,
          },
          {
            title: "Ports / side detail",
            hint: "Plug, port, and spec structure",
            icon: PlugZap,
          },
          {
            title: "Nameplate / package",
            hint: "CE, UKCA, FCC, and warnings",
            icon: PackageCheck,
          },
        ];

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => {
        if (url) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [previewUrls]);

  function validateFiles(nextFiles: File[]) {
    const invalidType = nextFiles.find((file) => !ACCEPTED_IMAGE_TYPES.has(file.type));
    if (invalidType) {
      setError(
        locale === "zh"
          ? `“${invalidType.name}”格式不支持，请上传 JPG、PNG 或 WebP 图片。`
          : `“${invalidType.name}” is not supported. Use JPG, PNG, or WebP.`
      );
      return null;
    }

    const oversized = nextFiles.find((file) => file.size > MAX_FILE_SIZE_BYTES);
    if (oversized) {
      setError(
        locale === "zh"
          ? `“${oversized.name}”超过 12MB，请压缩后重新上传。`
          : `“${oversized.name}” exceeds 12MB. Please compress it and try again.`
      );
      return null;
    }

    if (nextFiles.length > MAX_UPLOAD_FILES) {
      setError(
        locale === "zh"
          ? `一次最多上传 ${MAX_UPLOAD_FILES} 张图片，已为你保留前 ${MAX_UPLOAD_FILES} 张。`
          : `Up to ${MAX_UPLOAD_FILES} images are allowed. The first ${MAX_UPLOAD_FILES} were kept.`
      );
      return nextFiles.slice(0, MAX_UPLOAD_FILES);
    }

    setError(null);
    return nextFiles;
  }

  function handleFiles(nextFiles: File[]) {
    const validatedFiles = validateFiles(nextFiles);
    if (!validatedFiles?.length) {
      return;
    }

    startTransition(() => {
      setPreviewUrls((current) => {
        current.forEach((url) => {
          if (url) {
            URL.revokeObjectURL(url);
          }
        });
        return validatedFiles.map((file) => URL.createObjectURL(file));
      });
      setFiles(validatedFiles);
      setActivePreviewIndex(0);
      setPreviewMode("upload");
    });
  }

  function handleSlotFile(slotIndex: number, file?: File) {
    if (!file) {
      return;
    }

    const validatedFiles = validateFiles([file]);
    if (!validatedFiles?.[0]) {
      return;
    }

    const validatedFile = validatedFiles[0];

    startTransition(() => {
      setFiles((current) => {
        const nextFiles = [...current];
        while (nextFiles.length < REQUIRED_UPLOAD_SLOTS) {
          nextFiles.push(null);
        }
        nextFiles[slotIndex] = validatedFile;
        return nextFiles.slice(0, MAX_UPLOAD_FILES);
      });

      setPreviewUrls((current) => {
        const nextPreviewUrls = [...current];
        while (nextPreviewUrls.length < REQUIRED_UPLOAD_SLOTS) {
          nextPreviewUrls.push(null);
        }

        const previousUrl = nextPreviewUrls[slotIndex];
        if (previousUrl) {
          URL.revokeObjectURL(previousUrl);
        }

        nextPreviewUrls[slotIndex] = URL.createObjectURL(validatedFile);
        return nextPreviewUrls.slice(0, MAX_UPLOAD_FILES);
      });
      setActivePreviewIndex(slotIndex);
      setPreviewMode("upload");
    });
  }

  function removeSlotFile(slotIndex: number) {
    const nextFiles = [...files];
    if (slotIndex < nextFiles.length) {
      nextFiles[slotIndex] = null;
    }

    const nextPreviewUrls = [...previewUrls];
    const previousUrl = nextPreviewUrls[slotIndex];
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
    }
    if (slotIndex < nextPreviewUrls.length) {
      nextPreviewUrls[slotIndex] = null;
    }

    const nextPreviewIndex = nextPreviewUrls.findIndex(Boolean);

    startTransition(() => {
      setFiles(nextFiles);
      setPreviewUrls(nextPreviewUrls);

      if (previewMode === "upload" && slotIndex === activePreviewIndex) {
        if (nextPreviewIndex >= 0) {
          setActivePreviewIndex(nextPreviewIndex);
        } else {
          setPreviewMode("preset");
        }
      }
    });
  }

  /**
   * Validate a single document file via the shared `validateUploadFile` helper
   * (same code path as `/api/scan/route.ts:135` so the UI mirrors the BFF).
   * Returns an i18n-ready error message, or null on success.
   */
  function describeDocumentError(code: ReturnType<typeof validateUploadFile> extends Promise<infer R> ? R : never): string | null {
    if (!code) return null;
    const t = copy.upload.documents;
    switch (code) {
      case "DOCUMENT_TOO_LARGE":
        return t.tooLarge;
      case "UNSUPPORTED_DOCUMENT_TYPE":
        return t.invalidType;
      case "INVALID_FILE_SIGNATURE":
        return t.signatureFailed;
      default:
        return t.invalidType;
    }
  }

  async function handleDocumentFiles(rawFiles: File[]) {
    setDocumentError(null);
    if (rawFiles.length === 0) return;

    const remainingSlots = MAX_DOCUMENT_FILES - documentFiles.length;
    if (remainingSlots <= 0) {
      setDocumentError(copy.upload.documents.invalidType);
      return;
    }

    // De-dupe by (name+size+lastModified) so the same file dropped twice isn't
    // added twice (common when users drag the same file across multiple slots).
    const seen = new Set(documentFiles.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
    const accepted: File[] = [];
    let firstError: string | null = null;

    for (const file of rawFiles.slice(0, remainingSlots)) {
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (seen.has(key)) continue;
      const validation = await validateUploadFile(file, "document");
      if (validation) {
        if (!firstError) firstError = describeDocumentError(validation);
        continue;
      }
      seen.add(key);
      accepted.push(file);
    }

    if (firstError) setDocumentError(firstError);
    if (accepted.length === 0) return;

    startTransition(() => {
      setDocumentFiles((current) => [...current, ...accepted]);
    });
  }

  function removeDocumentFile(index: number) {
    startTransition(() => {
      setDocumentFiles((current) => current.filter((_, i) => i !== index));
      setDocumentError(null);
    });
  }

  function toggleMarket(market: Market) {
    setSelectedMarkets((current) => {
      if (current.includes(market)) {
        return current.length === 1 ? current : current.filter((item) => item !== market);
      }
      return [...current, market];
    });
  }

  async function submitScan(formData: FormData) {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as
        | ScanStartPayload
        | { error?: { message?: string } };

      if (!response.ok) {
        const errorPayload = payload as { error?: { message?: string } };
        throw new Error(
          errorPayload.error?.message ??
            (locale === "zh" ? "提交失败，请稍后重试。" : "Submission failed. Please try again.")
        );
      }

      if (!("sessionId" in payload)) {
        throw new Error(
          locale === "zh"
            ? "接口未返回有效的 sessionId。"
            : "The API did not return a valid sessionId."
        );
      }

      const startPayload = payload as ScanStartPayload;
      if (startPayload.accessToken) {
        try {
          sessionStorage.setItem(
            `scan-token:${startPayload.sessionId}`,
            startPayload.accessToken
          );
        } catch {
          // sessionStorage may be disabled (private mode, quota) — the poll
          // endpoint also accepts ?token=, so the user can still recover by
          // reloading with the token in the URL.
        }
      }

      try {
        sessionStorage.setItem(
          `scan-image-count:${startPayload.sessionId}`,
          String(formData.getAll("images").length),
        );
      } catch {
        // The polling response also exposes imageCount for reload recovery.
      }

      router.push(`/burning/${startPayload.sessionId}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : locale === "zh"
            ? "提交失败，请稍后重试。"
            : "Submission failed. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!uploadedFiles.length) {
      setError(
        locale === "zh"
          ? "请先上传至少 1 张产品图片，或使用下方预制 Demo。"
          : "Please upload at least one product image, or use the preset demo below."
      );
      return;
    }

    const formData = new FormData();
    uploadedFiles.forEach((file) => formData.append("images", file));
    documentFiles.forEach((file) => formData.append("documents", file));
    formData.append("category", category);
    formData.append("markets", selectedMarkets.join(","));
    formData.append("locale", locale);

    await submitScan(formData);
  }

  function startPresetDemo(presetIndex = selectedPresetIndex) {
    // B-3 note: 跳到 /result/demo 时附带 `?preset=` + `?markets=` query,让结果页
    // 用 createMockScanResult(sessionId, { category, markets }) 切到对应场景
    // (electronics/appliance/toy)并带上该场景的目标市场。之前只传 preset、markets
    // 落回默认 EU/UK,导致 humidifier/toy 明明选了 EU/US 却显示 EU/UK,toy 还丢了
    // US-CPSIA-TOY 法规。
    const presetKeys = ["charger", "humidifier", "toy"] as const;
    const key = presetKeys[presetIndex] ?? "charger";
    const preset = presetConfigs[presetIndex] ?? presetConfigs[0];
    router.push(`/burning/demo?preset=${key}&markets=${preset.markets.join(",")}`);
  }

  return (
    <main className={`${styles.page} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>
      <CompliPilotFlowBackdrop tone="bright" />

      <div className="relative z-10">
        <CompliPilotFlowHeader
          backHref="/"
          backLabel={locale === "zh" ? "返回首页" : "Back home"}
          flowTitle={locale === "zh" ? "产品合规检测" : "Product Compliance Scan"}
          flowSubtitle={locale === "zh" ? "上传产品图 · 选择目标市场 · 生成合规报告" : "Upload · choose markets · generate report"}
          primaryLabel={locale === "zh" ? "开始检测" : "Start scan"}
          secondaryHref="/result/demo"
          secondaryLabel={locale === "zh" ? "查看预制 Demo" : "View preset demo"}
          tone="bright"
        />

        <form
          className="mx-auto grid w-full max-w-[1240px] gap-6 px-6 pt-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(380px,0.92fr)]"
          onSubmit={handleSubmit}
        >
          <section className="blaze-panel p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <SectionEyebrow>Step 01</SectionEyebrow>
                <h1 className="mt-3 text-[30px] font-semibold leading-tight text-white">
                  {locale === "zh" ? "上传产品图片" : "Upload product images"}
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-white/58">
                  {locale === "zh"
                    ? "先上传一张清晰主图；补充接口和铭牌照片后，判断会更准确。"
                    : "Start with one clear product photo. Add ports and labels for a more accurate result."}
                </p>
              </div>
              <span className="rounded-full border border-white/40 bg-white/22 px-3 py-1.5 text-xs font-semibold text-white">
                {uploadProgress}/{REQUIRED_UPLOAD_SLOTS} {locale === "zh" ? "张已就绪" : "ready"}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs font-medium text-white/58">
              {(locale === "zh"
                ? ["1 上传图片", "2 选择市场", "3 生成报告"]
                : ["1 Upload", "2 Markets", "3 Report"]
              ).map((step, index) => (
                <span
                  key={step}
                  className={`rounded-full border px-3 py-2 ${
                    index === 0 ? "border-white/65 bg-white/34 text-white" : "border-white/28 bg-white/12"
                  }`}
                >
                  {step}
                </span>
              ))}
            </div>

            <label
              htmlFor="blaze-bulk-upload-input"
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  bulkUploadInputRef.current?.click();
                }
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                handleFiles(Array.from(event.dataTransfer.files));
              }}
              className={`mt-5 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-[26px] border border-dashed px-5 py-7 text-center transition ${
                dragActive
                  ? "scale-[1.01] border-white bg-white/46 shadow-[0_16px_45px_rgba(41,142,177,0.16)]"
                  : "border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.32),rgba(215,247,250,0.16))] hover:border-white hover:bg-white/38"
              }`}
            >
              <div className="rounded-2xl border border-white/45 bg-white/26 p-3 text-[#08708a] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                <Upload className="size-5" />
              </div>
              <p className="mt-3 text-sm font-semibold text-white">
                {dragActive
                  ? locale === "zh" ? "松开即可添加图片" : "Drop to add images"
                  : locale === "zh" ? "拖入图片或点击上传" : "Drop images or click to upload"}
              </p>
              <p className="mt-1.5 text-xs leading-5 text-white/48">
                {locale === "zh" ? "支持 JPG、PNG、WebP，单张不超过 12MB" : "JPG, PNG, or WebP; up to 12MB each"}
              </p>
            </label>
            <input
              ref={bulkUploadInputRef}
              id="blaze-bulk-upload-input"
              type="file"
              multiple
              aria-label={locale === "zh" ? "批量上传产品图片" : "Upload product images in bulk"}
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                const selectedFiles = Array.from(event.currentTarget.files ?? []);
                handleFiles(selectedFiles);
                event.currentTarget.value = "";
              }}
            />

            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">
                  {locale === "zh" ? "建议补齐这 3 个角度" : "Recommended 3 angles"}
                </p>
                <span className="text-xs text-white/42">
                  {locale === "zh" ? "至少 1 张即可开始" : "1 image minimum"}
                </span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {slotCopy.map((slot, index) => {
                  const file = files[index];
                  const previewUrl = previewUrls[index];
                  const SlotIcon = slot.icon;

                  return (
                    <article
                      key={slot.title}
                      className={`rounded-[20px] border p-3 ${
                        file ? "border-white/60 bg-white/30" : "border-white/34 bg-white/14"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          disabled={!previewUrl}
                          onClick={() => {
                            if (previewUrl) {
                              setActivePreviewIndex(index);
                              setPreviewMode("upload");
                            }
                          }}
                          aria-label={
                            previewUrl
                              ? locale === "zh"
                                ? `预览${slot.title}`
                                : `Preview ${slot.title}`
                              : undefined
                          }
                          className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-[14px] border border-white/38 bg-white/22 text-[#08708a] transition enabled:hover:border-white/75 enabled:hover:brightness-105"
                        >
                          {previewUrl ? (
                            <Image
                              src={previewUrl}
                              alt=""
                              fill
                              sizes="48px"
                              className="object-cover"
                              unoptimized
                            />
                          ) : (
                            <SlotIcon className="size-5" />
                          )}
                        </button>
                        {file ? (
                          <button
                            type="button"
                            className="rounded-full border border-white/38 bg-white/20 p-1.5 text-white/55 transition hover:bg-white/35 hover:text-white"
                            aria-label={locale === "zh" ? "移除图片" : "Remove image"}
                            onClick={() => removeSlotFile(index)}
                          >
                            <X className="size-3.5" />
                          </button>
                        ) : (
                          <>
                            <label
                              htmlFor={`blaze-upload-slot-${index}`}
                              className="cursor-pointer rounded-full border border-white/42 bg-white/22 px-2.5 py-1.5 text-xs text-white/58 transition hover:bg-white/38 hover:text-white"
                            >
                              {locale === "zh" ? "添加" : "Add"}
                            </label>
                            <input
                              id={`blaze-upload-slot-${index}`}
                              type="file"
                              aria-label={
                                locale === "zh"
                                  ? `上传到${slot.title}槽位`
                                  : `Upload to ${slot.title} slot`
                              }
                              accept="image/jpeg,image/png,image/webp"
                              className="sr-only"
                              onChange={(event) => {
                                handleSlotFile(index, event.currentTarget.files?.[0]);
                                event.currentTarget.value = "";
                              }}
                            />
                          </>
                        )}
                      </div>
                      <div className="mt-3 flex items-center gap-1.5">
                        <p className="truncate text-sm font-semibold text-white">{slot.title}</p>
                        {file ? <CheckCircle2 className="size-3.5 shrink-0 text-[#08708a]" /> : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/48">
                        {file ? `${file.name} · ${formatFileSize(file.size)}` : slot.hint}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>

            {files.slice(REQUIRED_UPLOAD_SLOTS).filter(Boolean).length > 0 ? (
              <p className="mt-3 text-xs leading-5 text-white/48">
                {locale === "zh"
                  ? `另外 ${files.slice(REQUIRED_UPLOAD_SLOTS).filter(Boolean).length} 张图片会作为补充证据。`
                  : `${files.slice(REQUIRED_UPLOAD_SLOTS).filter(Boolean).length} extra images will be supporting evidence.`}
              </p>
            ) : null}

            <details className="group mt-6 rounded-[22px] border border-white/24 bg-white/8 open:bg-white/12">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="size-4 shrink-0 text-white/58" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {copy.upload.documents.toggleLabel}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-white/48">
                      {copy.upload.documents.toggleHint}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-white/30 bg-white/14 px-2.5 py-0.5 text-[11px] font-medium text-white/58">
                  {documentFiles.length > 0
                    ? `${documentFiles.length}/${MAX_DOCUMENT_FILES}`
                    : locale === "zh"
                      ? "可选"
                      : "Optional"}
                </span>
              </summary>
              <div className="border-t border-white/16 px-4 pb-4 pt-3">
                <p className="text-xs leading-5 text-white/46">
                  {copy.upload.documents.format}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <label
                    htmlFor="blaze-document-input"
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/38 bg-white/14 px-3 py-1.5 text-xs font-medium text-white/72 transition hover:border-white/55 hover:bg-white/22 hover:text-white"
                  >
                    <Upload className="size-3.5" />
                    {documentFiles.length === 0
                      ? copy.upload.documents.toggleLabel.replace(/^📄\s*/, "")
                      : copy.upload.documents.addAnother}
                  </label>
                  <input
                    ref={documentInputRef}
                    id="blaze-document-input"
                    type="file"
                    multiple
                    aria-label={copy.upload.documents.toggleLabel}
                    accept={ACCEPTED_DOCUMENT_EXTENSIONS}
                    className="sr-only"
                    onChange={(event) => {
                      const next = Array.from(event.currentTarget.files ?? []);
                      void handleDocumentFiles(next);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
                {documentError ? (
                  <p
                    className="mt-2 rounded-[12px] border border-[rgba(196,76,63,0.24)] bg-[rgba(255,232,227,0.46)] px-3 py-2 text-xs text-[#8f3229]"
                    role="alert"
                    aria-live="polite"
                  >
                    {documentError}
                  </p>
                ) : null}
                {documentFiles.length > 0 ? (
                  <ul className="mt-3 space-y-1.5" data-testid="document-list">
                      {documentFiles.map((doc, index) => (
                        <li
                          key={`${doc.name}-${index}`}
                          className="flex items-center justify-between gap-3 rounded-[12px] border border-white/20 bg-white/10 px-3 py-2 text-xs"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <FileText className="size-3.5 shrink-0 text-white/58" />
                            <span className="truncate font-medium text-white/82">
                              {doc.name}
                            </span>
                            <span className="shrink-0 font-mono text-[11px] text-white/42">
                              {formatFileSize(doc.size)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeDocumentFile(index)}
                            aria-label={copy.upload.documents.removed}
                            className="shrink-0 rounded-full border border-white/28 bg-white/10 p-1 text-white/55 transition hover:border-white/55 hover:bg-white/22 hover:text-white"
                          >
                            <X className="size-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                ) : null}
              </div>
            </details>

            <div className="mt-6 grid gap-5 border-t border-white/30 pt-5 xl:grid-cols-[1fr_210px]">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{copy.upload.markets}</p>
                    <p className="mt-1 text-xs text-white/42">
                      {locale === "zh" ? "选择产品准备进入的市场" : "Choose destination markets"}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/38 bg-white/18 px-2.5 py-1 text-xs text-white/48">
                    {selectedMarkets.length} {locale === "zh" ? "个已选" : "selected"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(showAllMarkets ? MARKET_IDS : FEATURED_MARKETS).map((marketId) => {
                    const active = selectedMarkets.includes(marketId);
                    return (
                      <button
                        key={marketId}
                        type="button"
                        onClick={() => toggleMarket(marketId)}
                        className={`rounded-full border px-3 py-2 text-sm transition ${
                          active
                            ? "border-white/75 bg-white/40 text-white"
                            : "border-white/34 bg-white/12 text-white/58 hover:bg-white/28"
                        }`}
                      >
                        {copy.upload.marketLabels[marketId]}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setShowAllMarkets((current) => !current)}
                    className="rounded-full border border-white/28 bg-transparent px-3 py-2 text-sm text-white/48 transition hover:bg-white/18 hover:text-white"
                  >
                    {showAllMarkets
                      ? locale === "zh" ? "收起" : "Less"
                      : locale === "zh" ? "更多市场" : "More markets"}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-white" htmlFor="blaze-category">
                  {copy.upload.category}
                </label>
                <div className="relative mt-3">
                  <select
                    id="blaze-category"
                    value={category}
                    onChange={(event) => setCategory(event.target.value as ProductCategory)}
                    className="block w-full appearance-none rounded-[16px] border border-white/44 bg-white/22 px-4 py-3 pr-10 text-sm text-white outline-none transition focus:border-white/85"
                  >
                    {(["electronics", "appliance", "3c", "toy", "home", "battery", "cosmetic", "textile", "food_contact", "other"] as const).map((optionId) => (
                      <option key={optionId} value={optionId} className="bg-[#e8f7fa] text-[#073b54]">
                        {copy.upload.categoryLabels[optionId]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-white/46" />
                </div>
              </div>
            </div>

            {error ? (
              <div
                className="mt-5 rounded-[16px] border border-[rgba(196,76,63,0.24)] bg-[rgba(255,232,227,0.46)] px-4 py-3 text-sm text-[#8f3229]"
                role="alert"
                aria-live="polite"
              >
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="mt-6 w-full rounded-full border-0 bg-[linear-gradient(135deg,var(--blaze-orange),var(--blaze-red))] text-white shadow-[0_14px_42px_rgba(33,145,175,0.2)] hover:opacity-95"
              disabled={submitting || uploadedFiles.length === 0}
            >
              {submitting
                ? locale === "zh" ? "正在生成扫描会话…" : "Creating scan session..."
                : uploadedFiles.length === 0
                  ? locale === "zh" ? "上传 1 张图片后开始检测" : "Upload 1 image to start"
                  : copy.upload.submit}
            </Button>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-white/42">
              <span>{locale === "zh" ? "图片仅用于当前检测会话" : "Images are used for this scan only"}</span>
              <span>{locale === "zh" ? "提交前可随时修改" : "Editable before submission"}</span>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="blaze-panel p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <SectionEyebrow>Live Preview</SectionEyebrow>
                  <h2 className="mt-3 text-2xl font-semibold text-white">
                    {locale === "zh" ? "当前检测预览" : "Current scan preview"}
                  </h2>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <GlowPill>{readinessLabel}</GlowPill>
                  <GlowPill>{selectedMarketLabel} · {categoryLabel}</GlowPill>
                </div>
              </div>

              <div className="mt-5 rounded-[24px] border border-white/50 bg-white/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.58)]">
                <div
                  className={`${styles.previewStage} corner-marks relative aspect-[1.42/1] overflow-hidden rounded-[19px] border border-white/36 bg-[#0a4f79]`}
                  onWheel={(event) => {
                    if (previewMode !== "upload" || uploadedPreviewEntries.length < 2) {
                      return;
                    }

                    const currentPosition = uploadedPreviewEntries.findIndex(
                      (entry) => entry.index === activePreviewIndex
                    );
                    const direction = event.deltaY > 0 ? 1 : -1;
                    const nextPosition =
                      (Math.max(0, currentPosition) + direction + uploadedPreviewEntries.length) %
                      uploadedPreviewEntries.length;
                    setActivePreviewIndex(uploadedPreviewEntries[nextPosition].index);
                  }}
                >
                  {primaryPreviewSrc ? (
                    <Image
                      src={primaryPreviewSrc}
                      alt={
                        usingUploadedPreview
                          ? locale === "zh" ? "已上传产品图片预览" : "Uploaded product preview"
                          : locale === "zh" ? "示例产品预览" : "Sample product preview"
                      }
                      fill
                      sizes="(min-width: 1024px) 42vw, 92vw"
                      className="object-cover"
                      unoptimized={usingUploadedPreview}
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(145deg,rgba(225,248,251,0.72),rgba(164,220,235,0.42))] p-8 text-center">
                      <div>
                        <span className="mx-auto grid size-14 place-items-center rounded-[18px] border border-white/55 bg-white/34 text-[#08708a] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                          <FileImage className="size-6" />
                        </span>
                        <p className="mt-4 text-sm font-semibold text-[#073b54]">
                          {locale === "zh" ? "尚未上传产品图片" : "No product image yet"}
                        </p>
                        <p className="mt-1.5 text-xs text-[#073b54]/60">
                          {locale === "zh" ? "上传后会在这里确认主图" : "Your main image will appear here"}
                        </p>
                      </div>
                    </div>
                  )}
                  <span />

                </div>
              </div>

              {uploadedPreviewEntries.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-white/48">
                    {locale === "zh"
                      ? `已上传 ${uploadedPreviewEntries.length} 张 · 点击缩略图或在主图上滚轮切换`
                      : `${uploadedPreviewEntries.length} uploaded · click a thumbnail or use the wheel`}
                  </p>
                  <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
                    {uploadedPreviewEntries.map((entry, position) => (
                      <button
                        key={entry.url}
                        type="button"
                        aria-pressed={
                          previewMode === "upload" && activePreviewIndex === entry.index
                        }
                        onClick={() => {
                          setActivePreviewIndex(entry.index);
                          setPreviewMode("upload");
                        }}
                        className={`relative h-12 w-16 shrink-0 overflow-hidden rounded-[12px] border transition ${
                          previewMode === "upload" && activePreviewIndex === entry.index
                            ? "border-white bg-white/32 shadow-[0_8px_22px_rgba(7,80,120,0.18)]"
                            : "border-white/30 bg-white/14 hover:border-white/65"
                        }`}
                      >
                        <Image
                          src={entry.url}
                          alt={
                            locale === "zh"
                              ? `已上传图片 ${position + 1}`
                              : `Uploaded image ${position + 1}`
                          }
                          fill
                          sizes="64px"
                          className="object-cover"
                          unoptimized
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-5">
                <p className="text-sm font-semibold text-white">
                  {locale === "zh" ? "检测后你会得到" : "Your report will include"}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                  {(locale === "zh"
                    ? ["产品与标签识别", "风险等级与缺口", "法规依据与整改建议"]
                    : ["Product recognition", "Risk gaps", "Sources and actions"]
                  ).map((item) => (
                    <div key={item} className="flex items-start gap-2 rounded-[16px] border border-white/34 bg-white/16 p-3">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#08708a]" />
                      <span className="text-xs font-medium leading-5 text-white/58">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="blaze-panel-soft p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <SectionEyebrow>Quick Demo</SectionEyebrow>
                  <h3 className="mt-2 text-lg font-semibold text-white">
                    {locale === "zh" ? "没有图片？先用示例体验" : "No image? Try a sample"}
                  </h3>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full border-0 bg-[linear-gradient(135deg,var(--blaze-orange),var(--blaze-red))] px-4 text-white shadow-[0_10px_30px_rgba(33,145,175,0.16)] hover:opacity-95"
                  disabled={submitting}
                  onClick={() => startPresetDemo()}
                >
                  <Play className="size-4" />
                  {submitting
                    ? locale === "zh" ? "启动中…" : "Starting..."
                    : locale === "zh" ? "直接演示" : "Start demo"}
                </Button>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {copy.upload.presets.map((item, index) => {
                  const active = previewMode === "preset" && selectedPresetIndex === index;
                  const preset = presetConfigs[index] ?? presetConfigs[0];
                  return (
                    <button
                      key={item.title}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedPresetIndex(index);
                        setCategory(preset.category);
                        setSelectedMarkets(preset.markets);
                        setPreviewMode("preset");
                      }}
                      className={`rounded-[16px] border p-2 text-left transition ${
                        active ? "border-white/65 bg-white/30" : "border-white/30 bg-white/12 hover:bg-white/24"
                      }`}
                    >
                      <div className="relative aspect-[1.35/1] overflow-hidden rounded-[11px] border border-white/28 bg-white/14">
                        <Image src={preset.previewImage} alt="" fill sizes="140px" className="object-cover" />
                      </div>
                      <p className="mt-2 truncate text-xs font-semibold text-white">{item.title}</p>
                    </button>
                  );
                })}
              </div>
            </section>
          </aside>
        </form>
        <CompliPilotFlowFooter tone="bright" />
      </div>
    </main>
  );
}
