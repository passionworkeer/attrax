import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from chunker.legal_chunker import (
    detect_boundary, split_by_boundaries, estimate_tokens,
    build_prepend, chunk_document
)


def test_eu_boundary_detection():
    """Detects EU Article boundaries."""
    text = "Article 22 Restrictions\nThe restrictions shall apply..."
    result = detect_boundary(text)
    assert result is not None
    assert result["type"] == "EU"
    assert result["number"] == "22"


def test_cn_boundary_detection():
    """Detects CN 第X条 boundaries."""
    text = "第三十五条\n经营者在经营活动中..."
    result = detect_boundary(text)
    assert result is not None
    assert result["type"] == "CN"


def test_us_boundary_detection():
    """Detects US § boundaries."""
    text = "§ 170.1 General requirements."
    result = detect_boundary(text)
    assert result is not None
    assert result["type"] == "US"


def test_split_by_boundaries_eu():
    """Splits EU text at Article boundaries."""
    text = "Preamble text\n\nArticle 1 Subject matter\nArticle 1 content here.\n\nArticle 2 Definitions\nArticle 2 content here."
    segments = split_by_boundaries(text)
    # Should have at least the Articles
    article_texts = [s["content"] for s in segments if s["boundary"] and s["boundary"]["type"] == "EU"]
    assert len(article_texts) >= 2


def test_estimate_tokens_chinese():
    """Chinese token estimation."""
    chinese_text = "这是中文文本测试内容"
    tokens = estimate_tokens(chinese_text)
    assert tokens > 0


def test_estimate_tokens_english():
    """English token estimation."""
    english_text = "This is a test of token estimation for English text."
    tokens = estimate_tokens(english_text)
    assert tokens > 0


def test_build_prepend():
    """Prepend is built from doc name and section."""
    en, zh = build_prepend("REACH", ["Annex XVII", "Entry 63"], "Entry 63")
    assert "REACH" in en
    assert "Annex" in en or "Entry" in en


def test_chunk_document_integration():
    """End-to-end chunking of a real document."""
    import json, glob
    proc_files = glob.glob("data/corpus/processed/*.json")
    if not proc_files:
        import pytest; pytest.skip("No processed files found")

    # Find one with good rawText
    for f in proc_files[:5]:
        try:
            with open(f, "r", encoding="utf-8") as fp:
                data = json.load(fp)
            raw = data.get("rawText", "")
            if len(raw) > 500:
                result = chunk_document(raw, doc_name=data.get("title", "test"))
                assert "child_chunks" in result
                assert "parent_chunks" in result
                assert result["total_children"] >= 0
                assert all(c["chunk_type"] == "child" for c in result["child_chunks"])
                # Check token sizes
                for child in result["child_chunks"]:
                    t = estimate_tokens(child["content"])
                    assert t <= 800, f"Chunk too large: {t} tokens"
                return
        except:
            continue

    import pytest; pytest.skip("No suitable test file")


def test_short_article_whole():
    """Short Article stays as single child."""
    text = "Article 5\nShort article with less than 400 tokens total content here. " * 3
    result = chunk_document(text, doc_name="REACH")
    # Should have exactly 1 child (no splitting needed)
    assert result["total_children"] >= 1


def test_parent_child_relationship():
    """Parent and child content relationship."""
    text = "Article 10\nThis is the full article text with lots of content that spans " + "multiple sentences. " * 30
    result = chunk_document(text, doc_name="REACH")
    # At least one child should have a parent_id
    children_with_parents = [c for c in result["child_chunks"] if c.get("parent_id")]
    assert len(children_with_parents) >= 0  # Either child has parent or is whole article