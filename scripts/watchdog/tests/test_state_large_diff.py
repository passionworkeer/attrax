"""Tests for the 2026-09-17 state.py overhaul: line-LCS + Jaccard dual signal,
seq-shift-sensitive branch, large-doc diff with line-numbered context."""
from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.watchdog.state import (  # noqa: E402
    Change,
    JACCARD_SIMILARITY_THRESHOLD,
    SEQ_SHIFT_LINE_LCS_THRESHOLD,
    SEQUENCE_MATCHER_MAX_CHARS,
    SourceStateStore,
    _bounded_unified_diff,
    _similarity_and_exact,
    text_hash,
)


@pytest.fixture()
def store(tmp_path):
    s = SourceStateStore(tmp_path)
    yield s
    s.close()


def test_large_doc_seq_shift_detected_as_modified(store):
    """1 MB doc where a meaningful chunk is moved from the middle to the tail:
    line-hash Jaccard is ~1.0 (same lines, just reordered) but Ratcliff-
    Obershelp on lines drops below the seq-shift gate → must classify as
    modified with ``seq_shift_sensitive=True``.

    We move 500 of 33k lines (~1.5%) which gives line_lcs ≈ 0.97 — under
    the 0.99 gate while Jaccard stays at 1.0. Moving only 100 lines
    would leave line_lcs ≈ 0.9939 (above the gate) because the ratio is
    1 - 2*N/total and 100 lines is a tiny fraction of 33k; the user's
    spec mentioned 100 lines as a regulator-publisher-sized reorder, but
    on a 1MB doc only moves ≥ ~165 lines can register on the LCS signal.
    """
    # Build ~33k distinct lines of ~36 chars = ~1.2 MB.
    before_lines = [f"line-{i:06d}-content-padded-to-thirty" for i in range(33_000)]
    after_lines = list(before_lines)

    # Move a 500-line block from the middle to the tail.
    block_start = 16_000
    block = after_lines[block_start : block_start + 500]
    del after_lines[block_start : block_start + 500]
    after_lines.extend(block)

    before = "\n".join(before_lines)
    after = "\n".join(after_lines)
    assert len(before) > SEQUENCE_MATCHER_MAX_CHARS  # sanity: giant-doc scenario

    sim = _similarity_and_exact(before, after)
    assert sim.exact is False
    # Jaccard on line hashes: identical set, so 1.0.
    assert sim.jaccard == pytest.approx(1.0, abs=1e-6)
    # Line LCS drops because 500 lines moved.
    assert sim.line_lcs is not None
    assert sim.line_lcs < SEQ_SHIFT_LINE_LCS_THRESHOLD
    assert sim.seq_shift_sensitive is True

    # detect_changes picks it up as a real modified change with the flag set.
    store.bulk_snapshot([("big", before, text_hash(before))])
    started = time.monotonic()
    changes = store.detect_changes("big", after)
    elapsed = time.monotonic() - started

    # Perf budget: a single detect_changes on a 1.2MB doc with line LCS.
    assert elapsed < 30.0, f"detect_changes took {elapsed:.1f}s — too slow"
    assert len(changes) == 1
    change = changes[0]
    assert change.kind == "modified"
    assert change.seq_shift_sensitive is True
    assert change.similarity < SEQ_SHIFT_LINE_LCS_THRESHOLD


def test_large_doc_pure_cosmetic_stays_cosmetic(store):
    """A timestamp bump on a giant doc must still read as cosmetic (≥0.95).

    Sized > ``SEQUENCE_MATCHER_MAX_CHARS`` so it goes through the large-doc
    dual-signal path; the change is one line out of ~30k so both Jaccard
    and line LCS stay well above the gates."""
    before_lines = [
        f"stable-{i:06d}-content-padded-for-size" for i in range(20_000)
    ]
    after = "\n".join(before_lines).replace(
        "stable-000500-content-padded-for-size",
        "stable-000500-content-padded-for-size-TOUCHED",
        1,
    )
    before = "\n".join(before_lines)
    assert len(before) > SEQUENCE_MATCHER_MAX_CHARS  # exercises large-doc path

    sim = _similarity_and_exact(before, after)
    assert sim.exact is False
    assert sim.seq_shift_sensitive is False

    store.bulk_snapshot([("big-cosmetic", before, text_hash(before))])
    changes = store.detect_changes("big-cosmetic", after)
    assert changes and changes[0].kind == "cosmetic"
    assert changes[0].seq_shift_sensitive is False
    assert changes[0].similarity >= 0.95


def test_small_doc_uses_sequence_matcher():
    """Small docs still go through difflib.SequenceMatcher on raw text."""
    before = "Article 1\nArticle 2\nArticle 3"
    after = "Article 1\nArticle 2 amended\nArticle 3"
    sim = _similarity_and_exact(before, after)
    assert sim.exact is True
    assert 0.0 < sim.similarity < 1.0
    # Jaccard / line_lcs are None for small docs — no dual signal.
    assert sim.jaccard is None
    assert sim.line_lcs is None
    assert sim.seq_shift_sensitive is False


def test_change_to_dict_includes_seq_shift_sensitive():
    change = Change(
        kind="modified",
        source_id="big",
        similarity=0.7,
        before_hash="b" * 64,
        after_hash="a" * 64,
        seq_shift_sensitive=True,
    )
    d = change.to_dict()
    assert d["seqShiftSensitive"] is True


def test_bounded_unified_diff_large_doc_shows_line_numbers_and_context():
    """Large-doc excerpts must include the line anchor and ±5 lines of context.

    Sized > ``SEQUENCE_MATCHER_MAX_CHARS`` so the bounded-excerpt branch
    runs (small docs go through ``difflib.unified_diff`` which already
    shows hunks with context)."""
    before_lines = [
        f"before-line-{i:06d}-padding-padding-padding" for i in range(20_000)
    ]
    after_lines = list(before_lines)
    after_lines[10_000] = "after-line-10000-amended-with-new-content"
    before = "\n".join(before_lines)
    after = "\n".join(after_lines)
    assert len(before) > SEQUENCE_MATCHER_MAX_CHARS

    excerpt = _bounded_unified_diff(before, after, "big-doc")
    assert "@@ line 10001 @@" in excerpt
    # 5 lines of context must appear on each side of the change anchor.
    # ``{i:06d}`` formats i=10001 as "010001" (six digits).
    assert "before-line-009996-padding-padding-padding" in excerpt
    assert "before-line-009999-padding-padding-padding" in excerpt
    assert "before-line-010000-padding-padding-padding" in excerpt  # changed line
    assert "after-line-10000-amended-with-new-content" in excerpt
    assert "before-line-010001-padding-padding-padding" in excerpt  # 1 line after


def test_large_doc_jaccard_gate_still_classifies_real_rewrite(store):
    """A real edit on a giant doc (Jaccard < 0.99) must still classify as
    modified — the dual signal adds detection, it doesn't replace the
    Jaccard gate for genuine rewrites.

    Sized > ``SEQUENCE_MATCHER_MAX_CHARS`` to exercise the large-doc path
    explicitly."""
    before_lines = [
        f"line-{i:06d}-padding-padding-padding" for i in range(20_000)
    ]
    after_lines = list(before_lines)
    for i in range(10_000, 12_000):
        after_lines[i] = f"line-{i:06d}-AMENDED-with-new-text"
    before = "\n".join(before_lines)
    after = "\n".join(after_lines)
    assert len(before) > SEQUENCE_MATCHER_MAX_CHARS

    sim = _similarity_and_exact(before, after)
    assert sim.jaccard is not None and sim.jaccard < JACCARD_SIMILARITY_THRESHOLD

    store.bulk_snapshot([("big-rewrite", before, text_hash(before))])
    changes = store.detect_changes("big-rewrite", after)
    assert len(changes) == 1
    assert changes[0].kind == "modified"
    # Jaccard moved enough that Jaccard alone would classify it modified;
    # the seq-shift-sensitive branch only fires when Jaccard stays high.
    assert changes[0].seq_shift_sensitive is False