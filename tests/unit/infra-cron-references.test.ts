/**
 * docs/infra/cron-* fragments must be installable and point at real scripts.
 *
 * Two failure modes this exists to prevent, both of which have already happened:
 *
 *  1. A cron fragment referenced /opt/attrax/scripts/backup-remote.sh, but that
 *     script had never been added to scripts/ — so cron failed every day with
 *     "No such file or directory" and nothing noticed, because the error only
 *     landed in a log file nobody read.
 *  2. A cron fragment carried a four-line `*****` banner. In /etc/cron.d a line
 *     that is not a comment, an env assignment or a job is a hard error for
 *     cron — installing the fragment as written would have silently disabled
 *     the schedule it was supposed to install.
 *
 * So: parse every fragment strictly, and check that any script it invokes has a
 * counterpart in the repo. This is deliberately a syntactic gate, not a
 * semantic one — it cannot tell you the backup works, only that the line cron
 * would read is well-formed and not pointing at a missing file.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const INFRA_DIR = join(REPO_ROOT, "docs", "infra");

function cronFragments(): string[] {
  return readdirSync(INFRA_DIR)
    .filter((name) => name.startsWith("cron-"))
    .sort();
}

/** Fields in a cron.d job line: 5 schedule fields, a user, then the command. */
const JOB_LINE = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/;
const ENV_LINE = /^[A-Za-z_][A-Za-z0-9_]*=/;

type ParsedLine =
  | { kind: "env"; text: string }
  | { kind: "job"; user: string; command: string; text: string };

function parseFragment(file: string): { invalid: string[]; jobs: ParsedLine[] } {
  const invalid: string[] = [];
  const jobs: ParsedLine[] = [];

  readFileSync(join(INFRA_DIR, file), "utf8")
    .split("\n")
    .forEach((raw, index) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      if (ENV_LINE.test(line)) {
        jobs.push({ kind: "env", text: line });
        return;
      }
      const match = line.match(JOB_LINE);
      if (!match) {
        // Name the offending line: this is the assertion that catches banner
        // text, stray whitespace-only rules, and truncated job lines.
        invalid.push(`${file}:${index + 1}: ${line}`);
        return;
      }
      jobs.push({ kind: "job", user: match[6], command: match[7], text: line });
    });

  return { invalid, jobs };
}

describe("docs/infra/cron-* fragments", () => {
  it("finds the fragments it is meant to guard", () => {
    const fragments = cronFragments();
    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments).toContain("cron-attrax-backup");
  });

  it("contains only comments, env assignments and well-formed job lines", () => {
    const offenders = cronFragments().flatMap((file) => parseFragment(file).invalid);
    expect(offenders).toEqual([]);
  });

  it("runs jobs as a user that exists on the host", () => {
    // lighthouse has `ubuntu` and `root`; earlier revisions said `admin`, a
    // user that was removed when the host was rebuilt.
    const allowed = new Set(["ubuntu", "root"]);
    const bad = cronFragments().flatMap((file) =>
      parseFragment(file)
        .jobs.filter((job): job is Extract<ParsedLine, { kind: "job" }> => job.kind === "job")
        .filter((job) => !allowed.has(job.user))
        .map((job) => `${file}: runs as '${job.user}' -> ${job.command}`),
    );
    expect(bad).toEqual([]);
  });

  it("every /opt/attrax/scripts/<name> it invokes exists in scripts/", () => {
    const missing: string[] = [];
    for (const file of cronFragments()) {
      for (const job of parseFragment(file).jobs) {
        if (job.kind !== "job") continue;
        for (const match of job.command.matchAll(/\/opt\/attrax\/scripts\/([\w.-]+)/g)) {
          if (!existsSync(join(REPO_ROOT, "scripts", match[1]))) {
            missing.push(`${file} -> scripts/${match[1]}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("does not reference the retired scan-queue directories", () => {
    // data/scan-queue/ was removed with the de-RAG collapse; the fragments
    // that cleaned it were left behind, doing nothing.
    const offenders = cronFragments().filter((file) =>
      readFileSync(join(INFRA_DIR, file), "utf8").includes("scan-queue"),
    );
    expect(offenders).toEqual([]);
  });

  it("every fragment documents its install path", () => {
    // Cheap documentation check: each fragment should say where it is copied to,
    // since it is not installed by any script in this repo.
    const undocumented = cronFragments().filter(
      (file) => !readFileSync(join(INFRA_DIR, file), "utf8").includes("/etc/cron.d/"),
    );
    expect(undocumented).toEqual([]);
  });
});
