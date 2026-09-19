import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// render-nginx-vhost.sh --check 的行为回归。
//
// 2026-09-19 实测：模板的 upstream 行是
//   server 127.0.0.1:__NEXTJS_PORT__ max_fails=3 fail_timeout=30s;
// 而脚本用 `server 127\.0\.0\.1:[0-9]+;\s*$` 匹配（要求端口后紧跟分号结束），
// 永远命中不了；grep 未命中 + set -e → 脚本静默 rc=1、零输出，
// preflight-deploy.mjs 的第二步因此必然中止，整个预检失效。
//
// 这里在仓库根的 tmp/（已 gitignore）里搭一份 scripts/ + docs/infra/ 副本，
// 只替换模板或 ports.env 后运行真实脚本，覆盖成功与三种失败分支。
const REPO_ROOT = process.cwd();
const FIXTURE_ROOT = join(REPO_ROOT, "tmp", "vitest-render-nginx-vhost");
const SCRIPT = join(FIXTURE_ROOT, "scripts", "render-nginx-vhost.sh");
const TEMPLATE = join(FIXTURE_ROOT, "docs", "infra", "nginx-attrax-vhost-prod.conf.template");
const PORTS_ENV = join(FIXTURE_ROOT, "scripts", "ports.env");

const REAL_PORTS_ENV = readFileSync(join(REPO_ROOT, "scripts", "ports.env"), "utf8");
const REAL_TEMPLATE = readFileSync(
  join(REPO_ROOT, "docs", "infra", "nginx-attrax-vhost-prod.conf.template"),
  "utf8",
);
const PLACEHOLDER_TEMPLATE = [
  "upstream attrax_nextjs {",
  "    server 127.0.0.1:__NEXTJS_PORT__ max_fails=3 fail_timeout=30s;",
  "    keepalive 32;",
  "}",
  "",
].join("\n");

function setup(templateBody: string, portsBody: string) {
  mkdirSync(join(FIXTURE_ROOT, "scripts"), { recursive: true });
  mkdirSync(join(FIXTURE_ROOT, "docs", "infra"), { recursive: true });
  cpSync(join(REPO_ROOT, "scripts", "render-nginx-vhost.sh"), SCRIPT);
  writeFileSync(TEMPLATE, templateBody);
  writeFileSync(PORTS_ENV, portsBody);
}

function runCheck() {
  return spawnSync("bash", [SCRIPT, "--check"], { encoding: "utf8" });
}

describe("render-nginx-vhost.sh --check", () => {
  beforeAll(() => rmSync(FIXTURE_ROOT, { recursive: true, force: true }));
  afterAll(() => rmSync(FIXTURE_ROOT, { recursive: true, force: true }));

  it("passes on the real template (upstream line carries max_fails/fail_timeout)", () => {
    setup(REAL_TEMPLATE, REAL_PORTS_ENV);
    const result = runCheck();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK: rendered upstream attrax_nextjs -> 127.0.0.1:3000");
  });

  it("passes when ports.env selects a different port", () => {
    setup(PLACEHOLDER_TEMPLATE, "NEXTJS_PORT=3100\n");
    const result = runCheck();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK: rendered upstream attrax_nextjs -> 127.0.0.1:3100");
  });

  it("reports drift instead of exiting silently when the template hardcodes another port", () => {
    setup(PLACEHOLDER_TEMPLATE.replace("__NEXTJS_PORT__", "3100"), "NEXTJS_PORT=3000\n");
    const result = runCheck();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("ERROR: upstream port drift");
  });

  it("reports a missing server line instead of exiting silently", () => {
    setup("upstream attrax_nextjs {\n    keepalive 32;\n}\n", "NEXTJS_PORT=3000\n");
    const result = runCheck();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "ERROR: rendered template has no upstream attrax_nextjs server line",
    );
  });

  it("reports a missing NEXTJS_PORT instead of exiting silently", () => {
    setup(PLACEHOLDER_TEMPLATE, "RAG_PORT=8001\n");
    const result = runCheck();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ERROR: NEXTJS_PORT in ports.env is missing or invalid");
  });
});
