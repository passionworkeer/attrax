"use client";

/**
 * CitationChip — clickable per-claim citation shown alongside the
 * compliance text. Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md
 * §7.5 step 2.
 *
 * Each chip represents one CitationRef (spec §3.3): a (doc_id,
 * article_id) pair, a short label, and a match_status icon. Clicking
 * the chip navigates to the document viewer at
 * `/regulations/{doc_id}#art-{article_id}` with an `hl` query param
 * carrying the matched (start, end) span so the viewer can wrap the
 * highlighted text with `<mark>`.
 */
import Link from "next/link";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

export type CitationMatchStatus =
  | "matched"
  | "fallback_article_only"
  | "unmatched";

export interface CitationRefContract {
  doc_id: string;
  article_id: string;
  official_citation?: string;
  quote?: string;
  quote_span?: [number, number] | null;
  match_status?: CitationMatchStatus | null;
}

const STATUS_META: Record<
  CitationMatchStatus,
  { icon: string; tone: string; ariaKey: string }
> = {
  matched: {
    icon: "✓",
    tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    ariaKey: "matched",
  },
  fallback_article_only: {
    icon: "⚠",
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    ariaKey: "fallbackArticle",
  },
  unmatched: {
    icon: "✗",
    tone: "border-blaze-red/40 bg-blaze-red/10 text-blaze-red",
    ariaKey: "unmatched",
  },
};

export interface CitationChipProps {
  citation: CitationRefContract;
  /** Show the full quote text underneath the chip label. */
  showQuote?: boolean;
  className?: string;
}

export function CitationChip({ citation, showQuote = true, className }: CitationChipProps) {
  const status = (citation.match_status ?? "matched") as CitationMatchStatus;
  const meta = STATUS_META[status];

  // The viewer reads the article + scroll target from the URL hash +
  // ?hl= param (spec §4.4). quote_span is only meaningful when
  // status === matched — for other states we drop the hl param so the
  // viewer scrolls to the article without trying to highlight.
  const href = useMemo(() => {
    const params = new URLSearchParams();
    if (status === "matched" && citation.quote_span) {
      const [start, end] = citation.quote_span;
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        params.set("hl", `${start},${end}`);
      }
    }
    const query = params.toString();
    return `/regulations/${encodeURIComponent(citation.doc_id)}#${encodeURIComponent(citation.article_id)}${query ? `?${query}` : ""}`;
  }, [citation.doc_id, citation.article_id, citation.quote_span, status]);

  return (
    <Link
      href={href}
      aria-label={`Citation ${citation.official_citation || citation.article_id} (${meta.ariaKey})`}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition",
        "hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blaze-cyan",
        meta.tone,
        className,
      )}
    >
      <span aria-hidden className="font-bold leading-none">
        {meta.icon}
      </span>
      <span className="font-mono text-[11px]">
        {citation.official_citation || `${citation.doc_id} ${citation.article_id}`}
      </span>
      {showQuote && citation.quote && (
        <span className="hidden max-w-0 truncate text-slate-300 transition-all group-hover:ml-1.5 group-hover:max-w-[18rem] group-hover:overflow-visible group-hover:whitespace-normal">
          “{citation.quote}”
        </span>
      )}
    </Link>
  );
}

/**
 * CitationsList — render a stack of chips. Used by the report page to
 * surface the citation panel next to the markdown body.
 */
export function CitationsList({
  citations,
  emptyHint,
  className,
}: {
  citations: CitationRefContract[] | undefined | null;
  emptyHint?: string;
  className?: string;
}) {
  if (!citations || citations.length === 0) {
    if (!emptyHint) return null;
    return (
      <p className="text-xs text-slate-500">{emptyHint}</p>
    );
  }
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {citations.map((c, i) => (
        <CitationChip key={`${c.doc_id}-${c.article_id}-${i}`} citation={c} />
      ))}
    </div>
  );
}