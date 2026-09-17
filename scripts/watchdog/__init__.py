"""Regulation watchdog — daily change detection across official sources.

Package layout:
- ``orchestrator``: pass entry point — parallel fetch, diff, output, notify.
- ``registry``: source_type → collector binding (``@register`` plugin table).
- ``state``: SQLite-backed source-state cache + difflib change detection.
- ``auto_ingest``: applies a detected change into the regulation library.
- ``review``: operator CLI to inspect and roll back what auto-ingest applied.
- ``notify``: pluggable notifiers (log / slack / generic webhook).
- ``collectors``: per-source-type fetchers — see ``registry.REGISTRY`` for
  the live list rather than a hardcoded one here.

Design notes:
- Stdlib-only HTTP (``urllib.request``) so the lighthouse venv needs no new
  pip packages. The rag-service ``requests`` session is intentionally not
  reused: the watchdog must keep working even when the API venv is broken.
- Scheduling lives inside the process (2026-09-13): one pass at startup, then
  a sleep until ``ATTRAX_REGWATCH_RUN_AT``. pm2's ``cron_restart`` never
  fired — it only acts on *online* processes, and a single-pass app that
  exits cleanly sits in "stopped".
- Sources whose upstream blocks automated clients outright carry
  ``fetch_status: "unreachable"`` in ``official_sources.json`` and are
  skipped rather than retried nightly; see ``orchestrator._is_fetchable``.
"""
