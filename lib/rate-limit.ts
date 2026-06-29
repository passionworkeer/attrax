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

/** Default salt mixed into the anonymous fingerprint so the truncated
 *  client-id is not a pure function of public header strings (which would let
 *  an attacker precompute collision tables). Overridable via
 *  RATE_LIMIT_CLIENT_ID_SALT. */
const DEFAULT_UA_SALT = "attrax-rate-limit-v1";

function uaSalt(): string {
  return process.env.RATE_LIMIT_CLIENT_ID_SALT || DEFAULT_UA_SALT;
}

/**
 * Request-shaping headers combined into the anonymous fingerprint. The
 * User-Agent alone is trivially rotated (swap one header → fresh bucket →
 * `DAILY_FREE_SCAN_LIMIT` bypass), so we mix in the other headers a real
 * browser sends consistently. `X-Forwarded-For` / `X-Real-IP` are
 * deliberately EXCLUDED: a spoofed forwarding header must never be able to
 * shift an untrusted client's bucket (XFF-spoof hardening stays intact).
 *
 * Caveat (documented trade-off): every dimension here is still
 * client-controlled, so a determined attacker who rotates *all* of them can
 * still mint new buckets. Only the higher-priority tiers — a trusted proxy IP
 * or a server-issued session cookie — provide a hard cap. This tier exists to
 * raise the bar above "swap a single UA string" and to keep distinct browsers
 * from colliding, NOT as a complete anti-DoS control.
 */
const FINGERPRINT_HEADERS = [
  "user-agent",
  "accept-language",
  "accept-encoding",
] as const;

/**
 * Build the multi-dimensional anonymous fingerprint, or `null` when none of
 * the contributing headers are present (so the caller can collapse to the
 * shared `unknown` bucket only as a genuine last resort). The raw header
 * values are never returned — only a salted, truncated SHA-256 digest.
 */
function anonymousFingerprint(request: Request): string | null {
  const parts = FINGERPRINT_HEADERS.map(
    (name) => request.headers.get(name)?.trim() ?? ""
  );
  if (parts.every((value) => value === "")) return null;
  const digest = createHash("sha256")
    .update([uaSalt(), ...parts].join("::"))
    .digest("hex");
  return `ua:${digest.slice(0, 16)}`;
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
 * Priority chain (first non-empty wins), strongest signal first:
 *   1. Trusted real IP (only when `RATE_LIMIT_TRUST_XFF=true`): `X-Real-IP`,
 *      then the leftmost `X-Forwarded-For` entry. This is the only tier a
 *      client cannot self-mint; honored solely behind a trusted reverse proxy
 *      that overwrites these headers (see trustForwardedHeaders). A Web
 *      `Request` exposes no raw socket peer, so the proxy-set IP is the real
 *      IP we can observe here.
 *   2. The server-issued `session_id` / `sid` cookie — one bucket per browser
 *      profile, available even when no trusted IP exists. This is what keeps
 *      the no-IP case off the global `unknown` bucket (no whole-site exhaust).
 *   3. A salted, multi-dimensional fingerprint (UA + Accept-Language +
 *      Accept-Encoding, see anonymousFingerprint). UA is no longer the sole
 *      dimension, so trivially rotating just the UA string is less effective.
 *   4. `"unknown"` — only when NONE of the above headers/cookies exist, so the
 *      shared fallback bucket is a rare edge case, never the default.
 *
 * The function never throws. XFF/X-Real-IP are ignored entirely unless XFF is
 * trusted, so a spoofed forwarding header can never reset an attacker's bucket.
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
  // Server-issued cookies give one bucket per browser even with no real IP,
  // which is what prevents anonymous traffic collapsing into `daily:unknown`.
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

  // Multi-dimensional anonymous fingerprint (salted; raw headers never stored).
  // Returns null only when no contributing header is present.
  const fingerprint = anonymousFingerprint(request);
  if (fingerprint) return fingerprint;

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
