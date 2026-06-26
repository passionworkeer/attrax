type Bucket = { count: number; resetAt: number };

declare global {
  var __rateLimitBuckets: Map<string, Bucket> | undefined;
}

function buckets(): Map<string, Bucket> {
  if (!globalThis.__rateLimitBuckets) {
    globalThis.__rateLimitBuckets = new Map();
  }
  return globalThis.__rateLimitBuckets;
}

export function clientIp(request: Request): string {
  // X-Forwarded-For is trivially spoofable by clients when the app is
  // reachable without a trusted upstream proxy — anyone can send
  // "X-Forwarded-For: 1.2.3.4" and reset their bucket. Prefer X-Real-IP
  // (commonly set by nginx in front of this app) which is a single value
  // and harder to inject, then fall back to the leftmost XFF entry for
  // legitimate proxy chains, then "unknown" for direct connections.
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",", 1)[0].trim() || "unknown";
}

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  if (process.env.NODE_ENV === "test") return true;
  const now = Date.now();
  const all = buckets();
  const current = all.get(key);
  if (!current || current.resetAt <= now) {
    all.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  all.set(key, { ...current, count: current.count + 1 });
  return true;
}
