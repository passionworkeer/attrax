/**
 * GET /api/health — Frontend health check
 *
 * Probes both the Next.js server itself (liveness) and the RAG service (readiness).
 * Frontend components can call this before enabling certain features.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL ?? "http://localhost:8001";
const HEALTH_TIMEOUT_MS = 5_000;

export const runtime = "nodejs";

/**
 * Minimal schema for the RAG /health response. We only consume `status` /
 * `demo_mode`; everything else is ignored. RAG returning malformed JSON or an
 * unexpected shape degrades to `unreachable` rather than throwing a 500.
 */
const RagHealthSchema = z.object({
  status: z.string(),
  demo_mode: z.boolean().optional(),
  // Tolerate extra fields silently (the RAG service exposes faiss_index, etc.)
}).passthrough();

export async function GET() {
  const result = {
    timestamp: new Date().toISOString(),
    frontend: "ok" as const,
    ragService: {
      status: "unknown" as string,
      responseTimeMs: null as number | null,
      error: null as string | null,
    },
    demoMode: process.env.DEMO_MODE === "true",
  };

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    const resp = await fetch(`${RAG_SERVICE_URL}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    result.ragService.responseTimeMs = Date.now() - start;

    if (resp.ok) {
      const parsed = RagHealthSchema.safeParse(await resp.json());
      if (parsed.success) {
        result.ragService.status = parsed.data.status;
      } else {
        // RAG responded 2xx but with an unexpected body — treat as unhealthy
        // so a half-broken RAG does not silently look "ok".
        result.ragService.status = "error";
        result.ragService.error = "invalid health response shape";
      }
    } else {
      result.ragService.status = "error";
      result.ragService.error = `HTTP ${resp.status}`;
    }
  } catch (err: unknown) {
    result.ragService.responseTimeMs = Date.now() - start;
    result.ragService.status = "unreachable";
    if (err instanceof Error) {
      result.ragService.error = err.name === "AbortError" ? "timeout" : err.message;
    }
  }

  const allOk =
    result.frontend === "ok" &&
    (result.ragService.status === "ok" || result.ragService.status === "DEMO");

  return NextResponse.json(result, { status: allOk ? 200 : 503 });
}
