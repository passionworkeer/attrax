import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const windows = process.platform === "win32";

const candidates = [
  windows && join(root, ".runvenv", "Scripts", "python.exe"),
  windows && join(root, ".venv", "Scripts", "python.exe"),
  windows && join(root, "rag_service", ".venv", "Scripts", "python.exe"),
  !windows && join(root, ".runvenv", "bin", "python"),
  !windows && join(root, ".venv", "bin", "python"),
  !windows && join(root, "rag_service", ".venv", "bin", "python"),
  "python3",
  "python",
  windows && { command: "py", args: ["-3"] },
].filter(Boolean);

function normalizeCandidate(candidate) {
  if (typeof candidate === "string") {
    return { command: candidate, args: [] };
  }
  return candidate;
}

function isUsable(candidate) {
  const { command, args } = normalizeCandidate(candidate);
  if ((command.includes("/") || command.includes("\\")) && !existsSync(command)) {
    return false;
  }

  const probe = spawnSync(command, [...args, "-m", "pytest", "--version"], {
    cwd: root,
    stdio: "ignore",
  });
  return probe.status === 0;
}

const selected = candidates.map(normalizeCandidate).find(isUsable);

if (!selected) {
  console.error("Could not find a Python interpreter with pytest installed.");
  console.error("Tried local .runvenv/.venv/rag_service/.venv, then python3/python/py -3.");
  process.exit(1);
}

const pytestArgs = process.argv.slice(2);
const args = selected.args.concat(["-m", "pytest"], pytestArgs.length ? pytestArgs : ["rag_service/tests/", "-v"]);

console.log(`Running pytest with ${selected.command}`);
const result = spawnSync(selected.command, args, {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
