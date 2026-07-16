# Attrax Server Access Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a durable, secret-free server-access handoff while leaving the production application unchanged.

**Architecture:** Add one focused operations handoff under `docs/` and one small Codex memory update outside the repository. Verify the documented SSH and health commands against the live server, then commit only repository documentation.

**Tech Stack:** Markdown, OpenSSH, PM2, systemd, curl, Git.

---

### Task 1: Write the operations handoff

**Files:**
- Create: `docs/SERVER-ACCESS-HANDOFF.md`

- [ ] **Step 1: Record verified connection and runtime facts**

Include the SSH command, key fingerprint, production path, PM2 invocation, health endpoints, and the current no-deploy decision. Explicitly prohibit secrets in the document.

- [ ] **Step 2: Record future deployment constraints**

Document that `/opt/attrax` is not a Git checkout, repository access is private, `.env`/`data`/`.venv` must be preserved, and RAG must be stopped before a build on the 2 GiB server.

- [ ] **Step 3: Verify the documented commands**

Run:

```bash
ssh -o BatchMode=yes admin@203.0.113.10 "systemctl is-active pm2-root; curl -fsS http://127.0.0.1:3000/api/health"
```

Expected: `active`, followed by JSON with `frontend: ok` and `ragService.status: ok`.

### Task 2: Add the Codex memory update

**Files:**
- Create: `C:\workspace\.codex\memories\extensions\ad_hoc\notes\20260716-attrax-server-access.md`

- [ ] **Step 1: Write a secret-free memory note**

Record the workspace, SSH username/IP, key fingerprint, production path, PM2 command environment, and no-deploy decision. Do not store a password, private key, API key, or `.env` value.

### Task 3: Review and commit

**Files:**
- Review: `docs/SERVER-ACCESS-HANDOFF.md`
- Review: `docs/superpowers/specs/2026-07-16-server-access-handoff-design.md`
- Review: `docs/superpowers/plans/2026-07-16-server-access-handoff.md`

- [ ] **Step 1: Scan for accidental secrets**

Run:

```bash
git diff --check
git diff -- docs/
```

Expected: no whitespace errors and no password, private key, API key, or `.env` contents.

- [ ] **Step 2: Commit documentation**

Run:

```bash
git add docs/SERVER-ACCESS-HANDOFF.md docs/superpowers/specs/2026-07-16-server-access-handoff-design.md docs/superpowers/plans/2026-07-16-server-access-handoff.md
git commit -m "docs(ops): add Attrax server access handoff"
```

Expected: one documentation-only commit; no production deployment.
