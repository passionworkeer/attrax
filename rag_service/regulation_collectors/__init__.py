"""Reusable building blocks for official-source regulation collectors."""
from rag_service.regulation_collectors.base import BaseCollector
from rag_service.regulation_collectors.eu_rdf import (
    EU_CELLAR_VARIANTS_FULL,
    EU_CELLAR_VARIANTS_SHORT,
    ensure_eu_text,
)

__all__ = [
    "BaseCollector",
    "EU_CELLAR_VARIANTS_FULL",
    "EU_CELLAR_VARIANTS_SHORT",
    "ensure_eu_text",
]