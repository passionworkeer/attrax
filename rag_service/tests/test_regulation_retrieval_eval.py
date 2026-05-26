import json
from pathlib import Path

import pytest

from rag_service.eval import regulation_retrieval_eval as eval_runner


class FakeRetriever:
    def __init__(self, results_by_query):
        self.results_by_query = results_by_query
        self.calls = []

    def retrieve(self, query, **kwargs):
        self.calls.append({"query": query, **kwargs})
        return self.results_by_query.get(query, [])


def test_validate_cases_requires_expected_source_ids():
    cases = [
        {
            "id": "bad-case",
            "query": "EU toy safety",
            "market": "EU",
            "category": "toys",
            "risk": "product_safety",
            "expected_source_ids": [],
        }
    ]

    with pytest.raises(ValueError, match="expected_source_ids"):
        eval_runner.validate_cases(cases)


def test_evaluate_cases_scores_hit_rank_and_passes_metadata_filters():
    cases = [
        {
            "id": "eu-toy",
            "query": "EU toy chemical safety",
            "market": "EU",
            "category": "toys",
            "risk": "chemical",
            "regulatory_types": ["chemical", "product_safety"],
            "expected_source_ids": ["eu-2009-48-toy-safety"],
        },
        {
            "id": "us-radio",
            "query": "US bluetooth radio authorization",
            "market": "US",
            "category": "electronics",
            "risk": "radio",
            "regulatory_types": ["radio"],
            "expected_source_ids": ["us-47-cfr-15-radio-frequency-devices"],
        },
    ]
    retriever = FakeRetriever(
        {
            "EU toy chemical safety": [
                {"source_id": "eu-2023-988-general-product-safety", "doc_name": "GPSR"},
                {"source_id": "eu-2009-48-toy-safety", "doc_name": "Toy Safety Directive"},
            ],
            "US bluetooth radio authorization": [
                {"source_id": "us-47-cfr-15-radio-frequency-devices", "doc_name": "FCC Part 15"},
            ],
        }
    )

    results = eval_runner.evaluate_cases(cases, retriever, top_k=5)

    assert [result["hit"] for result in results] == [True, True]
    assert results[0]["rank"] == 2
    assert results[0]["reciprocal_rank"] == 0.5
    assert retriever.calls[0]["region"] == "EU"
    assert retriever.calls[0]["product_category"] == "toys"
    assert retriever.calls[0]["regulatory_types"] == ["chemical", "product_safety"]
    assert retriever.calls[0]["official_only"] is True


def test_summarize_results_groups_by_market_and_category():
    results = [
        {"id": "case-1", "market": "EU", "category": "toys", "hit": True, "reciprocal_rank": 1.0},
        {"id": "case-2", "market": "EU", "category": "electronics", "hit": False, "reciprocal_rank": 0.0},
        {"id": "case-3", "market": "US", "category": "electronics", "hit": True, "reciprocal_rank": 0.5},
    ]

    summary = eval_runner.summarize_results(results)

    assert summary["total_cases"] == 3
    assert summary["hits"] == 2
    assert summary["hit_rate"] == pytest.approx(2 / 3)
    assert summary["mrr"] == pytest.approx(0.5)
    assert summary["by_market"]["EU"]["hit_rate"] == pytest.approx(0.5)
    assert summary["by_category"]["electronics"]["hit_rate"] == pytest.approx(0.5)
    assert summary["misses"] == ["case-2"]


def test_write_report_outputs_json_and_markdown(tmp_path):
    results = [
        {
            "id": "eu-toy",
            "query": "EU toy safety",
            "market": "EU",
            "category": "toys",
            "risk": "product_safety",
            "expected_source_ids": ["eu-2009-48-toy-safety"],
            "returned_source_ids": ["eu-2009-48-toy-safety"],
            "hit": True,
            "rank": 1,
            "reciprocal_rank": 1.0,
        }
    ]
    summary = eval_runner.summarize_results(results)
    json_path = tmp_path / "eval.json"
    md_path = tmp_path / "eval.md"

    eval_runner.write_report(summary, results, json_path, md_path)

    payload = json.loads(json_path.read_text(encoding="utf-8"))
    assert payload["summary"]["hit_rate"] == 1.0
    markdown = md_path.read_text(encoding="utf-8")
    assert "Regulation Retrieval Evaluation" in markdown
    assert "eu-toy" in markdown


def test_curated_retrieval_cases_cover_markets_categories_and_risks():
    cases_path = Path("data/regulation_eval/retrieval_cases.json")
    cases = eval_runner.load_cases(cases_path)

    eval_runner.validate_cases(cases)
    markets = {case["market"] for case in cases}
    categories = {case["category"] for case in cases}
    risks = {case["risk"] for case in cases}

    assert {"EU", "US", "CN", "CA", "UK", "NZ"}.issubset(markets)
    assert {"electronics", "toys", "children_products", "packaging"}.issubset(categories)
    assert {"chemical", "product_safety", "conformity", "waste"}.issubset(risks)
