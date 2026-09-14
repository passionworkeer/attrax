/**
 * Unit tests for lib/rag-client/evidence-api.ts (plan §5.3 / J10).
 *
 * Covers: idempotency key derivation, multipart construction (images vs
 * documents split), token attach, error mapping from envelope failures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendEvidence, evidenceIdempotencyKey, requestRevision } from "@/lib/rag-client/evidence-api";

class MockFile extends File {
  constructor(name: string, type: string, lastModified = 1_700_000_000_000) {
    super(["x"], name, { type, lastModified });
  }
}

describe("evidenceIdempotencyKey", () => {
  it("is stable for the same file set regardless of order", () => {
    const a = evidenceIdempotencyKey("s1", [
      { name: "a.png", size: 1, lastModified: 100 },
      { name: "b.png", size: 2, lastModified: 200 },
    ], "supplement");
    const b = evidenceIdempotencyKey("s1", [
      { name: "b.png", size: 2, lastModified: 200 },
      { name: "a.png", size: 1, lastModified: 100 },
    ], "supplement");
    expect(a).toBe(b);
  });

  it("changes for different content or session", () => {
    const base = evidenceIdempotencyKey("s1", [{ name: "a.png", size: 1, lastModified: 100 }], "supplement");
    expect(evidenceIdempotencyKey("s2", [{ name: "a.png", size: 1, lastModified: 100 }], "supplement")).not.toBe(base);
    expect(evidenceIdempotencyKey("s1", [{ name: "a.png", size: 2, lastModified: 100 }], "supplement")).not.toBe(base);
  });
});

describe("appendEvidence", () => {
  beforeEach(() => {
    sessionStorage.setItem("scan-token:s1", "tok-1");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("splits images and documents into the right form fields", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { status: "stored", storedCount: 2 } }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await appendEvidence("s1", [
      { file: new MockFile("nameplate.png", "image/png") },
      { file: new MockFile("spec.pdf", "application/pdf") },
    ], "supplement");

    expect(result.status).toBe("stored");
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.getAll("images").length).toBe(1);
    expect(form.getAll("documents").length).toBe(1);
    expect(String(form.get("idempotency_key"))).toContain("s1:supplement:");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  it("maps envelope error codes into thrown Error codes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: null, error: { code: "NOT_READY", message: "still processing" } }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      appendEvidence("s1", [{ file: new MockFile("a.png", "image/png") }], "supplement"),
    ).rejects.toThrow("NOT_READY");
  });

  it("rejects empty submissions client-side", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(appendEvidence("s1", [], "supplement")).rejects.toThrow("NO_FILES");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("requestRevision", () => {
  beforeEach(() => {
    sessionStorage.setItem("scan-token:s1", "tok-1");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("posts a session-derived idempotency key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { status: "queued", revision: 2 } }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await requestRevision("s1");
    expect(result).toEqual({ status: "queued", revision: 2 });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("/api/scan/s1/revisions");
    expect(JSON.parse(String(init.body)).idempotencyKey).toBe("s1:revision");
  });

  it("surfaces already_queued as a resolved value, not an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { status: "already_queued", revision: 2 } }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(requestRevision("s1")).resolves.toEqual({ status: "already_queued", revision: 2 });
  });
});
