/**
 * lib/report-export-modules/inspection-annex.ts
 *
 * Plan 2026-09-14 §4.5 — J06 导出部分：「图像证据附录」。
 *
 * The plain compliance-report PDF (compliance.ts) carried score / markdown /
 * evidence tables but NO image annotations — the on-screen hotspot experience
 * (original photo + numbered bbox + per-observation status) was completely
 * missing from the downloadable artifact. This module appends an
 * 「图像证据附录」 section at the end of that PDF:
 *
 *   - one sub-section per vm.images entry: fetches the asset bytes via the
 *     session-authenticated BFF route (`/api/scan/{id}/asset/{n}`, which
 *     requires the session Bearer token — mirrors evidence-api.ts /
 *     readStoredAccessToken's `scan-token:{id}` sessionStorage key), draws the
 *     image with jsPDF `addImage`, then overlays every located anchor from
 *     `vm.anchorsByImage[imageId]` (normalized bbox × display size) with a
 *     red rectangle + finding number + short title (NotoSansSC 8pt).
 *   - findings WITHOUT a region (document gaps, ungrounded observations)
 *     never get a box; they are listed as compact textual supplement cards.
 *   - closes with a coverage table (vm.checks: business title / best
 *     visibility / finding status) and the explicit disclaimer that
 *     「本图未见异常 ≠ 全面合规」 (a clean photo is not a compliance verdict).
 *
 * Failure discipline (plan §4.5: 导出前的数据校验 / 缺失明确披露):
 *   - image fetch failure → draw 「图片 N 加载失败」 note, continue the export;
 *   - webp (and any format jsPDF cannot embed) → skip with a note, never abort;
 *   - a VM with no findings AND no observations (demo / legacy sessions) →
 *     the whole annex is skipped by the caller without error.
 *
 * All layout goes through the shared NotoSansSC layer (same fonts and
 * pdfSectionTitle/pdfDrawTable helpers as the rest of the report) so the
 * appendix cannot drift back to the mojibake Helvetica path (J06 root cause).
 */
import type { jsPDF } from "jspdf";
import type { InspectionResultVM, LocatedAnchorVM } from "@/lib/result/inspection-view-model";
import { pdfDrawTable, pdfSectionTitle, yieldToMainThread, type Locale } from "./shared";

export interface InspectionAnnexOptions {
  /** Session id — used to read the access token when `accessToken` is absent. */
  sessionId: string;
  /** Session bearer token; falls back to sessionStorage `scan-token:{id}`. */
  accessToken?: string | null;
  locale?: Locale;
  /** Page layout overrides (defaults match compliance.ts: mm / a4 / 20). */
  margin?: number;
}

// ── i18n strings (module-local; the report exports deliberately carry their
// own zh/en pairs instead of growing the global i18n dictionary). ───────────

interface AnnexStrings {
  sectionTitle: string;
  imageLabel: (index: number, fileName: string) => string;
  unsupportedFormat: (index: number) => string;
  loadFailed: (index: number) => string;
  ungroundedTitle: string;
  ungroundedItem: (index: number, title: string, status: string) => string;
  coverageTitle: string;
  coverageHeader: string[];
  coverageRow: (title: string, visibility: string, status: string) => string[];
  disclaimerTitle: string;
  disclaimerBody: string;
}

const STRINGS: Record<Locale, AnnexStrings> = {
  zh: {
    sectionTitle: "图像证据附录",
    imageLabel: (index, fileName) => `图 ${index}${fileName ? `（${fileName}）` : ""}`,
    unsupportedFormat: (index) => `图 ${index} 格式暂不支持嵌入（webp 等），已跳过`,
    loadFailed: (index) => `图 ${index} 加载失败`,
    ungroundedTitle: "无定位观察项（文档缺口 / 补证卡）",
    ungroundedItem: (index, title, status) => `${index}. ${title} — ${status}`,
    coverageTitle: "检查覆盖表",
    coverageHeader: ["检查项", "最佳可见性", "状态"],
    coverageRow: (title, visibility, status) => [title, visibility, status],
    disclaimerTitle: "附注：本图未见异常 ≠ 全面合规",
    disclaimerBody:
      "本附录仅呈现扫描时上传照片中可见的观察项与定位。未见异常仅表示本次照片中未发现相应问题，不构成全面合规结论；未覆盖、遮挡或不可读的项目请参见检查覆盖表与补证要求。",
  },
  en: {
    sectionTitle: "Image Evidence Annex",
    imageLabel: (index, fileName) => `Image ${index}${fileName ? ` (${fileName})` : ""}`,
    unsupportedFormat: (index) => `Image ${index} uses an unsupported embed format (e.g. webp); skipped`,
    loadFailed: (index) => `Image ${index} failed to load`,
    ungroundedTitle: "Unlocated observations (document gaps / evidence requests)",
    ungroundedItem: (index, title, status) => `${index}. ${title} — ${status}`,
    coverageTitle: "Inspection Coverage",
    coverageHeader: ["Check", "Best visibility", "Status"],
    coverageRow: (title, visibility, status) => [title, visibility, status],
    disclaimerTitle: "Note: no issue observed in a photo ≠ full compliance",
    disclaimerBody:
      "This annex only shows observations visible in the photos uploaded for this scan. An area with no observed issue means exactly that — it is not a compliance verdict. Uncovered, occluded, or unreadable items are tracked in the coverage table and the evidence requests.",
  },
};

const VISIBILITY_LABELS: Record<Locale, Record<string, string>> = {
  zh: {
    present_readable: "可读且可见",
    present_unreadable: "可见但不可读",
    not_in_view: "不在拍摄范围",
    occluded: "被遮挡",
    absent_in_visible_scope: "可见范围内缺失",
    not_assessed: "未评估",
  },
  en: {
    present_readable: "Present & readable",
    present_unreadable: "Present, unreadable",
    not_in_view: "Not in view",
    occluded: "Occluded",
    absent_in_visible_scope: "Absent in visible scope",
    not_assessed: "Not assessed",
  },
};

const ASSESSMENT_LABELS: Record<Locale, Record<string, string>> = {
  zh: {
    suspected_issue: "疑似问题",
    evidence_needed: "待资料",
    confirmed_issue: "确认问题",
  },
  en: {
    suspected_issue: "Suspected issue",
    evidence_needed: "Evidence needed",
    confirmed_issue: "Confirmed issue",
  },
};

function visibilityLabel(visibility: string | undefined, locale: Locale): string {
  return VISIBILITY_LABELS[locale][visibility ?? ""] ?? (locale === "zh" ? "未评估" : "Not assessed");
}

function assessmentLabel(assessment: string | null | undefined, locale: Locale): string {
  return ASSESSMENT_LABELS[locale][assessment ?? ""] ?? (locale === "zh" ? "观察记录" : "Observation");
}

// ── asset loading ───────────────────────────────────────────────────────────

/** Read the session bearer token from sessionStorage (`scan-token:{id}`). */
export function readAnnexAccessToken(sessionId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(`scan-token:${sessionId}`);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Formats jsPDF's addImage can embed. webp/gif are NOT supported by jsPDF. */
const EMBEDDABLE_FORMATS = new Set(["png", "jpeg", "jpg"]);

/** Guess the embeddable format from magic bytes / content-type / name hints. */
function imageFormatFrom(dataUrl: string, hints: string[]): ImageFormatGuess {
  const all = [dataUrl, ...hints].join(" ").toLowerCase();
  // Magic bytes survive the base64 round-trip at fixed offsets:
  //   PNG  → iVBORw0KGgo (8-byte PNG signature)
  //   JPEG → /9j/ (FF D8 FF)
  if (dataUrl.includes("iVBORw0KGgo")) return "png";
  if (dataUrl.includes("/9j/")) return "jpeg";
  if (all.includes("image/webp") || all.includes(".webp")) return "webp";
  if (all.includes("image/png") || all.includes(".png")) return "png";
  if (all.includes("image/jpeg") || all.includes(".jpg") || all.includes(".jpeg")) return "jpeg";
  if (all.includes("image/gif") || all.includes(".gif")) return "gif";
  return "unknown";
}

type ImageFormatGuess = "png" | "jpeg" | "jpg" | "webp" | "gif" | "unknown";

/**
 * The result of probing one asset BEFORE embedding: either an embeddable
 * dataURL, or the reason it cannot be embedded (unsupported format / fetch
 * failure). The caller maps each reason to an explicit disclosure note.
 */
type ImageFetchResult =
  | { kind: "ok"; dataUrl: string; format: "png" | "jpeg" | "jpg" }
  | { kind: "unsupported"; format: ImageFormatGuess }
  | { kind: "failed" };

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Fetch one image asset as a jsPDF-ready dataURL. Failures are typed (never
 * thrown) so the annex can render an explicit note per image instead of
 * aborting the whole export (plan §4.5: 缺失要明确披露).
 */
async function fetchImageAsset(
  url: string,
  sessionId: string,
  accessToken: string | null,
  hints: string[],
): Promise<ImageFetchResult> {
  try {
    const headers: Record<string, string> = {};
    const token = accessToken ?? readAnnexAccessToken(sessionId);
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, { headers });
    if (!response.ok) return { kind: "failed" };
    const contentType = String(response.headers?.get?.("content-type") ?? "").toLowerCase();
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) return { kind: "failed" };
    const dataUrl = `data:;base64,${base64FromBytes(new Uint8Array(buffer))}`;
    const format = imageFormatFrom(dataUrl, [contentType, ...hints]);
    if (!EMBEDDABLE_FORMATS.has(format)) {
      return { kind: "unsupported", format };
    }
    return { kind: "ok", dataUrl, format: format as "png" | "jpeg" | "jpg" };
  } catch {
    return { kind: "failed" };
  }
}

// ── layout ──────────────────────────────────────────────────────────────────

/** Max display height (mm) for one annex image; width fits content width. */
const IMAGE_MAX_HEIGHT = 130;

interface AnnexCursor {
  cur: number;
}

function ensureSpace(doc: jsPDF, y: AnnexCursor, margin: number, pageHeight: number, needed: number): void {
  if (y.cur + needed > pageHeight - margin) {
    doc.addPage();
    y.cur = margin;
  }
}

/** Numbered rect + label for one located anchor. */
function drawAnchor(
  doc: jsPDF,
  anchor: LocatedAnchorVM,
  anchorNumber: number,
  imageX: number,
  imageY: number,
  imageW: number,
  imageH: number,
): void {
  const rectX = imageX + anchor.bbox.x * imageW;
  const rectY = imageY + anchor.bbox.y * imageH;
  const rectW = Math.max(anchor.bbox.w * imageW, 2);
  const rectH = Math.max(anchor.bbox.h * imageH, 2);
  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(0.5);
  doc.rect(rectX, rectY, rectW, rectH);
  // Label: number + short title, 8pt NotoSansSC, kept above the box (or below
  // when the box hugs the top edge). Clamped so it stays inside the image.
  doc.setFont("NotoSansSC", "normal");
  doc.setFontSize(8);
  doc.setTextColor(220, 38, 38);
  const label = `${anchorNumber} ${anchor.shortTitle}`;
  const labelY = rectY >= imageY + 4 ? rectY - 1.2 : Math.min(rectY + rectH + 3, imageY + imageH - 1);
  doc.text(label, rectX, labelY);
}

// ── main entry ───────────────────────────────────────────────────────────────

/**
 * Append the 「图像证据附录」 to an in-progress compliance report PDF.
 *
 * Callers MUST already have run `embedFont(doc)` (the annex draws CJK labels
 * through the same NotoSansSC face). The cursor starts on a fresh page so the
 * annex never bleeds into the evidence tables above it.
 */
export async function appendInspectionAnnexToPdf(
  doc: jsPDF,
  vm: InspectionResultVM,
  opts: InspectionAnnexOptions,
): Promise<void> {
  const L = opts.locale ?? "zh";
  const strings = STRINGS[L];
  const margin = opts.margin ?? 20;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const y: AnnexCursor = { cur: margin };

  doc.addPage();
  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, strings.sectionTitle);

  // Anchor numbering follows the finding list order so appendix numbers match
  // the on-screen hotspot labels (plan §4.3: same VM drives list + image).
  const anchorNumbers = new Map<string, number>();
  vm.findings.forEach((finding, index) => {
    for (const anchor of finding.locatedAnchors) {
      anchorNumbers.set(anchor.observationId, index + 1);
    }
  });
  const locatedObservationIds = new Set(anchorNumbers.keys());

  // ── Per-image plates ────────────────────────────────────────────────────
  for (let imageIndex = 0; imageIndex < vm.images.length; imageIndex++) {
    const image = vm.images[imageIndex];
    if (!image?.url) continue;
    await yieldToMainThread();

    const imageLabel = strings.imageLabel(imageIndex + 1, image.fileName);
    ensureSpace(doc, y, margin, pageHeight, 18);
    doc.setFont("NotoSansSC", "bold");
    doc.setFontSize(9);
    doc.setTextColor(31, 41, 55);
    doc.text(imageLabel, margin, y.cur);
    y.cur += 4;

    const anchors = vm.anchorsByImage[image.imageId] ?? [];
    const fetched = await fetchImageAsset(image.url, opts.sessionId, opts.accessToken ?? null, [
      image.fileName,
      image.url,
    ]);

    if (fetched.kind !== "ok") {
      // Honest disclosure instead of a silently missing plate (plan §4.5).
      const note =
        fetched.kind === "unsupported"
          ? strings.unsupportedFormat(imageIndex + 1)
          : strings.loadFailed(imageIndex + 1);
      ensureSpace(doc, y, margin, pageHeight, 12);
      doc.setFont("NotoSansSC", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(120, 113, 108);
      doc.text(note, margin + 4, y.cur);
      y.cur += 10;
      continue;
    }

    // Draw the image fitted into the content box, then overlay anchors.
    const contentW = pageWidth - margin * 2;
    const drawH = Math.min(IMAGE_MAX_HEIGHT, pageHeight - margin * 2 - 30);
    ensureSpace(doc, y, margin, pageHeight, drawH + 6);
    doc.addImage(fetched.dataUrl, fetched.format, margin, y.cur, contentW, drawH);
    for (const anchor of anchors) {
      const number = anchorNumbers.get(anchor.observationId);
      if (number === undefined) {
        // Observation-only anchor (no finding): neutral gray box, no number.
        doc.setDrawColor(100, 116, 139);
        doc.setLineWidth(0.4);
        doc.rect(
          margin + anchor.bbox.x * contentW,
          y.cur + anchor.bbox.y * drawH,
          Math.max(anchor.bbox.w * contentW, 2),
          Math.max(anchor.bbox.h * drawH, 2),
        );
        continue;
      }
      drawAnchor(doc, anchor, number, margin, y.cur, contentW, drawH);
    }
    y.cur += drawH + 6;
  }

  // ── Unlocated findings → compact text cards ─────────────────────────────
  const unlocated = vm.findings.filter(
    (finding) => !finding.observations.some((observation) => locatedObservationIds.has(observation.observationId)),
  );
  if (unlocated.length > 0) {
    await yieldToMainThread();
    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, strings.ungroundedTitle);
    doc.setFont("NotoSansSC", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    unlocated.forEach((finding, index) => {
      ensureSpace(doc, y, margin, pageHeight, 6);
      doc.text(
        strings.ungroundedItem(index + 1, finding.title, assessmentLabel(finding.assessment, L)),
        margin,
        y.cur,
      );
      y.cur += 5;
    });
    y.cur += 3;
  }

  // ── Coverage table ──────────────────────────────────────────────────────
  if (vm.checks.length > 0) {
    await yieldToMainThread();
    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, strings.coverageTitle);
    const rows: string[][] = [
      strings.coverageHeader,
      ...vm.checks.map((check) =>
        strings.coverageRow(
          check.title,
          check.bestObservation
            ? visibilityLabel(check.bestObservation.visibility, L)
            : L === "zh"
              ? "未观察"
              : "Not observed",
          check.findings.length > 0
            ? check.findings.map((finding) => assessmentLabel(finding.assessment, L)).join("、")
            : L === "zh"
              ? "未见异常"
              : "No issue",
        ),
      ),
    ];
    pdfDrawTable(doc, y, margin, pageWidth, pageHeight, rows, [64, 46, 40]);
  }

  // ── Disclaimer ───────────────────────────────────────────────────────────
  ensureSpace(doc, y, margin, pageHeight, 24);
  doc.setFont("NotoSansSC", "bold");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text(strings.disclaimerTitle, margin, y.cur);
  y.cur += 5;
  doc.setFont("NotoSansSC", "normal");
  doc.setFontSize(8.5);
  const disclaimerLines: string[] =
    doc.splitTextToSize?.(strings.disclaimerBody, pageWidth - margin * 2) ?? [strings.disclaimerBody];
  for (const line of disclaimerLines) {
    ensureSpace(doc, y, margin, pageHeight, 6);
    doc.text(line, margin, y.cur);
    y.cur += 4.5;
  }
}
