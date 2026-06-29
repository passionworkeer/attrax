import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";
import { SESSION_CLEANUP_INTERVAL_MS, SESSION_TTL_MS } from "@/lib/constants";
import { removeAllUploads, removeUploadsForSession } from "@/lib/pipeline/upload-storage";
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

function validateSessionId(sessionId: string): boolean {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    return false;
  }
  return true;
}

function sessionFilePath(sessionId: string): string | null {
  if (!validateSessionId(sessionId)) return null;
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
  if (!filePath || !existsSync(filePath)) {
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

function writeJsonAtomicInternal(filePath: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  // Include crypto.randomBytes so two writers in the same millisecond (e.g.
  // drain + a polling update under load) cannot collide on the tmp file name
  // — on Windows that surfaces as EPERM during rename.
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;
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
  // On Windows, antivirus or another process can briefly hold the .tmp file,
  // making rename fail with EPERM. Retry a few times with exponential backoff
  // before falling back to a direct (non-atomic) write — safer than throwing
  // inside persistSession() and rolling back the in-memory state.
  const renameAttempts = 3;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= renameAttempts; attempt++) {
    try {
      renameSync(tmpPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < renameAttempts) {
        // Brief sync wait — Windows file lock typically clears within a few ms.
        const waitMs = attempt * 5;
        const end = Date.now() + waitMs;
        while (Date.now() < end) {
          /* spin briefly */
        }
      }
    }
  }
  // Atomic rename failed after retries — best-effort direct write so callers
  // can still read what they just stored. We keep the rollback on the table
  // by checking the error code: EBUSY/EPERM/EACCES are transient, anything
  // else (e.g. ENOENT, EISDIR) should still surface.
  const code = (lastError as NodeJS.ErrnoException | null)?.code;
  if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
    console.warn(
      `[session-store] rename ${tmpPath} → ${filePath} failed (${code}); falling back to direct write`
    );
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    writeFileSync(filePath, serialized, "utf-8");
    return;
  }
  try {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  } catch {
    /* ignore */
  }
  throw lastError;
}

/**
 * Public alias of the internal atomic-write helper, exported so other pipeline
 * modules (e.g. scan-queue) can reuse the same Windows-EPERM-retry logic
 * instead of rolling their own. Writes `value` to `filePath` via a temp file
 * + rename, with retries and a direct-write fallback for transient EPERM/
 * EBUSY/EACCES (common on Windows when antivirus briefly holds the file).
 */
export const writeJsonAtomic = writeJsonAtomicInternal;

function persistSession(session: StoredScanStatus): void {
  try {
    ensureSessionDir();
    const filePath = sessionFilePath(session.sessionId);
    if (!filePath) return;
    writeJsonAtomicInternal(filePath, session);
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
    if (filePath && existsSync(filePath)) unlinkSync(filePath);
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
    // Drop the archived uploads alongside the session so the disk doesn't grow
    // unbounded. Admins who need the files long-term should back them up before
    // the TTL elapses (see scripts/backup-data.sh).
    removeUploadsForSession(session.sessionId);
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
  if (existsSync(SESSION_DIR)) {
    try {
      for (const file of readdirSync(SESSION_DIR)) {
        if (file.endsWith(".json")) unlinkSync(join(SESSION_DIR, file));
      }
    } catch (error) {
      console.warn("[session-store] failed to clear store", error);
    }
  }
  removeAllUploads();
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
 * Implementation: a real async mutex built on a promise chain + a `pending`
 * flag. The flag detects re-entrant writes (a code bug that would bypass the
 * lock) and is also the semaphore any future async writer will wait on. Today
 * the read-modify-write section is synchronous — JS turns don't interleave
 * inside sync code — so the chain resolves immediately. If persist ever moves
 * to async fs, the chain below keeps the serialization invariant without any
 * change at the call sites.
 */
let writeChain: Promise<void> = Promise.resolve();
let pending = false;

function withWriteLock<T>(work: () => T): T {
  if (pending) {
    throw new Error(
      "[session-store] withWriteLock re-entrant call detected — updateSession/createSession/deleteSession called inside another write. This is a bug: the inner call would bypass the lock and break read-modify-write atomicity."
    );
  }
  pending = true;
  try {
    const result = work();
    // Chain a no-op so any future async writer awaits this turn. Settled
    // promises resolve on the next microtask, so the chain stays cheap.
    writeChain = writeChain.then(
      () => undefined,
      () => undefined
    );
    return result;
  } finally {
    pending = false;
  }
}

export function createSession(sessionId: string, accessTokenHash?: string): StoredScanStatus {
  // Fail-closed: in production every session must have an access-token hash on
  // creation, otherwise getSession can't enforce authentication and any caller
  // can read another user's session. Demo/test/dev paths still pass no hash.
  if (process.env.NODE_ENV === "production" && !accessTokenHash) {
    throw new Error(
      "[session-store] createSession requires an accessTokenHash in production; refusing to create an unauthenticated session."
    );
  }
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

export function updateSession(
  sessionId: string,
  patch: Partial<ScanStatus> & { accessTokenHash?: string }
) {
  withWriteLock(() => {
    const store = getStore();
    const current = store.get(sessionId) ?? loadSessionFromFile(sessionId);
    if (!current) {
      console.warn(`[session-store] updateSession: session "${sessionId}" not found`);
      return;
    }

    // Strip the access-token hash from the patch. updateSession must NEVER
    // overwrite `accessTokenHash`: a caller passing `{ accessTokenHash:
    // undefined }` would otherwise clear the hash via the spread below and
    // silently bypass session authentication. Only createSession() sets it,
    // once, at session creation.
    const { accessTokenHash: _stripped, ...patchWithoutHash } = patch;
    void _stripped;

    const now = Date.now();
    const merged: StoredScanStatus = {
      ...current,
      ...patchWithoutHash,
      // Preserve the original hash — never let the spread overwrite it.
      accessTokenHash: current.accessTokenHash,
      error: typeof patch.error === "string" ? patch.error : current.error,
      updatedAt: now,
    };

    // Long tasks (5–15 min RAG scans) outrun the default 1h TTL: a client
    // polling during a slow scan could hit 404 before completion. While the
    // scan is still in progress (progress<100) refresh the TTL on every
    // update so the session stays live as long as the pipeline is making
    // forward progress. Terminal updates (progress=100: ready/failed) keep
    // the original expiry so completed sessions still expire on schedule.
    if (typeof merged.progress === "number" && merged.progress < 100) {
      merged.expiresAt = now + SESSION_TTL_MS;
    }

    store.set(sessionId, merged);
    scheduleExpiry(merged);
    persistSession(merged);
  });
}

/**
 * Hard-delete a session: drop it from the in-memory store, clear its expiry
 * timer, and unlink the on-disk file + archived uploads. Used by /api/scan to
 * roll back a session when enqueueScan fails after createSession has already
 * run — otherwise the client would receive a 503 yet keep polling a session
 * that has no queue job behind it, and "processing" would hang forever.
 */
export function deleteSession(sessionId: string): void {
  if (!validateSessionId(sessionId)) return;
  withWriteLock(() => {
    const store = getStore();
    const timers = getTimers();
    const existing = store.get(sessionId);
    store.delete(sessionId);
    const timer = timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(sessionId);
    }
    removeSessionFile(sessionId);
    if (existing) {
      removeUploadsForSession(sessionId);
    }
  });
}

export function getSession(sessionId: string): StoredScanStatus | undefined {
  if (!validateSessionId(sessionId)) {
    throw new Error("Invalid sessionId");
  }
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
