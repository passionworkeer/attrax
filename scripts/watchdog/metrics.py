from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo


def append_run_metrics(
    supplements_dir: Path,
    *,
    started_at: dt.datetime,
    output_date: str,
    sources_checked: int,
    sources_fetched: int,
    sources_not_modified: int,
    sources_failed: int,
    sources_skipped: int,
    fetch_errors: list[dict],
    ingest_report: dict | None,
    auto_ingest: bool,
) -> dict:
    if started_at.tzinfo is None:
        raise ValueError("started_at must include a timezone")
    report = ingest_report or {}
    records = []
    for record in report.get("records", []):
        evidence_dir = Path(record["evidenceDir"])
        # 文件名来自本轮已经落盘的证据，不根据来源类型推测扩展名。
        raw_files = sorted(evidence_dir.glob("raw.*"))
        if len(raw_files) != 1:
            raise ValueError(f"expected one raw evidence file in {evidence_dir}")
        records.append({**record, "filename": raw_files[0].name})
    finished_at = dt.datetime.now(dt.timezone.utc)
    row = {
        "schemaVersion": 1,
        "runId": str(uuid4()),
        "startedAt": started_at.astimezone(dt.timezone.utc).isoformat(),
        "finishedAt": finished_at.isoformat(),
        "date": started_at.astimezone(ZoneInfo("Asia/Shanghai")).date().isoformat(),
        "timezone": "Asia/Shanghai",
        "outputDate": output_date,
        "autoIngest": auto_ingest,
        "sourcesChecked": sources_checked,
        "sourcesFetched": sources_fetched,
        "sourcesNotModified": sources_not_modified,
        "sourcesFailed": sources_failed,
        "sourcesSkipped": sources_skipped,
        "created": sorted(set(report.get("created", []))),
        "updated": sorted(set(report.get("updated", []))),
        "marked": sorted(set(report.get("marked", []))),
        "evidenceOnly": sorted(set(report.get("evidenceOnly", []))),
        "records": records,
        "errors": [
            *[{**error, "stage": "fetch"} for error in fetch_errors],
            *[{**error, "stage": "ingest"} for error in report.get("failed", [])],
        ],
    }
    payload = (json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    supplements_dir.mkdir(parents=True, exist_ok=True)
    # O_APPEND 配合一次 write，避免并行线程或进程相互覆盖记录。
    descriptor = os.open(supplements_dir / "watchdog-runs.jsonl", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        written = os.write(descriptor, payload)
        if written != len(payload):
            raise OSError(f"incomplete watchdog metrics write: {written}/{len(payload)} bytes")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return row
