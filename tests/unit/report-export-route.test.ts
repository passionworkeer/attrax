import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/report/[sessionId]/[reportType]/route";
import { NextRequest } from "next/server";

describe("GET /api/report/[sessionId]/[reportType] Route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unknown reportType with 400 Bad Request", async () => {
    const req = new NextRequest("http://localhost:3000/api/report/demo/unknown_type?format=md");
    const res = await GET(req, {
      params: Promise.resolve({ sessionId: "demo", reportType: "unknown_type" }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("BAD_REPORT_TYPE");
  });

  it("enforces format compatibility: roadmap only accepts csv", async () => {
    const req = new NextRequest("http://localhost:3000/api/report/demo/roadmap?format=md");
    const res = await GET(req, {
      params: Promise.resolve({ sessionId: "demo", reportType: "roadmap" }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("BAD_REPORT_FORMAT");
    expect(data.error.message).toMatch(/CSV/i);
  });

  it("enforces format compatibility: compliance only accepts md", async () => {
    const req = new NextRequest("http://localhost:3000/api/report/demo/compliance?format=csv");
    const res = await GET(req, {
      params: Promise.resolve({ sessionId: "demo", reportType: "compliance" }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("BAD_REPORT_FORMAT");
    expect(data.error.message).toMatch(/Markdown/i);
  });

  it("successfully exports compliance report as markdown for demo session", async () => {
    const req = new NextRequest("http://localhost:3000/api/report/demo/compliance?format=md");
    const res = await GET(req, {
      params: Promise.resolve({ sessionId: "demo", reportType: "compliance" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/markdown/);
    const body = await res.text();
    expect(body).toContain("# 规航AI");
  });

  it("successfully exports roadmap report as CSV for demo session", async () => {
    const req = new NextRequest("http://localhost:3000/api/report/demo/roadmap?format=csv");
    const res = await GET(req, {
      params: Promise.resolve({ sessionId: "demo", reportType: "roadmap" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const body = await res.text();
    expect(body).toContain('"阶段","动作","输出","备注"');
  });

  it("enforces authentication on non-demo sessions (returns 401 when token missing)", async () => {
    const req = new NextRequest("http://localhost:3000/api/report/real_session_123/compliance?format=md");
    const res = await GET(req, {
      params: Promise.resolve({ sessionId: "real_session_123", reportType: "compliance" }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.code).toBe("UNAUTHORIZED");
  });
});
