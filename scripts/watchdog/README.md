# Regulation Watchdog

Daily change detection across the official sources tracked in
`data/regulation_sources/official_sources.json` (EU Cellar / Federal
Register / Canada Justice XML / GOV.UK / NZ / plus the regional regulator
sites).

> The count is the length of that JSON array, not a constant — it was 25,
> then 35 (2026-09-16), then 37 (2026-09-17). **Do not hardcode it.** Run
> `check_sources.py` (below) to see the real list and whether each entry
> still resolves.

## Two things to know before reading further

**Not every entry is fetchable, and the registry says so.** `fetch_status`
gates the pass:

| value | meaning | orchestrator |
|-------|---------|--------------|
| `active` (default) | normal source | fetched every pass |
| `unreachable` | upstream blocks automated clients from this host (403 at the CDN edge, or a data API now serving only its SPA shell) | skipped |
| `shell_only` | fetch succeeds but returns a JS shell whose digest is a page title | skipped |

Skipping is deliberate. Retrying a known-untrackable source nightly does
nothing but fill `errors.json` and, at seven consecutive failures, mark its
mapped regulations `stale`. The 2026-09-17 audit found nine of thirty-five
entries in exactly that state — added with plausible deep URLs that had
never once been fetched successfully.

**`human_view_status` is hand-written and was wrong.** It described what a
browser sees, not what the watchdog can fetch, and 9 entries passed it while
failing every automated request. Treat it as documentation, not as a check;
`check_sources.py` is the check.

## Run

```bash
# Live health check — dispatches every entry through its real collector
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.check_sources
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.check_sources --json
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.check_sources --only uk-weee-regulations-guidance

# Manual single pass
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.orchestrator --once

# Dry run (no outputs written, snapshot DB untouched)
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.orchestrator --dry-run

# Review / roll back what auto-ingest applied
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.review --date 2026-09-17
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.review --date 2026-09-17 --show EU-2011-65
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.review --date 2026-09-17 --revert EU-2011-65

# Production (lighthouse): daemon under pm2 — pass at startup, then daily
# at ATTRAX_REGWATCH_RUN_AT (server-local)
pm2 start scripts/ecosystem.config.cjs --only regwatch
pm2 logs regwatch --lines 100
```

**Run `check_sources.py` after any registry edit**, and periodically against
production. Exit 0 = every checked source fetched cleanly, 3 = at least one
failed, 1 = the registry itself is malformed.

## How a pass works

1. Load entries; drop anything whose `fetch_status` is not `active`.
2. Fetch them **in parallel** (thread pool, `ATTRAX_REGWATCH_FETCH_WORKERS`,
   default 8). Each source gets a 60 s budget enforced cooperatively through
   `collectors/base.py:fetch_deadline` — `fetch_url` checks it before every
   attempt and every backoff sleep, and shrinks the socket timeout to
   whatever remains. Python cannot interrupt a thread blocked in a socket
   read, so this is the only cap that actually holds.
3. Diff each result against the SQLite snapshot (state.py). Workers do only
   the thread-safe parts; everything that mutates shared state — the
   ingestor's report, `.auto_state.json`, the index rebuild — is applied
   serially afterwards, ordered by source id so the output files are
   byte-stable across runs.
4. Write outputs to `data/regulation_supplements/watchdog-{date}/`:
   `no_change.json` · `diff.json` · `cosmetic.json` · `errors.json` ·
   `applied.json` (and `pending_review.json` only when auto-ingest is off).
5. Auto-ingest applies real changes to the regulation library (below).

## Exit codes (single-pass / per-pass return values)

| Code | Meaning |
|------|---------|
| 0 | Clean — no changes, or cosmetic-only churn |
| 2 | Real changes detected → `pending_review.json` awaits a human (auto-ingest off) |
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
3. Documents above 500 K characters take a two-signal path instead: a
   line-hash Jaccard **and** a line-level Ratcliff-Obershelp ratio, with the
   reported similarity being the lower of the two. Jaccard alone is blind to
   reordering — a publisher that moves a section without rewriting it scores
   1.0 — so a high Jaccard with a low line ratio is reported as `modified`
   with `seqShiftSensitive: true`.
4. **Auto-ingest is the default** (`ATTRAX_REGWATCH_AUTO_INGEST=true`,
   2026-09-13 起).`auto_ingest.py` 接管真实变化：
   - **UPDATE / CREATE / MARK / EVIDENCE** — 见 `docs/WATCHDOG.md` §变更处理流程
   - 入库成功后**自动 rebuild `regulations_index.json`**（内联镜像
     `_rebuild_index()`，原 `scripts/build_regulation_library.py` 已删除 —
     不要单独运行任何 build_xxx 脚本）
   - 当日 `applied.json` 记录干了什么；退出码改写为 0
   - `regulation_for_source()` 按 `source_type` 映射到主库（registry 里加
     `regulation_id` 字段显式声明，或按 source_type 推断）。召回流
     （`cpsc_recall_api` / `openfda_recalls` / `safety_gate`）不是法规正文，
     只落证据、不建 YAML。
   - **verbatim replacement pass**: UPDATE 路径里，如果 YAML 的
     `source_kind: unverified`，且新抓文本含 `Article <n>` 边界，自动
     用真实正文覆盖 KB-condensed summaries，并把 source_kind 提升到
     `official_verbatim`（eu_celex）或 `official_summary`（其他）。详见
     `auto_ingest.py:_extract_articles_from_text`。
5. 手动审阅模式（`ATTRAX_REGWATCH_AUTO_INGEST=false`）：回到 `pending_review.json`
   + `--ack ` / `--ack-all` 推进基线。

## Reviewing what auto-ingest did

Auto-ingest writes straight into the library, so `review.py` is the
oversight half of that trade. It reads the `records[]` audit trail in
`applied.json` (source → regulation → action → evidence dir) and can:

- list a day's changes,
- show the raw fetch, its `meta.json` and the unified diff behind one change,
- restore a regulation from the pre-change backup the ingestor wrote, then
  rebuild the index.

`--revert` deliberately refuses to act when the live YAML is missing rather
than guessing a destination, and warns that the next pass re-applies an
update upstream really did make.

## Env vars

| Var | Default | Purpose |
|-----|---------|---------|
| `ATTRAX_REGWATCH_ENABLED` | `true` | kill switch for the whole pass |
| `ATTRAX_REGWATCH_RUN_AT` | `03:00` | daily run time HH:MM, server-local |
| `ATTRAX_REGWATCH_FETCH_WORKERS` | `8` | parallel fetch threads (clamped 1–64) |
| `ATTRAX_REGWATCH_UA` | — | override the primary User-Agent without a deploy |
| `ATTRAX_REGWATCH_AUTO_INGEST` | `true` | 自动入库（UPDATE/CREATE/MARK/EVIDENCE）并 rebuild `regulations_index.json`；`false` 退回人工 ack 模式 |
| `ATTRAX_REGWATCH_NOTIFY` | `log` | comma list: `log,slack,webhook` |
| `SLACK_WEBHOOK_URL` | — | required when `slack` is selected |
| `ATTRAX_REGWATCH_WEBHOOK` | — | required when `webhook` is selected |

## Adding a source

1. Apply a working endpoint in `official_sources.json`.
2. If the source type is new, add a collector module with
   `@register("<source_type>")` and import it from `collectors/__init__.py`.
   That import is what populates the registry; a test asserts every
   `source_type` in the registry has a collector, so a missing import fails
   the suite rather than silently falling back to raw-byte hashing.
3. Run `check_sources.py --only <id>` against production. "Human can open
   it" is not the bar — the watchdog has to fetch it, unattended, from the
   Seoul host.

## Tests

```bash
rag_service/.venv/bin/python -m pytest scripts/watchdog/tests/ -v
```
