import { tokenFromRequest } from "@/lib/pipeline/session-auth";

const COOKIE_PREFIX = "attrax_scan_";
const SAFE_SESSION_ID = /^scan_[A-Za-z0-9_-]{1,64}$/;
const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

export function backendSessionCookieName(sessionId: string): string {
  if (!SAFE_SESSION_ID.test(sessionId)) {
    throw new Error("Invalid scan session id");
  }
  return `${COOKIE_PREFIX}${sessionId}`;
}

export function backendAccessTokenFromRequest(
  request: Request,
  sessionId: string,
): string | null {
  const bearer = tokenFromRequest(request);
  if (bearer) return bearer;

  let cookieName: string;
  try {
    cookieName = backendSessionCookieName(sessionId);
  } catch {
    return null;
  }
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const segment of cookieHeader.split(";")) {
    const [name, ...parts] = segment.trim().split("=");
    if (name !== cookieName) continue;
    const value = parts.join("=").trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function backendSessionCookie(sessionId: string, accessToken: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${backendSessionCookieName(sessionId)}=${encodeURIComponent(accessToken)}; Path=/api/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict; Priority=High${secure}`;
}

/**
 * 401 响应附带清 cookie：上游判定 token 失效（或 token 缺失）后，别让
 * 浏览器把死 cookie 留在 TTL 内反复重试。session id 非法时静默跳过
 * （本来就没有对应 cookie 可清）。
 */
export function withClearedSessionCookie(response: Response, sessionId: string): Response {
  try {
    response.headers.append(
      "Set-Cookie",
      `${backendSessionCookieName(sessionId)}=; Path=/api/; Max-Age=0; HttpOnly; SameSite=Strict`,
    );
  } catch {
    // invalid session id — nothing to clear
  }
  return response;
}
