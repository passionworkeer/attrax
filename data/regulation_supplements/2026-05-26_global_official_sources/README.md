# Global Regulation Supplement 2026-05-26

This directory contains isolated raw official or government-source regulation documents collected for review before ingestion.

## Scope

- Collected at: 2026-05-26T17:02:25+08:00
- Entries collected: 55
- Raw files referenced: 63
- Failed downloads: 0
- Markets: AU, BR, CA, EU, GCC, IN, JP, KR, MX, SG, UK, US
- Source manifest: manifest.json

## Coverage Themes

- Electronics, electrical equipment, radio/EMC, connected products
- Batteries, e-waste, packaging, sustainability and waste obligations
- Toys, children products, small parts, flammability and apparel/textiles
- Cosmetics, chemicals, food-contact materials, kitchenware and packaging
- General product safety, conformity assessment, labelling, documentation and market surveillance

## Notes

- Files remain isolated from `data/corpus/processed/` and `data/faiss/` until reviewed.
- This batch complements `2026-05-25_official_sources`, which already contains CN CCC, EU cyber/ecodesign/product-liability/common-charger, UK PSTI/UKCA, and US toy/button-battery/magnet/lead-paint entries.
- US eCFR browser pages may require access checks, so raw US files use the official eCFR API XML endpoint.
- EU files use Publications Office RDF metadata plus resolved Cellar XHTML document files where available.
- PDF-heavy entries will need the project PDF parser path before ingestion.
## Document Inventory

- Per-document inventory: [DOCUMENTS.md](DOCUMENTS.md)
- Source audit: [../SOURCE_AUDIT_2026-05-27.md](../SOURCE_AUDIT_2026-05-27.md)
- Local integrity status: raw files are referenced by manifest entries and hash-checked in the document inventory.
- Legal-effect boundary: these are preserved official-source originals for RAG review; formal legal validity still requires checking the live issuing authority or counsel.
