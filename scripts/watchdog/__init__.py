"""Regulation watchdog — daily change detection across official sources.

Package layout:
- ``orchestrator``: single-pass entry point (run via pm2 ``cron_restart``).
- ``state``: SQLite-backed source-state cache + difflib change detection.
- ``notify``: pluggable notifiers (log / slack / generic webhook).
- ``collectors``: per-source-type fetchers (eu_celex / ecfr_part / cpsc_rss /
  gov_html / canada_justice_xml / direct_url).

Design notes (2026-09-12):
- Stdlib-only HTTP (``urllib.request``) so the lighthouse venv needs no new
  pip packages. The rag-service ``requests`` session is intentionally not
  reused: the watchdog must keep working even when the API venv is broken.
- Scheduling is pm2 ``cron_restart: "0 3 * * *"`` — the process itself only
  runs one pass and exits (code 0 = clean, 3 = partial failures). A
  long-running scheduler inside Python was rejected: pm2 already provides
  process supervision, logs, and restart backoff.
"""
