import { afterEach, describe, expect, it } from "vitest";
import { getRagServiceUrl } from "@/lib/rag-client/v1-adapter";

const original = process.env.RAG_SERVICE_URL;

afterEach(() => {
  if (original === undefined) delete process.env.RAG_SERVICE_URL;
  else process.env.RAG_SERVICE_URL = original;
});

describe("getRagServiceUrl", () => {
  it("preserves a reverse-proxy path prefix", () => {
    process.env.RAG_SERVICE_URL = "https://example.com/internal/rag/";
    expect(getRagServiceUrl()).toBe("https://example.com/internal/rag");
  });

  it("rejects credentials, query parameters, and non-http protocols", () => {
    process.env.RAG_SERVICE_URL = "https://user:pass@example.com/rag";
    expect(() => getRagServiceUrl()).toThrow(/must not contain credentials/);

    process.env.RAG_SERVICE_URL = "https://example.com/rag?token=secret";
    expect(() => getRagServiceUrl()).toThrow(/query/);

    process.env.RAG_SERVICE_URL = "file:///tmp/rag";
    expect(() => getRagServiceUrl()).toThrow(/http or https/);
  });
});
