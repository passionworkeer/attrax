"use client";

import { useMemo } from "react";
import type { InspectionFinding, InspectionObservation } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Plan 2026-09-13 §5 + §8 — the per-check inspection checklist.
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
  ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  reshoot: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  confirm: "border-white/15 bg-white/[0.06] text-white/62",
};

function checkTitleFromId(checkId: string): string {
  // "common.nameplate.readability" → "铭牌/标签信息可读性" is available
  // server-side only; on the client we humanize the trailing segment.
  const segment = checkId.split(".").slice(-1)[0] ?? checkId;
  return segment
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function InspectionChecklistPanel({
  observations,
  selectedCheckIds,
  findings,
  locale,
  onCheckClick,
  activeImageId,
}: {
  observations: InspectionObservation[];
  selectedCheckIds?: string[];
  findings?: InspectionFinding[];
  locale: "zh" | "en";
  onCheckClick?: (observation: InspectionObservation) => void;
  activeImageId?: string | null;
}) {
  const rows = useMemo(() => {
    // Best observation per check: prefer ones on the displayed image, then
    // by informativeness (readable beats missing).
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
    return [...byCheck.values()].sort((a, b) => priority(a) - priority(b));
  }, [observations, selectedCheckIds, activeImageId]);

  if (rows.length === 0) return null;

  const counts = {
    ok: rows.filter((row) => VISIBILITY_LABELS[row.visibility]?.tone === "ok").length,
    reshoot: rows.filter((row) => VISIBILITY_LABELS[row.visibility]?.tone === "reshoot").length,
    confirm: rows.filter((row) => VISIBILITY_LABELS[row.visibility]?.tone === "confirm").length,
  };

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
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-emerald-200">
            {locale === "zh" ? "已观察" : "Observed"} {counts.ok}
          </span>
          <span className="rounded-full border border-amber-400/35 bg-amber-400/10 px-2.5 py-1 text-amber-200">
            {locale === "zh" ? "待补拍" : "Reshoot"} {counts.reshoot}
          </span>
          <span className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-white/62">
            {locale === "zh" ? "待确认" : "Confirm"} {counts.confirm}
          </span>
        </div>
      </div>

      <ul className="mt-5 space-y-2">
        {rows.map((row) => {
          const meta = VISIBILITY_LABELS[row.visibility] ?? VISIBILITY_LABELS.not_assessed;
          const hasRegion = !!row.region?.bbox;
          return (
            <li key={row.checkId}>
              <button
                type="button"
                onClick={hasRegion ? () => onCheckClick?.(row) : undefined}
                disabled={!hasRegion}
                className={cn(
                  "flex w-full items-start justify-between gap-3 rounded-[16px] border px-4 py-3 text-left transition",
                  hasRegion
                    ? "border-white/10 bg-white/[0.045] hover:border-white/25 hover:bg-white/[0.07]"
                    : "cursor-default border-white/8 bg-white/[0.03]",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs text-white/48">{row.checkId}</span>
                  <span className="mt-1 block text-sm font-medium text-white">
                    {checkTitleFromId(row.checkId)}
                  </span>
                  {row.observedText ? (
                    <span className="mt-1 block truncate text-xs text-white/55">
                      {locale === "zh" ? "读到：" : "Read: "}
                      {row.observedText}
                    </span>
                  ) : row.description ? (
                    <span className="mt-1 block truncate text-xs text-white/55">{row.description}</span>
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
            </li>
          );
        })}
      </ul>

      {/* Plan §10.3 — 确定性的待补清单: findings carry the concrete
          reshoot / material actions, built server-side from the same
          observations (never by the LLM). */}
      {findings && findings.length > 0 ? (
        <div className="mt-6 border-t border-white/10 pt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/42">
            {locale === "zh"
              ? `待补拍 / 待补资料（${findings.length} 项）`
              : `Actions needed (${findings.length})`}
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {findings.map((finding) => (
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
                      finding.assessment === "suspected_issue"
                        ? "border-amber-400/35 bg-amber-400/10 text-amber-200"
                        : "border-sky-400/30 bg-sky-400/10 text-sky-200",
                    )}
                  >
                    {finding.assessment === "suspected_issue"
                      ? locale === "zh" ? "疑点" : "suspected"
                      : locale === "zh" ? "待证据" : "evidence"}
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
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
