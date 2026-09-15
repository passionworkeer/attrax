# Regulation Watchdog

Daily change detection across the 25 official regulation sources tracked in
`data/regulation_sources/official_sources.json` (EU Cellar / eCFR / CPSC RSS /
GOV.UK / CA Justice Laws / NZ legislation / direct URLs).

## Architecture decision (2026-09-12, revised 2026-09-13)

**Daemon process with an internal daily scheduler** — the orchestrator runs
one pass at startup, then sleeps until the next `ATTRAX_REGWATCH_RUN_AT`
(default 03:00 **server-local** — Asia/Shanghai on lighthouse, i.e. 19:00 UTC)
and repeats. Stdlib only (`time.sleep` — no APScheduler, no extra pip
packages).

Why not pm2 `cron_restart`: it never fired in production (2026-09-13
incident) — pm2's cron only acts on **online** processes, and a single-pass
fork-mode app that exits cleanly sits in "stopped", which cron_restart
ignores. With the scheduler inside the process, pm2 supervises a
permanently-online app and `autorestart` covers crashes.

## Run

```bash
# Manual single pass (from repo root)
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.orchestrator --once

# Dry run (no outputs written, snapshot DB untouched)
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.orchestrator --dry-run

# Production (lighthouse): daemon under pm2 — pass at startup, then daily
# at ATTRAX_REGWATCH_RUN_AT (server-local)
pm2 start scripts/ecosystem.config.cjs --only regwatch
pm2 logs regwatch --lines 100
```

## Exit codes (single-pass / per-pass return values)

| Code | Meaning |
|------|---------|
| 0 | Clean — no changes, or cosmetic-only churn |
| 2 | Real changes detected → `pending_review.json` awaits a human |
| 3 | One or more sources failed (others still processed) → `errors.json` |
| 1 | Fatal (bad config, unreadable sources file) |

pm2 records non-zero exits as `errored` and `autorestart` relaunches — that is
expected and harmless in `--once` mode; in daemon mode these codes are logged
per pass and the loop keeps running.

## Outputs — `data/regulation_supplements/watchdog-{date}/`

| File | Written when |
|------|--------------|
| `no_change.json` | every source unchanged |
| `diff.json` | real changes (added / removed / modified) with unified diffs |
| `pending_review.json` | same changes + the next-step command for the operator (manual mode only) |
| `cosmetic.json` | similarity ≥ 0.95 churn (HTML boilerplate, timestamps) |
| `errors.json` | per-source fetch failures |
| `applied.json` | auto-ingest succeeded, one record per source — what was UPDATEd/CREATEd/MARKed |

Snapshot state lives in `data/regulation_supplements/.cache.db` (SQLite).

## Change-classification contract

1. SHA-256 of the whitespace-normalized text — identical hash ⇒ no change.
2. Hash differs ⇒ `difflib.SequenceMatcher` similarity against the previous
   snapshot:
   - ≥ **0.95** ⇒ `cosmetic` (snapshot updated, nothing reported)
   - < 0.95 ⇒ `modified` / `added` / `removed` ⇒ written into the
     `data/regulation_supplements/watchdog-{date}/` outputs
3. **Auto-ingest is the default** (`ATTRAX_REGWATCH_AUTO_INGEST=true`,
   2026-09-13 起)。`auto_ingest.py` 接管真实变化：
   - **UPDATE / CREATE / MARK / EVIDENCE** — 见 `docs/WATCHDOG.md` §变更处理流程
   - 入库成功后**自动 rebuild `regulations_index.json`**（内联镜像
     `_rebuild_index()`，原 `scripts/build_regulation_library.py` 已删除 —
     不要单独运行任何 build_xxx 脚本）
   - 当日 `applied.json` 记录干了什么；退出码改写为 0
4. 手动审阅模式（`ATTRAX_REGWATCH_AUTO_INGEST=false`）：回到 `pending_review.json`
   + `--ack ` / `--ack-all` 推进基线（但 snapshot 数据库的
   `data/regulation_supplements/.cache.db` 推进仍由人工 ack 触发）。

## Env vars

| Var | Default | Purpose |
|-----|---------|---------|
| `ATTRAX_REGWATCH_ENABLED` | `true` | kill switch for the whole pass |
| `ATTRAX_REGWATCH_RUN_AT` | `03:00` | daily run time HH:MM, server-local |
| `ATTRAX_REGWATCH_AUTO_INGEST` | `true` | 自动入库真实变化（UPDATE/CREATE/MARK/EVIDENCE）并 rebuild `regulations_index.json`；`false` 退回人工 ack 模式 |
| `ATTRAX_REGWATCH_NOTIFY` | `log` | comma list: `log,slack,webhook` |
| `SLACK_WEBHOOK_URL` | — | required when `slack` is selected |
| `ATTRAX_REGWATCH_WEBHOOK` | — | required when `webhook` is selected |

## Tests

```bash
rag_service/.venv/bin/python -m pytest scripts/watchdog/tests/ -v
```
