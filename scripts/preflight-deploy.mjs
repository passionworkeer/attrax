import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REQUIRED_DATA_PATHS = [
  "data/kb/anchors",
  "data/regulations/regulations_index.json",
  "data/regulation_sources/official_sources.json",
];

function parseEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isExamplePlaceholder(value) {
  if (!hasValue(value)) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("your_") ||
    normalized.startsWith("your-") ||
    normalized.includes("replace_me") ||
    normalized.includes("replace_with") ||
    normalized.includes("changeme") ||
    normalized.includes("example_secret")
  );
}

export function validateDeployment(rootDir = process.cwd(), options = {}) {
  const envFile = options.envFile ?? ".env";
  const errors = [];
  const warnings = [];
  const envPath = join(rootDir, envFile);

  if (!existsSync(envPath)) {
    errors.push(`${envFile} is missing. Copy .env.production.example to ${envFile} and fill it.`);
  }

  const env = existsSync(envPath)
    ? parseEnv(readFileSync(envPath, "utf8"))
    : {};
  const demoMode = String(env.DEMO_MODE ?? "false").toLowerCase() === "true";

  if (!demoMode) {
    const minimaxApiKey = env.MINIMAX_API_KEY || env.MIMOTALK_API_KEY;
    if (!hasValue(minimaxApiKey)) {
      errors.push("MINIMAX_API_KEY is required when DEMO_MODE is not true.");
    } else if (isExamplePlaceholder(minimaxApiKey)) {
      errors.push("MINIMAX_API_KEY still contains the production example placeholder.");
    }
    if (!hasValue(env.RAG_INTERNAL_SECRET)) {
      errors.push("RAG_INTERNAL_SECRET is required when DEMO_MODE is not true.");
    } else if (
      isExamplePlaceholder(env.RAG_INTERNAL_SECRET) ||
      env.RAG_INTERNAL_SECRET.length < 48
    ) {
      errors.push("RAG_INTERNAL_SECRET must be a non-placeholder value of at least 48 hex characters (see docs/RAG-INTERNAL-SECRET.md and scripts/ecosystem.config.cjs header comment).");
    }
    if (!hasValue(env.RAG_ALLOWED_ORIGINS)) {
      errors.push("RAG_ALLOWED_ORIGINS is required for direct browser access in production.");
    } else if (env.RAG_ALLOWED_ORIGINS.split(",").some((origin) => origin.trim() === "*")) {
      errors.push("RAG_ALLOWED_ORIGINS must not contain * in production.");
    }
    if (!hasValue(env.ATTRAX_BUILD_SHA) || isExamplePlaceholder(env.ATTRAX_BUILD_SHA)) {
      errors.push("ATTRAX_BUILD_SHA must identify the exact deployed Git commit.");
    }
  }

  for (const relativePath of REQUIRED_DATA_PATHS) {
    const path = join(rootDir, relativePath);
    if (!existsSync(path)) {
      errors.push(`${relativePath} is missing.`);
      continue;
    }
    if (relativePath.endsWith("anchors") && !statSync(path).isDirectory()) {
      errors.push(`${relativePath} must be a directory.`);
    }
  }

  for (const relativePath of ["docker-compose.yml", "Dockerfile", "rag_service/Dockerfile"]) {
    if (!existsSync(join(rootDir, relativePath))) errors.push(`${relativePath} is missing.`);
  }

  // 提醒运维：生产服务器上 RAG_INTERNAL_SECRET 单一来源是
  // `/opt/attrax/.rag-internal-secret`（mode 600），由 scripts/ecosystem.config.cjs
  // 启动 rag-service 时读取（fail-closed：缺文件直接抛错）。
  // preflight 在本地跑，没法 stat 服务器上的文件；这里只是文案提示运维
  // 部署后必须存在。服务器侧的真实 fail-closed 验证在 ecosystem.config.cjs。
  if (!demoMode && !hasValue(env.RAG_INTERNAL_SECRET)) {
    warnings.push(
      "After deploy, confirm /opt/attrax/.rag-internal-secret exists on the server (mode 600) — see scripts/ecosystem.config.cjs header.",
    );
  }

  if (demoMode && !hasValue(env.ATTRAX_BUILD_SHA)) {
    warnings.push("ATTRAX_BUILD_SHA is not set; health and audit records cannot identify the deployed commit.");
  }
  if (hasValue(env.OLLAMA_BASE_URL) || hasValue(env.OLLAMA_EMBED_MODEL)) {
    warnings.push("OLLAMA_* variables are ignored; production retrieval uses ModelScope or BM25-only mode.");
  }

  return { ok: errors.length === 0, errors, warnings, env };
}

function commandExists(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function validateKnowledgeAnchors(root) {
  const indexFile = join(root, "data/regulations/regulations_index.json");
  if (!existsSync(indexFile)) {
    console.error("data/regulations/regulations_index.json is missing.");
    process.exit(1);
  }
  try {
    const raw = readFileSync(indexFile, "utf8");
    const parsed = JSON.parse(raw);
    const count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
    console.log(`Knowledge anchors verified: ${count} entries.`);
  } catch (err) {
    console.error("Failed to parse regulations_index.json:", err);
    process.exit(1);
  }
}

function printValidation(result) {
  for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
  if (result.ok) {
    console.log("Deployment preflight passed.");
    return;
  }
  console.error("Deployment preflight failed:");
  for (const error of result.errors) console.error(`- ${error}`);
}

function main() {
  const root = process.cwd();
  const result = validateDeployment(root);
  printValidation(result);
  if (!result.ok) process.exit(1);
  validateKnowledgeAnchors(root);
  if (process.argv.includes("--check-only")) return;

  if (!commandExists("docker", ["--version"])) {
    console.error("Docker CLI is not available. Install Docker Engine and Docker Compose first.");
    process.exit(1);
  }
  run("docker", ["compose", "up", "-d", "--build"]);
  run("docker", ["compose", "ps"]);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) main();
