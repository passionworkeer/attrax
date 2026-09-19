import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin/auth";
import { getAdminOverview } from "@/lib/admin/overview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (!await isAdmin()) return NextResponse.json({ error: "请先登录管理员账户" }, { status: 401, headers });
  const days = Number(new URL(request.url).searchParams.get("days") ?? "30");
  if (![7, 30, 90].includes(days)) return NextResponse.json({ error: "仅支持 7、30、90 天" }, { status: 400, headers });
  try { return NextResponse.json(await getAdminOverview(days), { headers }); }
  catch (error) {
    console.error("[admin] overview failed", error instanceof Error ? error.message : "Error");
    return NextResponse.json({ error: "统计数据读取失败，请检查服务日志后重试" }, { status: 503, headers });
  }
}
