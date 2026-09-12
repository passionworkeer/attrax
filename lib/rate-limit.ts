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
import { dirname, join, resolve } from "path";

type Bucket = { count: number; resetAt: number };

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitBuckets: Map<string, Bucket> | undefined;
}

const EVICT_ABOVE_SIZE = 5000;
const DEFAULT_UA_SALT = "attrax-rate-limit-v2";
const LOCK_STALE_MS = 10_000;
const LOCK_RETRIES = 20;
const LOCK_RETRY_MS = 10;
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

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
  if (trustForwardedHeaders()) {
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return `ip:${digestIdentifier(realIp)}`;
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

function sleep(ms: number): void {
  Atomics.wait(SLEEP_BUFFER, 0, 0, ms);
}

function acquireLock(lockPath: string): boolean {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        // The lock disappeared between checks; retry immediately.
      }
      sleep(LOCK_RETRY_MS);
    }
  }
  return false;
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
  const lockPath = `${path}.lock`;
  if (!acquireLock(lockPath)) return false;

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
    rmSync(lockPath, { recursive: true, force: true });
  }
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
    console.error("rate_limit_store_failure", {
      message: error instanceof Error ? error.message : String(error),
      directory: dirname(storeDirectory()),
    });
    // Cost-control boundary: fail closed when the shared store is unavailable.
    return false;
  }
}
