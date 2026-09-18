/**
 * 桩上游：模拟 RAG 的 POST /api/v1/scans。
 *
 * 只做三件事：把请求体按字节收全、从 multipart 里抽出文本字段、
 * 回一个 v1 envelope。用来验证 BFF 的流式转发链路——真实 RAG 服务
 * 需要 LLM key 且会跑完整管线，不适合做这一层的验证。
 */
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 8099);

function parseMultipart(buffer, boundary) {
  const text = buffer.toString("latin1");
  const fields = {};
  const files = [];
  const parts = text.split(`--${boundary}`);
  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    const rawValue = part.slice(headerEnd + 4).replace(/\r\n$/, "");
    const nameMatch = headers.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const filenameMatch = headers.match(/filename="([^"]*)"/);
    if (filenameMatch) {
      files.push({ name: nameMatch[1], filename: filenameMatch[1], bytes: rawValue.length });
    } else {
      fields[nameMatch[1]] = rawValue;
    }
  }
  return { fields, files };
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const contentType = req.headers["content-type"] ?? "";
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = boundaryMatch ? (boundaryMatch[1] ?? boundaryMatch[2]).trim() : "";
    const { fields, files } = boundary ? parseMultipart(body, boundary) : { fields: {}, files: [] };

    console.log(
      JSON.stringify({
        event: "stub_received",
        path: req.url,
        method: req.method,
        bytes: body.length,
        contentLengthHeader: req.headers["content-length"] ?? null,
        transferEncoding: req.headers["transfer-encoding"] ?? null,
        internalSecret: req.headers["x-internal-secret"] ? "present" : "absent",
        fields,
        files,
      }),
    );

    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        data: {
          sessionId: "scan_stub0001",
          accessToken: "stub-token",
          status: "processing",
          pollUrl: "/api/v1/scans/scan_stub0001",
        },
        error: null,
        meta: { requestId: "stub-1" },
      }),
    );
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({ event: "stub_listening", port: PORT }));
});
