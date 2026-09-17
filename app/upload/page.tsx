"use client";

import Image from "next/image";
import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  ScanLine,
  ShieldAlert,
  ClipboardList,
  CheckCircle2,
  FileImage,
  FileText,
  Play,
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
  CompliPilotFlowFooter,
  CompliPilotFlowHeader,
} from "@/components/complipilot/flow-shell";
import { getCompliPilotCopy } from "@/lib/complipilot/copy";
import { MARKET_IDS, type Market, type ProductCategory } from "@/lib/types";
import { getCategoryManifest } from "@/lib/upload/category-manifest";
import { validateUploadFile } from "@/lib/upload-validation";
import styles from "./upload.module.css";
import { CategorySelect } from "./category-select";
import { PRODUCT_SAMPLES, loadProductSample } from "@/lib/upload/product-samples";

type ScanStartPayload = {
  sessionId: string;
  accessToken?: string;
  status: "processing";
  pollUrl: string;
};

/**
 * J17（计划 §5.4）：不再使用固定 3 槽。照片槽数量由当前品类的
 * `category-manifest.ts` 决定（2-4 槽），上限仍为 MAX_UPLOAD_FILES。
 */
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

const presetConfigs = PRODUCT_SAMPLES;

export default function UploadPage() {
  const router = useRouter();
  const { locale } = useBlazeLocale();
  const copy = getCompliPilotCopy(locale);
  const [files, setFiles] = useState<Array<File | null>>([]);
  const [previewUrls, setPreviewUrls] = useState<Array<string | null>>([]);
  const uploadPanelRef = useRef<HTMLElement | null>(null);
  const currentPreviewUrlsRef = useRef<Array<string | null>>([]);
  const bulkUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedMarkets, setSelectedMarkets] = useState<Market[]>(["EU"]);
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
  const [loadingSample, setLoadingSample] = useState(false);
  const [includeSampleDocument, setIncludeSampleDocument] = useState(false);
  const [sampleNotice, setSampleNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // J17: 品类条件问题的答案（问题 id → 用户选择的选项文案）。
  // 提交时以 `userDeclaredFacts` JSON 字段附带给 BFF；BFF 透传为
  // declared_facts → 后端 ScanSubmission → findings_builder 关闭不适用的
  // 检查（例如声明无电池时不再要求电池仓照片）。
  const [categoryAnswers, setCategoryAnswers] = useState<Record<string, string>>({});
  const uploadedFiles = files.filter((file): file is File => Boolean(file));
  // J17: 照片槽 = 当前品类 manifest 的 photoSlots（数量可变，≤8）。
  const categoryManifest = getCategoryManifest(category);
  const photoSlots = categoryManifest.photoSlots;
  const slotCount = Math.min(photoSlots.length, MAX_UPLOAD_FILES);
  const uploadProgress = files.slice(0, slotCount).filter(Boolean).length;
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
  // J18/J17: 预览徽标不再叫「多品类模式」——那会暗示系统已经跨品类
  // 自动切换检查配置。改为如实的「示例预览 · <品类>」。
  const categoryLabel =
    locale === "zh"
      ? `${usingUploadedPreview ? "上传预览" : "示例预览"} · ${categoryManifest.label}`
      : `${usingUploadedPreview ? "Upload preview" : "Sample preview"} · ${categoryManifest.labelEn}`;
  const slotCopy =
    locale === "zh"
      ? photoSlots.map((slot) => ({
          title: slot.label,
          hint: slot.hint,
          icon: Camera,
        }))
      : photoSlots.map((slot) => ({
          title: slot.labelEn,
          hint: slot.hintEn,
          icon: Camera,
        }));
  const recommendedSlotTitle =
    locale === "zh"
      ? `建议补齐这 ${slotCount} 个角度（${categoryManifest.label}）`
      : `Recommended ${slotCount} angles (${categoryManifest.labelEn})`;

  useEffect(() => {
    currentPreviewUrlsRef.current = previewUrls;
  }, [previewUrls]);

  useEffect(() => () => {
    currentPreviewUrlsRef.current.forEach((url) => { if (url) URL.revokeObjectURL(url); });
  }, []);

  useEffect(() => {
    if (!sampleNotice) return;
    uploadPanelRef.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
    uploadPanelRef.current?.focus({ preventScroll: true });
  }, [sampleNotice]);

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
        while (nextFiles.length < slotCount) {
          nextFiles.push(null);
        }
        nextFiles[slotIndex] = validatedFile;
        return nextFiles.slice(0, MAX_UPLOAD_FILES);
      });

      setPreviewUrls((current) => {
        const nextPreviewUrls = [...current];
        while (nextPreviewUrls.length < slotCount) {
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
      setDocumentError(copy.upload.documents.maxCountExceeded ?? `最多支持上传 ${MAX_DOCUMENT_FILES} 个文档文件`);
      return;
    }

    // De-dupe by (name+size+lastModified) so the same file dropped twice isn't
    // added twice (common when users drag the same file across multiple slots).
    const seen = new Set(documentFiles.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
    const accepted: File[] = [];
    let firstError: string | null = rawFiles.length > remainingSlots
      ? (copy.upload.documents.maxCountExceeded ?? `最多支持上传 ${MAX_DOCUMENT_FILES} 个文档文件`)
      : null;

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

  /**
   * J17: 切换品类时，清空旧品类的条件问题答案——问题集随品类变化，
   * 旧答案对新问题没有意义。已上传的照片保留（它们仍是有效证据），
   * 超出新品类槽位数的部分自动按「补充证据」提交（见下方
   * uploadedFiles 的构造：所有已上传文件都进入 formData 的 images，
   * 槽位只是建议视角，不是提交过滤器）。
   */
  function handleCategoryChange(nextCategory: ProductCategory) {
    setCategory(nextCategory);
    setCategoryAnswers({});
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
          // sessionStorage may be disabled (private mode, quota). That is not
          // a recovery problem: the scan-creation response also set the
          // HttpOnly `attrax_scan_<id>` cookie, and the poll endpoint accepts
          // it (app/api/backend-session-access.ts). Nothing needs the token in
          // JS memory, and the poll endpoint does NOT accept ?token= — putting
          // it in the URL would land it in nginx access logs.
        }
      }

      try {
        sessionStorage.setItem(`scan-markets:${startPayload.sessionId}`, String(formData.get("markets") ?? ""));
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
    if (submitting || loadingSample) return;

    if (!uploadedFiles.length) {
      setError(
        locale === "zh"
          ? "请先上传至少 1 张产品图片，或载入下方产品样例。"
          : "Please upload at least one product image, or load a product sample below."
      );
      return;
    }

    const formData = new FormData();
    uploadedFiles.forEach((file) => formData.append("images", file));
    documentFiles.forEach((file) => formData.append("documents", file));
    formData.append("category", category);
    formData.append("markets", selectedMarkets.join(","));
    formData.append("locale", locale);
    // J17: 附带品类条件问题的用户声明。BFF 读取该 JSON 并透传为
    // declared_facts（见 app/api/scan/route.ts 与 lib/rag-client/
    // v1-adapter.ts），后端 findings_builder 据此关闭不适用的检查
    // （计划 §5.4，J09）。
    const declaredFacts = categoryManifest.conditionalQuestions.reduce<Record<string, string>>(
      (acc, question) => {
        const answer = categoryAnswers[question.id];
        if (answer) {
          acc[question.id] = answer;
        }
        return acc;
      },
      {},
    );
    if (Object.keys(declaredFacts).length > 0) {
      formData.append("userDeclaredFacts", JSON.stringify(declaredFacts));
    }

    await submitScan(formData);
  }

  async function loadSelectedSample() {
    if (loadingSample || submitting) return;
    setLoadingSample(true);
    setSampleNotice(null);
    setError(null);
    try {
      const sample = presetConfigs[selectedPresetIndex] ?? presetConfigs[0];
      const loaded = await loadProductSample(sample, includeSampleDocument);
      if (!validateFiles(loaded.images)) return;
      handleCategoryChange(sample.category);
      setSelectedMarkets([...sample.markets]);
      setCategoryAnswers({});
      handleFiles(loaded.images);
      setDocumentFiles(loaded.documents);
      setDocumentError(null);
      setSampleNotice(locale === "zh"
        ? "已载入三张照片。请确认目标市场与资料，再点击开始检测。"
        : "Three photos loaded. Review the market and documents, then start the scan.");
    } catch {
      setError(locale === "zh" ? "样例资料加载失败，原有上传内容已保留，请重试。" : "Could not load the sample. Your uploads were preserved. Please retry.");
    } finally {
      setLoadingSample(false);
    }
  }

  return (
    <main className={`${styles.page} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>

      <div className="relative z-10">
        <CompliPilotFlowHeader
          backHref="/"
          backLabel={locale === "zh" ? "返回首页" : "Back home"}
          flowTitle={locale === "zh" ? "产品合规检测" : "Product Compliance Scan"}
          flowSubtitle={locale === "zh" ? "上传产品图 · 选择目标市场 · 生成合规报告" : "Upload · choose markets · generate report"}
          primaryFormId="product-scan-form"
          primaryDisabled={submitting || loadingSample || uploadedFiles.length === 0}
          primaryLabel={submitting ? (locale === "zh" ? "正在提交…" : "Submitting…") : (locale === "zh" ? "开始检测" : "Start scan")}

          tone="bright"
        />

        <form
          id="product-scan-form"
          className="mx-auto grid w-full max-w-[1240px] gap-6 px-3 pt-5 sm:px-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(380px,0.92fr)]"
          onSubmit={handleSubmit}
        >
          <fieldset disabled={loadingSample || submitting} className="contents">
          <section id="upload-form" ref={uploadPanelRef} tabIndex={-1} className="blaze-panel min-w-0 scroll-mt-24 p-5 outline-none sm:p-7">
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
                {uploadProgress}/{slotCount} {locale === "zh" ? "张已就绪" : "ready"}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs font-medium text-white/58">
              {(locale === "zh"
                ? ["1 选择品类上传", "2 选择市场", "3 生成报告"]
                : ["1 Category + upload", "2 Markets", "3 Report"]
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

            {sampleNotice && <p role="status" className={styles.sampleNotice}>{locale === "zh" ? "已载入三张照片。请确认目标市场与资料，再点击开始检测。" : "Three photos loaded. Review the market and documents, then start the scan."}</p>}

            {/* J17（计划 §5.4）：先选品类，下面的照片槽与提示按品类动态渲染 */}
            <div className="mt-5 flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <label className="text-sm font-semibold text-white" htmlFor="blaze-category">
                  {copy.upload.category}
                </label>
                <p className="mt-1 text-xs text-white/42">
                  {locale === "zh"
                    ? "照片槽与提示会随品类变化"
                    : "Photo slots and hints change with the category"}
                </p>
              </div>
              <div className="relative min-w-[200px] flex-[2]">
                <CategorySelect value={category} onChange={handleCategoryChange}
                  labels={copy.upload.categoryLabels} disabled={loadingSample || submitting} />
              </div>
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
              aria-disabled={loadingSample || submitting}
              className={`${styles.uploadDropzone} mt-5 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-[26px] border border-dashed px-5 py-7 text-center transition ${
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
                  {recommendedSlotTitle}
                </p>
                <span className="text-xs text-white/42">
                  {locale === "zh" ? "至少 1 张即可开始" : "1 image minimum"}
                </span>
              </div>
              {/* J17: 品类诚实边界 — 提示该品类哪些结论不能仅凭照片断言 */}
              <p className="mt-1.5 text-xs leading-5 text-white/48">
                {locale === "zh" ? categoryManifest.notPhotoAssertable : categoryManifest.notPhotoAssertableEn}
              </p>
              {/* J17: 建议补充的文档类型（按品类） */}
              <p className="mt-1 text-xs leading-5 text-white/40">
                {locale === "zh"
                  ? `建议补充资料：${categoryManifest.documentHints.join(" · ")}`
                  : `Suggested documents: ${categoryManifest.documentHintsEn.join(" · ")}`}
              </p>
              {/* J17: 槽位数量随品类变化（2-4），网格列数随之自适应 */}
              <div
                className={`mt-3 grid gap-3 ${
                  slotCount === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"
                }`}
              >
                {slotCopy.map((slot, index) => {
                  const file = files[index];
                  const previewUrl = previewUrls[index];
                  const SlotIcon = slot.icon;

                  return (
                    <article
                      key={slot.title}
                      className={`${styles.photoSlot} rounded-[20px] border p-3 ${
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
                              className={`${styles.addPhoto} cursor-pointer rounded-full border border-white/42 bg-white/22 px-2.5 py-1.5 text-xs text-white/58 transition hover:bg-white/38 hover:text-white`}
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

            {files.slice(slotCount).filter(Boolean).length > 0 ? (
              <p className="mt-3 text-xs leading-5 text-white/48">
                {locale === "zh"
                  ? `另外 ${files.slice(slotCount).filter(Boolean).length} 张图片会作为补充证据。`
                  : `${files.slice(slotCount).filter(Boolean).length} extra images will be supporting evidence.`}
              </p>
            ) : null}

            {/* J17（计划 §5.4）：品类条件问题——回答后作为「用户声明」随扫描提交，
                帮助检查器关闭不适用的检查（例如玩具声明无电池时不再要求电池仓照片）。
                跳过不影响提交；回答不会替代照片证据（例如年龄声明不能替代包装年龄标注）。 */}
            {categoryManifest.conditionalQuestions.length > 0 ? (
              <details className={styles.optionalQuestions}>
              <summary>{locale === "zh" ? "补充产品信息（可选）" : "Additional product information (optional)"}<span>{Object.keys(categoryAnswers).length}/{categoryManifest.conditionalQuestions.length}</span></summary>
              <fieldset className={styles.questionBody}>
                <legend className="sr-only">
                  {locale === "zh"
                    ? `${categoryManifest.label} · 条件问题（用户声明，可选）`
                    : `${categoryManifest.labelEn} · Conditional questions (user declaration, optional)`}
                </legend>
                <p className={styles.questionIntro}>
                  {locale === "zh"
                    ? "按实际情况选填，帮助确定检查范围。不确定可跳过；回答不替代检测证明。"
                    : "Optional answers help define the checks. Skip anything uncertain; answers do not replace test evidence."}
                </p>
                <div className={styles.questionList}>
                  {categoryManifest.conditionalQuestions.map((question, questionIndex) => {
                    const questionText = locale === "zh" ? question.question : question.questionEn;
                    const options =
                      locale === "zh"
                        ? question.options
                        : question.optionsEn ?? question.options;
                    return (
                      <div key={question.id} className={styles.questionRow}>
                        <p className={styles.questionTitle}><span aria-hidden="true">{String(questionIndex + 1).padStart(2, "0")}</span>{questionText}</p>
                        <div className={styles.questionOptions} role="group" aria-label={questionText}>
                          {options.map((option, optionIndex) => {
                            const answer = question.options[optionIndex];
                            const selected = categoryAnswers[question.id] === answer;
                            return (
                              <button
                                key={option}
                                type="button"
                                aria-pressed={selected}
                                onClick={() =>
                                  setCategoryAnswers((current) => {
                                    const next = { ...current };
                                    if (selected) {
                                      delete next[question.id];
                                    } else {
                                      next[question.id] = answer;
                                    }
                                    return next;
                                  })
                                }
                                className={styles.questionOption}
                              >
                                {option}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              </details>
            ) : null}

            <details className={`${styles.documentPanel} group mt-6 rounded-[22px] border border-white/24 bg-white/8 open:bg-white/12`}>
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

            <div className="mt-6 grid gap-5 border-t border-white/30 pt-5">
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
                        aria-pressed={active}
                        onClick={() => toggleMarket(marketId)}
                        className={`${styles.marketOption} rounded-full border px-3 py-2 text-sm transition ${
                          active
                            ? styles.selectedOption
                            : "border-white/34 bg-white/12 text-white/58 hover:bg-white/28"
                        }`}
                      >
                        {copy.upload.marketLabels[marketId]}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-expanded={showAllMarkets}
                    onClick={() => setShowAllMarkets((current) => !current)}
                    className={`${styles.marketOption} rounded-full border border-white/28 bg-transparent px-3 py-2 text-sm transition hover:bg-white/18`}
                  >
                    {showAllMarkets
                      ? locale === "zh" ? "收起" : "Less"
                      : locale === "zh" ? "更多市场" : "More markets"}
                  </button>
                </div>
              </div>
            </div>

            {error ? (
              <div
                className="mt-5 rounded-[16px] border border-[rgba(196,76,63,0.24)] bg-[rgba(255,232,227,0.46)] px-4 py-3 text-sm text-[#8f3229]"
                role="alert"
                aria-live="polite"
                tabIndex={-1}
              >
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              size="lg"
              id="scan-submit"
              className={`${styles.submitButton} mt-6 w-full scroll-mt-28 rounded-full`}
              disabled={submitting || loadingSample || uploadedFiles.length === 0}
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

          <aside className="min-w-0 space-y-5">
            <section id="product-samples" className="blaze-panel-soft scroll-mt-24 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <SectionEyebrow>Product Samples</SectionEyebrow>
                  <h3 className="mt-2 text-lg font-semibold text-white">
                    {locale === "zh" ? "没有图片？先用示例体验" : "No image? Try a sample"}
                  </h3>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full border-0 bg-[linear-gradient(135deg,var(--blaze-orange),var(--blaze-red))] px-4 text-white shadow-[0_10px_30px_rgba(33,145,175,0.16)] hover:opacity-95"
                  disabled={submitting || loadingSample}
                  onClick={() => void loadSelectedSample()}
                >
                  <Play className="size-4" />
                  {loadingSample
                    ? locale === "zh" ? "载入中…" : "Loading..."
                    : locale === "zh" ? "载入三张照片" : "Load three photos"}
                </Button>
              </div>

              <label className="mt-4 flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" checked={includeSampleDocument} onChange={(event) => setIncludeSampleDocument(event.target.checked)} />
                {locale === "zh" ? "同时载入案例资料（产品摘要及已收集的官方文件）" : "Include case evidence (summary and available official documents)"}
              </label>
              <p className="mt-2 text-xs text-white/65">
                {locale === "zh" ? "载入将替换当前图片与文档，不会自动开始检测。" : "Loading replaces current images and documents without starting a scan."}
              </p>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {presetConfigs.map((preset, index) => {
                  const active = selectedPresetIndex === index;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedPresetIndex(index);
                        setSampleNotice(null);
                        if (!uploadedFiles.length) setPreviewMode("preset");
                      }}
                      className={`rounded-[16px] border p-2 text-left transition ${
                        active ? styles.selectedSample : "border-white/30 bg-white/12 hover:bg-white/24"
                      }`}
                    >
                      <div className="relative aspect-[1.35/1] overflow-hidden rounded-[11px] border border-white/28 bg-white/14">
                        <Image src={preset.previewImage} alt="" fill sizes="140px" className="object-contain" />
                      </div>
                      <p className="mt-2 text-xs font-semibold leading-5 text-white">{locale === "zh" ? preset.title : preset.titleEn}</p>
                    </button>
                  );
                })}
              </div>
            </section>
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
                      className="object-contain"
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
                      ? `已上传 ${uploadedPreviewEntries.length} 张 · 点击缩略图切换`
                      : `${uploadedPreviewEntries.length} uploaded · select a thumbnail`}
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
                <ol className={styles.reportOutcomes}>
                  {[
                    { icon: ScanLine, title: locale === "zh" ? "识别与定位" : "Identify", body: locale === "zh" ? "核对产品信息与可见标识" : "Review product details and visible markings" },
                    { icon: ShieldAlert, title: locale === "zh" ? "风险与缺口" : "Assess", body: locale === "zh" ? "梳理风险疑点与待补资料" : "Identify potential risks and missing evidence" },
                    { icon: ClipboardList, title: locale === "zh" ? "依据与建议" : "Take action", body: locale === "zh" ? "查看法规来源与整改建议" : "Review regulatory sources and next steps" },
                  ].map(({ icon: Icon, title, body }, index) => (
                    <li key={title} className={styles.outcomeCard}>
                      <div className={styles.outcomeHeading}>
                        <span className={styles.outcomeIcon}><Icon size={18} aria-hidden="true" /></span>
                        <span className={styles.outcomeNumber} aria-hidden="true">0{index + 1}</span>
                      </div>
                      <h3 className={styles.outcomeTitle}>{title}</h3>
                      <p className={styles.outcomeDescription}>{body}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </section>


          </aside>
          </fieldset>
        </form>
        <CompliPilotFlowFooter tone="bright" />
      </div>
    </main>
  );
}
