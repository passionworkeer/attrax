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
from scripts.watchdog.collectors.us_cpsc import collect_cpsc_rss
from scripts.watchdog.collectors.gov_html import collect_gov_html
from scripts.watchdog.collectors.safety_gate import collect_safety_gate
from scripts.watchdog.collectors.eu_cellar_sparql import collect_eu_cellar_sparql
from scripts.watchdog.collectors.uk_legislation import collect_uk_legislation_xml
from scripts.watchdog.collectors.openfda import collect_openfda_recalls
from scripts.watchdog.collectors.health_canada import collect_health_canada_recalls
from scripts.watchdog.collectors.tga import collect_tga_rss
from scripts.watchdog.collectors.accc_recalls import collect_accc_recalls_rss

__all__ = [
    "RegulationUpdate",
    "collect_source",
    "collect_generic",
    "collect_eu_celex",
    "collect_ecfr_part",
    "collect_cpsc_rss",
    "collect_gov_html",
    "collect_safety_gate",
    "collect_eu_cellar_sparql",
    "collect_uk_legislation_xml",
    "collect_openfda_recalls",
    "collect_health_canada_recalls",
    "collect_tga_rss",
    "collect_accc_recalls_rss",
]
