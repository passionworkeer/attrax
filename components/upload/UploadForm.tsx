"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import type { Market as ScanMarket, ProductCategory } from "@/lib/types";

export type Market = ScanMarket;
export type Category = ProductCategory;

const CATEGORIES: { value: Category; labelKey: string }[] = [
  { value: "electronics", labelKey: "categories.electronics" },
  { value: "appliance", labelKey: "categories.appliance" },
  { value: "3c", labelKey: "categories.3c" },
  { value: "toy", labelKey: "categories.toy" },
  { value: "home", labelKey: "categories.home" },
  { value: "other", labelKey: "categories.other" },
];

const MARKETS: { value: Market; labelKey: string }[] = [
  { value: "EU", labelKey: "markets.EU" },
  { value: "US", labelKey: "markets.US" },
  { value: "UK", labelKey: "markets.UK" },
  { value: "CN", labelKey: "markets.CN" },
  { value: "AU", labelKey: "markets.AU" },
  { value: "SA", labelKey: "markets.SA" },
  { value: "AE", labelKey: "markets.AE" },
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
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  if (!url) return null;

  return (
    <div className="relative flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3">
      <Image
        src={url}
        alt={file.name}
        width={64}
        height={64}
        className="h-16 w-16 shrink-0 rounded-lg object-cover"
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
  const { t } = useTranslation();
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
      setLocalError(t("upload.notSupportedImageFormat", { count: raw.length - valid.length }));
    } else {
      setLocalError(null);
    }

    setImages((prev) => [...prev, ...valid].slice(0, 8));
  }

  function handleDocumentChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = Array.from(event.target.files ?? []);
    const valid = raw.filter((f) => ACCEPTED_DOCUMENT_TYPES.includes(f.type));

    if (raw.length > valid.length) {
      setLocalError(t("upload.notSupportedDocFormat", { count: raw.length - valid.length }));
    } else {
      setLocalError(null);
    }

    setDocuments((prev) => [...prev, ...valid].slice(0, 5));
  }

  async function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!images.length) {
      setLocalError(t("upload.selectAtLeastOneImageError"));
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
          <label className="text-sm font-medium">{t("upload.productImages")}</label>
          <span className="text-xs text-muted-foreground">
            {t("upload.productImagesCount", { count: images.length })}
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
              {t("upload.clearAllImages")}
            </button>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 border-t border-border" />
        <span className="text-xs text-muted-foreground">{t("upload.optional")} · {t("upload.supportedFormats")}</span>
        <div className="h-px flex-1 border-t border-border" />
      </div>

      {/* Documents section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">{t("upload.productDocs")}</label>
          <span className="text-xs text-muted-foreground">
            {t("upload.productDocsCount", { count: documents.length })}
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
              {t("upload.clearAllDocs")}
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
          ? t("upload.selectAtLeastOneImage")
          : t("upload.selectedFiles", { imageCount: images.length, docCount: documents.length })}
      </div>

      {/* Category & Markets selectors */}
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium">{t("upload.targetMarket")}</label>
          <div className="flex flex-wrap gap-2">
            {MARKETS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() =>
                  setSelectedMarkets((prev) =>
                    prev.includes(m.value)
                      ? prev.length > 1
                        ? prev.filter((x) => x !== m.value)
                        : prev
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
                {t(m.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium">{t("upload.productCategory")}</label>
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
                {t(c.labelKey)}
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
        {isSubmitting ? t("common.loading") : t("upload.submitAndScan")}
      </Button>
    </form>
  );
}
