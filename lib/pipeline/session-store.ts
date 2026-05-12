import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import type { ScanStatus } from "@/lib/types";

declare global {
  var __scanStore: Map<string, ScanStatus> | undefined;
  var __sessionTimers: Map<string, NodeJS.Timeout> | undefined;
}

const SESSION_DIR = join(process.cwd(), "data", "sessions");
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

function getStore(): Map<string, ScanStatus> {
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

function sessionFilePath(sessionId: string): string {
  return join(SESSION_DIR, `${sessionId}.json`);
}

function ensureSessionDir() {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function loadSessionFromFile(sessionId: string): ScanStatus | null {
  const filePath = sessionFilePath(sessionId);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const session = JSON.parse(raw) as ScanStatus & { _timestamp?: number };
    // Auto-expire: skip if older than SESSION_TTL_MS
    const ts = session._timestamp;
    if (!ts || Date.now() - ts > SESSION_TTL_MS) {
      try { unlinkSync(filePath); } catch { /* ignore */ }
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function persistSession(session: ScanStatus): void {
  ensureSessionDir();
  const withTimestamp: ScanStatus & { _timestamp: number } = {
    ...session,
    _timestamp: Date.now(),
  };
  writeFileSync(sessionFilePath(session.sessionId), JSON.stringify(withTimestamp), "utf-8");
}

function cleanStaleFiles(): void {
  if (!existsSync(SESSION_DIR)) return;
  try {
    for (const file of readdirSync(SESSION_DIR)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(SESSION_DIR, file);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const session = JSON.parse(raw) as ScanStatus & { _timestamp?: number };
        if (session._timestamp && Date.now() - session._timestamp > SESSION_TTL_MS) {
          unlinkSync(filePath);
        }
      } catch {
        // skip malformed files
      }
    }
  } catch {
    // skip on directory read error
  }
}

export function createSession(sessionId: string): ScanStatus {
  const store = getStore();
  const timers = getTimers();
  const session: ScanStatus = {
    sessionId,
    status: "processing",
    progress: 0,
    stageText: "准备中…",
  };

  store.set(sessionId, session);
  persistSession(session);

  // Clear any existing timer
  const existing = timers.get(sessionId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    store.delete(sessionId);
    timers.delete(sessionId);
    try {
      const filePath = sessionFilePath(sessionId);
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch {
      // ignore cleanup errors
    }
  }, SESSION_TTL_MS);

  timers.set(sessionId, timer);
  return session;
}

export function updateSession(sessionId: string, patch: Partial<ScanStatus>) {
  const store = getStore();
  const current = store.get(sessionId);
  if (!current) {
    console.warn(`[session-store] updateSession: session "${sessionId}" not found in memory, trying file`);
    // Try to reload from file in case the session exists on disk
    const fromFile = loadSessionFromFile(sessionId);
    if (!fromFile) {
      console.error(`[session-store] updateSession: session "${sessionId}" not found anywhere`);
      return;
    }
    store.set(sessionId, fromFile);
  }

  const base = store.get(sessionId)!;
  const updated: ScanStatus = { ...base, ...patch };
  store.set(sessionId, updated);
  persistSession(updated);
}

export function getSession(sessionId: string): ScanStatus | undefined {
  const store = getStore();
  const cached = store.get(sessionId);
  if (cached) return cached;

  // Not in memory — try loading from file
  const fromFile = loadSessionFromFile(sessionId);
  if (fromFile) {
    store.set(sessionId, fromFile);
    // Restore the expiry timer
    const timers = getTimers();
    const existing = timers.get(sessionId);
    if (existing) clearTimeout(existing);

    const ts = (fromFile as ScanStatus & { _timestamp?: number })._timestamp;
    const remaining = ts ? SESSION_TTL_MS - (Date.now() - ts) : SESSION_TTL_MS;
    if (remaining > 0) {
      const timer = setTimeout(() => {
        store.delete(sessionId);
        timers.delete(sessionId);
        try {
          const filePath = sessionFilePath(sessionId);
          if (existsSync(filePath)) unlinkSync(filePath);
        } catch {
          // ignore cleanup errors
        }
      }, remaining);
      timers.set(sessionId, timer);
    }

    return fromFile;
  }

  return undefined;
}

export function clearStore() {
  globalThis.__scanStore = new Map();
  // Clean up timers
  const timers = getTimers();
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  globalThis.__sessionTimers = new Map();
  // Clean up session files
  if (existsSync(SESSION_DIR)) {
    try {
      for (const file of readdirSync(SESSION_DIR)) {
        if (file.endsWith(".json")) {
          try {
            unlinkSync(join(SESSION_DIR, file));
          } catch {
            // skip
          }
        }
      }
    } catch {
      // skip
    }
  }
}

// Clean stale session files on module load
cleanStaleFiles();