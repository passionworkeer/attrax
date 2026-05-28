# Regulation Source Audit - 2026-05-27

## Scope

This audit covers all legal and regulatory source batches under `data/regulation_supplements/` as of 2026-05-27. It checks source traceability, local file integrity, and Markdown coverage for every manifest entry.

## What Was Checked

- Manifest completeness: ID, market, title, official channel, source type, source URL, files, categories, regulatory types, and retention rationale.
- Raw file coverage: every manifest file exists, and no raw file is orphaned outside the manifest.
- Local integrity: byte size and SHA-256 in `file_stats` exist and byte sizes match the preserved file; SHA-256 values were recomputed during the audit pass before documentation generation.
- Basic original-file structure: PDFs start with `%PDF-` and contain an EOF marker; DOCX files use ZIP/PK structure.
- Markdown coverage: every batch has `README.md` and `DOCUMENTS.md`; every manifest entry appears in the generated inventory.
- URL reachability: source/content URLs were checked with HEAD and ranged GET fallback.

## Result Summary

| Area | Result |
|---|---|
| Batches | 6 |
| Source entries | 259 |
| Raw originals | 369 |
| Raw file types | docx: 12, html: 102, pdf: 85, rdf: 37, xhtml: 37, xml: 96 |
| Local manifest/file/hash issues | 0 |
| PDF/DOCX structural issues | 0 |
| URL checks returning 2xx/3xx | 282/298 |
| URL checks needing manual retry or refresh | 16 |

## Batch Results

| Batch | Entries | Raw files | README | DOCUMENTS.md | Local status |
|---|---:|---:|---|---|---|
| [2026-05-25_official_sources](2026-05-25_official_sources/README.md) | 14 | 18 | yes | yes | clean |
| [2026-05-26_global_official_sources](2026-05-26_global_official_sources/README.md) | 55 | 63 | yes | yes | clean |
| [2026-05-26_registry_official_sources](2026-05-26_registry_official_sources/README.md) | 25 | 33 | yes | yes | clean |
| [2026-05-27_coverage_gap_official_sources](2026-05-27_coverage_gap_official_sources/README.md) | 40 | 76 | yes | yes | clean |
| [2026-05-27_extra_global_official_sources](2026-05-27_extra_global_official_sources/README.md) | 30 | 36 | yes | yes | clean |
| [2026-05-27_more_official_sources](2026-05-27_more_official_sources/README.md) | 95 | 143 | yes | yes | clean |

## URL Exceptions

These do not necessarily make the local original invalid. They mean the automated audit could not confirm the live URL on this run, or a direct convenience URL should be refreshed. The manifest `source_url` remains the first trace link to use for official verification.

| Status | Entry | URL field | URL | Notes |
|---|---|---|---|---|
| TypeError | `br-planalto-consumer-defense-code` | source_url | <http://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm> | Automated fetch failed; retry manually or with browser. |
| TypeError | `in-cpcb-plastic-waste-management-rules` | source_url | <https://cpcb.nic.in/plastic-waste-rules/> | Automated fetch failed; source remains an official CPCB domain. |
| TypeError | `in-battery-waste-management-rules-2022` | source_url | <https://cpcb.nic.in/uploads/hwmd/Battery-WasteManagementRules-2022.pdf> | Automated fetch failed; local PDF exists and is hash-verified. |
| 404 | `eu-2008-1272-clp` | content_url | <https://publications.europa.eu/resource/cellar/6bf54b59-7673-461b-b8e1-f24c545cbd3c.0006.03/DOC_1> | Direct Cellar content URL returned 404; CELEX source_url remains the authoritative trace link. |
| 404 | `eu-2009-125-ecodesign-energy-related-products` | content_url | <https://publications.europa.eu/resource/cellar/a7108d5e-5401-41c1-9a8a-d029b9df9e49.0006.03/DOC_1> | Direct Cellar content URL returned 404; CELEX source_url remains the authoritative trace link. |
| 404 | `eu-2000-14-outdoor-noise` | content_url | <https://publications.europa.eu/resource/cellar/d3c5dd69-9bd0-11e4-872e-01aa75ed71a1.0006.03/DOC_1> | Direct Cellar content URL returned 404; CELEX source_url remains the authoritative trace link. |
| 403 | `sg-consumer-protection-safety-requirements-regulations-2002` | source_url | <https://sso.agc.gov.sg/SL-Supp/S23-2002/Published?DocDate=20020110&ProvIds=Sc1-> | Singapore statutes site blocked automated access; verify in browser if needed. |
| TypeError | `tr-ministry-product-safety-consumer-info` | source_url | <https://ticaret.gov.tr/tuketici/piyasa-gozetimi/urun-guvenligi> | Automated fetch failed; retry manually or with browser. |
| TypeError | `tr-product-safety-technical-regulations-law-7223` | source_url | <https://urunkurallari.ticaret.gov.tr/en/legislation/product-safety-and-technical-regulations-law-no-7223> | Automated fetch failed; retry manually or with browser. |
| TypeError | `tr-law-7223-implementing-regulations` | source_url | <https://urunkurallari.ticaret.gov.tr/en/legislation/product-safety-and-technical-regulations-law-no-7223/implementing-regulations> | Automated fetch failed; retry manually or with browser. |
| TypeError | `in-cpcb-e-waste-rules-portal` | source_url | <https://www.cpcb.nic.in/e-waste/> | Automated fetch failed; source remains an official CPCB domain. |
| 429 | `us-16-cfr-1501-small-parts` | source_url | <https://www.ecfr.gov/api/versioner/v1/full/2026-05-21/title-16.xml?part=1501> | eCFR API rate-limited the audit run; retry later. |
| 429 | `us-16-cfr-1610-textile-flammability` | source_url | <https://www.ecfr.gov/api/versioner/v1/full/2026-05-21/title-16.xml?part=1610> | eCFR API rate-limited the audit run; retry later. |
| 429 | `us-16-cfr-1615-childrens-sleepwear-0-6x` | source_url | <https://www.ecfr.gov/api/versioner/v1/full/2026-05-21/title-16.xml?part=1615> | eCFR API rate-limited the audit run; retry later. |
| 429 | `us-16-cfr-1616-childrens-sleepwear-7-14` | source_url | <https://www.ecfr.gov/api/versioner/v1/full/2026-05-21/title-16.xml?part=1616> | eCFR API rate-limited the audit run; retry later. |
| 429 | `us-21-cfr-177-food-contact-polymers` | source_url | <https://www.ecfr.gov/api/versioner/v1/full/2026-05-21/title-21.xml?part=177> | eCFR API rate-limited the audit run; retry later. |

## Legal-Effect Boundary

The project can show that these files are preserved, hash-stable, and traceable to official or government publication channels. It cannot, by local inspection alone, certify that a law is currently in force, fully consolidated, translated with legal effect, or applicable to a specific product decision. Formal compliance use should re-check the live issuing authority, official gazette/consolidation status, and counsel where required.

## Follow-Up Items

- Refresh the three EU `content_url` values that returned 404 if direct Cellar document URLs are needed; otherwise rely on the CELEX `source_url` plus preserved raw file hashes.
- Retry eCFR URLs after rate limits clear.
- Manually verify access-blocked or network-failed official sites in a browser before treating their current live URL as confirmed.
- Keep `DOCUMENTS.md` regenerated whenever a manifest changes, so every source entry remains described in Markdown.

