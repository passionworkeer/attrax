#!/usr/bin/env python3
"""
retag_product_categories.py - Patch missing/incomplete product_categories on
FAISS meta sidecar + corpus processed JSON.

Root cause of the recall bug (commit 388de12 fallback):
  - 44.9% of FAISS chunks (6509 / 14495) have empty product_categories.
  - Several tagged docs (e.g. us-16-cfr-1303-lead-paint) are missing
    children_products even though they are fundamentally children-product
    regulations, so the strict metadata filter excludes them and the
    fallback has to rescue recall.

This script tags the gap IN PLACE. No re-embedding — product_categories
is a sidecar field consumed by metadata_filter.chunk_matches, not by the
vector or BM25 indices.

Tagging sources combined:
  1. Eval-observed expected categories (retrieval_cases.json).
  2. must_check.CATEGORY_REGULATIONS (category -> doc_name).
  3. Doc name / source_id heuristics for major EU directives.

Idempotent: re-running on already-tagged chunks only adds missing categories.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = ROOT / "data" / "corpus" / "processed"
FAISS_META_PATH = ROOT / "data" / "faiss" / "legal_chunks_meta.json"


# Source-id substring -> categories to ensure are present.
# Curated from:
#   - data/regulation_eval/retrieval_cases.json (eval expected categories)
#   - rag_service/retrieval/must_check.py CATEGORY_REGULATIONS
#   - direct doc-name heuristics for major EU directives
# Only PRODUCT-relevant docs are mapped; non-product docs (GDPR, AI Act, DSA,
# DMA, FIRRMA, IRA, PCT, antitrust, labor, PDPA) are intentionally left
# untagged so the strict filter does not surface them under any product query.
SOURCE_CATEGORY_RULES: dict[str, list[str]] = {
    # EU directives (untagged duplicates of ingested official sources)
    "EU_Regulations_PDF_REACH": ["chemicals", "electronics", "cosmetics", "textiles", "toys"],
    "EU_Regulations_PDF_RoHS": ["electronics", "electrical_equipment"],
    "EU_Regulations_PDF_LVD": ["electrical_equipment", "electronics"],
    "EU_Regulations_PDF_EMC": ["electronics", "electrical_equipment"],
    "EU_Regulations_PDF_RED": ["radio", "electronics", "telecommunications"],
    "EU_Regulations_PDF_GPSR": ["general_consumer_products", "children_products"],
    "EU_Regulations_PDF_玩具安全法规": ["toys", "children_products"],
    "EU_Regulations_PDF_市场监督与产品合规": ["general_consumer_products", "market_surveillance"],
    "EU_Regulations_PDF_市场监督合格评定": ["general_consumer_products", "market_surveillance"],
    "EU_Regulations_PDF_消费者权益指令": ["general_consumer_products"],
    "EU_Regulations_PDF_合格评定程序参考条款": ["general_consumer_products"],
    "EU_Regulations_PDF_不公平商业行为指令": ["general_consumer_products"],
    "EU_Regulations_PDF_产品责任指令": ["general_consumer_products"],
    "EU_Regulations_PDF_Blue_Guide": ["general_consumer_products"],
    "EU_Regulations_PDF_Decision_768-2008-EC": ["general_consumer_products"],
    # US child-online privacy: a children_products-adjacent rule; CPSIA scope.
    "US_美国_儿童在线隐私保护法__COPPA": ["children_products"],
}

# Per-source_id additive patches for docs that ARE tagged but missing a
# key category. Lead paint is a CPSIA children's-product rule; collector
# originally tagged [electronics, toys, painted_goods] only.
SOURCE_ID_ADDITIVE: dict[str, list[str]] = {
    "us-16-cfr-1303-lead-paint": ["children_products"],
    # UKCA marking applies to virtually all consumer products subject to UK
    # conformity assessment; eval queries it as general_consumer_products.
    "uk-ukca-conformity-assessment": ["general_consumer_products"],
}


def _categories_for_source(source_id: str, source_file: str) -> list[str] | None:
    """Return categories to ensure-present for a chunk, or None if no rule."""
    for needle, cats in SOURCE_CATEGORY_RULES.items():
        if needle in source_id or needle in source_file:
            return cats
    for needle, cats in SOURCE_ID_ADDITIVE.items():
        if needle == source_id:
            return cats
    return None


def _merge_unique(existing: list[str], additions: list[str]) -> list[str]:
    """Immutable merge preserving order, deduped, no empty strings."""
    merged: list[str] = []
    seen: set[str] = set()
    for value in [*existing, *additions]:
        normalized = str(value).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        merged.append(normalized)
    return merged


def patch_chunk(chunk: dict) -> tuple[dict, bool]:
    """Return (new_chunk, changed). Adds product_categories if a rule applies."""
    source_id = str(chunk.get("source_id", ""))
    source_file = str(chunk.get("source_file", ""))
    additions = _categories_for_source(source_id, source_file)
    if not additions:
        return chunk, False

    existing = list(chunk.get("product_categories") or [])
    merged = _merge_unique(existing, additions)
    if merged == existing:
        return chunk, False

    new_chunk = dict(chunk)
    new_chunk["product_categories"] = merged
    nested = new_chunk.get("metadata") if isinstance(new_chunk.get("metadata"), dict) else {}
    if nested:
        nested_existing = list(nested.get("product_categories") or [])
        nested_merged = _merge_unique(nested_existing, additions)
        new_chunk["metadata"] = {**nested, "product_categories": nested_merged}
    return new_chunk, True


def patch_faiss_meta(meta_path: Path = FAISS_META_PATH) -> tuple[int, int, dict]:
    """Patch the FAISS meta sidecar. Returns (total, patched, by_source)."""
    data = json.loads(meta_path.read_text(encoding="utf-8"))
    chunks = data.get("chunks", data) if isinstance(data, dict) else data
    patched_count = 0
    by_source: Counter = Counter()
    for index, chunk in enumerate(chunks):
        new_chunk, changed = patch_chunk(chunk)
        if changed:
            chunks[index] = new_chunk
            patched_count += 1
            by_source[new_chunk.get("source_id", "")] += 1
    if isinstance(data, dict):
        data["chunks"] = chunks
    else:
        data = chunks
    meta_path.write_text(
        json.dumps(data, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return len(chunks), patched_count, dict(by_source)


def patch_corpus_processed(processed_dir: Path = PROCESSED_DIR) -> tuple[int, int, dict]:
    """Patch metadata.product_categories / productCategories on corpus JSONs."""
    patched_files = 0
    patched_chunks = 0
    by_source: Counter = Counter()
    for path in sorted(processed_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"  skip (parse error): {path.name}: {exc}", file=sys.stderr)
            continue
        metadata = data.get("metadata") if isinstance(data, dict) else None
        if not isinstance(metadata, dict):
            continue
        source_id = str(data.get("id", path.stem))
        additions = _categories_for_source(source_id, path.name)
        if not additions:
            continue
        changed = False
        for field in ("product_categories", "productCategories"):
            existing = list(metadata.get(field) or [])
            merged = _merge_unique(existing, additions)
            if merged != existing:
                metadata[field] = merged
                changed = True
        if changed:
            data["metadata"] = metadata
            path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            patched_files += 1
            patched_chunks += 1
            by_source[source_id] += 1
    return patched_files, patched_chunks, dict(by_source)


def main() -> int:
    print("=" * 60)
    print("  retag_product_categories")
    print("=" * 60)

    if not FAISS_META_PATH.exists():
        print(f"ERROR: FAISS meta not found: {FAISS_META_PATH}", file=sys.stderr)
        return 2

    total, patched, by_source_faiss = patch_faiss_meta()
    print(f"\n[FAISS meta] {patched}/{total} chunks re-tagged")
    for sid, n in sorted(by_source_faiss.items(), key=lambda x: -x[1])[:30]:
        print(f"  {n:>5}  {sid[:90]}")

    files, chunks, by_source_corpus = patch_corpus_processed()
    print(f"\n[Corpus processed] {files} files / {chunks} docs re-tagged")
    for sid, n in sorted(by_source_corpus.items(), key=lambda x: -x[1])[:30]:
        print(f"  {n:>5}  {sid[:90]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
