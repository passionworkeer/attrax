import Link from "next/link";
import { Flame, Home, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * 404 page for unknown routes. Renders as a server component so search
 * engines can still index it. Branded with the same dark cyber-industrial
 * theme as the rest of the app.
 */
export default function NotFound() {
  return (
    <main className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-6 py-16">
      <div className="glass-panel max-w-xl rounded-3xl p-8 sm:p-12 text-center">
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-blaze-cyan/10 border border-blaze-cyan/40">
          <Flame className="h-12 w-12 text-blaze-cyan" />
        </div>

        <p className="label-caps text-xs text-blaze-cyan/80 mb-3">404 · Not found</p>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-white mb-4">
          Lost in the smoke.
        </h1>
        <p className="text-sm leading-relaxed text-slate-400 mb-8">
          The page you tried to reach does not exist on CompliPilot. It may have
          been moved, renamed, or the URL is mistyped.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/" className={buttonVariants({ variant: "default", size: "lg" })}>
            <Home className="h-4 w-4 mr-2" />
            Back to home
          </Link>
          <Link
            href="/regulations"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            <Search className="h-4 w-4 mr-2" />
            Browse regulations
          </Link>
        </div>
      </div>
    </main>
  );
}
