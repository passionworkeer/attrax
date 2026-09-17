"use client";

/**
 * DocViewer — Renders a single regulation payload returned by
 * `GET /api/v1/regulations/{doc_id}`.
 *
 * Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §7.5 step 5.
 *
 * Layout:
 *   - Left column: TOC of article IDs (private regulations render
 *     "metadata only" — no TOC, just key_points + purchase link)
 *   - Right column: article text with optional `<mark>` highlight on
 *     the (start, end) span carried by the `hl` URL param
 *
 * The highlight effect is implemented client-side: on mount, the
 * component reads `hl`, locates the article DOM node by hash, splits
 * its `textContent` at the offsets, and re-wraps the highlighted
 * region with `<mark>` so CSS gives the visual cue. This stays
 * SSR-friendly (the article DOM is rendered server-side; only the
 * wrap is dynamic).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, FileText, ShieldCheck, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";

interface Article {
  id: string;
  title: string;
  text?: string;
}

export interface RegulationViewModel {
  id: string;
  official_citation: string;
  short_name?: string;
  region: string;
  license: "public" | "private_with_summary";
  source_url?: string | null;
  purchase_url?: string | null;
  articles?: Article[];
  notes?: string;
  schema_version: number;
}

export interface DocViewerProps {
  regulation: RegulationViewModel;
  /** Optional highlight overlay coordinates from the URL `hl` param. */
  hl?: { articleId: string; start: number; end: number } | null;
}

const HL_CLASSES =
  "bg-yellow-200/70 dark:bg-yellow-900/40 rounded px-0.5 -mx-0.5";

export function DocViewer({ regulation, hl }: DocViewerProps) {
  const articles = regulation.articles ?? [];
  const isPrivate = regulation.license === "private_with_summary";
  const [articleId, setArticleId] = useState(hl?.articleId ?? "");
  useEffect(() => {
    const readHash = () => {
      try { setArticleId(decodeURIComponent(window.location.hash.slice(1).split("?")[0])); }
      catch { setArticleId(""); }
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);
  const activeHighlight = hl ? { ...hl, articleId: hl.articleId || articleId } : null;
  const condensed = articles.some((article) => /condensed from KB|full official text pending/i.test(article.text ?? ""));

  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
      {/* Left column: TOC + metadata */}
      <aside className="space-y-5">
        <div className="glass-panel rounded-2xl p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {regulation.region}
          </p>
          <h1 className="mt-1 text-base font-semibold leading-snug text-white">
            {regulation.short_name || regulation.official_citation}
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            {regulation.official_citation}
          </p>
          {regulation.license === "public" && regulation.source_url && (
            <a
              href={regulation.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-blaze-cyan hover:text-blaze-red"
            >
              <ExternalLink className="h-3 w-3" />
              原文出处
            </a>
          )}
        </div>

        {articles.length > 0 && (
          <nav className="glass-panel rounded-2xl p-3">
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              条款目录
            </p>
            <ol className="space-y-1">
              {articles.map((a) => (
                <li key={a.id}>
                  <a
                    href={`#${encodeURIComponent(a.id)}`}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white",
                      hl?.articleId === a.id && "bg-blaze-cyan/10 text-blaze-cyan",
                    )}
                  >
                    <span className="font-mono text-[10px] text-slate-500">
                      {a.id}
                    </span>
                    <span className="ml-2">{a.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}
      </aside>

      {/* Right column: article body */}
      <main className="glass-panel min-h-[24rem] rounded-2xl p-6">
        {condensed && <p role="note" className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-7 text-amber-200">当前展示的是法规知识库摘要，尚未逐字核对官方条文，不能作为法规原文引用。请通过「原文出处」核查完整文本。</p>}
        {isPrivate ? (
          <PrivateView regulation={regulation} />
        ) : articles.length === 0 ? (
          <p className="text-sm text-slate-400">
            该法规暂无条款正文。
          </p>
        ) : (
          <PublicArticles
            articles={articles}
            hl={activeHighlight}
            citation={regulation.official_citation}
          />
        )}
      </main>
    </div>
  );
}

function PublicArticles({
  articles,
  hl,
  citation,
}: {
  articles: Article[];
  hl: DocViewerProps["hl"];
  citation: string;
}) {
  return (
    <article className="prose prose-invert max-w-none text-sm">
      {articles.map((a) => (
        <section
          id={a.id}
          key={a.id}
          className="border-b border-white/5 py-5 last:border-0"
        >
          <header className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-mono text-sm font-semibold text-blaze-cyan">
              {a.id}
            </h2>
            <span className="text-xs text-slate-400">{citation}</span>
          </header>
          <h3 className="mb-3 text-base font-semibold text-white">{a.title}</h3>
          <ArticleBody article={a} hl={hl} />
        </section>
      ))}
    </article>
  );
}

function ArticleBody({
  article,
  hl,
}: {
  article: Article;
  hl: DocViewerProps["hl"];
}) {
  const text = article.text ?? "";
  const isTarget = hl?.articleId === article.id;
  // We expose the article id via data-article so the client-side hl
  // effect can locate it even when the browser auto-scroll doesn't
  // include the full encoded form.
  const dataArticleId = article.id;
  if (!isTarget) {
    return (
      <p
        data-article-id={dataArticleId}
        className="whitespace-pre-wrap leading-relaxed text-slate-200"
      >
        {text}
      </p>
    );
  }
  return (
    <HighlightedBody
      text={text}
      start={hl?.start ?? 0}
      end={hl?.end ?? 0}
      articleId={article.id}
    />
  );
}

function HighlightedBody({
  text,
  start,
  end,
  articleId,
}: {
  text: string;
  start: number;
  end: number;
  articleId: string;
}) {
  // Clamp the offsets to the text length and split into pre/highlight/post.
  const safeEnd = Math.max(0, Math.min(end, text.length));
  const safeStart = Math.max(0, Math.min(start, safeEnd));
  const pre = text.slice(0, safeStart);
  const marked = text.slice(safeStart, safeEnd);
  const post = text.slice(safeEnd);

  useEffect(() => {
    // Scroll the marked span into view if the URL hash points here.
    const target = document.getElementById(articleId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [articleId]);

  return (
    <p
      data-article-id={articleId}
      className="whitespace-pre-wrap leading-relaxed text-slate-200"
    >
      {pre}
      <mark className={HL_CLASSES}>{marked}</mark>
      {post}
    </p>
  );
}

function PrivateView({ regulation }: { regulation: RegulationViewModel }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <div>
          <p className="text-sm font-semibold">私有标准（仅元数据）</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
            根据许可策略（spec §6.4），本标准仅展示元数据 + 关键摘要，
            不分发条款正文。点击下方链接购买正式版以获取完整内容。
          </p>
        </div>
      </div>

      {regulation.purchase_url && (
        <a
          href={regulation.purchase_url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2.5 text-sm text-white transition hover:border-blaze-cyan/40 hover:bg-slate-800"
        >
          <ShoppingCart className="h-4 w-4" />
          购买 / 查阅原文
          <ExternalLink className="h-3 w-3 text-slate-400" />
        </a>
      )}

      {regulation.notes && (
        <p className="text-xs leading-relaxed text-slate-400">
          {regulation.notes}
        </p>
      )}

      <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
        <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold text-white">
          <FileText className="h-4 w-4" />
          元数据
        </p>
        <dl className="grid grid-cols-2 gap-y-2 text-xs text-slate-300 sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">编号</dt>
            <dd className="font-mono">{regulation.id}</dd>
          </div>
          <div>
            <dt className="text-slate-500">区域</dt>
            <dd>{regulation.region}</dd>
          </div>
          <div>
            <dt className="text-slate-500">许可</dt>
            <dd>{regulation.license}</dd>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-slate-500">官方引用</dt>
            <dd>{regulation.official_citation}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/**
 * CiteLink — light wrapper around Link used in the report markdown to
 * navigate to the regulation viewer for a specific article.
 */
export function CiteLink({
  docId,
  articleId,
  hl,
  children,
  className,
}: {
  docId: string;
  articleId: string;
  hl?: [number, number] | null;
  children: React.ReactNode;
  className?: string;
}) {
  const href = useMemo(() => {
    const params = new URLSearchParams();
    if (hl) {
      const [start, end] = hl;
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        params.set("hl", `${start},${end}`);
      }
    }
    const q = params.toString();
    return `/regulations/${encodeURIComponent(docId)}#${encodeURIComponent(articleId)}${q ? `?${q}` : ""}`;
  }, [docId, articleId, hl]);

  return (
    <Link
      href={href}
      className={cn(
        "text-blaze-cyan underline decoration-blaze-cyan/40 hover:text-blaze-red hover:decoration-blaze-red/60",
        className,
      )}
    >
      {children}
    </Link>
  );
}
