"""append_run_metrics 的逐轮审计记录契约。

这些 JSONL 行是运营看板「法规每日更新」曲线的部署后数据源，写坏一行
（缺 filename、时区错、字段漂移）看板就会整行丢弃或归错日期，所以把
行为钉在这里。
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from scripts.watchdog.metrics import append_run_metrics


def _evidence(supplements: Path, source_id: str, name: str = "raw.html") -> Path:
    directory = supplements / "auto-2026-09-19" / source_id / name
    directory.mkdir(parents=True)
    (directory / name).write_text("<html>doc</html>", encoding="utf-8")
    return directory


def test_appends_one_json_line_per_run(tmp_path: Path) -> None:
    supplements = tmp_path / "supplements"
    evidence_a = _evidence(supplements, "src-a")
    evidence_b = _evidence(supplements, "src-b")
    started = dt.datetime(2026, 9, 18, 17, 30, tzinfo=dt.timezone.utc)
    report = {
        "created": ["CN-CCC", "EU-LVD", "CN-CCC"],
        "updated": ["US-CPSC-General"],
        "records": [
            {"sourceId": "src-a", "contentHash": "h1", "evidenceDir": str(evidence_a)},
            {"sourceId": "src-b", "contentHash": "h2", "evidenceDir": str(evidence_b)},
        ],
    }
    errors = [{"sourceId": "src-c", "message": "403"}]

    row = append_run_metrics(
        supplements,
        started_at=started,
        output_date="2026-09-18",
        sources_checked=3,
        sources_fetched=2,
        sources_not_modified=0,
        sources_failed=1,
        sources_skipped=0,
        fetch_errors=errors,
        ingest_report=report,
        auto_ingest=True,
    )

    lines = (supplements / "watchdog-runs.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0]) == row
    # started 17:30 UTC = 北京时间次日 01:30，日期必须按北京口径归档。
    assert row["date"] == "2026-09-19"
    assert row["outputDate"] == "2026-09-18"
    assert row["created"] == ["CN-CCC", "EU-LVD"]
    assert row["updated"] == ["US-CPSC-General"]
    assert [record["filename"] for record in row["records"]] == ["raw.html", "raw.html"]
    assert row["errors"] == [{"sourceId": "src-c", "message": "403", "stage": "fetch"}]
    assert row["sourcesChecked"] == 3 and row["sourcesFailed"] == 1


def test_second_run_appends_without_touching_first_line(tmp_path: Path) -> None:
    supplements = tmp_path / "supplements"
    evidence = _evidence(supplements, "src-a")
    common = dict(
        output_date="2026-09-19",
        sources_checked=1,
        sources_fetched=1,
        sources_not_modified=0,
        sources_failed=0,
        sources_skipped=0,
        fetch_errors=[],
        ingest_report={
            "created": [],
            "updated": [],
            "records": [{"sourceId": "src-a", "contentHash": "h", "evidenceDir": str(evidence)}],
        },
        auto_ingest=False,
    )
    first = append_run_metrics(supplements, started_at=dt.datetime(2026, 9, 19, 1, 0, tzinfo=ZoneInfo("Asia/Shanghai")), **common)
    second = append_run_metrics(supplements, started_at=dt.datetime(2026, 9, 19, 9, 0, tzinfo=ZoneInfo("Asia/Shanghai")), **common)

    lines = (supplements / "watchdog-runs.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["runId"] == first["runId"]
    assert json.loads(lines[1])["runId"] == second["runId"]
    assert first["runId"] != second["runId"]


def test_naive_started_at_is_rejected(tmp_path: Path) -> None:
    try:
        append_run_metrics(
            tmp_path,
            started_at=dt.datetime(2026, 9, 19, 9, 0),
            output_date="2026-09-19",
            sources_checked=0,
            sources_fetched=0,
            sources_not_modified=0,
            sources_failed=0,
            sources_skipped=0,
            fetch_errors=[],
            ingest_report=None,
            auto_ingest=False,
        )
    except ValueError as error:
        assert "timezone" in str(error)
    else:
        raise AssertionError("naive started_at 必须被拒绝")


def test_evidence_dir_with_wrong_raw_count_is_rejected(tmp_path: Path) -> None:
    supplements = tmp_path / "supplements"
    empty = supplements / "auto-2026-09-19" / "src-empty" / "raw.html"
    empty.mkdir(parents=True)
    doubled = supplements / "auto-2026-09-19" / "src-doubled" / "raw.html"
    doubled.mkdir(parents=True)
    (doubled / "raw.html").write_text("a", encoding="utf-8")
    (doubled / "raw.json").write_text("b", encoding="utf-8")

    for evidence_dir in (empty, doubled):
        try:
            append_run_metrics(
                supplements,
                started_at=dt.datetime(2026, 9, 19, 9, 0, tzinfo=dt.timezone.utc),
                output_date="2026-09-19",
                sources_checked=1,
                sources_fetched=1,
                sources_not_modified=0,
                sources_failed=0,
                sources_skipped=0,
                fetch_errors=[],
                ingest_report={"records": [{"sourceId": "x", "contentHash": "h", "evidenceDir": str(evidence_dir)}]},
                auto_ingest=True,
            )
        except ValueError as error:
            assert "raw evidence file" in str(error)
        else:
            raise AssertionError(f"{evidence_dir} 的 raw.* 数量异常必须被拒绝")
