import { createHash } from "crypto";

type Bucket = { count: number; resetAt: number };

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitBuckets: Map<string, Bucket> | undefined;
}

function buckets(): Map<string, Bucket> {
  if (!globalThis.__rateLimitBuckets) {
    globalThis.__rateLimitBuckets = new Map();
  }
  return globalThis.__rateLimitBuckets;
}

/** Hard cap above which stale entries get evicted on the next checkRateLimit
 *  call. Prevents unbounded growth of `__rateLimitBuckets` across days (each
 *  IP+day combo otherwise lingers until process restart). */
const EVICT_ABOVE_SIZE = 5000;

/** Default salt mixed into the UA hash so the truncated client-id is not a
 *  pure function of public UA strings (which would let an attacker precompute
 *  collision tables). Overridable via RATE_LIMIT_CLIENT_ID_SALT. */
const DEFAULT_UA_SALT = "attrax-rate-limit-v1";

function uaSalt(): string {
  return process.env.RATE_LIMIT_CLIENT_ID_SALT || DEFAULT_UA_SALT;
}

/**
 * Whether to trust forwarding headers (X-Forwarded-For / X-Real-IP) for the
 * client IP. Default is `false` because these headers are trivially spoofable
 * by any client that can reach the app directly. Set `RATE_LIMIT_TRUST_XFF=true`
 * ONLY when the app is deployed behind a trusted reverse proxy that
 * unconditionally overwrites these headers before forwarding. Vercel and most
 * managed platforms already strip/replace XFF, so `true` is safe there.
 */
function trustForwardedHeaders(): boolean {
  const flag = (process.env.RATE_LIMIT_TRUST_XFF ?? "").toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

/**
 * Resolve the client IP used as a rate-limit key.
 *
 * Security model: by default we do NOT trust XFF / X-Real-IP — an attacker
 * sending `X-Forwarded-For: <random>` cannot reset their bucket. When the app
 * is behind a trusted reverse proxy, set `RATE_LIMIT_TRUST_XFF=true` and the
 * proxy-set headers (X-Real-IP first, then leftmost XFF) are honored.
 *
 * The function never throws; unknown connections collapse to "unknown" so the
 * fallback rate-limit bucket is shared (still bounded by `limit`).
 */
/**
 * Resolve a stable client identifier used as a rate-limit key.
 *
 * Priority chain (first non-empty wins):
 *   1. When `RATE_LIMIT_TRUST_XFF=true`: trusted `X-Real-IP`, then the
 *      leftmost `X-Forwarded-For` entry (only honored behind a trusted
 *      reverse proxy that overwrites these headers — see trustForwardedHeaders).
 *   2. The `session_id` / `sid` cookie (issued to returning users).
 *   3. A salted SHA-256 of the `User-Agent`, truncated to 16 hex chars. The
 *      raw UA is never stored; only the truncated digest becomes a bucket key.
 *   4. `"unknown"` — only reached when none of the above is present, so the
 *      shared fallback bucket stays a rare edge case instead of the default.
 *
 * The function never throws. The goal is that two distinct browser
 * fingerprints (e.g. different UAs) cannot share a daily cap when XFF is not
 * trusted — closing the previous "everyone is `unknown`" blast-radius hole.
 */
export function resolveClientId(request: Request): string {
  if (trustForwardedHeaders()) {
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
    const forwarded = request.headers.get("x-forwarded-for") ?? "";
    const leftmost = forwarded.split(",", 1)[0].trim();
    if (leftmost) return leftmost;
  }

  // Cookie header: prefer our own session markers over arbitrary cookies.
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (cookieHeader) {
    for (const name of ["session_id", "sid"]) {
      const match = cookieHeader.match(
        new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)
      );
      if (match && match[1].trim()) {
        return `cookie:${match[1].trim()}`;
      }
    }
  }

  // UA-based fingerprint. Salted + hashed so the bucket key is not a pure
  // function of a public string, and never stored as raw UA.
  const ua = request.headers.get("user-agent")?.trim();
  if (ua) {
    const digest = createHash("sha256")
      .update(`${uaSalt()}::${ua}`)
      .digest("hex");
    return `ua:${digest.slice(0, 16)}`;
  }

  return "unknown";
}

/**
 * Backwards-compatible wrapper. Historical callers (e.g. scan route) use
 * `clientIp(request)` as the rate-limit key; this now delegates to
 * `resolveClientId` so the same richer identifier is used everywhere without
 * touching call sites.
 */
export function clientIp(request: Request): string {
  return resolveClientId(request);
}

function evictExpiredBuckets(all: Map<string, Bucket>, now: number): void {
  if (all.size <= EVICT_ABOVE_SIZE) return;
  for (const [key, bucket] of all) {
    if (bucket.resetAt <= now) all.delete(key);
  }
}

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  if (process.env.NODE_ENV === "test") return true;
  const now = Date.now();
  const all = buckets();
  evictExpiredBuckets(all, now);
  const current = all.get(key);
  if (!current || current.resetAt <= now) {
    all.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  all.set(key, { ...current, count: current.count + 1 });
  return true;
}
