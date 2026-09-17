"""Per-source-type collectors for the regulation watchdog.

Each collector turns entries from ``data/regulation_sources/official_sources.json``
into ``RegulationUpdate`` records and declares its ``source_type`` with
``@registry.register``. All fetching goes through the shared ``fetch_url``
helper (stdlib urllib + retry + timeout + cookie jar + WAF fallback UA, see
collectors/base.py) so a single source going down never blocks the pass —
failures are recorded per-source and the orchestrator continues.

Importing this package is what populates ``registry.REGISTRY``: every module
below runs its ``@register`` decorator as an import side effect. Anything that
needs dispatch (``registry.collect_source``) triggers this import lazily, so
the module list here is the single place a new collector must be added.
"""
from scripts.watchdog.collectors.base import (
    RegulationUpdate,
    collect_generic,
    collect_source,
)
from scripts.watchdog.collectors.eu import collect_eu_celex
from scripts.watchdog.collectors.us_ecfr import collect_ecfr_part
from scripts.watchdog.collectors.us_cpsc_api import collect_cpsc_recall_api
from scripts.watchdog.collectors.gov_html import collect_gov_html
from scripts.watchdog.collectors.safety_gate import collect_safety_gate
from scripts.watchdog.collectors.openfda import collect_openfda_recalls

__all__ = [
    "RegulationUpdate",
    "collect_source",
    "collect_generic",
    "collect_eu_celex",
    "collect_ecfr_part",
    "collect_cpsc_recall_api",
    "collect_gov_html",
    "collect_safety_gate",
    "collect_openfda_recalls",
]
