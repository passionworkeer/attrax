import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || "http://127.0.0.1:8001";
const SAFE_DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ docId: string }> }
): Promise<Response> {
  const { docId } = await context.params;

  if (!docId || !SAFE_DOC_ID.test(docId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_DOC_ID", message: "Invalid regulation doc id" } },
      { status: 400 }
    );
  }

  try {
    const upstreamUrl = `${RAG_SERVICE_URL.replace(/\/+$/, "")}/api/v1/regulations/${encodeURIComponent(docId)}`;
    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: 3600 },
    });

    if (!upstreamRes.ok) {
      return NextResponse.json(
        { success: false, error: { code: "REGULATION_NOT_FOUND", message: "Regulation not found" } },
        { status: upstreamRes.status }
      );
    }

    const data = await upstreamRes.json();
    return NextResponse.json(data, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "UPSTREAM_ERROR",
          message: error instanceof Error ? error.message : "Failed to fetch regulation",
        },
      },
      { status: 502 }
    );
  }
}
