"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Resolve the active scan sessionId from one of three sources, in priority
 * order:
 *   1. `?sessionId=...` query string  (links from /result)
 *   2. `params.sessionId` dynamic segment  (/trace/[sessionId], /roadmap/[sessionId])
 *   3. `sessionStorage.lastSessionId`  (cross-page handoff for the last visit)
 *
 * Replaces the previous setTimeout(0) + window.location.search + sessionStorage
 * triple hack which broke SSR/first-paint consistency. `useSearchParams()` is
 * the Next.js-blessed way to read the query string; the surrounding page
 * should be wrapped in <Suspense> so the hook can suspend during streaming.
 *
 * Returns "" when no sessionId is available anywhere — callers should treat
 * that as "no active session" (e.g. fall back to demo data).
 */
export function useSessionId(
  paramsSessionId?: string,
  options: { persist?: boolean } = {}
): string {
  const { persist = true } = options;
  const searchParams = useSearchParams();
  // Initial state is always "" so the server-rendered HTML and the first
  // client render produce identical output (searchParams / sessionStorage
  // are only available client-side). The real value is resolved inside
  // useEffect below, which runs after hydration — eliminating the
  // SSR/CSR mismatch where SSR rendered "" but CSR rendered the query id.
  const [sessionId, setSessionId] = useState<string>("");

  // Resolve after mount: query > dynamic param > sessionStorage. Reading
  // window.sessionStorage here is safe because effects don't run on the
  // server. The dependency array covers both query and param changes.
  useEffect(() => {
    const fromQuery = searchParams?.get("sessionId") || "";
    const fromParams = paramsSessionId || "";
    const fromStorage =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("lastSessionId") || ""
        : "";
    const resolved = fromQuery || fromParams || fromStorage;
    setSessionId(resolved);
  }, [searchParams, paramsSessionId]);

  // Mirror the old behavior of persisting the active sessionId so other
  // pages can pick it up. We only persist non-empty, non-"demo" ids to avoid
  // poisoning the cache with the demo sentinel.
  useEffect(() => {
    if (!persist) return;
    if (!sessionId || sessionId === "demo") return;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem("lastSessionId") !== sessionId) {
      window.sessionStorage.setItem("lastSessionId", sessionId);
    }
  }, [sessionId, persist]);

  return sessionId;
}
