# Regulation Supplement 2026-05-25

This directory is intentionally isolated from `data/corpus/` and `data/corpus/processed/`.
It contains newly collected official or official API source files for later review and ingestion.

## Scope

- Collected at: 2026-05-25T19:14:21+08:00
- Collector intent: add real, traceable regulation sources without mixing them into the current corpus.
- Source channels: Publications Office of the European Union, eCFR API, GOV.UK, CNCA.
- Raw files: `raw/`
- Source manifest: `manifest.json`

## Notes

- EUR-Lex PDF shortcut URLs returned zero-byte WAF challenge responses in this environment, so EU files use official Publications Office CELEX RDF metadata plus Cellar XHTML full text.
- eCFR browser pages returned a "Request Access" anti-scraping page, so US files use the official eCFR API XML endpoint instead.
- These files have not been added to `data/corpus/processed/` and the FAISS index has not been rebuilt.
## Document Inventory

- Per-document inventory: [DOCUMENTS.md](DOCUMENTS.md)
- Source audit: [../SOURCE_AUDIT_2026-05-27.md](../SOURCE_AUDIT_2026-05-27.md)
- Local integrity status: raw files are referenced by manifest entries and hash-checked in the document inventory.
- Legal-effect boundary: these are preserved official-source originals for RAG review; formal legal validity still requires checking the live issuing authority or counsel.
