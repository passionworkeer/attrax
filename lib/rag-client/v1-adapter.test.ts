/**
 * lib/rag-client/v1-adapter.test.ts
 *
 * Unit tests for the v1 FastAPI client wrapper. fetch is mocked globally
 * (tests/setup.ts) so no real network calls are made.
 *
 * Coverage:
 *   - unwrapV1Envelope: success, error envelope, empty data
 *   - createScan: success, AbortError→TIMEOUT, non-2xx→UNAVAILABLE
 *   - getScan: success, 401→UNAUTHORIZED, 404→NOT_FOUND
 *   - isDemoSession
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createScan,
  getScan,
  getRagServiceUrl,
  isDemoSession,
  unwrapV1Envelope,
  V1EnvelopeError,
  type V1SessionData,
} from "@/lib/rag-client/v1-adapter";

type FetchMock = ReturnType<typeof vi.fn>;

const mockFetch = globalThis.fetch as unknown as FetchMock;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers ?? {});
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

function emptyResponse(status: number, headers: Record<string, string> = {}): Response {
  const h = new Headers(headers);
  return new Response(null, { status, headers: h });
}

describe("v1-adapter", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("unwrapV1Envelope", () => {
    it("returns data on success", () => {
      const data = { sessionId: "scan_abc" };
      expect(unwrapV1Envelope({ data, error: null, meta: { requestId: "r1" } })).toEqual(data);
    });

    it("throws V1EnvelopeError on error envelope", () => {
      expect(() =>
        unwrapV1Envelope({
          data: null,
          error: { code: "INVALID_REQUEST", message: "bad input" },
          meta: { requestId: "r2" },
        }),
      ).toThrow(V1EnvelopeError);

      try {
        unwrapV1Envelope({
          data: null,
          error: { code: "INVALID_REQUEST", message: "bad input" },
          meta: { requestId: "r2" },
        });
      } catch (err) {
        expect(err).toBeInstanceOf(V1EnvelopeError);
        const e = err as V1EnvelopeError;
        expect(e.code).toBe("INVALID_REQUEST");
        expect(e.message).toBe("bad input");
        expect(e.requestId).toBe("r2");
      }
    });

    it("throws V1EnvelopeError(EMPTY_RESPONSE) when data is null with no error", () => {
      try {
        unwrapV1Envelope({ data: null, error: null, meta: { requestId: "r3" } });
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(V1EnvelopeError);
        const e = err as V1EnvelopeError;
        expect(e.code).toBe("EMPTY_RESPONSE");
        expect(e.httpStatus).toBe(502);
        expect(e.requestId).toBe("r3");
      }
    });
  });

  describe("createScan", () => {
    it("successful POST returns CreatedScanData and sends multipart fields", async () => {
      const created = {
        sessionId: "scan_xyz",
        accessToken: "tok-1",
        status: "processing" as const,
        pollUrl: "/api/v1/scans/scan_xyz",
      };
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: created, error: null, meta: { requestId: "req-1" } }, { status: 202 }),
      );

      const result = await createScan({
        query: "test",
        product: "widget",
        category: "electronics",
        markets: ["EU", "US"],
        images: [{ buffer: Buffer.from("img"), originalName: "a.png", mimeType: "image/png" }],
      });

      expect(result).toEqual(created);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:8001/api/v1/scans");
      expect(init.method).toBe("POST");
      expect(init.body).toBeInstanceOf(FormData);
    });

    it("AbortError maps to RAG_SERVICE_TIMEOUT", async () => {
      const abortErr = new Error("aborted");
      abortErr.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortErr);

      try {
        await createScan({
          query: "q",
          category: "electronics",
          markets: ["EU"],
          images: [{ buffer: Buffer.from(""), originalName: "x.png", mimeType: "image/png" }],
        });
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(V1EnvelopeError);
        const e = err as V1EnvelopeError;
        expect(e.code).toBe("RAG_SERVICE_TIMEOUT");
        expect(e.httpStatus).toBe(504);
      }
    });

    it("non-2xx maps to RAG_SERVICE_UNAVAILABLE with the response status", async () => {
      mockFetch.mockResolvedValueOnce(emptyResponse(503, { "x-request-id": "req-503" }));

      try {
        await createScan({
          query: "q",
          category: "electronics",
          markets: ["EU"],
          images: [{ buffer: Buffer.from(""), originalName: "x.png", mimeType: "image/png" }],
        });
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(V1EnvelopeError);
        const e = err as V1EnvelopeError;
        expect(e.code).toBe("RAG_SERVICE_UNAVAILABLE");
        expect(e.httpStatus).toBe(503);
        expect(e.requestId).toBe("req-503");
      }
    });
  });

  describe("getScan", () => {
    it("successful GET returns V1SessionData", async () => {
      const session: V1SessionData = {
        sessionId: "scan_abc",
        status: "ready",
        progress: 100,
        stageText: "complete",
        category: "electronics",
        markets: ["EU"],
        createdAt: "2026-07-17T00:00:00Z",
        updatedAt: "2026-07-17T00:01:00Z",
        result: {},
        error: null,
      };
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: session, error: null, meta: { requestId: "r1" } }),
      );

      const result = await getScan({ sessionId: "scan_abc", accessToken: "tok" });

      expect(result).toEqual(session);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:8001/api/v1/scans/scan_abc");
      expect(init.method).toBe("GET");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    });

    it("401 maps to V1EnvelopeError(UNAUTHORIZED)", async () => {
      mockFetch.mockResolvedValueOnce(emptyResponse(401, { "x-request-id": "r401" }));

      try {
        await getScan({ sessionId: "scan_abc", accessToken: "bad" });
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(V1EnvelopeError);
        const e = err as V1EnvelopeError;
        expect(e.code).toBe("UNAUTHORIZED");
        expect(e.httpStatus).toBe(401);
        expect(e.requestId).toBe("r401");
      }
    });

    it("404 maps to V1EnvelopeError(NOT_FOUND)", async () => {
      mockFetch.mockResolvedValueOnce(emptyResponse(404));

      try {
        await getScan({ sessionId: "scan_missing", accessToken: "tok" });
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(V1EnvelopeError);
        const e = err as V1EnvelopeError;
        expect(e.code).toBe("NOT_FOUND");
        expect(e.httpStatus).toBe(404);
      }
    });
  });

  describe("isDemoSession", () => {
    it("returns true for 'demo'", () => {
      expect(isDemoSession("demo")).toBe(true);
    });

    it("returns false for anything else", () => {
      expect(isDemoSession("scan_abc")).toBe(false);
      expect(isDemoSession("")).toBe(false);
      expect(isDemoSession("DEMO")).toBe(false);
    });
  });

  describe("getRagServiceUrl", () => {
    const original = process.env.RAG_SERVICE_URL;
    afterEach(() => {
      if (original === undefined) delete process.env.RAG_SERVICE_URL;
      else process.env.RAG_SERVICE_URL = original;
    });

    it("returns the default when env unset", () => {
      delete process.env.RAG_SERVICE_URL;
      expect(getRagServiceUrl()).toBe("http://localhost:8001");
    });

    it("returns the env value when set", () => {
      process.env.RAG_SERVICE_URL = "https://rag.example.com";
      expect(getRagServiceUrl()).toBe("https://rag.example.com");
    });

    it("throws when protocol is not http(s)", () => {
      process.env.RAG_SERVICE_URL = "ftp://rag.example.com";
      expect(() => getRagServiceUrl()).toThrow(/http or https/);
    });
  });
});