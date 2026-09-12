# Regulation Watchdog

Daily change detection across the 25 official regulation sources tracked in
`data/regulation_sources/official_sources.json` (EU Cellar / eCFR / CPSC RSS /
GOV.UK / CA Justice Laws / NZ legislation / direct URLs).

## Architecture decision (2026-09-12)

**Single-pass process + pm2 `cron_restart`** — no APScheduler, no
long-running Python daemon, no new pip packages (stdlib `urllib` /
`sqlite3` / `difflib` only). pm2 already provides supervision, logs, and
restart backoff; a second scheduler inside the process would duplicate that
and add a venv dependency (`regwatch-eu`, `APScheduler`, `feedparser`) for no
functional gain. The EU collector re-implements the CELEX → Cellar
resolution already proven in `rag_service/regulation_collectors/eu_rdf.py`.

## Run

```bash
# Manual single pass (from repo root)
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.orchestrator --once

# Dry run (no outputs written, snapshot DB untouched)
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.orchestrator --dry-run

# Production (lighthouse): pm2 owns the schedule (03:00 UTC daily)
pm2 start scripts/ecosystem.config.cjs --only regwatch
pm2 logs regwatch --lines 100
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Clean — no changes, or cosmetic-only churn |
| 2 | Real changes detected → `pending_review.json` awaits a human |
| 3 | One or more sources failed (others still processed) → `errors.json` |
| 1 | Fatal (bad config, unreadable sources file) |

pm2 records non-zero exits as `errored` before the next cron tick — that is
expected and harmless; check `pm2 logs regwatch`.

## Outputs — `data/regulation_supplements/watchdog-{date}/`

| File | Written when |
|------|--------------|
| `no_change.json` | every source unchanged |
| `diff.json` | real changes (added / removed / modified) with unified diffs |
| `pending_review.json` | same changes + the next-step command for the operator |
| `cosmetic.json` | similarity ≥ 0.95 churn (HTML boilerplate, timestamps) |
| `errors.json` | per-source fetch failures |

Snapshot state lives in `data/regulation_supplements/.cache.db` (SQLite).

## Change-classification contract

1. SHA-256 of the whitespace-normalized text — identical hash ⇒ no change.
2. Hash differs ⇒ `difflib.SequenceMatcher` similarity against the previous
   snapshot:
   - ≥ **0.95** ⇒ `cosmetic` (snapshot updated, nothing reported)
   - < 0.95 ⇒ `modified` / `added` / `removed` ⇒ `pending_review.json`
3. **The regulation library is never rebuilt automatically.** Real changes
   always stop at `pending_review.json`; the operator reviews `diff.json`
   and runs `scripts/build_regulation_library.py` deliberately.

## Env vars

| Var | Default | Purpose |
|-----|---------|---------|
| `ATTRAX_REGWATCH_ENABLED` | `true` | kill switch for the whole pass |
| `ATTRAX_REGWATCH_CRON` | `0 3 * * *` | pm2 cron (read at `pm2 start` time) |
| `ATTRAX_REGWATCH_NOTIFY` | `log` | comma list: `log,slack,webhook` |
| `SLACK_WEBHOOK_URL` | — | required when `slack` is selected |
| `ATTRAX_REGWATCH_WEBHOOK` | — | required when `webhook` is selected |

## Tests

```bash
rag_service/.venv/bin/python -m pytest scripts/watchdog/tests/ -v
```
