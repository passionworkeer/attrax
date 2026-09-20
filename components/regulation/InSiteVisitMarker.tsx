"use client";

import { useEffect } from "react";
import { markInSiteVisit } from "@/lib/regulation/back-navigation";

/**
 * 无渲染组件：本站每个页面挂载时标记「本标签页访问过本站」。
 * 供法规详情页「返回上一页」在无 Navigation API 的浏览器里判断
 * 上一页是否为本站页面。挂在根布局，一次写入、全站生效。
 */
export function InSiteVisitMarker() {
  useEffect(() => {
    markInSiteVisit();
  }, []);
  return null;
}
