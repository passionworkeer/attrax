import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 rounded-4xl border border-white/60 bg-white/80 px-8 py-12 text-center shadow-[0_30px_120px_rgba(26,26,46,0.12)] backdrop-blur">
        <p className="text-sm font-medium uppercase tracking-[0.28em] text-blaze-red/80">
          Blaze Hawks
        </p>
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-6xl">
            想出海？先烧毁。
          </h1>
          <p className="mx-auto max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            P0-P1 骨架已启动。下一步从上传图片进入 Demo Mode 扫描流程。
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/upload"
            className={cn(
              buttonVariants({ size: "lg" }),
              "bg-blaze-red px-6 text-white hover:bg-blaze-red/90"
            )}
          >
            开始扫描
          </Link>
          <Link
            href="/result/demo"
            className={cn(buttonVariants({ size: "lg", variant: "outline" }), "px-6")}
          >
            查看 Demo
          </Link>
        </div>
      </section>
    </main>
  );
}
