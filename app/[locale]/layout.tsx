import type { ReactNode } from "react";

/**
 * [locale] 段的服务端路由配置(layout 是 server component,可导出 route segment config)。
 *
 * 只允许 zh / en 两个 locale 段。其它单段路径(如 /this-route-does-not-exist)
 * 不再被 [locale] 吃掉当成首页,而是落回 Next 的 not-found 管线命中 app/not-found.tsx。
 *
 * 注意:这些 export 不能放在 page.tsx 里(该页是 "use client",且其 t() 来自 client
 * 模块),所以单独用本 layout 承载。page.tsx 仍是 client,正常渲染 HomeContent。
 */
export function generateStaticParams() {
  return [{ locale: "zh" }, { locale: "en" }];
}

export const dynamicParams = false;

export default function LocaleLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
