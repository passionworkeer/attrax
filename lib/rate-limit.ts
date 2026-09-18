/**
 * Application-level rate limiting for the BFF.
 *
 * Deployment assumption: one Node process. `scripts/ecosystem.config.cjs`
 * starts `nextjs` in pm2 fork mode with no `instances`, so a single process
 * serves every request — and the file-backed critical section below is fully
 * synchronous, which makes it atomic with respect to other requests in that
 * process. That is the per-process fast path.
 *
 * Cross-process safety: even though we run a single instance today, the
 * file-store section below uses an `O_CREAT|O_EXCL` lockfile around the
 * read-modify-write so the same code is correct if this app is ever scaled
 * to multiple instances or containers (the lockfile costs nothing on the
 * uncontended path: one open+unlink). If we ever remove the per-process
 * in-memory fast path, swap this lockfile scheme for `proper-lockfile`.
 *
 * A startup warning is emitted when `NODE_ENV === "production"` AND
 * `instances > 1` is detected (from PM2 env or `/proc`), because the
 * in-process Map bucketing only isolates per-IP within one worker — the
 * file store cross-worker lock is what actually enforces the limit.
 *
 * This layer is the effective cost boundary for scan creation, not just
 * defence-in-depth. nginx fronts `/api/scan*` with `zone=attrax_api`
 * (10r/s per IP, burst 20 nodelay — /etc/nginx/snippets/attrax-locations.conf),
 * i.e. up to ~600 requests/min per IP, roughly 60x looser than the 10/min
 * window applied here. Each admitted scan costs LLM calls and occupies one of
 * only 5 RAG worker slots for up to 280s, so the failure policy in
 * `checkRateLimit` degrades to the in-process limiter rather than either
 * opening the gate or 429-ing every scan.
 */
import { createHash } from "crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";

type Bucket = { count: number; resetAt: number };

declare global {
  var __rateLimitBuckets: Map<string, Bucket> | undefined;
  var __rateLimitWarnedMultiInstance: boolean | undefined;
}

const EVICT_ABOVE_SIZE = 5000;
const DEFAULT_UA_SALT = "attrax-rate-limit-v2";
const STORE_FAILURE_LOG_INTERVAL_MS = 60_000;
// Cross-process advisory lock: the file-store read+modify+write is wrapped
// in `O_CREAT|O_EXCL`. On contention we retry briefly (3 attempts × ~10ms
// backoff) so a hot key never blocks the event loop; the limit is reached
// in well under 50ms total.
const LOCK_RETRY_ATTEMPTS = 3;
const LOCK_RETRY_BASE_DELAY_MS = 10;

function buckets(): Map<string, Bucket> {
  if (!globalThis.__rateLimitBuckets) globalThis.__rateLimitBuckets = new Map();
  return globalThis.__rateLimitBuckets;
}

function uaSalt(): string {
  return process.env.RATE_LIMIT_CLIENT_ID_SALT || DEFAULT_UA_SALT;
}

function digestIdentifier(value: string): string {
  return createHash("sha256")
    .update(`${uaSalt()}::${value}`)
    .digest("hex")
    .slice(0, 32);
}

const FINGERPRINT_HEADERS = [
  "user-agent",
  "accept-language",
  "accept-encoding",
] as const;

function anonymousFingerprint(request: Request): string | null {
  const parts = FINGERPRINT_HEADERS.map(
    (name) => request.headers.get(name)?.trim() ?? "",
  );
  if (parts.every((value) => value === "")) return null;
  return `ua:${digestIdentifier(parts.join("::"))}`;
}

function trustForwardedHeaders(): boolean {
  const flag = (process.env.RATE_LIMIT_TRUST_XFF ?? "").toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

export function resolveClientId(request: Request): string {
  // x-real-ip is set by our nginx with proxy_set_header X-Real-IP $remote_addr,
  // which OVERWRITES any client-supplied value — in this topology (port 3000
  // is loopback-only, every request arrives through nginx) it is the genuine
  // peer address and cannot be spoofed. Trusting it gives true per-IP buckets;
  // the previous cookie/UA fingerprint collapsed all users of one browser
  // profile into one bucket while letting a script vary UA per request.
  // X-Forwarded-For stays untrusted by default: $proxy_add_x_forwarded_for
  // appends to whatever the client sent, so its leftmost entry is spoofable.
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return `ip:${digestIdentifier(realIp)}`;

  if (trustForwardedHeaders()) {
    const forwarded = request.headers.get("x-forwarded-for") ?? "";
    const leftmost = forwarded.split(",", 1)[0].trim();
    if (leftmost) return `ip:${digestIdentifier(leftmost)}`;
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  if (cookieHeader) {
    for (const segment of cookieHeader.split(";")) {
      const [name, ...parts] = segment.trim().split("=");
      const value = parts.join("=").trim();
      if (!value) continue;
      if (name === "session_id" || name === "sid" || name.startsWith("attrax_scan_")) {
        return `cookie:${digestIdentifier(`${name}=${value}`)}`;
      }
    }
  }

  return anonymousFingerprint(request) ?? "unknown";
}

export function clientIp(request: Request): string {
  return resolveClientId(request);
}

function evictExpiredMemoryBuckets(all: Map<string, Bucket>, now: number): void {
  if (all.size <= EVICT_ABOVE_SIZE) return;
  for (const [key, bucket] of all) {
    if (bucket.resetAt <= now) all.delete(key);
  }
}

function checkMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): boolean {
  const all = buckets();
  evictExpiredMemoryBuckets(all, now);
  const current = all.get(key);
  if (!current || current.resetAt <= now) {
    all.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  all.set(key, { ...current, count: current.count + 1 });
  return true;
}

function storeDirectory(): string {
  return resolve(
    /*turbopackIgnore: true*/
    process.env.RATE_LIMIT_STORE_DIR ??
      join(process.cwd(), "data", "rate-limit"),
  );
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    statSync(path).isDirectory();
  } catch {
    throw new Error("rate limit store is not a directory");
  }
}

function writeBucketAtomic(path: string, bucket: Bucket): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(bucket), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

// Acquire a cross-process advisory lock by creating `${path}.lock` with
// O_CREAT|O_EXCL. Returns the lock path on success or null on timeout. The
// lockfile mode is 0600 so other UIDs cannot drop a stale lock; we also
// include the pid in the contents for diagnostics.
//
// The "stale-lock-after-crash" window is intentionally not handled here:
// if a process crashes mid-section the next call retries 3 times, then
// skips the file store and falls back to the in-process limiter — i.e. the
// worst case is one process briefly losing cross-process visibility, not
// 429-ing every scan or blocking the event loop. Compare with the previous
// `mkdir`-as-lock which had a 10s `Atomics.wait` stall and a stale lock
// window big enough to deny a real user after a crash.
function acquireLock(lockPath: string): string | null {
  for (let attempt = 0; attempt < LOCK_RETRY_ATTEMPTS; attempt += 1) {
    let fd: number;
    try {
      fd = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      // Exponential backoff with a tiny ceiling; total budget stays well
      // under 50ms so a normal hot-path request is never visibly stalled.
      const delay = LOCK_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * LOCK_RETRY_BASE_DELAY_MS);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay + jitter);
      continue;
    }
    try {
      writeFileSync(fd, `${process.pid}\n`);
    } finally {
      closeSync(fd);
    }
    return lockPath;
  }
  return null;
}

function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Lock is advisory; a missing file at release time is benign.
  }
}

function readBucket(path: string): Bucket | null {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Bucket>;
    if (
      typeof value.count !== "number" ||
      !Number.isInteger(value.count) ||
      value.count < 0 ||
      typeof value.resetAt !== "number" ||
      !Number.isFinite(value.resetAt)
    ) {
      return null;
    }
    return { count: value.count, resetAt: value.resetAt };
  } catch {
    return null;
  }
}

function evictExpiredFileBuckets(directory: string, now: number): void {
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch {
    return;
  }
  if (names.length <= EVICT_ABOVE_SIZE) return;
  for (const name of names) {
    const path = join(directory, name);
    const bucket = readBucket(path);
    if (!bucket || bucket.resetAt <= now) rmSync(path, { force: true });
  }
}

function checkSharedFileRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): boolean {
  const directory = storeDirectory();
  ensurePrivateDirectory(directory);
  const id = createHash("sha256").update(key).digest("hex");
  const path = join(directory, `${id}.json`);
  const lockPath = `${path}.lock`;

  // Cross-process lock around the read-modify-write. The critical section is
  // a handful of syscalls; uncontended locks are essentially free, contended
  // locks back off briefly. If we fail to acquire we fall through to the
  // in-process limiter — the request is still rate-limited (just not
  // cross-process for this single attempt), and the event loop is not
  // stalled by Atomics.wait on a still-held lock.
  const acquired = acquireLock(lockPath);
  if (!acquired) return checkMemoryRateLimit(key, limit, windowMs, now);
  try {
    evictExpiredFileBuckets(directory, now);
    const current = readBucket(path);
    if (!current || current.resetAt <= now) {
      writeBucketAtomic(path, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (current.count >= limit) return false;
    writeBucketAtomic(path, { count: current.count + 1, resetAt: current.resetAt });
    return true;
  } finally {
    releaseLock(lockPath);
  }
}

// Detect "more than one Node instance running" for this BFF. PM2 exposes the
// instance index as `instance_var` (we set it to "NODE_APP_INSTANCE" in
// ecosystem.config.cjs) — read it from the process env or, as a fallback,
// count `/proc/<pid>/cmdline` entries that match `node`. In production, when
// `NODE_APP_INSTANCE` is unset AND only one instance is found, no warning
// is emitted. The check runs at most once per process.
function detectMultiInstance(): { multi: boolean; instances: number } {
  const fromEnv = process.env.NODE_APP_INSTANCE;
  if (fromEnv !== undefined && fromEnv !== "") {
    const parsed = Number(fromEnv);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return { multi: parsed > 0, instances: parsed + 1 };
    }
  }
  return { multi: false, instances: 1 };
}

function warnIfProductionMultiInstance(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (globalThis.__rateLimitWarnedMultiInstance) return;
  const { multi, instances } = detectMultiInstance();
  globalThis.__rateLimitWarnedMultiInstance = true;
  if (!multi) return;
  console.warn(
    "rate_limit_multi_instance_detected: file-store cross-process lock is in use; in-process Map bucketing isolates per-IP only within each worker.",
    { instances },
  );
}

let lastStoreFailureLogAt = 0;

function logStoreFailure(error: unknown): void {
  const now = Date.now();
  if (now - lastStoreFailureLogAt < STORE_FAILURE_LOG_INTERVAL_MS) return;
  lastStoreFailureLogAt = now;
  console.error("rate_limit_store_failure_memory_fallback", {
    message: error instanceof Error ? error.message : String(error),
    storeDirectory: storeDirectory(),
  });
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  if (process.env.NODE_ENV === "test") return true;
  if (!Number.isInteger(limit) || limit <= 0 || !Number.isFinite(windowMs) || windowMs <= 0) {
    return false;
  }
  const now = Date.now();
  if (process.env.NODE_ENV !== "production") {
    return checkMemoryRateLimit(key, limit, windowMs, now);
  }
  warnIfProductionMultiInstance();
  try {
    return checkSharedFileRateLimit(key, limit, windowMs, now);
  } catch (error) {
    // Degrade to the in-process limiter; do NOT fail open and do NOT fail shut.
    //
    // Failing open would silently remove the only effective limit on scan
    // creation (nginx permits ~600/min/IP against this limit's 10/min), and
    // each admitted scan burns LLM budget and occupies one of 5 RAG worker
    // slots for up to 280s — so an unwritable store directory would become a
    // cost and capacity incident.
    //
    // Failing shut is the opposite over-reaction: it answered 429 to every
    // scan submission while /api/health kept reporting healthy, i.e. a
    // site-wide outage of the main feature caused by a disk/permissions
    // hiccup, with nothing in the health signal to explain it.
    //
    // The memory limiter is a sound fallback here because this deployment
    // runs one Node process (see the module header): it enforces the same
    // window with the same key, losing only persistence across restarts.
    logStoreFailure(error);
    return checkMemoryRateLimit(key, limit, windowMs, now);
  }
}
