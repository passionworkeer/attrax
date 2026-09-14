import Link from "next/link";
import { Flame, Home, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * 404 page for unknown routes. Renders as a server component so search
 * engines can still index it. Branded with the same dark cyber-industrial
 * theme as the rest of the app.
 *
 * J18（计划 §7）：文案从英文「Lost in the smoke.」改为中文主导
 * 「页面未找到」，与中文品牌和工作流一致；保留英文辅助行。
 * 保留返回首页与法规示例入口两个 CTA。
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
          页面未找到
        </h1>
        <p className="text-sm text-slate-300 mb-6">
          你访问的页面不存在，可能已被移动、重命名，或链接地址有误。
        </p>
        <p className="text-sm leading-relaxed text-slate-400 mb-8">
          Page not found — the page may have been moved, renamed, or the URL is
          mistyped.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/" className={buttonVariants({ variant: "default", size: "lg" })}>
            <Home className="h-4 w-4 mr-2" />
            返回首页
          </Link>
          <Link
            href="/regulations"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            <Search className="h-4 w-4 mr-2" />
            法规动态示例
          </Link>
        </div>
      </div>
    </main>
  );
}
