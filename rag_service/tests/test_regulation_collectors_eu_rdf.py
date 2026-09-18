"""Unit tests for the shared EU RDF / Cellar / EUR-Lex resolver."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from rag_service.regulation_collectors.base import BaseCollector
from rag_service.regulation_collectors.eu_rdf import (
    EU_CELLAR_VARIANTS_FULL,
    EU_CELLAR_VARIANTS_SHORT,
    MAX_CELLAR_VARIANT_PROBES,
    ensure_eu_text,
)


@pytest.fixture
def collector(tmp_path):
    return BaseCollector(tmp_path, "TestAgent/1.0")


def _write_rdf_with_cellar(rdf_path: Path, celex: str, cellar_uuid: str) -> None:
    rdf_path.parent.mkdir(parents=True, exist_ok=True)
    rdf_path.write_text(
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        f'<rdf:Description rdf:about="http://publications.europa.eu/resource/cellar/{cellar_uuid}">'
        f'<owl:sameAs rdf:resource="http://publications.europa.eu/resource/celex/{celex}"/>'
        '</rdf:Description>'
        '</rdf:RDF>',
        encoding="utf-8",
    )


def test_ensure_eu_text_missing_rdf_downloads_then_records_failure(tmp_path, collector):
    collector.download = MagicMock(return_value={"status": "failed"})
    entry = {"id": "eu-x", "files": [], "source_url": "https://example.test/x"}
    ensure_eu_text(collector, entry, "32023R0001", "eu/x.rdf", "eu/x.xhtml", min_bytes_for_rdf=500)
    assert any("missing EU RDF" in f["error"] for f in collector.failures)


def test_ensure_eu_text_resolves_cellar_uuid(tmp_path, collector):
    rdf = tmp_path / "eu" / "x.rdf"
    _write_rdf_with_cellar(rdf, "32023R0001", "abc-uuid")
    entry = {"id": "eu-x", "files": [], "source_url": "https://example.test/x"}

    def fake_download(url, rel_path, **_):
        if "eur-lex" in url:
            return {"status": "failed"}
        if rel_path == "eu/x.xhtml":
            (tmp_path / rel_path).parent.mkdir(parents=True, exist_ok=True)
            (tmp_path / rel_path).write_bytes(b"x" * 1500)
            return {"status": "downloaded"}
        return {"status": "downloaded", "bytes": 1024}

    collector.download = MagicMock(side_effect=fake_download)
    ensure_eu_text(collector, entry, "32023R0001", "eu/x.rdf", "eu/x.xhtml", min_bytes_for_rdf=128)
    assert entry["content_url"].endswith("/DOC_1")
    assert "eu/x.xhtml" in entry["files"]


def test_ensure_eu_text_no_cellar_uuid_records_failure(tmp_path, collector):
    rdf = tmp_path / "eu" / "x.rdf"
    rdf.parent.mkdir(parents=True, exist_ok=True)
    rdf.write_text("<rdf:RDF>" + "x" * 500 + "</rdf:RDF>", encoding="utf-8")
    entry = {"id": "eu-x", "files": [], "source_url": "https://example.test/x"}
    ensure_eu_text(collector, entry, "32023R0001", "eu/x.rdf", "eu/x.xhtml", min_bytes_for_rdf=128)
    assert any("could not resolve Cellar UUID" in f["error"] for f in collector.failures)


def test_ensure_eu_text_uses_short_variants_when_passed(tmp_path, collector):
    rdf = tmp_path / "eu" / "x.rdf"
    _write_rdf_with_cellar(rdf, "32023R0001", "abc-uuid")
    entry = {"id": "eu-x", "files": [], "source_url": "https://example.test/x"}
    seen_variants: list[str] = []

    def fake_download(url, rel_path, **_):
        for variant in EU_CELLAR_VARIANTS_FULL:
            if f".{variant}/DOC_1" in url:
                seen_variants.append(variant)
        return {"status": "failed"}

    collector.download = MagicMock(side_effect=fake_download)
    ensure_eu_text(
        collector,
        entry,
        "32023R0001",
        "eu/x.rdf",
        "eu/x.xhtml",
        min_bytes_for_rdf=128,
        variants=EU_CELLAR_VARIANTS_SHORT,
        use_eurlex_fallback=False,
    )
    assert seen_variants == list(EU_CELLAR_VARIANTS_SHORT)
    assert "0004.03" not in seen_variants
    assert any("could not download XHTML" in f["error"] for f in collector.failures)


def test_ensure_eu_text_eurlex_fallback_success(tmp_path, collector):
    rdf = tmp_path / "eu" / "x.rdf"
    _write_rdf_with_cellar(rdf, "32023R0001", "abc-uuid")
    entry = {"id": "eu-x", "files": [], "source_url": "https://example.test/x"}

    def fake_download(url, rel_path, **_):
        if "eur-lex" in url:
            (tmp_path / rel_path).parent.mkdir(parents=True, exist_ok=True)
            (tmp_path / rel_path).write_bytes(b"x" * 1500)
            return {"status": "downloaded"}
        return {"status": "failed"}

    collector.download = MagicMock(side_effect=fake_download)
    ensure_eu_text(collector, entry, "32023R0001", "eu/x.rdf", "eu/x.xhtml", min_bytes_for_rdf=128)
    assert entry["content_url"].startswith("https://eur-lex.europa.eu/")
    assert entry["content_note"].startswith("EUR-Lex")


def test_ensure_eu_text_no_eurlex_fallback_records_final_failure(tmp_path, collector):
    rdf = tmp_path / "eu" / "x.rdf"
    _write_rdf_with_cellar(rdf, "32023R0001", "abc-uuid")
    entry = {"id": "eu-x", "files": [], "source_url": "https://example.test/x"}
    collector.download = MagicMock(return_value={"status": "failed"})
    ensure_eu_text(
        collector, entry, "32023R0001", "eu/x.rdf", "eu/x.xhtml",
        min_bytes_for_rdf=128, use_eurlex_fallback=False,
    )
    assert any("could not download XHTML" in f["error"] for f in collector.failures)


def test_ensure_eu_text_caps_variant_probes(tmp_path, collector):
    """M18: the registry passes up to 80 variant slots; the resolver must
    probe at most MAX_CELLAR_VARIANT_PROBES of them so one unreachable EU
    source cannot pin its worker across an 80-request sweep."""
    rdf = tmp_path / "eu" / "x.rdf"
    _write_rdf_with_cellar(rdf, "32023R0001", "abc-uuid")
    entry = {"id": "eu-x", "files": [], "source_url": "https://example.test/x"}

    # The same 80-slot shape the registry generator produces.
    many_variants = tuple(f"{slot:04d}.{suffix}" for slot in range(1, 21) for suffix in ("04", "03", "02", "01"))
    assert len(many_variants) == 80

    probed: list[str] = []

    def fake_download(url, rel_path, **_):
        for variant in many_variants:
            if f".{variant}/DOC_1" in url:
                probed.append(variant)
        return {"status": "failed"}

    collector.download = MagicMock(side_effect=fake_download)
    ensure_eu_text(
        collector,
        entry,
        "32023R0001",
        "eu/x.rdf",
        "eu/x.xhtml",
        min_bytes_for_rdf=128,
        variants=many_variants,
        use_eurlex_fallback=False,
    )

    assert probed == list(many_variants[:MAX_CELLAR_VARIANT_PROBES])
    assert any("could not download XHTML" in f["error"] for f in collector.failures)