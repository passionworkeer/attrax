import { expect, it, vi } from "vitest";
import {
  IN_SITE_MARKER_KEY,
  markInSiteVisit,
  readInSiteMarker,
  readNavigationApi,
  resolveBackTarget,
} from "@/lib/regulation/back-navigation";

const ORIGIN = "https://example.com";
const LIST = "/regulations";

it("Navigation API：直接打开（index=0）→ 站内列表", () => {
  const navigation = {
    currentEntry: { index: 0 },
    entries: () => [{ url: `${ORIGIN}/regulations/US-16-CFR-1263#art-1` }],
  };
  expect(resolveBackTarget({ navigation, markerIsInSite: false, origin: ORIGIN })).toBe(LIST);
});

it("Navigation API：上一页是本站页面 → 回退", () => {
  const navigation = {
    currentEntry: { index: 1 },
    entries: () => [
      { url: `${ORIGIN}/regulations` },
      { url: `${ORIGIN}/regulations/US-16-CFR-1263#art-1` },
    ],
  };
  expect(resolveBackTarget({ navigation, markerIsInSite: false, origin: ORIGIN })).toBe("back");
});

it("Navigation API：上一页是外部站点 → 不回退，回站内列表", () => {
  const navigation = {
    currentEntry: { index: 1 },
    entries: () => [{ url: "https://github.com/some/repo" }, { url: `${ORIGIN}/regulations/US-16-CFR-1263` }],
  };
  expect(resolveBackTarget({ navigation, markerIsInSite: true, origin: ORIGIN })).toBe(LIST);
});

it("Navigation API：上一页是新标签页（chrome://newtab）→ 回站内列表", () => {
  const navigation = {
    currentEntry: { index: 1 },
    entries: () => [{ url: "chrome://newtab/" }, { url: `${ORIGIN}/regulations/US-16-CFR-1263` }],
  };
  expect(resolveBackTarget({ navigation, markerIsInSite: true, origin: ORIGIN })).toBe(LIST);
});

it("Navigation API：上一条 URL 缺失或不可解析 → 回站内列表", () => {
  const missing = {
    currentEntry: { index: 1 },
    entries: () => [undefined, { url: `${ORIGIN}/regulations/US-16-CFR-1263` }],
  };
  expect(resolveBackTarget({ navigation: missing, markerIsInSite: true, origin: ORIGIN })).toBe(LIST);
  const broken = {
    currentEntry: { index: 1 },
    entries: () => [{ url: "not a url" }, { url: `${ORIGIN}/regulations/US-16-CFR-1263` }],
  };
  expect(resolveBackTarget({ navigation: broken, markerIsInSite: true, origin: ORIGIN })).toBe(LIST);
});

it("Navigation API：currentEntry.index 缺失时退回标记判定", () => {
  const navigation = { currentEntry: null, entries: () => [] };
  expect(resolveBackTarget({ navigation, markerIsInSite: true, origin: ORIGIN })).toBe("back");
  expect(resolveBackTarget({ navigation, markerIsInSite: false, origin: ORIGIN })).toBe(LIST);
});

it("无 Navigation API：标记存在 → 回退，无标记 → 站内列表", () => {
  expect(resolveBackTarget({ navigation: null, markerIsInSite: true, origin: ORIGIN })).toBe("back");
  expect(resolveBackTarget({ navigation: null, markerIsInSite: false, origin: ORIGIN })).toBe(LIST);
});

it("readNavigationApi：非对象或缺少 entries 时返回 null", () => {
  expect(readNavigationApi(undefined)).toBeNull();
  expect(readNavigationApi(null)).toBeNull();
  expect(readNavigationApi("navigation")).toBeNull();
  expect(readNavigationApi({})).toBeNull();
  const ok = { entries: () => [] };
  expect(readNavigationApi(ok)).toBe(ok);
});

it("readInSiteMarker / markInSiteVisit：读写标记，存储报错时按未访问处理", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  expect(readInSiteMarker(storage)).toBe(false);
  markInSiteVisit(storage);
  expect(store.get(IN_SITE_MARKER_KEY)).toBe("1");
  expect(readInSiteMarker(storage)).toBe(true);

  const broken = {
    getItem: vi.fn(() => {
      throw new Error("storage disabled");
    }),
    setItem: vi.fn(() => {
      throw new Error("storage disabled");
    }),
  };
  expect(readInSiteMarker(broken)).toBe(false);
  expect(() => markInSiteVisit(broken)).not.toThrow();
});
