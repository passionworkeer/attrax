# Regulation Retrieval Governance Design

## Goal

Build the next regulation data layer around three operational capabilities:

- a repeatable retrieval evaluation set across markets, categories, and risk scenarios;
- metadata-driven retrieval routing for market, category, regulatory type, and official-source authority;
- manifest-level collection diffing so each official-source batch records added, removed, changed, and unchanged regulations.

## Current Context

The project already has a registry of official sources in `data/regulation_sources/official_sources.json`, isolated raw supplement manifests under `data/regulation_supplements/`, processed official documents under `data/corpus/processed/*_Official_*.json`, and a versioned FAISS build pipeline in `scripts/build_faiss.py`.

The active index currently works, but the chunk metadata is too thin for precise routing: chunks carry source ids and regions, while source category, regulatory type, authority, and URLs are mostly left inside processed-document metadata. The old eval runner is scan-oriented; it does not directly measure whether retrieval returned the expected official source.

## Design

### 1. Retrieval Evaluation

Add a curated JSON evaluation set at `data/regulation_eval/retrieval_cases.json`. Each case describes:

- market;
- product category;
- regulatory types or risk scenarios;
- query text;
- expected official source ids.

Add a runner module at `rag_service/eval/regulation_retrieval_eval.py` and a thin CLI wrapper at `scripts/evaluate_regulation_retrieval.py`. The runner loads active FAISS metadata, builds a BM25-backed `HybridRetriever`, applies metadata filters, then reports hit rate, miss rate, mean reciprocal rank, and grouped coverage by market and category.

### 2. Metadata-Driven Retrieval Routing

Add a small retrieval filter layer under `rag_service/retrieval/metadata_filter.py`. It normalizes metadata from both top-level chunk fields and nested `metadata` fields, then supports strict matching for:

- market/region;
- product category;
- regulatory type;
- official source only;
- source ids.

Update processed ingestion and FAISS chunking so official-source metadata is preserved onto each chunk. Update BM25/fusion/hybrid retrieval so result dictionaries keep the same metadata and so `HybridRetriever.retrieve()` can narrow BM25 candidates before ranking and filter fused results afterward.

### 3. Incremental Collection Diff

Add manifest diff utilities in `scripts/diff_regulation_manifests.py`. The diff compares entries by id and file sha256 hashes, returning added, removed, changed, unchanged, and version-changed entries. Integrate the same diff into `scripts/collect_official_sources_from_registry.py` behind `--previous-manifest` and `--diff-output`, then write the summary into the generated manifest as `incremental_diff`.

Source-version metadata will be explicit per manifest entry when available: eCFR date, CELEX id, source URL, and optional lifecycle fields such as publication/effective dates, supersedes, and replaces.

## Error Handling

- Missing eval case fields fail validation before a run starts.
- Missing FAISS metadata or chunks produces a clear runner error.
- Empty metadata-filter result sets return no results instead of silently broadening the query.
- Manifest diff accepts missing previous manifests and reports all current entries as added.

## Testing

Add focused tests for:

- eval case validation and retrieval scoring;
- metadata normalization/filtering and `HybridRetriever.retrieve()` strict routing;
- processed ingestion preserving registry metadata;
- FAISS chunking preserving document metadata;
- manifest diff added/removed/changed/unchanged behavior;
- registry collector embedding incremental diff metadata.

## Out of Scope

This phase does not add a new embedding provider or a UI. The FAISS index can still be rebuilt with the deterministic hash fallback when no embedding provider is configured; production semantic quality should use Ollama or ModelScope embeddings.
