"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw, ShieldAlert, FileSearch } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * Result-page-specific error boundary. Distinct from the global app/error.tsx
 * because scan-related failures have very different recovery paths (re-fetch
 * the session, or start over) than generic route errors.
 */
export default function ResultError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[attrax] result page error:", error);
  }, [error]);

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] w-full max-w-3xl px-4 sm:px-6 py-10">
      <section className="glass-panel rounded-3xl p-8 sm:p-12 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blaze-red/15 border border-blaze-red/40">
          <ShieldAlert className="h-8 w-8 text-blaze-red" />
        </div>

        <p className="label-caps text-xs text-blaze-red/80 mb-3">Result load failed</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-4">
          Could not load the report.
        </h1>
        <p className="text-sm leading-relaxed text-slate-400 mb-8">
          The session exists but the report data could not be rendered. This is
          usually transient — the session is still valid and reloading usually
          works.
        </p>

        {error.digest && (
          <p className="text-xs data-mono text-slate-500 mb-6 break-all">
            digest: {error.digest}
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className={buttonVariants({ variant: "default", size: "lg" })}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reload report
          </button>
          <Link
            href="/upload"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            <FileSearch className="h-4 w-4 mr-2" />
            Start new scan
          </Link>
        </div>
      </section>
    </main>
  );
}
