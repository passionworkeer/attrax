"use client";

/**
 * LinkBackToReport — 法规文档详情页顶部的导航条。
 *
 * 历史背景：该组件原本仅靠 `router.back()` 实现"返回上一页"。Next.js
 * App Router 的 `router.back()` 在以下场景会失效：
 *   1. 用户从外部链接 / 分享链接 / 书签直接访问（浏览器栈里没有
 *      SPA 内的上一页），`router.back()` 静默 no-op；
 *   2. 上游 referrer 是跨域页面（GitHub / 微信 / 邮件），history
 *      即便存在也可能直接退出当前标签；
 *   3. URL 带 `#anchor` 时，App Router 在某些版本下不会触发
 *      hashchange，会让"返回"看起来没反应。
 *
 * 改为传统 web 设计：调用浏览器原生 `window.history.back()`，并
 * 在确实没有可回跳历史（`history.length <= 1`）时退回到法规列表
 * 页 `/regulations`，避免点击后毫无反应。
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function LinkBackToReport() {
  const handleBack = () => {
    if (typeof window === "undefined") return;
    // 传统 web：优先用浏览器历史栈。
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    // 没有历史时（直接打开分享链接 / 书签进入），退回到法规列表。
    window.location.assign("/regulations");
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
