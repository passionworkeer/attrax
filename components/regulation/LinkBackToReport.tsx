"use client";

/**
 * LinkBackToReport — 法规文档详情页顶部的导航条。
 *
 * 历史问题（2026-09-20 两次修复）：
 *   1. 原实现用 Next.js App Router 的 `router.back()`。从外部链接 / 分享
 *      链接直接打开时没有站内 SPA 历史项，该方法静默 no-op，按钮点了
 *      没反应。
 *   2. 改为 `history.length > 1 ? history.back() : /regulations` 后，
 *      直接打开（新标签页）时浏览器历史里存在新标签页/空白页这一条，
 *      length > 1 成立，回退把用户带出了站点。
 *
 * 现行行为（传统 web）：仅当浏览器历史中的上一条确实是本站页面时才
 * 回退，否则回到法规档案列表 /regulations。归属判定见
 * `lib/regulation/back-navigation.ts`。
 */
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  readInSiteMarker,
  readNavigationApi,
  resolveBackTarget,
} from "@/lib/regulation/back-navigation";

export function LinkBackToReport() {
  // 首屏渲染时读取：本页挂载后根布局才写入标记，晚于此处读取，
  // 因此读到的只可能是"此前页面"留下的值。
  const [markerIsInSite] = useState(() => readInSiteMarker());

  const handleBack = () => {
    const target = resolveBackTarget({
      navigation: readNavigationApi((window as { navigation?: unknown }).navigation),
      markerIsInSite,
      origin: window.location.origin,
    });
    if (target === "back") {
      window.history.back();
      return;
    }
    window.location.assign(target);
  };

  return (
    <div className="flex items-center justify-between text-xs text-slate-400">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-slate-900/40 px-2.5 py-1 text-slate-300 transition hover:border-blaze-cyan/40 hover:text-white"
      >
        <ArrowLeft className="h-3 w-3" />
        返回首页
      </Link>
      <button
        type="button"
        onClick={handleBack}
        className="min-h-10 rounded-md px-3 text-slate-300 underline hover:text-white"
      >
        返回上一页
      </button>
    </div>
  );
}
