import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STRONG_SECRET = "0123456789abcdef0123456789abcdef";

function makeDeployRoot(envBody: string) {
  const root = mkdtempSync(join(tmpdir(), "attrax-deploy-"));
  mkdirSync(join(root, "data", "faiss"), { recursive: true });
  mkdirSync(join(root, "data", "corpus", "processed"), { recursive: true });
  mkdirSync(join(root, "rag_service"), { recursive: true });
  writeFileSync(join(root, "data", "faiss", "legal_chunks.index"), "index");
  writeFileSync(
    join(root, "data", "faiss", "legal_chunks_meta.json"),
    '{"dim":4,"chunks":[{"id":"one"}]}',
  );
  writeFileSync(
    join(root, "data", "faiss", "index_manifest.json"),
    '{"schema_version":2,"dim":4,"vector_count":1,"chunk_count":1}',
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
MODELSCOPE_API_KEY=modelscope-key
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

  it("requires LLM, embedding, internal service, and build identity", async () => {
    const { validateDeployment } = await import("../../scripts/preflight-deploy.mjs");
    const result = validateDeployment(
      makeDeployRoot(`
MINIMAX_API_KEY=
MODELSCOPE_API_KEY=
RAG_INTERNAL_SECRET=
DEMO_MODE=false
RAG_ALLOWED_ORIGINS=https://frontend.example.com
`),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("MINIMAX_API_KEY is required when DEMO_MODE is not true.");
    expect(result.errors).toContain("MODELSCOPE_API_KEY is required when DEMO_MODE is not true.");
    expect(result.errors).toContain("RAG_INTERNAL_SECRET is required when DEMO_MODE is not true.");
    expect(result.errors).toContain("ATTRAX_BUILD_SHA must identify the exact deployed Git commit.");
  });

  it("rejects every documented placeholder form", async () => {
    const { validateDeployment } = await import("../../scripts/preflight-deploy.mjs");
    const result = validateDeployment(
      makeDeployRoot(`
MINIMAX_API_KEY=your_minimax_api_key
MODELSCOPE_API_KEY=your_modelscope_api_key
RAG_INTERNAL_SECRET=replace_with_a_strong_random_service_secret
ATTRAX_BUILD_SHA=replace_with_git_commit_sha
DEMO_MODE=false
RAG_ALLOWED_ORIGINS=https://frontend.example.com
`),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("MINIMAX_API_KEY still contains the production example placeholder.");
    expect(result.errors).toContain("MODELSCOPE_API_KEY still contains the production example placeholder.");
    expect(result.errors).toContain("RAG_INTERNAL_SECRET must be a non-placeholder value of at least 32 characters.");
    expect(result.errors).toContain("ATTRAX_BUILD_SHA must identify the exact deployed Git commit.");
  });

  it("requires explicit non-wildcard browser origins", async () => {
    const { validateDeployment } = await import("../../scripts/preflight-deploy.mjs");
    const missing = validateDeployment(
      makeDeployRoot(`
MINIMAX_API_KEY=minimax-key
MODELSCOPE_API_KEY=modelscope-key
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

  it("requires the sealed index manifest and corpus directory", async () => {
    const { validateDeployment } = await import("../../scripts/preflight-deploy.mjs");
    const root = makeDeployRoot(productionEnv());
    rmSync(join(root, "data", "faiss", "index_manifest.json"));
    const result = validateDeployment(root);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("data/faiss/index_manifest.json is missing.");
  });

  it("accepts the legacy MIMOTALK_API_KEY alias during migration", async () => {
    const { validateDeployment } = await import("../../scripts/preflight-deploy.mjs");
    const root = makeDeployRoot(`
MIMOTALK_API_KEY=legacy-key
MODELSCOPE_API_KEY=modelscope-key
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
