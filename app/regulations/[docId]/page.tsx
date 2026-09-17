/**
 * app/regulations/[docId]/page.tsx — Document viewer for one entry in
 * the regulation library. Spec §7.5: route renders the regulation
 * payload returned by `GET /api/v1/regulations/{docId}`.
 *
 * Server component: SSR fetches the regulation from the scan service. The
 * `hl` query param (start,end) is parsed and passed to the client
 * `DocViewer`, which highlights the matched span and scrolls the
 * target article into view.
 */
import { notFound } from "next/navigation";
import { DocViewer, type RegulationViewModel } from "@/components/regulation/DocViewer";
import { LinkBackToReport } from "@/components/regulation/LinkBackToReport";

interface PageProps {
  params: Promise<{ docId: string }>;
  searchParams?: Promise<{ hl?: string }>;
}

async function loadRegulation(
  docId: string,
): Promise<RegulationViewModel | null> {
  const base = process.env.RAG_SERVICE_URL ?? "http://localhost:8001";
  const url = `${base.replace(/\/+$/, "")}/api/v1/regulations/${encodeURIComponent(docId)}`;
  try {
    const res = await fetch(url, {
      // Revalidate often enough that newly-seeded YAMLs show up, but
      // cache to keep page-load latency down. 60s is a sweet spot for
      // an internal tool that rarely changes.
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as RegulationViewModel;
  } catch {
    return null;
  }
}

function parseHl(raw: string | undefined): {
  articleId: string;
  start: number;
  end: number;
} | null {
  if (!raw) return null;
  const [startRaw, endRaw] = raw.split(",");
  const start = Number(startRaw);
  const end = Number(endRaw);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return { articleId: "", start, end };
}

export default async function RegulationViewerPage({
  params,
  searchParams,
}: PageProps) {
  // Next 16: params / searchParams are Promises in server components.
  const { docId } = await params;
  const sp = (await searchParams) ?? {};
  const reg = await loadRegulation(docId);
  if (!reg) {
    notFound();
  }
  // The URL hash carries the article id (e.g. #art-77) but Next.js
  // `searchParams` does not expose it. We pass the raw hl pair down
  // and let the DocViewer / browser handle the hash-scroll.
  const hlRaw = sp.hl;
  const hl = parseHl(hlRaw);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-5 sm:p-8">
      <LinkBackToReport />
      <DocViewer regulation={reg} hl={hl} />
    </div>
  );
}

export const dynamic = "force-dynamic";