"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ComplianceTimeline from "@/components/trace/ComplianceTimeline";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { unwrapApiData } from "@/lib/api-response";
import { useTranslation } from "@/lib/i18n";
import { useSessionId } from "@/lib/hooks/useSessionId";
import { getDefaultRoadmapItems, type RoadmapItem } from "@/lib/mock/roadmap";

interface RoadmapData {
  product?: string;
  totalDays?: number;
  totalCost?: string;
  progress?: number;
  items?: RoadmapItem[];
}

/**
 * Dynamic `/roadmap/[sessionId]` route. CLAUDE.md advertises this URL shape
 * but the project previously only had `/roadmap?sessionId=…`. This page keeps
 * that query form working (it still falls through `useSessionId`) while also
 * accepting the path segment directly via `params.sessionId`.
 *
 * Rendering logic mirrors `app/roadmap/page.tsx` — kept inline rather than
 * extracted into a shared component because that extraction would touch
 * `components/` (out of this agent's scope). If a future pass pulls a
 * `RoadmapView` into a shared module, both routes should converge on it.
 */
export default function RoadmapSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="rounded-2xl border border-white/60 bg-white/85 px-6 py-4 text-muted-foreground shadow-sm backdrop-blur animate-pulse">
            Loading…
          </div>
        </div>
      }
    >
      <RoadmapSessionPageInner params={params} />
    </Suspense>
  );
}

function RoadmapSessionPageInner({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const router = useRouter();
  const { t, locale } = useTranslation();

  // Unwrap the params Promise (Next.js 15+: dynamic params are async). The
  // resolved sessionId is fed into useSessionId so the hook's existing
  // query→param→storage precedence still works (a `?sessionId=` query, if
  // present, wins over the path segment — matching the documented behavior).
  const [paramSessionId, setParamSessionId] = useState<string>("");
  useEffect(() => {
    params.then((p) => setParamSessionId(p.sessionId));
  }, [params]);

  const sessionId = useSessionId(paramSessionId);

  const [loading, setLoading] = useState(true);
  const [roadmapData, setRoadmapData] = useState<RoadmapData | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    if (sessionId === "demo") {
      setLoading(false);
      return;
    }

    const token = sessionStorage.getItem(`scan-token:${sessionId}`);
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

    let cancelled = false;

    // Fetch real roadmap data from the API
    fetch(`/api/roadmap/${sessionId}`, { cache: "no-store", headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((rawData) => {
        if (cancelled) return;
        const data = unwrapApiData<{ items?: RoadmapItem[] }>(rawData);
        if (data?.items) {
          setRoadmapData(data);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    // Prefetch scan result into sessionStorage for the result page
    fetch(`/api/scan/${sessionId}`, { cache: "no-store", headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((rawPayload) => {
        if (cancelled) return;
        const payload = unwrapApiData<{ result?: unknown }>(rawPayload);
        if (payload?.result) {
          sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(payload.result));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleBack = () => {
    if (sessionId) {
      router.push(`/result/${sessionId}`);
    } else {
      router.push("/upload");
    }
  };

  const hasRealRoadmap = Boolean(roadmapData?.items?.length);

  const totalDays = roadmapData?.totalDays ?? 63;
  const totalCost = roadmapData?.totalCost ?? "¥20K+";
  const progress = roadmapData?.progress ?? 14;
  const steps = roadmapData?.items?.length ?? 7;

  const items = roadmapData?.items ?? getDefaultRoadmapItems();

  if (sessionId && sessionId !== "demo" && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="rounded-2xl border border-white/60 bg-white/85 px-6 py-4 text-muted-foreground shadow-sm backdrop-blur animate-pulse">
          {t("roadmap.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Back Button */}
      <div className="max-w-6xl mx-auto px-6 pt-8">
        <button
          onClick={handleBack}
          className={cn(buttonVariants({ variant: "ghost", size: "default" }), "text-muted-foreground hover:text-foreground")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          {t("roadmap.backToResult")}
        </button>
      </div>

      {/* Hero Header */}
      <div className="mx-6 mt-6 glass-panel rounded-3xl p-8 shadow-[0_30px_120px_rgba(0,0,0,0.5)]">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="label-caps text-xs text-blaze-red/80">
                Compliance Roadmap
              </p>
              <div className="mt-3 flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blaze-red to-blaze-orange shadow-[0_0_20px_rgba(217,58,26,0.5)]">
                  <span className="text-lg font-bold text-white">RM</span>
                </div>
                <div className="min-w-0 flex items-center gap-3">
                  <h1 className="text-3xl font-bold tracking-tight text-white max-sm:text-2xl">{t("roadmap.title")}</h1>
                  {!hasRealRoadmap && (
                    <span className="inline-flex items-center rounded-full border border-blaze-cyan/40 bg-blaze-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blaze-cyan">
                      Demo
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-1 text-sm text-slate-400">{t("roadmap.subtitle")}</p>
            </div>

            {/* Stats */}
            <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4 lg:w-auto lg:flex lg:items-center lg:gap-4">
              <div className="min-w-0 text-center rounded-2xl border border-white/10 bg-slate-900/50 px-3 py-3 shadow-sm backdrop-blur sm:px-5">
                <div className="text-2xl font-black text-blaze-red">{totalDays}</div>
                <div className="text-xs text-slate-400">{t("roadmap.totalDays")}</div>
              </div>
              <div className="min-w-0 text-center rounded-2xl border border-white/10 bg-slate-900/50 px-3 py-3 shadow-sm backdrop-blur sm:px-5">
                <div className="text-lg font-black text-blaze-red">{totalCost}</div>
                <div className="text-xs text-slate-400">{t("roadmap.estimatedCost")}</div>
              </div>
              <div className="min-w-0 text-center rounded-2xl border border-white/10 bg-slate-900/50 px-3 py-3 shadow-sm backdrop-blur sm:px-5">
                <div className="text-2xl font-black text-blaze-red">{steps}</div>
                <div className="text-xs text-slate-400">{t("roadmap.stepsCount")}</div>
              </div>
              <div className="min-w-0 text-center rounded-2xl border border-white/10 bg-slate-900/50 px-3 py-3 shadow-sm backdrop-blur sm:px-5">
                <div className="text-2xl font-black text-blaze-red">{progress}%</div>
                <div className="text-xs text-slate-400">{t("roadmap.progress")}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-12">
        <ComplianceTimeline locale={locale} autoPlay={false} items={items} />
      </div>
    </div>
  );
}
