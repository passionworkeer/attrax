# Regulation Retrieval Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add retrieval eval coverage, metadata-driven retrieval routing, and incremental official-source manifest diffing.

**Architecture:** Keep the existing registry, ingestion, FAISS, and hybrid retrieval pipeline. Add small focused modules for metadata filtering, retrieval evaluation, and manifest diffing, then wire them into current scripts.

**Tech Stack:** Python, pytest, existing FAISS/BM25 retrievers, JSON manifests, PowerShell commands on Windows.

---

### Task 1: Retrieval Eval Dataset And Runner

**Files:**
- Create: `data/regulation_eval/retrieval_cases.json`
- Create: `rag_service/eval/regulation_retrieval_eval.py`
- Create: `scripts/evaluate_regulation_retrieval.py`
- Test: `rag_service/tests/test_regulation_retrieval_eval.py`

- [ ] Write tests for case validation, hit-rate scoring, and grouped summaries.
- [ ] Implement the eval runner API: `load_cases`, `validate_cases`, `evaluate_cases`, `summarize_results`, `write_report`.
- [ ] Add the CLI wrapper.
- [ ] Add curated cases covering EU, US, CN, CA, UK, and NZ across electronics, toys, children products, packaging, chemical, waste, and safety risks.
- [ ] Run `pytest rag_service/tests/test_regulation_retrieval_eval.py -q`.
- [ ] Commit the eval dataset and runner.

### Task 2: Metadata Routing

**Files:**
- Create: `rag_service/retrieval/metadata_filter.py`
- Modify: `scripts/ingest_regulation_supplements.py`
- Modify: `scripts/build_faiss.py`
- Modify: `rag_service/retrieval/bm25_retriever.py`
- Modify: `rag_service/retrieval/fusion.py`
- Modify: `rag_service/retrieval/hybrid_retriever.py`
- Test: `rag_service/tests/test_metadata_retrieval_routing.py`
- Test: `rag_service/tests/test_regulation_supplement_ingest.py`
- Test: `rag_service/tests/test_build_faiss_versioning.py`

- [ ] Write failing tests for metadata normalization/filtering and strict `HybridRetriever.retrieve()` routing.
- [ ] Write failing tests proving ingestion carries manifest categories/types into processed metadata.
- [ ] Write failing tests proving FAISS chunks carry source metadata.
- [ ] Implement metadata filter helpers.
- [ ] Preserve official metadata during ingestion and chunking.
- [ ] Preserve metadata through BM25 and RRF fusion results.
- [ ] Add strict metadata filtering to hybrid retrieval.
- [ ] Re-ingest registry official supplements and rebuild the active FAISS index.
- [ ] Run focused retrieval/ingestion/build tests.
- [ ] Commit metadata routing changes and refreshed processed official docs/manifests.

### Task 3: Incremental Manifest Diff

**Files:**
- Create: `scripts/diff_regulation_manifests.py`
- Modify: `scripts/collect_official_sources_from_registry.py`
- Test: `rag_service/tests/test_regulation_manifest_diff.py`
- Test: `rag_service/tests/test_registry_collector_adapters.py`

- [ ] Write failing tests for added, removed, changed, unchanged, and version-changed entries.
- [ ] Implement manifest diff helpers and CLI output.
- [ ] Add source-version metadata to registry manifest entries.
- [ ] Wire `--previous-manifest` and `--diff-output` into the registry collector.
- [ ] Run focused manifest tests.
- [ ] Commit incremental diff support.

### Task 4: Verification And Reports

**Files:**
- Generated: `data/regulation_eval/results/2026-05-26_registry_retrieval_eval.json`
- Generated: `data/regulation_eval/results/2026-05-26_registry_retrieval_eval.md`

- [ ] Run the retrieval eval against the active index.
- [ ] Run the focused Python test suite for the new and touched modules.
- [ ] Verify active FAISS loads and contains metadata-enriched chunks.
- [ ] Commit any curated reports that should be versioned.
- [ ] Push `main` to `origin/main`.
