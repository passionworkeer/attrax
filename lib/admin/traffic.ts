import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { NextRequest, NextResponse } from "next/server";
import { regulationsProjectRoot } from "@/lib/regulations/data-root";
import { adminDb } from "./store";

const publicPages = /^\/(?:$|upload\/?$|regulations\/?$|pricing\/?$|profit\/?$|(?:result|burning)\/[^/]+\/?$)/;
const publicApis = /^\/api\/(?:scan|regulations|report)(?:\/|$)/;

export function recordTraffic(request: NextRequest, response: NextResponse): Promise<void> {
  if (!existsSync(path.join(regulationsProjectRoot(), ".admin-auth.json"))) return Promise.resolve();
  const pathname = request.nextUrl.pathname;
  const isPage = request.method === "GET" && publicPages.test(pathname);
  const isApi = publicApis.test(pathname);
  if (!isPage && !isApi) return Promise.resolve();
  if (request.headers.has("next-router-prefetch") || request.headers.get("purpose") === "prefetch" || request.headers.get("sec-purpose")?.includes("prefetch")) return Promise.resolve();
  if (/bot|crawler|spider|headless|uptime|monitor/i.test(request.headers.get("user-agent") ?? "")) return Promise.resolve();
  const supplied = request.cookies.get("attrax_visitor")?.value;
  const visitor = supplied && /^[0-9a-f-]{36}$/.test(supplied) ? supplied : randomUUID();
  if (visitor !== supplied) response.cookies.set("attrax_visitor", visitor, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 86400 });
  const timestamp = new Date().toISOString();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
  // 不记录 IP、查询参数、上传内容或会话标识；路径只保留业务分类。
  const route = pathname.replace(/^(\/(?:result|burning))\/[^/]+/, "$1/:session").replace(/^(\/api\/(?:scan|report))\/[^/]+/, "$1/:session");
  return Promise.resolve().then(() => {
    const db = adminDb();
    db.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES ('traffic_since', ?)").run(timestamp);
    db.prepare("INSERT INTO traffic(timestamp, day, visitor, kind, path) VALUES (?, ?, ?, ?, ?)").run(timestamp, day, createHash("sha256").update(visitor).digest("hex"), isPage ? "page" : "api", route);
  });
}
