import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 48-hex 字符串 —— 与 scripts/ecosystem.config.cjs 注释承诺的「48-hex」对齐。
// preflight-deploy.mjs 把最小长度从 32 提到 48 时这个值也要跟着加长，
// 否则整套生产环境校验会失败。
const STRONG_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";

function makeDeployRoot(envBody: string) {
  const root = mkdtempSync(join(tmpdir(), "attrax-deploy-"));
  mkdirSync(join(root, "data", "kb", "anchors"), { recursive: true });
  mkdirSync(join(root, "data", "regulations"), { recursive: true });
  mkdirSync(join(root, "data", "regulation_sources"), { recursive: true });
  mkdirSync(join(root, "rag_service"), { recursive: true });
  writeFileSync(join(root, "data", "kb", "anchors", "anchor.yaml"), "anchor");
  writeFileSync(
    join(root, "data", "regulations", "regulations_index.json"),
    '{"regulations":[]}',
  );
  writeFileSync(
    join(root, "data", "regulation_sources", "official_sources.json"),
    "[]",
  );
  writeFileSync(join(root, "docker-compose.yml"), "services: {}\n");
  writeFileSync(join(root, "Dockerfile"), "FROM node:22-alpine\n");
  writeFileSync(join(root, "rag_service", "Dockerfile"), "FROM python:3.11-slim\n");
  writeFileSync(join(root, ".env"), envBody);
  return root;
}

function productionEnv(extra = "") {
  return `
MINIMAX_API_KEY=minimax-key
RAG_INTERNAL_SECRET=${STRONG_SECRET}
DEMO_MODE=false
RAG_ALLOWED_ORIGINS=https://frontend.example.com
ATTRAX_BUILD_SHA=abc123
${extra}
`;
}

describe("deployment preflight", () => {
  it("accepts a complete production deployment root", async () => {
    const { validateDeployment } = await import("../../scripts/preflight-deploy.mjs");
    const result = validateDeployment(makeDeployRoot(productionEnv()));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("requires LLM, internal service, and build identity", async () => {
    const { validateDeployment } = await import("../../scripts/preflight-deploy.mjs");
    const result = validateDeployment(
      makeDeployRoot(`
MINIMAX_API_KEY=
RAG_INTERNAL_SECRET=
DEMO_MODE=false
RAG_ALLOWED_ORIGINS=https://frontend.example.com
`),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("MINIMAX_API_KEY is required when DEMO_MODE is not true.");
    expect(result.errors).toContain("RAG_INTERNAL_SECRET is required when DEMO_MODE is not true.");
    expect(result.errors).toContain("ATTRAX_BUILD_SHA must identify the exact deployed Git commit.");
  });

  it("rejects every documented placeholder form", async () => {
    const { validateDeployment } = await import("../../scripts/preflight-deploy.mjs");
    const result = validateDeployment(
      makeDeployRoot(`
MINIMAX_API_KEY=your_minimax_api_key
RAG_INTERNAL_SECRET=replace_with_a_strong_random_service_secret
ATTRAX_BUILD_SHA=replace_with_git_commit_sha
DEMO_MODE=false
RAG_ALLOWED_ORIGINS=https://frontend.example.com
`),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("MINIMAX_API_KEY still contains the production example placeholder.");
    expect(result.errors).toContain("RAG_INTERNAL_SECRET must be a non-placeholder value of at least 48 hex characters (see docs/RAG-INTERNAL-SECRET.md and scripts/ecosystem.config.cjs header comment).");
    expect(result.errors).toContain("ATTRAX_BUILD_SHA must identify the exact deployed Git commit.");
  });

  it("requires explicit non-wildcard browser origins", async () => {
    const { validateDeployment } = await import("../../scripts/preflight-deploy.mjs");
    const missing = validateDeployment(
      makeDeployRoot(`
MINIMAX_API_KEY=minimax-key
RAG_INTERNAL_SECRET=${STRONG_SECRET}
ATTRAX_BUILD_SHA=abc123
DEMO_MODE=false
`),
    );
    expect(missing.errors).toContain(
      "RAG_ALLOWED_ORIGINS is required for direct browser access in production.",
    );
    const wildcard = validateDeployment(
      makeDeployRoot(productionEnv("RAG_ALLOWED_ORIGINS=*")),
    );
    expect(wildcard.errors).toContain("RAG_ALLOWED_ORIGINS must not contain * in production.");
  });

  it("requires the knowledge anchors and regulations index", async () => {
    const { validateDeployment } = await import("../../scripts/preflight-deploy.mjs");
    const root = makeDeployRoot(productionEnv());
    rmSync(join(root, "data", "regulations", "regulations_index.json"));
    const result = validateDeployment(root);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("data/regulations/regulations_index.json is missing.");
  });

  it("accepts the legacy MIMOTALK_API_KEY alias during migration", async () => {
    const { validateDeployment } = await import("../../scripts/preflight-deploy.mjs");
    const root = makeDeployRoot(`
MIMOTALK_API_KEY=legacy-key
RAG_INTERNAL_SECRET=${STRONG_SECRET}
DEMO_MODE=false
RAG_ALLOWED_ORIGINS=https://frontend.example.com
ATTRAX_BUILD_SHA=abc123
`);
    expect(validateDeployment(root).ok).toBe(true);
  });

  it("warns about missing build identity only in demo mode", async () => {
    const { validateDeployment } = await import("../../scripts/preflight-deploy.mjs");
    const result = validateDeployment(makeDeployRoot("DEMO_MODE=true\n"));
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain(
      "ATTRAX_BUILD_SHA is not set; health and audit records cannot identify the deployed commit.",
    );
  });

  it("keeps backend and rate-limit state on writable volumes", () => {
    const compose = readFileSync(join(process.cwd(), "docker-compose.yml"), "utf8");
    const dockerfile = readFileSync(join(process.cwd(), "rag_service", "Dockerfile"), "utf8");
    expect(compose).toContain("ATTRAX_RUNTIME_DIR: /app/data/backend");
    expect(compose).toContain("./data/backend:/app/data/backend");
    expect(compose).toContain("./data/rate-limit:/app/data/rate-limit");
    expect(compose).toContain("127.0.0.1:${RAG_PORT:-8001}:8000");
    expect(dockerfile).toContain("/app/data/backend");
  });
});
