#!/usr/bin/env python3
"""
test_regulation_endpoint.py — Tests for §7.5 regulation viewer endpoint.

Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §7.5 step 1.

Covers:
  - Public regulation returns `articles[]` with non-empty text
  - Private regulation returns empty `articles` + `purchase_url`
  - Unknown regulation_id returns 404
  - Internal fields (`_path`) are stripped before sending

Run: rag_service/.venv/bin/python3 -m pytest rag_service/tests/test_regulation_endpoint.py -v
"""
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag_service.main import app  # noqa: E402


class TestRegulationViewerEndpoint:
    def setup_method(self):
        self.client = TestClient(app)

    def test_public_regulation_returns_articles(self):
        r = self.client.get("/api/v1/regulations/EU-2023-1542")
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == "EU-2023-1542"
        assert data["license"] == "public"
        assert data["region"] == "EU"
        assert data["source_url"]
        articles = data.get("articles", [])
        assert articles, "public regulation must have articles"
        for art in articles:
            assert art["id"]
            assert art["title"]
            # Spec §7.5 step 1: public articles MUST have non-empty text
            # so the viewer can render the article body.
            assert art.get("text"), f"article {art['id']} missing text"

    def test_private_regulation_returns_metadata_only(self):
        r = self.client.get("/api/v1/regulations/CN-GB-31241")
        assert r.status_code == 200
        data = r.json()
        assert data["license"] == "private_with_summary"
        # Spec §6.4: no article body for private standards
        assert data["articles"] == []
        assert data["purchase_url"]
        assert "source_url" not in data or data.get("source_url") is None

    def test_unknown_regulation_returns_404(self):
        r = self.client.get("/api/v1/regulations/NOPE-9999")
        assert r.status_code == 404
        body = r.json()
        assert body.get("ok") is False
        assert body["error"]["code"] == "REGULATION_NOT_FOUND"

    def test_internal_fields_stripped(self):
        r = self.client.get("/api/v1/regulations/EU-2023-1542")
        data = r.json()
        # `_path` is the on-disk YAML location; never expose to client.
        assert "_path" not in data

    def test_response_carries_required_metadata(self):
        # The viewer page renders these fields.
        r = self.client.get("/api/v1/regulations/EU-2023-1542")
        data = r.json()
        for key in (
            "id",
            "official_citation",
            "region",
            "license",
            "last_verified",
            "language",
            "schema_version",
        ):
            assert key in data, f"missing {key}"

    def test_public_regulation_eu_red_lists_annexes(self):
        # Spec §3.1 annex naming: article IDs include annex-*
        r = self.client.get("/api/v1/regulations/EU-2014-53")
        data = r.json()
        article_ids = {a["id"] for a in data["articles"]}
        assert any(a.startswith("annex-") for a in article_ids)

    def test_cn_regulation_chinese_article_ids_preserved(self):
        # Chinese article IDs (`第N条`) must round-trip unmodified.
        r = self.client.get("/api/v1/regulations/CN-CSAR")
        data = r.json()
        article_ids = {a["id"] for a in data["articles"]}
        chinese_ids = {a for a in article_ids if "第" in a}
        assert chinese_ids, f"expected Chinese article IDs, got {article_ids}"