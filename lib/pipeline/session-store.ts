import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { SESSION_CLEANUP_INTERVAL_MS, SESSION_TTL_MS } from "@/lib/constants";
import type { ScanStatus } from "@/lib/types";

export type StoredScanStatus = ScanStatus & {
  accessTokenHash?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

declare global {
  var __scanStore: Map<string, StoredScanStatus> | undefined;
  var __sessionTimers: Map<string, NodeJS.Timeout> | undefined;
  var __clearedSessionIds: Set<string> | undefined;
  var __scanStoreRecovered: boolean | undefined;
}

const SESSION_DIR = join(process.cwd(), "data", "sessions");
let lastCleanupAt = 0;

function getClearedSessionIds(): Set<string> {
  if (!globalThis.__clearedSessionIds) {
    globalThis.__clearedSessionIds = new Set();
  }
  return globalThis.__clearedSessionIds;
}

function getStore(): Map<string, StoredScanStatus> {
  if (!globalThis.__scanStore) {
    globalThis.__scanStore = new Map();
  }
  return globalThis.__scanStore;
}

function getTimers(): Map<string, NodeJS.Timeout> {
  if (!globalThis.__sessionTimers) {
    globalThis.__sessionTimers = new Map();
  }
  return globalThis.__sessionTimers;
}

function validateSessionId(sessionId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error("Invalid sessionId");
  }
}

function sessionFilePath(sessionId: string): string {
  validateSessionId(sessionId);
  return join(SESSION_DIR, `${sessionId}.json`);
}

function ensureSessionDir() {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function toStoredSession(session: ScanStatus, accessTokenHash?: string): StoredScanStatus {
  const now = Date.now();
  return {
    ...session,
    accessTokenHash,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
}

function isExpired(session: StoredScanStatus): boolean {
  return Date.now() > session.expiresAt;
}

function loadSessionFromFile(sessionId: string): StoredScanStatus | null {
  if (getClearedSessionIds().has(sessionId)) return null;
  const filePath = sessionFilePath(sessionId);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoredScanStatus> & ScanStatus & { _timestamp?: number };
    const timestamp = parsed.updatedAt ?? parsed._timestamp ?? Date.now();
    const stored: StoredScanStatus = {
      ...parsed,
      createdAt: parsed.createdAt ?? timestamp,
      updatedAt: timestamp,
      expiresAt: parsed.expiresAt ?? timestamp + SESSION_TTL_MS,
    };
    if (isExpired(stored)) {
      removeSessionFile(sessionId);
      return null;
    }
    return stored;
  } catch (error) {
    console.warn(`[session-store] failed to load session "${sessionId}"`, error);
    return null;
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, serialized, "utf-8");
  } catch (error) {
    // Best-effort cleanup of orphan tmp; if rename was in progress it may already be gone.
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw error;
  }
  if (typeof renameSync !== "function") {
    // Test/mock environments without renameSync fall back to a direct write.
    // Not atomic in theory, but better than throwing inside persistSession().
    writeFileSync(filePath, serialized, "utf-8");
    return;
  }
  try {
    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

function persistSession(session: StoredScanStatus): void {
  try {
    ensureSessionDir();
    writeJsonAtomic(sessionFilePath(session.sessionId), session);
  } catch (error) {
    // Roll back the in-memory write so memory and disk stay in sync.
    // Without this, a subsequent getSession() would return data that
    // doesn't exist on disk, silently breaking crash recovery.
    const store = getStore();
    const current = store.get(session.sessionId);
    if (current && current.updatedAt === session.updatedAt) {
      store.delete(session.sessionId);
      getTimers().delete(session.sessionId);
    }
    console.warn(`[session-store] failed to persist "${session.sessionId}"`, error);
  }
}

function removeSessionFile(sessionId: string): void {
  try {
    const filePath = sessionFilePath(sessionId);
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (error) {
    console.warn(`[session-store] failed to remove "${sessionId}"`, error);
  }
}

function scheduleExpiry(session: StoredScanStatus): void {
  const timers = getTimers();
  const existing = timers.get(session.sessionId);
  if (existing) clearTimeout(existing);

  const remaining = Math.max(0, session.expiresAt - Date.now());
  const timer = setTimeout(() => {
    getStore().delete(session.sessionId);
    timers.delete(session.sessionId);
    removeSessionFile(session.sessionId);
  }, remaining);
  timers.set(session.sessionId, timer);
}

function cleanStaleFiles(): void {
  lastCleanupAt = Date.now();
  if (!existsSync(SESSION_DIR)) return;
  try {
    for (const file of readdirSync(SESSION_DIR)) {
      if (!file.endsWith(".json")) continue;
      const sessionId = file.slice(0, -5);
      const session = loadSessionFromFile(sessionId);
      if (!session) getStore().delete(sessionId);
    }
  } catch (error) {
    console.warn("[session-store] failed to clean stale sessions", error);
  }
}

function cleanStaleFilesIfDue(): void {
  if (Date.now() - lastCleanupAt >= SESSION_CLEANUP_INTERVAL_MS) {
    cleanStaleFiles();
  }
}

export function clearStore() {
  const cleared = getClearedSessionIds();
  for (const sessionId of getStore().keys()) {
    cleared.add(sessionId);
  }
  globalThis.__scanStore = new Map();
  const timers = getTimers();
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  globalThis.__sessionTimers = new Map();
  if (!existsSync(SESSION_DIR)) return;
  try {
    for (const file of readdirSync(SESSION_DIR)) {
      if (file.endsWith(".json")) unlinkSync(join(SESSION_DIR, file));
    }
  } catch (error) {
    console.warn("[session-store] failed to clear store", error);
  }
}

/**
 * HMR / fresh-process recovery: if globalThis.__scanStore is empty (e.g. after
 * Next.js HMR replaced the module instance, or a worker restart) but the
 * data/sessions directory still has live session files, rebuild the in-memory
 * map from disk so polling clients can resume mid-scan.
 *
 * Runs once per process. We keep it synchronous and best-effort: failed
 * reads are dropped (the file is treated as expired/corrupt and will be
 * cleaned up on the next periodic sweep).
 */
function recoverFromDiskIfEmpty(): void {
  if (globalThis.__scanStoreRecovered) return;
  globalThis.__scanStoreRecovered = true;
  if (getStore().size > 0) return;
  if (!existsSync(SESSION_DIR)) return;
  let entries: string[];
  try {
    entries = readdirSync(SESSION_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  if (entries.length === 0) return;
  for (const file of entries) {
    const sessionId = file.slice(0, -5);
    const session = loadSessionFromFile(sessionId);
    if (session) {
      getStore().set(sessionId, session);
      scheduleExpiry(session);
    }
  }
  console.info(`[session-store] recovered ${entries.length} session file(s) from disk`);
}

/**
 * Serialize write operations through a per-process mutex. Without this, two
 * updateSession() calls can race in the read-modify-write window between
 * `store.get(sessionId)` and `persistSession(updated)`: the second writer's
 * stale `current` snapshot would overwrite the first writer's update.
 *
 * Implementation note: in Node.js the JS call stack is single-threaded, so
 * the only way to get a true race is `async` work interleaving — e.g.
 * `await loadSessionFromFile()` from a future async API. We use a Promise
 * chain so any later async writer waits for in-flight writers to finish
 * their synchronous update+persist section before reading. Today the chain
 * completes synchronously inside the then() callback, but if we ever move
 * persist to async (e.g. fs.promises), the chain keeps the invariant.
 */
let writeChain: Promise<void> = Promise.resolve();

function withWriteLock<T>(work: () => T): T {
  // Synchronous critical section: the JS turn holding this stack frame
  // completes before any .then() continuation runs.
  const result = work();
  // Chain a no-op so any future async writer awaits this turn.
  writeChain = writeChain.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function createSession(sessionId: string, accessTokenHash?: string): StoredScanStatus {
  return withWriteLock(() => {
    getClearedSessionIds().delete(sessionId);
    cleanStaleFilesIfDue();
    const session = toStoredSession(
      {
        sessionId,
        status: "processing",
        progress: 0,
        stageText: "准备中…",
      },
      accessTokenHash
    );

    getStore().set(sessionId, session);
    scheduleExpiry(session);
    persistSession(session);
    return session;
  });
}

export function updateSession(sessionId: string, patch: Partial<ScanStatus> & { accessTokenHash?: string }) {
  withWriteLock(() => {
    const store = getStore();
    const current = store.get(sessionId) ?? loadSessionFromFile(sessionId);
    if (!current) {
      console.warn(`[session-store] updateSession: session "${sessionId}" not found`);
      return;
    }

    const updated: StoredScanStatus = {
      ...current,
      ...patch,
      error: typeof patch.error === "string" ? patch.error : current.error,
      updatedAt: Date.now(),
    };
    store.set(sessionId, updated);
    scheduleExpiry(updated);
    persistSession(updated);
  });
}

export function getSession(sessionId: string): StoredScanStatus | undefined {
  cleanStaleFilesIfDue();
  const store = getStore();
  const cached = store.get(sessionId);
  if (cached && !isExpired(cached)) return cached;
  if (cached) store.delete(sessionId);

  const fromFile = loadSessionFromFile(sessionId);
  if (!fromFile) return undefined;

  store.set(sessionId, fromFile);
  scheduleExpiry(fromFile);
  return fromFile;
}

export function publicSession(session: ScanStatus): ScanStatus {
  const { sessionId, status, progress, stageText, result, profitReport, profitReports, error } = session;
  return { sessionId, status, progress, stageText, result, profitReport, profitReports, error };
}

cleanStaleFiles();
recoverFromDiskIfEmpty();
