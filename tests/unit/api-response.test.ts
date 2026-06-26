/**
 * Tests for lib/api-response.ts — locks in the `ok()` envelope contract
 * (intentional spread behavior) and `fail()` shape.
 */
import { describe, it, expect } from "vitest";
import { ok, fail, unwrapApiData } from "@/lib/api-response";

describe("ok()", () => {
  it("wraps a plain object with success=true and error=null", async () => {
    const res = ok({ items: [1, 2, 3] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.items).toEqual([1, 2, 3]);
  });

  it("spreads the data arg so { data, meta } lands as top-level fields", async () => {
    // This is the contract /api/regulations/updates depends on:
    // body.data IS the items array, body.meta IS the meta block.
    const res = ok({
      data: [{ id: "r1" }, { id: "r2" }],
      meta: { total: 2, dataset: "static-demo" },
    });
    const body = await res.json();
    // Duplicate 'data' key — last write wins (the spread). So `body.data`
    // is the items array, NOT the wrapper object.
    expect(body.data).toEqual([{ id: "r1" }, { id: "r2" }]);
    expect(body.meta).toEqual({ total: 2, dataset: "static-demo" });
  });

  it("honors the ResponseInit status code", async () => {
    const res = ok({ ok: true }, { status: 201 });
    expect(res.status).toBe(201);
  });
});

describe("fail()", () => {
  it("returns success=false with the error code and message", async () => {
    const res = fail({ code: "BAD_INPUT", message: "Missing field" });
    expect(res.status).toBe(200); // default
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.error).toEqual({ code: "BAD_INPUT", message: "Missing field" });
  });

  it("honors the ResponseInit status code (e.g. 503 for backend failures)", async () => {
    const res = fail({ code: "REGULATIONS_FETCH_FAILED", message: "Backend down" }, { status: 503 });
    expect(res.status).toBe(503);
  });

  it("preserves optional reason and messageEn fields", async () => {
    const res = fail({
      code: "BAD_INPUT",
      message: "缺少字段",
      reason: "field=name required",
      messageEn: "Missing name field",
    });
    const body = await res.json();
    expect(body.error.reason).toBe("field=name required");
    expect(body.error.messageEn).toBe("Missing name field");
  });
});

describe("unwrapApiData()", () => {
  it("returns the data field when payload has success=true", () => {
    const payload = { success: true, data: { foo: "bar" }, error: null };
    expect(unwrapApiData<{ foo: string }>(payload)).toEqual({ foo: "bar" });
  });

  it("returns the payload as-is when success is not true", () => {
    // Used by callers who pass a raw object instead of an envelope.
    const payload = { items: [1, 2] };
    expect(unwrapApiData<{ items: number[] }>(payload)).toEqual({ items: [1, 2] });
  });

  it("returns null for null or non-object input", () => {
    expect(unwrapApiData(null)).toBeNull();
    expect(unwrapApiData("string")).toBeNull();
    expect(unwrapApiData(42)).toBeNull();
  });
});