# Regulation Supplements

This folder stores isolated official or government-source legal and regulatory originals before or alongside ingestion into the RAG corpus. Each batch keeps its raw files, source manifest, batch README, and generated per-document inventory.

Last audit: 2026-05-27

## Traceability Standard

A source is treated as traceable for project use when all of these are true:

- `manifest.json` records an ID, market, title, official channel, source type, source URL, product categories, regulatory types, and reason for retaining it.
- Every manifest file path exists under `raw/`.
- Every raw file has byte size and SHA-256 recorded in `file_stats`, and the recorded values match the local file.
- `DOCUMENTS.md` explains every source entry and lists every preserved original file.
- Automated URL reachability exceptions are called out in the audit report.

This is an engineering traceability standard, not legal advice or a certificate that a text is currently in force.

## Audit Snapshot

- Batches: 6
- Source entries: 259
- Raw originals: 369
- File types: docx 12, html 102, pdf 85, rdf 37, xhtml 37, xml 96
- Local manifest/file/hash issues after cleanup: 0
- PDF/DOCX structural check issues: 0
- URL reachability: 282/298 URLs returned 2xx/3xx-range responses in the automated audit; 16 need manual retry or refresh.

## Batches

| Batch | Entries | Raw files | Inventory | Notes |
|---|---:|---:|---|---|
| [2026-05-25_official_sources](2026-05-25_official_sources/README.md) | 14 | 18 | [DOCUMENTS.md](2026-05-25_official_sources/DOCUMENTS.md) | Local checks clean |
| [2026-05-26_global_official_sources](2026-05-26_global_official_sources/README.md) | 55 | 63 | [DOCUMENTS.md](2026-05-26_global_official_sources/DOCUMENTS.md) | Local checks clean |
| [2026-05-26_registry_official_sources](2026-05-26_registry_official_sources/README.md) | 25 | 33 | [DOCUMENTS.md](2026-05-26_registry_official_sources/DOCUMENTS.md) | Local checks clean |
| [2026-05-27_coverage_gap_official_sources](2026-05-27_coverage_gap_official_sources/README.md) | 40 | 76 | [DOCUMENTS.md](2026-05-27_coverage_gap_official_sources/DOCUMENTS.md) | Local checks clean |
| [2026-05-27_extra_global_official_sources](2026-05-27_extra_global_official_sources/README.md) | 30 | 36 | [DOCUMENTS.md](2026-05-27_extra_global_official_sources/DOCUMENTS.md) | Local checks clean |
| [2026-05-27_more_official_sources](2026-05-27_more_official_sources/README.md) | 95 | 143 | [DOCUMENTS.md](2026-05-27_more_official_sources/DOCUMENTS.md) | Local checks clean |

## Audit Report

- Detailed report: [SOURCE_AUDIT_2026-05-27.md](SOURCE_AUDIT_2026-05-27.md)
- The report records current automated URL exceptions, including rate limits, access blocks, and three EU direct content URLs that should be refreshed from CELEX if the direct `content_url` is needed.

