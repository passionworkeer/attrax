import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/regulations/[docId]/route";
import { NextRequest } from "next/server";

describe("GET /api/regulations/[docId] BFF Route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects path traversal attempts with 400 Bad Request", async () => {
    const maliciousDocIds = [
      "../etc/passwd",
      "..%2f..%2fpasswd",
      "doc/../../secret",
      "EU;DROP TABLE",
      "doc id with spaces",
    ];

    for (const docId of maliciousDocIds) {
      const req = new NextRequest(`http://localhost:3000/api/regulations/${encodeURIComponent(docId)}`);
      const res = await GET(req, { params: Promise.resolve({ docId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("INVALID_DOC_ID");
      expect(data.error.message).toMatch(/Invalid regulation doc id/i);
    }
  });

  it("proxies successfully to upstream RAG service for valid docId", async () => {
    const mockRegulation = {
      id: "EU-2023-1542",
      official_citation: "Regulation (EU) 2023/1542",
      short_name: "EU Battery Regulation 2023/1542",
      region: "EU",
    };

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => mockRegulation,
    } as Response);

    const req = new NextRequest("http://localhost:3000/api/regulations/EU-2023-1542");
    const res = await GET(req, { params: Promise.resolve({ docId: "EU-2023-1542" }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("EU-2023-1542");
    expect(data.short_name).toBe("EU Battery Regulation 2023/1542");
  });

  it("returns 404 when upstream regulation is not found", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "Regulation not found",
    } as Response);

    const req = new NextRequest("http://localhost:3000/api/regulations/UNKNOWN-999");
    const res = await GET(req, { params: Promise.resolve({ docId: "UNKNOWN-999" }) });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.code).toBe("REGULATION_NOT_FOUND");
    expect(data.error.message).toMatch(/not found/i);
  });

  it("returns 502 when upstream service is unreachable", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED 127.0.0.1:8001"));

    const req = new NextRequest("http://localhost:3000/api/regulations/EU-2023-1542");
    const res = await GET(req, { params: Promise.resolve({ docId: "EU-2023-1542" }) });

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error.code).toBe("UPSTREAM_ERROR");
    expect(data.error.message).toMatch(/ECONNREFUSED/i);
  });
});
