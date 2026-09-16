"""Per-source-type collectors for the regulation watchdog.

Each collector turns entries from ``data/regulation_sources/official_sources.json``
into ``RegulationUpdate`` records. All fetching goes through the shared
``fetch_url`` helper (stdlib urllib + retry + timeout + WAF fallback UA,
see collectors/base.py) so a single source going down never blocks the
pass — failures are recorded per-source and the orchestrator continues.
"""
from scripts.watchdog.collectors.base import (
    RegulationUpdate,
    collect_generic,
    collect_source,
)
from scripts.watchdog.collectors.eu import collect_eu_celex
from scripts.watchdog.collectors.us_ecfr import collect_ecfr_part
from scripts.watchdog.collectors.us_cpsc import collect_cpsc_rss
from scripts.watchdog.collectors.gov_html import collect_gov_html
from scripts.watchdog.collectors.safety_gate import collect_safety_gate

__all__ = [
    "RegulationUpdate",
    "collect_source",
    "collect_generic",
    "collect_eu_celex",
    "collect_ecfr_part",
    "collect_cpsc_rss",
    "collect_gov_html",
    "collect_safety_gate",
]