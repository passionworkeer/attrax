"""Shared schemas for RAG service payloads."""

from rag_service.schemas.report_package import ReportPackage, normalize_report_package

__all__ = ["ReportPackage", "normalize_report_package"]
