// 法规详情页「返回上一页」的目标解析。
//
// 需求：点击后不要把用户带出站点。只有浏览器历史中的上一条确实是本站
// 页面时才回退（window.history.back()）；否则（直接打开分享链接、从
// 外部站点进入、新标签页）回到法规档案列表，避免出现"点了跳到浏览器
// 新标签页/外部网站"的行为。
//
// 判定分两层：
//   1. Navigation API（Chromium）：能读到历史条目列表与当前索引，
//      直接检查上一条的 URL 是否同源；直接打开时 index === 0。
//   2. sessionStorage 标记（Firefox / 旧 Safari 等无该 API 的浏览器）：
//      本站每个页面挂载时打一个标记；详情页在首屏渲染时读取该标记，
//      有标记说明本标签页此前访问过本站，才允许回退。

export const REGULATIONS_LIST_HREF = "/regulations";

/** 「本标签页访问过本站」标记的 sessionStorage 键（sessionStorage 按标签页隔离）。 */
export const IN_SITE_MARKER_KEY = "attrax:in-site";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

/**
 * 读取「本标签页此前访问过本站」标记。
 * 必须在详情页自身写入标记之前读取（组件首屏渲染时），否则恒为真。
 * 存储不可用（隐私模式禁写）时按未访问处理。
 */
export function readInSiteMarker(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(IN_SITE_MARKER_KEY) === "1";
  } catch {
    return false;
  }
}

/** 本站页面挂载时调用，供后续页面判断「上一页是否为本站」。 */
export function markInSiteVisit(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(IN_SITE_MARKER_KEY, "1");
  } catch {
    // 存储被禁用时跳过；仅影响上一页归属判定，页面功能不受影响
  }
}

/** Navigation API 的最小结构（Chromium 支持，Firefox/Safari 可能没有）。 */
export interface NavigationEntriesLike {
  currentEntry?: { index?: number } | null;
  entries?: () => ReadonlyArray<{ url?: string | null } | undefined>;
}

/** 从 window.navigation 取出可用的 Navigation API 结构；不可用时返回 null。 */
export function readNavigationApi(target: unknown): NavigationEntriesLike | null {
  if (!target || typeof target !== "object") return null;
  const nav = target as NavigationEntriesLike;
  return typeof nav.entries === "function" ? nav : null;
}

function isSameOrigin(rawUrl: string | null | undefined, origin: string): boolean {
  if (!rawUrl) return false;
  try {
    // 严格解析（不给 base）：Navigation API 的条目 URL 规范保证是绝对 URL，
    // 这里拒绝相对/不可解析的字符串，按"非本站"处理，保证留在站内。
    return new URL(rawUrl).origin === origin;
  } catch {
    return false;
  }
}

export interface BackTargetInput {
  /** window.navigation（无 Navigation API 的浏览器为 null）。 */
  navigation?: NavigationEntriesLike | null;
  /** 详情页首屏渲染时读取的标记；当页自身写入的标记不参与判定。 */
  markerIsInSite: boolean;
  /** location.origin。 */
  origin: string;
  listHref?: string;
}

/** 返回 "back"（浏览器历史回退）或站内列表地址。 */
export function resolveBackTarget({
  navigation,
  markerIsInSite,
  origin,
  listHref = REGULATIONS_LIST_HREF,
}: BackTargetInput): "back" | string {
  if (navigation) {
    const index = navigation.currentEntry?.index;
    if (typeof index === "number") {
      if (index <= 0) return listHref;
      const entries = navigation.entries?.() ?? [];
      const previous = entries[index - 1];
      return isSameOrigin(previous?.url, origin) ? "back" : listHref;
    }
  }
  return markerIsInSite ? "back" : listHref;
}
