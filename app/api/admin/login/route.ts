import { NextResponse } from "next/server";
import { ADMIN_COOKIE, SESSION_SECONDS, createAdminSession, sameOrigin, verifyAdminPassword } from "@/lib/admin/auth";
import { checkRateLimit, resolveClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403, headers });
  if (!checkRateLimit(`admin-login:${resolveClientId(request)}`, 5, 15 * 60_000)) return NextResponse.json({ error: "登录尝试过多，请在 15 分钟后重试" }, { status: 429, headers });
  const text = await request.text();
  if (text.length > 4096) return NextResponse.json({ error: "请求过大" }, { status: 413, headers });
  let password: unknown;
  try { password = JSON.parse(text).password; } catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400, headers }); }
  if (typeof password !== "string" || password.length < 16 || password.length > 256) return NextResponse.json({ error: "管理员密码错误" }, { status: 401, headers });
  try {
    if (!verifyAdminPassword(password)) return NextResponse.json({ error: "管理员密码错误" }, { status: 401, headers });
    const response = NextResponse.json({ success: true }, { headers });
    response.cookies.set(ADMIN_COOKIE, createAdminSession(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: SESSION_SECONDS });
    return response;
  } catch (error) {
    console.error("[admin] login unavailable", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ error: "管理员登录尚未配置或暂时不可用" }, { status: 503, headers });
  }
}
