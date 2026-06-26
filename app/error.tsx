"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Flame, RefreshCw, ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * Root-level Next.js error boundary. Catches any unhandled error in the
 * route tree and shows a branded fallback instead of the default white
 * "Application error" screen. Logs to the console for ops triage.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[attrax] route error boundary caught:", error);
  }, [error]);

  return (
    <main className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-6 py-16">
      <div className="glass-panel max-w-xl rounded-3xl p-8 sm:p-12 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-blaze-red/15 border border-blaze-red/40">
          <ShieldAlert className="h-10 w-10 text-blaze-red" />
        </div>

        <p className="label-caps text-xs text-blaze-red/80 mb-3">Runtime error</p>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white mb-4">
          <Flame className="inline h-8 w-8 text-blaze-red mr-1" />
          Something caught fire.
        </h1>
        <p className="text-sm leading-relaxed text-slate-400 mb-8">
          The scan pipeline hit an unexpected error. Your previous session state
          is preserved — you can retry, or start a new scan.
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
            Try again
          </button>
          <Link
            href="/"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Back to home
          </Link>
          <Link
            href="/upload"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Start new scan
          </Link>
        </div>
      </div>
    </main>
  );
}
