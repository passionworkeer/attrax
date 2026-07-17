import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("approved new frontend shell", () => {
  it("does not mount legacy global headers or page wrappers", async () => {
    const source = await readFile("app/layout.tsx", "utf8");

    expect(source).not.toContain("BlazeHeader");
    expect(source).not.toContain("SiteHeader");
    expect(source).not.toContain("PageTransition");
  });

  it("uses a deterministic CSP compatible with cached Next.js pages", async () => {
    const source = await readFile("middleware.ts", "utf8");

    expect(source).not.toContain("generateNonce");
    expect(source).not.toContain("'nonce-${nonce}'");
    expect(source).toContain("script-src 'self' 'unsafe-inline'");
  });
});
