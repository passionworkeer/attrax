"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Market = "EU" | "US" | "UK" | "CN" | "AU" | "SA" | "AE";
export type Category = "electronics" | "appliance" | "3c" | "toy" | "home" | "other";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "electronics", label: "电子产品" },
  { value: "appliance", label: "家电" },
  { value: "3c", label: "3C 数码" },
  { value: "toy", label: "玩具" },
  { value: "home", label: "家居" },
  { value: "other", label: "其他" },
];

const MARKETS: { value: Market; label: string }[] = [
  { value: "EU", label: "欧盟" },
  { value: "US", label: "美国" },
  { value: "UK", label: "英国" },
  { value: "CN", label: "中国" },
  { value: "AU", label: "澳大利亚" },
  { value: "SA", label: "沙特" },
  { value: "AE", label: "阿联酋" },
];

const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
];

const ACCEPTED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
];

const DOCUMENT_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/html": "html",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === "application/pdf") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-8 shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    );
  }
  if (mimeType.includes("wordprocessingml")) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-8 shrink-0 text-blue-600">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-8 shrink-0 text-orange-500">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function ImagePreview({ file }: { file: File }) {
  const url = URL.createObjectURL(file);
  return (
    <div className="relative flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3">
      <Image
        src={url}
        alt={file.name}
        width={64}
        height={64}
        className="h-16 w-16 shrink-0 rounded-lg object-cover"
        onLoad={() => URL.revokeObjectURL(url)}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(file.size)}</p>
      </div>
    </div>
  );
}

function DocumentPreview({ file }: { file: File }) {
  const ext = DOCUMENT_EXTENSIONS[file.type] ?? file.name.split(".").pop() ?? "file";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3">
      <DocumentIcon mimeType={file.type} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {ext.toUpperCase()} · {formatBytes(file.size)}
        </p>
      </div>
    </div>
  );
}

export interface UploadFormProps {
  onSubmit: (data: {
    images: File[];
    documents: File[];
    category: Category;
    markets: Market[];
  }) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}

export function UploadForm({ onSubmit, isSubmitting, error }: UploadFormProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const [images, setImages] = useState<File[]>([]);
  const [documents, setDocuments] = useState<File[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category>("electronics");
  const [selectedMarkets, setSelectedMarkets] = useState<Market[]>(["EU", "US"]);
  const [localError, setLocalError] = useState<string | null>(null);

  function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = Array.from(event.target.files ?? []);
    const valid = raw.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));

    if (raw.length > valid.length) {
      setLocalError(`部分文件不是支持的图片格式，已跳过 ${raw.length - valid.length} 个。`);
    } else {
      setLocalError(null);
    }

    setImages((prev) => [...prev, ...valid].slice(0, 8));
  }

  function handleDocumentChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = Array.from(event.target.files ?? []);
    const valid = raw.filter((f) => ACCEPTED_DOCUMENT_TYPES.includes(f.type));

    if (raw.length > valid.length) {
      setLocalError(`部分文件不是支持的文档格式（PDF / DOCX / HTML），已跳过 ${raw.length - valid.length} 个。`);
    } else {
      setLocalError(null);
    }

    setDocuments((prev) => [...prev, ...valid].slice(0, 5));
  }

  async function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!images.length) {
      setLocalError("请先选择至少 1 张图片。");
      return;
    }
    await onSubmit({ images, documents, category: selectedCategory, markets: selectedMarkets });
  }

  function clearImages() {
    setImages([]);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function clearDocuments() {
    setDocuments([]);
    if (docInputRef.current) docInputRef.current.value = "";
  }

  const totalFiles = images.length + documents.length;
  const displayError = error ?? localError;

  return (
    <form className="mt-8 space-y-6" onSubmit={handleFormSubmit}>
      {/* Images section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">产品图片</label>
          <span className="text-xs text-muted-foreground">
            {images.length}/8 张
          </span>
        </div>

        <input
          ref={imageInputRef}
          type="file"
          multiple
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          className="block w-full rounded-2xl border border-dashed border-border bg-blaze-surface px-4 py-6 text-sm file:hidden"
          onChange={handleImageChange}
          disabled={images.length >= 8 || isSubmitting}
        />

        {images.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {images.map((file) => (
              <ImagePreview key={file.name} file={file} />
            ))}
            <button
              type="button"
              onClick={clearImages}
              className="text-xs text-muted-foreground underline hover:text-red-500"
            >
              清除全部图片
            </button>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 border-t border-border" />
        <span className="text-xs text-muted-foreground">可选 · 支持文档</span>
        <div className="h-px flex-1 border-t border-border" />
      </div>

      {/* Documents section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">产品文档</label>
          <span className="text-xs text-muted-foreground">
            {documents.length}/5 份
          </span>
        </div>

        <input
          ref={docInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.html"
          className="block w-full rounded-2xl border border-dashed border-border bg-blaze-surface px-4 py-6 text-sm file:hidden"
          onChange={handleDocumentChange}
          disabled={documents.length >= 5 || isSubmitting}
        />

        {documents.length > 0 && (
          <div className="space-y-2">
            {documents.map((file) => (
              <DocumentPreview key={file.name} file={file} />
            ))}
            <button
              type="button"
              onClick={clearDocuments}
              className="text-xs text-muted-foreground underline hover:text-red-500"
            >
              清除全部文档
            </button>
          </div>
        )}
      </div>

      {/* Summary bar */}
      <div
        className={cn(
          "rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground transition-all",
          totalFiles === 0 && "opacity-40"
        )}
      >
        {totalFiles === 0
          ? "请上传至少 1 张图片"
          : `已选择 ${images.length} 张图片${documents.length > 0 ? `，${documents.length} 份文档` : ""}`}
      </div>

      {/* Category & Markets selectors */}
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium">目标市场</label>
          <div className="flex flex-wrap gap-2">
            {MARKETS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() =>
                  setSelectedMarkets((prev) =>
                    prev.includes(m.value)
                      ? prev.filter((x) => x !== m.value)
                      : [...prev, m.value]
                  )
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  selectedMarkets.includes(m.value)
                    ? "border-blaze-red bg-blaze-red/10 text-blaze-red"
                    : "border-border bg-blaze-surface text-muted-foreground hover:border-blaze-red/40"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium">产品分类</label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setSelectedCategory(c.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  selectedCategory === c.value
                    ? "border-blaze-red bg-blaze-red/10 text-blaze-red"
                    : "border-border bg-blaze-surface text-muted-foreground hover:border-blaze-red/40"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error */}
      {displayError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {displayError}
        </p>
      ) : null}

      {/* Submit */}
      <Button
        type="submit"
        size="lg"
        className="w-full bg-blaze-red text-white hover:bg-blaze-red/90"
        disabled={isSubmitting || images.length === 0}
      >
        {isSubmitting ? "提交中…" : "提交并开始扫描"}
      </Button>
    </form>
  );
}