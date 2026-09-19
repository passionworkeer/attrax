import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { z } from "zod";
import { regulationsProjectRoot } from "@/lib/regulations/data-root";
import { adminDb } from "./store";

export const ADMIN_COOKIE = "attrax_admin";
export const SESSION_SECONDS = 8 * 60 * 60;
const configSchema = z.object({ salt: z.string().regex(/^[a-f0-9]{32}$/), passwordHash: z.string().regex(/^[a-f0-9]{128}$/) });

export function verifyAdminPassword(password: string): boolean {
  const config = configSchema.parse(JSON.parse(readFileSync(path.join(regulationsProjectRoot(), ".admin-auth.json"), "utf8")));
  return timingSafeEqual(scryptSync(password, config.salt, 64), Buffer.from(config.passwordHash, "hex"));
}

function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export function createAdminSession(): string {
  const token = randomBytes(32).toString("base64url");
  const db = adminDb();
  db.prepare("DELETE FROM admin_sessions WHERE expires <= ?").run(Date.now());
  db.prepare("INSERT INTO admin_sessions(token_hash, expires) VALUES (?, ?)").run(tokenHash(token), Date.now() + SESSION_SECONDS * 1000);
  return token;
}

export async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return !!adminDb().prepare("SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires > ?").get(tokenHash(token), Date.now());
}

export async function revokeAdminSession(): Promise<void> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (token) adminDb().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const parsed = URL.parse(origin);
  if (!parsed) return false;
  return parsed.host === request.headers.get("host") && (process.env.NODE_ENV !== "production" || parsed.protocol === "https:");
}
