# Regulation Source Registry and Official Source Expansion Design

> ⚠️ **SUPERSEDED — 2026-05-26 历史架构设计 spec**。当前权威源注册见 `data/regulation_sources/` + `scripts/regulation_collectors/`，运行时由 `scripts/watchdog/` 自动维护。

## Context

The project already has an isolated official-source supplement at
`data/regulation_supplements/2026-05-26_global_official_sources` with 55
entries, 63 raw files, and coverage across 12 markets. The current collector
works, but its source list is embedded directly in
`scripts/collect_global_regulation_sources.py`, which makes future expansion
hard to review, deduplicate, and test.

This design keeps the raw-source isolation model, adds a small source registry,
and uses the registry to collect the next batch of official regulations.

## Goals

- Add more official regulatory documents for high-value markets and product
  categories without mixing raw files into the processed corpus.
- Move source declarations out of hardcoded Python and into a reviewable
  registry file.
- Preserve manifest quality checks: official channel, source URL, raw files,
  hashes, market, product categories, regulatory types, and failed downloads.
- Prepare the pipeline for PDF-heavy markets and broader must-check coverage.

## Non-Goals

- Do not ingest the new raw batch into `data/corpus/processed` until reviewed.
- Do not rebuild `data/faiss` as part of source collection.
- Do not refactor the full RAG service in this step.
- Do not replace the current collector all at once if a compatibility wrapper
  can keep the change smaller.

## Collection Scope

The next batch should target official or government-hosted sources that fill
current coverage gaps:

- EU: GPSR, Toy Safety Directive, RoHS, WEEE, RED, EMC, LVD, market
  surveillance, and other CELEX-backed acts from EUR-Lex/Publications Office.
- US: eCFR XML for phthalates, poison prevention packaging, carpet and rug
  flammability, mattresses/open flame, and other CPSC or EPA consumer-product
  rules that are reachable through official APIs.
- Canada: Justice Laws XML for phthalates, surface coating materials, consumer
  chemical containers, lead, children sleepwear, and related consumer product
  rules.
- UK: GOV.UK and HSE pages for WEEE, packaging EPR, UK REACH, SVHC, and
  product-safety obligations.
- New Zealand and similar markets where reachable: product-safety standards,
  button batteries, toys, and children-product safety rules.

Priority product categories are electronics, toys, children products, textiles
and apparel, furniture and soft goods, food contact, cosmetics, batteries,
packaging/EPR, radio equipment, PPE, and general consumer products.

## Source Registry

Add a registry file at `data/regulation_sources/official_sources.json`.
Each source entry should be declarative and reviewable:

- `id`: stable slug.
- `market`: jurisdiction code such as `EU`, `US`, `CA`, `UK`, `NZ`.
- `title`: human-readable official title.
- `channel`: official authority or publication channel.
- `source_type`: adapter type, for example `eu_celex`, `ecfr_part`,
  `canada_justice_xml`, `direct_url`, or `gov_html`.
- `source_url`: official browser URL or API URL template.
- `files`: expected relative raw file paths.
- `product_categories`: controlled tags used for coverage and retrieval rules.
- `regulatory_types`: controlled tags such as `product_safety`, `chemical`,
  `labelling`, `conformity`, `flammability`, `radio`, `waste`, or
  `market_surveillance`.
- `why_added`: short compliance reason.
- Optional adapter fields such as `celex`, `ecfr_title`, `ecfr_part`, or
  `min_bytes`.

The initial registry can include the next batch only. Existing hardcoded
entries can be migrated gradually after the generic path is proven.

## Collector Design

Add a registry-driven collector script or extend the current one with a
registry mode:

1. Load `official_sources.json`.
2. Dispatch each entry by `source_type`.
3. Download raw official files into a dated isolated supplement directory.
4. Compute file size and SHA-256 for every referenced raw file.
5. Write `manifest.json`, `README.md`, and `download_failures.json` when needed.

Adapters should stay small:

- `eu_celex`: fetch Publications Office RDF, resolve Cellar XHTML, keep both
  metadata and text files.
- `ecfr_part`: build official eCFR API XML URL using a pinned date.
- `canada_justice_xml`: download Justice Laws XML directly.
- `direct_url`: download PDFs or HTML pages with normal retry/fallback rules.
- `gov_html`: download government guidance HTML and keep original URL metadata.

## Ingestion and Indexing Follow-Up

The current ingestion script supports HTML, XHTML, XML, and RDF. The next
architecture step should add supplement PDF ingestion, because AU, IN, GCC, JP,
and some government sources are PDF-heavy.

After review, ingestion should write one processed JSON per manifest entry,
preserve official metadata, then rebuild FAISS only as an explicit separate
step. The manifest should record ingestion status and index build status so a
future report can tell which source batch is active in retrieval.

## RAG Architecture Improvements

- Replace hardcoded `must_check.py` rules with rules derived from registry or
  processed metadata, while keeping a curated override file for true mandatory
  obligations.
- Add source quality metadata such as authority level, official/publication
  type, effective date, language, and raw/processed/index lifecycle status.
- Add a retrieval evaluation set for the newly covered categories and markets,
  especially EU GPSR/RoHS/RED, US CPSC/eCFR, Canada chemicals, UK EPR/REACH,
  and NZ product safety.
- Consider a reranker only after retrieval eval shows poor ordering. The
  current codebase does not contain a `cohere_reranker.py` module, so reranking
  should be treated as a new integration, not a simple wiring task.
- Keep startup behavior stable: existing FAISS and BM25 load paths should still
  work when no new registry-driven supplement has been ingested.

## Error Handling

- Failed downloads must be listed in `download_failures.json` and reflected in
  `manifest.summary.failed_downloads`.
- Manifest tests should fail if referenced files are missing, empty, or lack
  file stats.
- Adapters should tolerate official-site redirects and access-check pages by
  validating minimum bytes and, where practical, content signatures.
- Collection failures should not modify `data/corpus/processed` or `data/faiss`.

## Testing

Add focused tests for:

- Registry schema sanity: required fields, unique IDs, supported source types,
  controlled tags, and valid relative raw paths.
- Manifest output: no missing files, stats include bytes and SHA-256, summaries
  match entries, and isolation status is preserved.
- Adapter URL construction for CELEX, eCFR, and Canada Justice XML without
  needing network calls.
- Existing ingestion tests should continue to pass for the 2026-05-25 batch.

## Execution Plan

1. Add the source registry with the next official-source batch.
2. Add registry schema tests.
3. Add or extend a collector so it can build a dated supplement from registry
   entries.
4. Run collection and verify raw files plus manifest.
5. Run the focused pytest suite.
6. Report coverage gained and remaining gaps before ingestion.

## Approval Check

This design intentionally keeps collection, ingestion, and index rebuild as
separate steps. That preserves reviewability while making the source expansion
repeatable.
