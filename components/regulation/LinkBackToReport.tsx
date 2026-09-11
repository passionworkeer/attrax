"use client";

/**
 * LinkBackToReport — A small breadcrumb / back-link rendered above the
 * DocViewer. Sessions keep the originating report URL in a query
 * param so users can navigate back without hunting through their
 * browser history.
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function LinkBackToReport() {
  return (
    <div className="flex items-center justify-between text-xs text-slate-400">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-slate-900/40 px-2.5 py-1 text-slate-300 transition hover:border-blaze-cyan/40 hover:text-white"
      >
        <ArrowLeft className="h-3 w-3" />
        返回首页
      </Link>
      <span className="text-slate-500">De-RAG 文档查看器 · §7.5</span>
    </div>
  );
}