from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3


FIELDS = ("timestamp", "event", "sessionId", "jobId", "category", "status", "latencyMs")
AUDIT_NAME = re.compile(r"audit\.jsonl(?:\.\d+)?(?:\.gz)?$")


def retain(root: Path, runtime: Path, backup: Path | None) -> dict:
    files = sorted(item for item in runtime.iterdir() if AUDIT_NAME.fullmatch(item.name))
    if not files:
        raise FileNotFoundError(f"没有找到扫描审计日志：{runtime}")
    directory = root / "data" / "admin"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    database = directory / "analytics.sqlite"
    connection = sqlite3.connect(database, timeout=30)
    os.chmod(database, 0o600)
    imported = 0
    scanned = 0
    undated = 0
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE IF NOT EXISTS scan_audit (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, payload TEXT NOT NULL)")
        connection.execute("BEGIN IMMEDIATE")
        try:
            for filename in files:
                opener = gzip.open if filename.suffix == ".gz" else open
                with opener(filename, "rt", encoding="utf-8") as stream:
                    for line_number, line in enumerate(stream, 1):
                        if not line.strip():
                            continue
                        try:
                            event = json.loads(line)
                        except json.JSONDecodeError as error:
                            raise ValueError(f"审计日志 {filename.name} 第 {line_number} 行 JSON 无效") from error
                        if not isinstance(event, dict):
                            raise ValueError(f"审计日志 {filename.name} 第 {line_number} 行必须为对象")
                        name = event.get("event")
                        if not isinstance(name, str) or not name.startswith(("scan_", "revision")):
                            continue
                        scanned += 1
                        # 与 overview.ts 保持字段顺序和紧凑编码，跨执行入口共用摘要。
                        retained = {key: event[key] for key in FIELDS if key in event}
                        latency = retained.get("latencyMs")
                        if isinstance(latency, float) and latency.is_integer():
                            retained["latencyMs"] = int(latency)
                        payload = json.dumps(retained, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
                        timestamp = event.get("timestamp")
                        timestamp = timestamp if isinstance(timestamp, str) else ""
                        if not timestamp:
                            undated += 1
                        cursor = connection.execute(
                            "INSERT OR IGNORE INTO scan_audit(id,timestamp,payload) VALUES (?,?,?)",
                            (hashlib.sha256(payload.encode("utf-8")).hexdigest(), timestamp, payload),
                        )
                        imported += cursor.rowcount
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        if backup is not None:
            backup = backup.resolve()
            if backup == database.resolve():
                raise ValueError("备份路径不能与统计数据库相同")
            backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            destination = sqlite3.connect(backup)
            try:
                connection.backup(destination)
            finally:
                destination.close()
            os.chmod(backup, 0o600)
        total = connection.execute("SELECT COUNT(*) FROM scan_audit").fetchone()[0]
        return {"files": len(files), "scanned": scanned, "imported": imported, "undated": undated, "total": total, "backupCreated": backup is not None}
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="每日归档扫描统计，保留日志轮转前的真实历史")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--runtime", type=Path, help="默认读取项目 data/backend 或 ATTRAX_RUNTIME_DIR")
    parser.add_argument("--backup", type=Path, help="导入完成后使用 SQLite 在线备份 API 生成快照")
    args = parser.parse_args()
    os.umask(0o077)
    root = args.root.resolve()
    runtime = args.runtime or Path(os.environ.get("ATTRAX_RUNTIME_DIR", str(root / "data/backend")))
    print(json.dumps(retain(root, runtime, args.backup), ensure_ascii=False))


if __name__ == "__main__":
    main()
