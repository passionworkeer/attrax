/**
 * GET /api/health/watchdog — BFF pass-through to the RAG service
 *
 * The RAG service exposes the actual regwatch state under
 * `GET /health/watchdog` (see `rag_service/main.py:_watchdog_snapshot`).
 * This BFF mirrors that endpoint with a 5s timeout so the Next.js layer
 * does not hold a render open if the RAG process is wedged. The payload
 * is opaque to the front-end — we only validate that it's a JSON object
 * so a 502 / 504 / parse failure cannot crash the consumer.
 *
 * Why a separate endpoint from `/api/health`: `/api/health` probes
 * `/ready` (liveness of the LLM path), and a degraded but-recovering
 * RAG process can still pass that while the watchdog is several days
 * behind. Operators need a dedicated dial for "regwatch health"
 * without confusing it with the user-facing readiness probe.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL ?? "http://localhost:8001";
const WATCHDOG_TIMEOUT_MS = 5_000;

export const runtime = "nodejs";

/**
 * Minimal schema — the front-end today only renders the
 * counts/booleans for monitoring. New fields can be added by the RAG
 * service without changing this schema (passthrough tolerates them),
 * but a non-object response still degrades to "error".
 */
const RagWatchdogSchema = z
  .object({
    last_pass_date: z.union([z.string(), z.null()]).optional(),
    last_pass_at: z.union([z.string(), z.null()]).optional(),
    last_pass_exit_code: z.number().int().optional(),
    sources_total: z.number().int().optional(),
    sources_failed_today: z.number().int().optional(),
    sources_changed_today: z.number().int().optional(),
  })
  .passthrough();

export async function GET() {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WATCHDOG_TIMEOUT_MS);

    const resp = await fetch(`${RAG_SERVICE_URL}/health/watchdog`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "RAG_UNHEALTHY",
            message: `RAG /health/watchdog returned HTTP ${resp.status}`,
          },
          responseTimeMs: Date.now() - start,
        },
        { status: 502 },
      );
    }

    const body = await resp.json();
    const parsed = RagWatchdogSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "RAG_INVALID_RESPONSE",
            message: "RAG /health/watchdog returned an unexpected shape",
          },
          responseTimeMs: Date.now() - start,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { ok: true, data: parsed.data, responseTimeMs: Date.now() - start },
      { status: 200 },
    );
  } catch (err: unknown) {
    const responseTimeMs = Date.now() - start;
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "TIMEOUT", message: "RAG /health/watchdog timed out" },
          responseTimeMs,
        },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UNREACHABLE",
          message: err instanceof Error ? err.message : "unknown error",
        },
        responseTimeMs,
      },
      { status: 502 },
    );
  }
}
