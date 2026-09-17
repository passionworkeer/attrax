/**
 * Application-level rate limiting for the BFF.
 *
 * Deployment assumption: one Node process. `scripts/ecosystem.config.cjs`
 * starts `nextjs` in pm2 fork mode with no `instances`, so a single process
 * serves every request — and the file-backed critical section below is fully
 * synchronous, which makes it atomic with respect to other requests in that
 * process. That is why there is no lock file: the previous `mkdir`-as-lock
 * scheme only ever bought cross-process safety, while costing `Atomics.wait`
 * event-loop stalls (up to 200ms per contended request) and a 10s stale-lock
 * window that could 429 a bucket after a crash. Re-introduce a real
 * cross-process lock if this app is ever scaled to multiple instances or
 * containers.
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
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";

type Bucket = { count: number; resetAt: number };

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitBuckets: Map<string, Bucket> | undefined;
}

const EVICT_ABOVE_SIZE = 5000;
const DEFAULT_UA_SALT = "attrax-rate-limit-v2";
const STORE_FAILURE_LOG_INTERVAL_MS = 60_000;

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

  // No lock: this function is synchronous and Node runs one request at a time
  // on the event loop, so the read-modify-write below cannot interleave with
  // another request in this process. See the module header for the
  // single-instance assumption and what to do if that changes.
  evictExpiredFileBuckets(directory, now);
  const current = readBucket(path);
  if (!current || current.resetAt <= now) {
    writeBucketAtomic(path, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  writeBucketAtomic(path, { count: current.count + 1, resetAt: current.resetAt });
  return true;
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
