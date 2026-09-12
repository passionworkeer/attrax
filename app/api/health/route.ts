/**
 * GET /api/health — Frontend health check
 *
 * Probes the Next.js server itself (liveness, by virtue of serving this route)
 * and the scan service's **readiness** (`/ready`, not `/health`). The scan
 * service's `/health` is a liveness probe that returns 200 whenever the
 * process can serve HTTP — a
 * half-broken scan backend (process up but its regulation index is not loaded)
 * mode) would look "ok" and mask the outage. `/ready` returns 200 only when the
 * gate checks pass (bm25 / minimax key / config / scan_service) and 503 otherwise,
 * so this route surfaces real degradation. The restart window (~30-60s, /ready
 * 503 while deps reload) is absorbed by the uptime-alert state machine.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL ?? "http://localhost:8001";
const HEALTH_TIMEOUT_MS = 5_000;

export const runtime = "nodejs";

/**
 * Minimal schema for the scan backend `/ready` response. We only consume `ready`;
 * `checks` / `version` are tolerated silently. Malformed JSON or an unexpected
 * shape degrades to `error` rather than throwing a 500.
 */
const RagReadySchema = z.object({
  ready: z.boolean(),
}).passthrough();

export async function GET() {
  const result = {
    timestamp: new Date().toISOString(),
    frontend: "ok" as const,
    scanService: {
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

    const resp = await fetch(`${RAG_SERVICE_URL}/ready`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    result.scanService.responseTimeMs = Date.now() - start;

    if (resp.ok) {
      const parsed = RagReadySchema.safeParse(await resp.json());
      if (parsed.success) {
        result.scanService.status = parsed.data.ready ? "ok" : "error";
        if (!parsed.data.ready) {
          result.scanService.error = "scan backend dependencies not ready";
        }
      } else {
        result.scanService.status = "error";
        result.scanService.error = "invalid readiness response shape";
      }
    } else {
      // /ready returns 503 (with a checks body) when a gate check fails.
      result.scanService.status = "error";
      result.scanService.error = `HTTP ${resp.status}`;
    }
  } catch (err: unknown) {
    result.scanService.responseTimeMs = Date.now() - start;
    result.scanService.status = "unreachable";
    if (err instanceof Error) {
      result.scanService.error = err.name === "AbortError" ? "timeout" : err.message;
    }
  }

  const allOk = result.frontend === "ok" && result.scanService.status === "ok";

  return NextResponse.json(result, { status: allOk ? 200 : 503 });
}
