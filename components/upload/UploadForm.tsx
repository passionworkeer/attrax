"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import type { Market as ScanMarket, ProductCategory } from "@/lib/types";

// Module-level cache shared across all LocalImageCarousel instances on the
// page. Object URLs are keyed by stable file identity (name+size+lastModified)
// so appending a file does NOT revoke-and-recreate URLs for existing files
// (which previously caused image flicker). Lives outside the component so it
// is not a React ref (avoids the React 19 ref-during-render lint).
const urlCache = new Map<string, string>();

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

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

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

interface ImageCarouselProps {
  files: File[];
}

/**
 * Local File carousel (upload page). Renamed internally to avoid name clash
 * with the result-page ImageCarousel. Object URLs are keyed by stable file
 * identity (name + size + lastModified) so that adding a single new file does
 * not revoke-and-recreate URLs for previously-added files (which causes flicker).
 */
function LocalImageCarousel({ files }: ImageCarouselProps) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);

  const keys = useMemo(
    () => files.map((f) => `${f.name}|${f.size}|${f.lastModified}`),
    [files],
  );

  const urls = useMemo(
    () =>
      keys.map((key, i) => {
        const existing = urlCache.get(key);
        if (existing) return existing;
        const url = URL.createObjectURL(files[i]);
        urlCache.set(key, url);
        return url;
      }),
    [files, keys],
  );

  // External-system cleanup: revoke any URL whose file identity has disappeared
  // from `files`, and revoke everything on full unmount. The browser blob URL
  // registry is an external system, so this is the canonical use of an effect.
  useEffect(() => {
    const liveKeys = new Set(keys);
    for (const [key, url] of urlCache) {
      if (!liveKeys.has(key)) {
        URL.revokeObjectURL(url);
        urlCache.delete(key);
      }
    }
    return () => {
      // Only on unmount: clear every URL this carousel ever produced.
      urlCache.forEach((url) => URL.revokeObjectURL(url));
      urlCache.clear();
    };
  }, [keys]);

  // Derive clamped index in render instead of a setState-in-effect.
  const safeCurrent = current > files.length - 1 ? Math.max(0, files.length - 1) : current;

  const prev = useCallback(() => setCurrent((c) => (c > 0 ? c - 1 : files.length - 1)), [files.length]);
  const next = useCallback(() => setCurrent((c) => (c < files.length - 1 ? c + 1 : 0)), [files.length]);

  // Arrow-key handlers are mounted globally but suppressed whenever an
  // interactive element (input/select/menu/tab/cell) is focused, so the upload
  // page's category/market chip buttons and form inputs keep their keyboard
  // behavior.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const active = document.activeElement as Element | null;
      if (
        active &&
        active.closest(
          'input, textarea, select, [contenteditable="true"], [contenteditable=""], button, [role="menuitem"], [role="menuitemradio"], [role="tab"]',
        )
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next]);

  if (files.length === 0) return null;
  const currentIndex = Math.min(safeCurrent, files.length - 1);
  const currentFile = files[currentIndex];
  const currentUrl = urls[currentIndex];
  if (!currentFile || !currentUrl) return null;

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={t("upload.productImages")}
      className="space-y-3"
    >
      {/* Main view */}
      <div className="relative rounded-2xl border border-border bg-muted/30 overflow-hidden">
        <div className="relative aspect-[4/3] w-full">
          <Image
            src={currentUrl}
            alt={currentFile.name}
            fill
            className="object-contain"
          />
          {/* Risk region placeholder overlay */}
          <div className="absolute inset-0 pointer-events-none" />
        </div>
        <div className="border-t border-border bg-blaze-surface px-4 py-3">
          <p className="truncate text-sm font-medium">{currentFile.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(currentFile.size)}</p>
        </div>
        {/* Prev / Next */}
        {files.length > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors"
              aria-label={t("upload.prevImage")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={next}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors"
              aria-label={t("upload.nextImage")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </>
        )}
        {/* Index badge */}
        <div className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
          {currentIndex + 1} / {files.length}
        </div>
      </div>

      {/* Thumbnail strip */}
      {files.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {files.map((file, i) => (
            <button
              key={file.name}
              type="button"
              onClick={() => setCurrent(i)}
              className={cn(
                "relative shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                i === currentIndex ? "border-blaze-red" : "border-transparent opacity-60 hover:opacity-80"
              )}
            >
              <Image src={urls[i]} alt={file.name} title={file.name} width={64} height={64} className="h-16 w-16 object-cover" />
              {i !== currentIndex ? <span className="sr-only">{file.name}</span> : null}
            </button>
          ))}
        </div>
      )}
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
          <div className="space-y-3">
            <LocalImageCarousel files={images} />
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
