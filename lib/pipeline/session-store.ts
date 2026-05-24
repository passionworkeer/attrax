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
  writeFileSync(tmpPath, serialized, "utf-8");
  if (typeof renameSync === "function") {
    renameSync(tmpPath, filePath);
  } else {
    writeFileSync(filePath, serialized, "utf-8");
  }
}

function persistSession(session: StoredScanStatus): void {
  try {
    ensureSessionDir();
    writeJsonAtomic(sessionFilePath(session.sessionId), session);
  } catch (error) {
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

export function createSession(sessionId: string, accessTokenHash?: string): StoredScanStatus {
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
  persistSession(session);
  scheduleExpiry(session);
  return session;
}

export function updateSession(sessionId: string, patch: Partial<ScanStatus> & { accessTokenHash?: string }) {
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
  persistSession(updated);
  scheduleExpiry(updated);
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
  const { sessionId, status, progress, stageText, result, profitReport, error } = session;
  return { sessionId, status, progress, stageText, result, profitReport, error };
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

cleanStaleFiles();
