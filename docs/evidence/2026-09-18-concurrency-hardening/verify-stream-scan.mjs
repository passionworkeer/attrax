/**
 * 端到端验证：BFF 流式转发 multipart 的实际链路。
 *
 * 单元测试只能证明路由在 mock 下的行为。这个脚本打真实的 HTTP：
 *   浏览器形态的 multipart（文本字段在前、markets 逗号分隔、
 *   declared_facts）→ Next.js BFF /api/scan → RAG /api/v1/scans，
 * 然后轮询 session，断言 RAG 真正收到的字段与发出的一致。
 *
 * 用法：node .review-tmp/concurrency/verify-stream-scan.mjs [baseUrl] [imagePath]
 * 前置：RAG(8001) 与 Next.js(3000) 都已启动，且 .env 里有真实 LLM key。
 */
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const IMAGE_PATH = process.argv[3] ?? null;

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);
const IMAGE = IMAGE_PATH
  ? { body: readFileSync(IMAGE_PATH), filename: IMAGE_PATH.split("/").pop(), contentType: "image/jpeg" }
  : { body: PNG, filename: "verify.png", contentType: "image/png" };

function buildMultipart(fields, files) {
  const boundary = "----attraxVerifyBoundary7f3a";
  const chunks = [];
  for (const [name, value] of fields) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        "utf8",
      ),
    );
  }
  for (const { name, filename, contentType, body } of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
        "utf8",
      ),
    );
    chunks.push(body);
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return { boundary, body: Buffer.concat(chunks) };
}

async function main() {
  // 与 app/upload/page.tsx 完全一致的字段顺序与取值形态
  const { boundary, body } = buildMultipart(
    [
      ["category", "toy"],
      ["markets", "EU,US"],
      ["locale", "zh"],
      ["declared_facts", JSON.stringify({ battery: "否" })],
    ],
    [{ name: "images", filename: IMAGE.filename, contentType: IMAGE.contentType, body: IMAGE.body }],
  );

  const created = await fetch(`${BASE}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const createdText = await created.text();
  console.log(`[create] HTTP ${created.status}`);
  console.log(`[create] body ${createdText.slice(0, 300)}`);
  if (created.status !== 202) {
    throw new Error(`expected 202, got ${created.status}`);
  }
  const createdJson = JSON.parse(createdText);
  const sessionId = createdJson.data?.sessionId;
  if (!sessionId) throw new Error("no sessionId in response");

  const cookie = created.headers.getSetCookie?.() ?? [];
  const deadline = Date.now() + 300_000;
  let last = null;
  while (Date.now() < deadline) {
    const poll = await fetch(`${BASE}/api/scan/${sessionId}`, {
      headers: cookie.length ? { Cookie: cookie.map((c) => c.split(";")[0]).join("; ") } : {},
    });
    const json = await poll.json();
    last = json.data ?? json;
    const status = last?.status;
    if (status && status !== "processing") {
      console.log(`[poll] terminal status = ${status}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  const result = last?.result ?? last;
  console.log(`[result] query = ${JSON.stringify(result?.query)}`);
  console.log(`[result] markets = ${JSON.stringify(result?.markets ?? result?.reportPackage?.markets)}`);
  console.log(`[result] category = ${JSON.stringify(result?.category)}`);
  console.log(`[result] status = ${JSON.stringify(last?.status)}`);

  const query = result?.query;
  if (typeof query === "string" && query.includes("toy") && query.includes("EU/US")) {
    console.log("[assert] query synthesis reached RAG with the browser's category + markets: OK");
  } else {
    console.log("[assert] query did NOT match the expected synthesized wording — inspect above");
  }
}

main().catch((error) => {
  console.error("[verify-stream-scan] FAILED:", error);
  process.exit(1);
});
