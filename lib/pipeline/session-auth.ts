import { createHash, randomBytes, timingSafeEqual } from "crypto";

const TOKEN_BYTES = 32;

export function createAccessToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyAccessToken(token: string, hash: string | undefined): boolean {
  if (!token || !hash) return false;
  const candidate = Buffer.from(hashAccessToken(token), "hex");
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function tokenFromRequest(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  const url = new URL(request.url);
  return url.searchParams.get("token");
}
