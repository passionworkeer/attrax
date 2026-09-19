import { NextResponse } from "next/server";
import { ADMIN_COOKIE, revokeAdminSession, sameOrigin } from "@/lib/admin/auth";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  await revokeAdminSession();
  const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
