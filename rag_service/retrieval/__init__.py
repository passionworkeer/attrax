"""Knowledge-base lookup module (De-RAG §7.1/§7.7).

The FAISS/BM25/embedding retrieval stack was deleted with the pipeline
collapse; what remains is the deterministic KB lookup layer:
kb_loader (applicability anchors) + article_loader (regulation bodies)
+ must_check (feature detection + anchor-list building).
"""
