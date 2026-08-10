"use client";

/**
 * E2E 专用:仅在非 production 环境的渲染期抛错,用于稳定触发 app/error.tsx。
 *
 * 为什么需要它:error-boundary.spec.ts 需要可靠地让 React 渲染期抛错以命中根
 * error boundary。旧实现用 addInitScript monkey-patch JSON.parse,但 Next 16
 * App Router 的 RSC flight 数据解析点不再固定,无法稳定产生渲染期错误。
 *
 * 为什么是 client:Server Component 在 SSR 期抛错,dev 模式下会被 Next.js 开发错误
 * 页拦截(返回 500 带堆栈),不会进 app/error.tsx。"use client" 把执行挪到客户端
 * hydration 阶段,React 的 error boundary 会接管并渲染 app/error.tsx。
 *
 * 命名注意:目录不能以 `_` 开头 —— Next.js App Router 把 `_` 前缀目录当私有目录
 * 排除出路由(会 404)。故用 `force-error`(无下划线前缀)。
 *
 * 安全性:NODE_ENV === "production" 时不抛错(渲染 null),生产环境是一条空路由,
 * 不影响真实用户;e2e 在 `next dev`(development)下跑,才真正抛错。
 */
export default function ForceErrorPage() {
  if (process.env.NODE_ENV !== "production") {
    throw new Error("e2e forced render error");
  }
  return null;
}