"use client";

import { useMemo, useState } from "react";
import { checkLabel } from "@/lib/result/check-labels";
import type { InspectionFinding, InspectionObservation } from "@/lib/types";
import type { CheckResultVM, FindingVM, InspectionResultVM } from "@/lib/result/inspection-view-model";
import { checkTitleFromId } from "@/lib/result/inspection-view-model";
import { cn } from "@/lib/utils";

/**
 * Plan 2026-09-13 §5 + §8 — the per-check inspection checklist.
 * Plan 2026-09-14 §4.3 (J03/J15) — the panel now consumes the unified
 * `InspectionResultVM` when provided. The legacy raw-props path stays as
 * the fallback so demo/legacy sessions keep rendering; both paths produce
 * the same row structure.
 *
 * Every selected check MUST show a result (真实问题可以是零个；未覆盖、
 * 看不清、需要材料检测也是有价值的结果). The panel groups checks into:
 *   - 已观察 (present_readable) — green
 *   - 待补拍 (present_unreadable / not_in_view / occluded) — amber, with
 *     the specific view the user should re-shoot
 *   - 待确认 (absent_in_visible_scope / not_assessed) — slate
 *
 * It deliberately does NOT render "通过/合格" for clean checks —
 * `present_readable` only means "this photo shows the region and the
 * text is legible", which is an observation, not a compliance verdict.
 *
 * J14: checkId 收进诊断详情 — rows display the business title first and
 * the technical checkId in a secondary mono line.
 */

const VISIBILITY_LABELS: Record<string, { zh: string; en: string; tone: "ok" | "reshoot" | "confirm" }> = {
  present_readable: { zh: "已观察", en: "Observed", tone: "ok" },
  present_unreadable: { zh: "待补拍 · 文字不可辨", en: "Reshoot · unreadable", tone: "reshoot" },
  not_in_view: { zh: "待补拍 · 未入镜", en: "Reshoot · not in view", tone: "reshoot" },
  occluded: { zh: "待补拍 · 被遮挡", en: "Reshoot · occluded", tone: "reshoot" },
  absent_in_visible_scope: { zh: "待确认 · 可见范围未检出", en: "Confirm · not found in view", tone: "confirm" },
  not_assessed: { zh: "未评估", en: "Not assessed", tone: "confirm" },
};

const TONE_STYLES: Record<"ok" | "reshoot" | "confirm", string> = {
  ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-800",
  reshoot: "border-amber-400/35 bg-amber-400/10 text-amber-800",
  confirm: "border-white/15 bg-white/[0.06] text-white/62",
};

/** Assessment chip for findings (suspected/confirmed/evidence-needed). */
const ASSESSMENT_LABELS: Record<string, { zh: string; en: string; tone: string }> = {
  suspected_issue: { zh: "疑点", en: "suspected", tone: "border-amber-400/35 bg-amber-400/10 text-amber-800" },
  confirmed_issue: { zh: "确定问题", en: "confirmed", tone: "border-red-400/45 bg-red-400/10 text-red-800" },
  evidence_needed: { zh: "待证据", en: "evidence", tone: "border-sky-400/30 bg-sky-400/10 text-sky-800" },
};

interface ChecklistRow {
  checkId: string;
  title: string;
  visibility: InspectionObservation["visibility"];
  observedText: string | null;
  description: string;
  hasRegion: boolean;
  /** observation to switch the image stage to when clicked */
  anchorObservation: InspectionObservation | null;
  findings: FindingVM[];
}

function rowFromVMCheck(check: CheckResultVM, activeImageId: string | null): ChecklistRow {
  // Anchor selection: prefer a located observation ON the displayed image,
  // then any located observation (switch image), else no anchor.
  const located = check.observations.filter(
    (observation) => observation.bbox !== null && observation.imageId !== "",
  );
  const onActive = activeImageId
    ? located.find((observation) => observation.imageId === activeImageId)
    : undefined;
  const anchor = onActive ?? located[0] ?? null;
  const best = check.bestObservation;
  // P0-3 (adversarial round 4, 2026-09-15): the old code promoted
  // hazard+zero-findings observations to `present_readable` whenever the
  // raw visibility was `not_in_view` or `absent_in_visible_scope`. That
  // turned unreadable hazard checks into green "已观察" badges — implying
  // compliance was proven when the photo could not support the judgment.
  // visibility is now passed through as-is; coverageOf() owns the hazard
  // promotion logic (and it only fires for `present_readable`).
  const visibility = best?.visibility ?? "not_assessed";

  return {
    checkId: check.checkId,
    title: check.title || checkTitleFromId(check.checkId),
    visibility,
    observedText: best?.observedText ?? null,
    description: best?.description ?? "",
    hasRegion: anchor !== null,
    anchorObservation: anchor
      ? ({
          observationId: anchor.observationId,
          checkId: anchor.checkId,
          imageId: anchor.imageId,
          visibility: anchor.visibility,
          observedText: anchor.observedText,
          description: anchor.description,
          region: anchor.bbox
            ? { kind: "bbox", coordinateSpace: "normalized_canonical_image" as const, bbox: anchor.bbox, verified: anchor.regionVerified }
            : null,
        } satisfies InspectionObservation)
      : null,
    findings: check.findings,
  };
}

function rowFromLegacy(
  observation: InspectionObservation,
  findings: FindingVM[],
): ChecklistRow {
  const hasRegion = !!observation.region?.bbox;
  return {
    checkId: observation.checkId,
    title: checkTitleFromId(observation.checkId),
    visibility: observation.visibility,
    observedText: observation.observedText ?? null,
    description: observation.description,
    hasRegion,
    anchorObservation: hasRegion ? observation : null,
    findings,
  };
}

/** Visibility rank shared by the VM and legacy row ordering (lower = more
 *  informative / displayed first). */
function rowVisibilityRank(row: { visibility: InspectionObservation["visibility"] }): number {
  return row.visibility === "present_readable" ? 0
    : row.visibility === "absent_in_visible_scope" ? 1
    : row.visibility === "present_unreadable" ? 2
    : row.visibility === "occluded" ? 3
    : row.visibility === "not_in_view" ? 4
    : 5;
}

/** Legacy-path row priority: displayed-image preference + visibility rank. */
function legacyRowPriority(
  row: ChecklistRow,
  activeImageId: string | null | undefined,
): number {
  const onActiveImage = !activeImageId || row.anchorObservation?.imageId === activeImageId;
  return (onActiveImage ? 0 : 10) + rowVisibilityRank(row);
}

export function InspectionChecklistPanel({
  observations,
  selectedCheckIds,
  findings,
  locale,
  onCheckClick,
  activeImageId,
  vm,
  selectedObservationId,
  showRequests = true,
  auditMode = false,
}: {
  showRequests?: boolean;
  auditMode?: boolean;
  observations: InspectionObservation[];
  selectedCheckIds?: string[];
  findings?: InspectionFinding[];
  locale: "zh" | "en";
  onCheckClick?: (observation: InspectionObservation) => void;
  activeImageId?: string | null;
  /**
   * Plan 2026-09-14 §4.3 — the unified result ViewModel. When provided the
   * panel renders from it (business titles, finding join, coverage states)
   * and the legacy props are ignored.
   */
  vm?: InspectionResultVM;
  /** Selection linkage: highlight the row whose observation is selected. */
  selectedObservationId?: string | null;
}) {
  const [filter, setFilter] = useState<"all" | "attention" | "observed">("attention");
  const rows = useMemo<ChecklistRow[]>(() => {
    if (vm) {
      return vm.checks
        .map((check) => rowFromVMCheck(check, activeImageId ?? null))
        .sort((a, b) => rowVisibilityRank(a) - rowVisibilityRank(b));
    }
    // Legacy path (demo sessions / older stored payloads without a VM):
    // best observation per check, prefer ones on the displayed image.
    const byCheck = new Map<string, InspectionObservation>();
    const priority = (obs: InspectionObservation) => {
      const onActiveImage = !activeImageId || obs.imageId === activeImageId;
      const rank = obs.visibility === "present_readable" ? 0
        : obs.visibility === "absent_in_visible_scope" ? 1
        : obs.visibility === "present_unreadable" ? 2
        : obs.visibility === "occluded" ? 3
        : obs.visibility === "not_in_view" ? 4
        : 5;
      return (onActiveImage ? 0 : 10) + rank;
    };
    for (const obs of observations) {
      const existing = byCheck.get(obs.checkId);
      if (!existing || priority(obs) < priority(existing)) {
        byCheck.set(obs.checkId, obs);
      }
    }
    // Checks selected but with no observation at all (shouldn't happen —
    // server backfills — but guard anyway).
    const seen = new Set(byCheck.keys());
    for (const checkId of selectedCheckIds ?? []) {
      if (!seen.has(checkId)) {
        byCheck.set(checkId, {
          observationId: `${checkId}-missing`,
          checkId,
          imageId: "",
          visibility: "not_assessed",
          observedText: null,
          description: "",
          region: null,
        });
      }
    }
    return [...byCheck.values()]
      .map((observation) => rowFromLegacy(observation, []))
      .sort((a, b) => legacyRowPriority(a, activeImageId) - legacyRowPriority(b, activeImageId));
  }, [vm, observations, selectedCheckIds, activeImageId]);

  // Findings for the bottom 待补拍/待补资料 block: prefer the VM findings
  // (real foreign-key expansion), else the raw legacy findings.
  const displayFindings: FindingVM[] | null = vm
    ? vm.findings.length > 0
      ? vm.findings
      : null
    : (findings && findings.length > 0
        ? findings.map((finding) => ({
            findingId: finding.findingId,
            checkId: finding.checkId,
            title: finding.title,
            assessment: finding.assessment,
            applicability: finding.applicability,
            severity: finding.severity,
            suggestedAction: finding.suggestedAction,
            requiredEvidence: finding.requiredEvidence,
            citationIds: finding.citationIds,
            observations: [],
            locatedAnchors: [],
          }))
        : null);

  if (rows.length === 0 && !displayFindings && !vm) return null;
  if (rows.length === 0 && !displayFindings) return null;

  const counts = {
    ok: rows.filter((row) => VISIBILITY_LABELS[row.visibility]?.tone === "ok").length,
    reshoot: rows.filter((row) => VISIBILITY_LABELS[row.visibility]?.tone === "reshoot").length,
    confirm: rows.filter((row) => VISIBILITY_LABELS[row.visibility]?.tone === "confirm").length,
  };

  const needsReview = (row: ChecklistRow) => row.visibility !== "present_readable" || row.findings.some(finding => finding.applicability !== "not_applicable");
  const reviewRows = auditMode ? [...rows].sort((a,b) => Number(needsReview(b)) - Number(needsReview(a))) : rows;
  const shownRows = !auditMode || filter === "all" ? reviewRows : reviewRows.filter(row => filter === "attention" ? needsReview(row) : !needsReview(row));
  return (
    <div data-testid="inspection-checklist-panel" className="blaze-panel p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/42">
            {locale === "zh" ? "检查清单" : "Inspection checklist"}
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">
            {locale === "zh" ? "按品类逐项检查结果" : "Per-check inspection results"}
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/52">
            {locale === "zh"
              ? "每项都有结果；「待补拍」与「待确认」不代表产品不合格，只说明当前照片无法支撑判断。"
              : "Every check has an outcome. Reshoot / confirm states mean the photos cannot support a judgment yet — not that the product fails."}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-emerald-800">
            {locale === "zh" ? "已观察" : "Observed"} {counts.ok}
          </span>
          <span className="rounded-full border border-amber-400/35 bg-amber-400/10 px-2.5 py-1 text-amber-800">
            {locale === "zh" ? "待补拍" : "Reshoot"} {counts.reshoot}
          </span>
          <span className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-white/62">
            {locale === "zh" ? "待确认" : "Confirm"} {counts.confirm}
          </span>
        </div>
      </div>

      {auditMode && <div className="mt-5 flex flex-wrap gap-2" aria-label={locale === "zh" ? "检查筛选" : "Filter checks"}>
        {(["attention", "all", "observed"] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={cn("min-h-10 rounded-xl border px-4 py-2 text-sm", filter === value ? "bg-[#174e68] !text-white border-[#174e68]" : "bg-white/40 text-[#315c70] border-white/60")}>{locale === "zh" ? (value === "attention" ? "优先复核" : value === "all" ? "全部检查" : "已观察 · 无疑点") : value} · {value === "all" ? rows.length : rows.filter(row => value === "attention" ? needsReview(row) : !needsReview(row)).length}</button>)}
      </div>}
      {auditMode && shownRows.length === 0 && <p className="mt-5 text-sm text-[#315c70]">{locale === "zh" ? "此分类暂无检查项，可切换查看全部检查。" : "No checks in this filter. View all checks."}</p>}
      <ul className="mt-5 space-y-2">
        {shownRows.map((row) => {
          const meta = VISIBILITY_LABELS[row.visibility] ?? VISIBILITY_LABELS.not_assessed;
          const isSelected = !!row.anchorObservation && row.anchorObservation.observationId === selectedObservationId;
          return (
            <li key={row.checkId}>
              <button
                type="button"
                onClick={row.anchorObservation ? () => onCheckClick?.(row.anchorObservation!) : undefined}
                disabled={!row.anchorObservation}
                data-check-id={row.checkId}
                className={cn(
                  "flex w-full items-start justify-between gap-3 rounded-[16px] border px-4 py-3 text-left transition",
                  row.anchorObservation
                    ? isSelected
                      ? "border-[rgba(94,234,222,0.55)] bg-[rgba(210,247,249,0.14)]"
                      : "border-white/10 bg-white/[0.045] hover:border-white/25 hover:bg-white/[0.07]"
                    : "cursor-default border-white/8 bg-white/[0.03]",
                )}
              >
                <span className="min-w-0">
                  {/* J14: business title first; the technical checkId moves to
                      the secondary mono line instead of being the headline. */}
                  <span className="block text-sm font-medium text-white">{checkLabel(row.checkId, locale, row.title)}</span>
                  {row.observedText ? (
                    <span className="mt-1 block break-words text-xs text-white/55">
                      {locale === "zh" ? "读到：" : "Read: "}
                      {row.observedText}
                    </span>
                  ) : row.description ? (
                    <span className="mt-1 block break-words text-xs text-white/55">{row.description}</span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    TONE_STYLES[meta.tone],
                  )}
                >
                  {locale === "zh" ? meta.zh : meta.en}
                </span>
              </button>
              {auditMode && row.findings.length > 0 && <div className="px-4 pb-3 space-y-2">{row.findings.map(finding => <p key={finding.findingId} className="text-xs leading-6 text-[#315c70]"><strong>{locale === "zh" ? (ASSESSMENT_LABELS[finding.assessment]?.zh ?? "待复核") : finding.assessment}：</strong>{finding.title}{finding.suggestedAction ? ` · ${finding.suggestedAction}` : ""}</p>)}</div>}
            </li>
          );
        })}
      </ul>

      {/* Plan §10.3 — 确定性的待补清单: findings carry the concrete
          reshoot / material actions, built server-side from the same
          observations (never by the LLM). J15: when the VM is provided the
          same block renders the MERGED evidence requests (plan §5.3) instead
          of a wall of near-duplicate cards. */}
      {showRequests && vm && vm.evidenceRequests.length > 0 ? (
        <div className="mt-6 border-t border-white/10 pt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/42">
            {locale === "zh"
              ? `补充证据（${vm.evidenceRequests.length} 项请求 · ${vm.findings.length} 项待办）`
              : `Evidence requests (${vm.evidenceRequests.length} · ${vm.findings.length} findings)`}
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="evidence-request-list">
            {vm.evidenceRequests.map((request) => (
              <li
                key={request.id}
                data-testid="evidence-request"
                className="rounded-[16px] border border-white/10 bg-white/[0.045] px-4 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-white">{request.title}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-[10px]",
                      request.type === "photo"
                        ? "border-amber-400/35 bg-amber-400/10 text-amber-800"
                        : "border-sky-400/30 bg-sky-400/10 text-sky-800",
                    )}
                  >
                    {request.type === "photo"
                      ? locale === "zh" ? "待补拍" : "photo"
                      : locale === "zh" ? "待补资料" : "document"}
                  </span>
                </div>
                {request.explanation ? (
                  <p className="mt-2 text-xs leading-5 text-white/62">{request.explanation}</p>
                ) : null}
                {request.resolvesCheckIds.length > 0 ? (
                  <p className="mt-2 font-mono text-[10px] text-white/38">
                    {locale === "zh"
                      ? `可补齐 ${request.resolvesCheckIds.length} 项检查`
                      : `resolves ${request.resolvesCheckIds.length} checks`}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : showRequests && displayFindings ? (
        <div className="mt-6 border-t border-white/10 pt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/42">
            {locale === "zh"
              ? `待补拍 / 待补资料（${displayFindings.length} 项）`
              : `Actions needed (${displayFindings.length})`}
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {displayFindings.map((finding) => {
              const assessment = ASSESSMENT_LABELS[finding.assessment] ?? ASSESSMENT_LABELS.evidence_needed;
              return (
                <li
                  key={finding.findingId}
                  data-testid="inspection-finding"
                  className="rounded-[16px] border border-white/10 bg-white/[0.045] px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-white">{finding.title}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[10px]",
                        assessment.tone,
                      )}
                    >
                      {locale === "zh" ? assessment.zh : assessment.en}
                    </span>
                  </div>
                  {finding.suggestedAction ? (
                    <p className="mt-2 text-xs leading-5 text-white/62">
                      {finding.suggestedAction}
                    </p>
                  ) : null}
                  {finding.requiredEvidence.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {finding.requiredEvidence.map((evidence) => (
                        <li key={evidence} className="text-[11px] text-white/48">
                          · {evidence}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {finding.citationIds.length > 0 ? (
                    <p className="mt-2 truncate font-mono text-[10px] text-white/38">
                      {finding.citationIds.join(" · ")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
