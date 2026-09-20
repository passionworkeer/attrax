// 生产环境真实扫描冒烟：POST /api/scan（multipart，走 nginx → BFF → RAG → LLM）→ 轮询到终态。
// 用途：部署后确认整条主链路可用（/api/health 200 不能证明 BFF→RAG auth 通）。
// 运行：node tmp-deploy/prod-scan-smoke.mjs
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.ATTRAX_SMOKE_BASE || "https://twinbuddy.xyz";
const CASE_DIR = "tests/fixtures/regression-package-20260914/01-Anker-A2332-充电器-EU";
const IMAGES = ["01-正反面整体.jpg", "02-铭牌标签近照.jpg", "03-接口与插脚.jpg"];
const POLL_TIMEOUT_MS = 6 * 60 * 1000;

function buildForm() {
  const form = new FormData();
  // 文本字段必须排在文件之前：BFF 只从请求体前 8KB 嗅探 category。
  form.append("category", "electronics");
  form.append("markets", "EU,US");
  form.append("locale", "zh");
  form.append("declared_facts", JSON.stringify({ builtin_battery: "否", wireless: "否" }));
  for (const name of IMAGES) {
    const buf = readFileSync(path.join(CASE_DIR, name));
    form.append("images", new Blob([buf], { type: "image/jpeg" }), name);
  }
  return form;
}

const started = Date.now();
const createRes = await fetch(`${BASE}/api/scan`, {
  method: "POST",
  headers: { Origin: BASE },
  body: buildForm(),
});
const cookie = (createRes.headers.getSetCookie() || []).map((c) => c.split(";")[0]).join("; ");
const createBody = await createRes.json();
console.log(`create: HTTP ${createRes.status} success=${createBody.success} cookie=${cookie ? "set" : "MISSING"}`);

if (!createRes.ok || !createBody.success) {
  console.error("create failed:", JSON.stringify(createBody).slice(0, 500));
  process.exit(1);
}

const sessionId = createBody.data?.sessionId ?? createBody.sessionId;
console.log(`sessionId: ${sessionId}`);

let last = "";
while (Date.now() - started < POLL_TIMEOUT_MS) {
  await new Promise((r) => setTimeout(r, 5000));
  const res = await fetch(`${BASE}/api/scan/${sessionId}`, { headers: { Cookie: cookie } });
  const body = await res.json();
  const data = body.data ?? body;
  const line = `t+${Math.round((Date.now() - started) / 1000)}s HTTP ${res.status} status=${data.status} progress=${data.progress} stage=${data.stageText ?? ""}`;
  if (line !== last) {
    console.log(line);
    last = line;
  }
  if (data.status === "ready" || data.status === "failed" || data.status === "degraded") {
    const result = data.result ?? {};
    const findings = result.findings ?? result.reportPackage?.findings ?? [];
    const citations = result.citations ?? result.reportPackage?.citations ?? [];
    console.log("---- terminal ----");
    console.log(`status=${data.status} source=${result.source} provider=${result.ragProvider ?? result.provider ?? "-"}`);
    console.log(`findings=${findings.length} citations=${citations.length} score=${result.complianceScore ?? "-"}`);
    console.log(`product=${result.productName ?? "-"} category=${result.productCategory ?? "-"}`);
    const okish = data.status === "ready";
    console.log(okish ? "SMOKE_PASS" : "SMOKE_FAIL");
    process.exit(okish ? 0 : 1);
  }
}
console.error("SMOKE_FAIL: timeout waiting for terminal status");
process.exit(1);
