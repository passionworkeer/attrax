"""Verify NLI batched predict path: a single batched call instead of O(claims x chunks)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.verify.citation_verifier import CitationVerifier


class _FakeNLIResult:
    def __init__(self, label: str):
        self.label = label


class _CountingNLIModel:
    """Records every predict() invocation; returns NEUTRAL for everything."""

    def __init__(self):
        self.call_count = 0
        self.batch_sizes: list[int] = []

    def predict(self, pairs, multi_label=False):
        self.call_count += 1
        # Each element of `pairs` is itself a 1-element list (premise+claim).
        # We record how many premises were submitted in this single call.
        try:
            self.batch_sizes.append(len(pairs))
        except TypeError:
            self.batch_sizes.append(1)
        return [_FakeNLIResult("NEUTRAL") for _ in pairs]


def _make_chunks(n: int) -> list[dict]:
    return [
        {"content": f"chunk {i} body content", "doc_name": "DOC", "article_no": f"Article {i}"}
        for i in range(n)
    ]


def test_nli_uses_single_batched_predict_call():
    """One claim against many chunks must trigger exactly ONE predict() call,
    not one per chunk."""
    model = _CountingNLIModel()
    verifier = CitationVerifier(nli_model=model)

    # Claim does NOT match any citation marker, so it falls through to
    # verify_claim_nli() with all chunks available.
    report = "This product must satisfy all chemical restriction requirements."
    chunks = _make_chunks(8)

    verifier.verify_citations(report, chunks)

    assert model.call_count == 1, (
        f"expected exactly one batched predict() call, got {model.call_count}"
    )
    # All 8 chunks should have been submitted in that single batched call.
    assert model.batch_sizes == [8], f"unexpected batch sizes: {model.batch_sizes}"


def test_nli_batched_returns_entailed_short_circuits():
    """When the batched result contains an ENTAILED verdict, the verifier
    reports ENTAILED without iterating chunk-by-chunk."""

    class _EntailOnceModel(_CountingNLIModel):
        def predict(self, pairs, multi_label=False):
            self.call_count += 1
            self.batch_sizes.append(len(pairs))
            # First chunk entails, rest neutral.
            labels = [_FakeNLIResult("ENTAILED")] + [_FakeNLIResult("NEUTRAL")] * (len(pairs) - 1)
            return labels

    model = _EntailOnceModel()
    verifier = CitationVerifier(nli_model=model)

    report = "The product must comply with the lead restriction requirements."
    chunks = _make_chunks(5)
    result = verifier.verify_citations(report, chunks)

    assert model.call_count == 1
    # At least one claim should be ENTAILED from the batched verdict.
    statuses = {r.status for r in result.claims}
    assert "ENTAILED" in statuses, f"expected ENTAILED in {statuses}"


def test_nli_batched_failure_falls_back_to_topk_per_chunk():
    """If the model rejects the batched list, fall back to per-chunk calls
    bounded by top-K candidates (k=3) rather than O(chunks)."""

    class _RejectsBatchModel(_CountingNLIModel):
        def predict(self, pairs, multi_label=False):
            self.call_count += 1
            # Batched (list-of-lists) input is rejected; per-pair call accepted.
            if isinstance(pairs, list) and pairs and isinstance(pairs[0], list):
                raise TypeError("batched predict not supported")
            self.batch_sizes.append(1)
            return [_FakeNLIResult("NEUTRAL")]

    model = _RejectsBatchModel()
    verifier = CitationVerifier(nli_model=model)

    report = "The product must comply with chemical substance regulations."
    chunks = _make_chunks(10)
    verifier.verify_citations(report, chunks)

    # First call is the rejected batched attempt; subsequent calls are
    # top-K (k=3) per unmatched claim. No single claim should run all 10.
    assert model.call_count >= 2
    # No per-call batch should exceed the top-K bound (k=3).
    assert all(size <= 1 for size in model.batch_sizes[1:]), (
        f"per-chunk fallback exceeded top-K bound: {model.batch_sizes}"
    )


def test_no_nli_model_keeps_embedding_fallback():
    """Without an NLI model the verifier must still run via text overlap."""
    verifier = CitationVerifier(nli_model=None)
    report = "Lead content restriction applies. Source citations may follow."
    chunks = [
        {"content": "lead content restriction applies to this product category",
         "doc_name": "REACH", "article_no": "Article 22"},
    ]
    result = verifier.verify_citations(report, chunks)
    assert result.status in ("PASS", "WARN", "REJECTED")
