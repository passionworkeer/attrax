import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REQUIRED_DATA_PATHS = [
  "data/faiss/legal_chunks.index",
  "data/faiss/legal_chunks_meta.json",
  "data/corpus/processed",
];

function parseEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) {
      continue;
    }
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
  if (!hasValue(value)) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("your_") ||
    normalized.startsWith("your-") ||
    normalized.includes("replace_me") ||
    normalized.includes("changeme")
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
    if (!hasValue(env.MODELSCOPE_API_KEY)) {
      errors.push("MODELSCOPE_API_KEY is required when DEMO_MODE is not true.");
    } else if (isExamplePlaceholder(env.MODELSCOPE_API_KEY)) {
      errors.push("MODELSCOPE_API_KEY still contains the production example placeholder.");
    }
    if (!hasValue(env.RAG_ALLOWED_ORIGINS)) {
      errors.push("RAG_ALLOWED_ORIGINS is required for direct browser access in production.");
    } else if (env.RAG_ALLOWED_ORIGINS.split(",").some((origin) => origin.trim() === "*")) {
      errors.push("RAG_ALLOWED_ORIGINS must not contain * in production.");
    }
  }

  for (const relativePath of REQUIRED_DATA_PATHS) {
    const path = join(rootDir, relativePath);
    if (!existsSync(path)) {
      errors.push(`${relativePath} is missing.`);
      continue;
    }
    if (relativePath.endsWith("processed") && !statSync(path).isDirectory()) {
      errors.push(`${relativePath} must be a directory.`);
    }
  }

  if (!existsSync(join(rootDir, "docker-compose.yml"))) {
    errors.push("docker-compose.yml is missing.");
  }
  if (!existsSync(join(rootDir, "Dockerfile"))) {
    errors.push("Dockerfile is missing.");
  }
  if (!existsSync(join(rootDir, "rag_service", "Dockerfile"))) {
    errors.push("rag_service/Dockerfile is missing.");
  }

  if (hasValue(env.OLLAMA_BASE_URL) || hasValue(env.OLLAMA_EMBED_MODEL)) {
    warnings.push("OLLAMA_* variables are ignored in API-only deployment.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    env,
  };
}

function commandExists(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function printValidation(result) {
  for (const warning of result.warnings) {
    console.warn(`WARNING: ${warning}`);
  }
  if (result.ok) {
    console.log("Deployment preflight passed.");
    return;
  }
  console.error("Deployment preflight failed:");
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
}

function main() {
  const root = process.cwd();
  const result = validateDeployment(root);
  printValidation(result);
  if (!result.ok) {
    process.exit(1);
  }

  if (process.argv.includes("--check-only")) {
    return;
  }

  if (!commandExists("docker", ["--version"])) {
    console.error("Docker CLI is not available. Install Docker Engine and Docker Compose first.");
    process.exit(1);
  }

  run("docker", ["compose", "up", "-d", "--build"]);
  run("docker", ["compose", "ps"]);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  main();
}
