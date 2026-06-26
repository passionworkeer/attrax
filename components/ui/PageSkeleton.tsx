/**
 * Branded loading skeleton for Attrax page transitions.
 * Uses blaze-red/cyan for spinner accents so the skeleton feels consistent
 * with the dark cyber-industrial theme rather than defaulting to a generic
 * spinner. Drop-in for Next.js loading.tsx.
 */
export function PageSkeleton({ label }: { label?: string }) {
  return (
    <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-6">
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-full border-2 border-white/10" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blaze-red animate-spin" />
          <div
            className="absolute inset-1 rounded-full border-2 border-transparent border-b-blaze-cyan animate-spin"
            style={{ animationDuration: "1.5s", animationDirection: "reverse" }}
          />
        </div>
        {label && (
          <p className="text-sm font-medium text-slate-400 data-mono uppercase tracking-widest">
            {label}
          </p>
        )}
      </div>
    </div>
  );
}
