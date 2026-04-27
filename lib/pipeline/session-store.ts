import type { ScanStatus } from "@/lib/types";

declare global {
  var __scanStore: Map<string, ScanStatus> | undefined;
}

const store = globalThis.__scanStore ?? new Map<string, ScanStatus>();

if (!globalThis.__scanStore) {
  globalThis.__scanStore = store;
}

export function createSession(sessionId: string): ScanStatus {
  const session: ScanStatus = {
    sessionId,
    status: "processing",
    progress: 0,
    stageText: "准备中…",
  };

  store.set(sessionId, session);
  setTimeout(() => {
    store.delete(sessionId);
  }, 60 * 60 * 1000);

  return session;
}

export function updateSession(sessionId: string, patch: Partial<ScanStatus>) {
  const current = store.get(sessionId);
  if (!current) {
    return;
  }

  store.set(sessionId, { ...current, ...patch });
}

export function getSession(sessionId: string) {
  return store.get(sessionId);
}
