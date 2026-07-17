import { describe, expect, it } from "vitest";
import {
  backendAccessTokenFromRequest,
  backendSessionCookie,
  backendSessionCookieName,
} from "@/app/api/backend-session-access";

describe("backend session access cookie", () => {
  it("uses the bearer header before the HttpOnly cookie", () => {
    const name = backendSessionCookieName("scan_real1");
    const request = new Request("http://localhost/api/report/scan_real1/compliance", {
      headers: {
        authorization: "Bearer header-token",
        cookie: `${name}=cookie-token`,
      },
    });

    expect(backendAccessTokenFromRequest(request, "scan_real1")).toBe("header-token");
  });

  it("allows browser download navigations to authenticate with an HttpOnly cookie", () => {
    const name = backendSessionCookieName("scan_real1");
    const request = new Request("http://localhost/api/report/scan_real1/compliance", {
      headers: { cookie: `other=x; ${name}=cookie-token` },
    });

    expect(backendAccessTokenFromRequest(request, "scan_real1")).toBe("cookie-token");
    expect(backendSessionCookie("scan_real1", "cookie-token")).toContain("HttpOnly");
    expect(backendSessionCookie("scan_real1", "cookie-token")).toContain("SameSite=Strict");
  });
});
