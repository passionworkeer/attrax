import json
from datetime import timedelta
from pathlib import Path

from rag_service.domain.scans import ScanJob, ScanSession, utc_now
from rag_service.infrastructure.file_backend import FileBackend


def test_file_backend_round_trips_session_and_hides_token_from_public_data(tmp_path):
    backend = FileBackend(tmp_path)
    session = ScanSession.new(
        session_id="scan_01",
        access_token_hash="secret-hash",
        category="electronics",
        markets=["EU"],
    )

    backend.save_session(session)

    restored = backend.get_session("scan_01")
    assert restored == session
    assert "accessTokenHash" not in restored.public_data()
    assert "access_token_hash" not in restored.public_data()
    assert restored.public_data()["expiresAt"]
    assert not list((tmp_path / "sessions").glob("*.tmp"))


def test_file_backend_archives_upload_with_generated_name_digest_and_safe_read(tmp_path):
    backend = FileBackend(tmp_path)
    upload = backend.save_upload(
        session_id="scan_01",
        kind="image",
        original_name="../../front.jpg",
        content_type="image/jpeg",
        content=b"image-bytes",
    )

    saved_path = Path(upload.path)
    assert saved_path.read_bytes() == b"image-bytes"
    assert saved_path.parent == tmp_path / "uploads" / "scan_01"
    assert "front.jpg" not in saved_path.name
    assert upload.original_name == "front.jpg"
    assert upload.sha256 == "2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c"
    assert backend.list_uploads("scan_01") == [upload]
    restored, content = backend.read_upload("scan_01", upload.upload_id)
    assert restored == upload
    assert content == b"image-bytes"


def test_file_backend_rejects_tampered_upload_path_and_digest(tmp_path):
    backend = FileBackend(tmp_path)
    upload = backend.save_upload("scan_01", "image", "front.jpg", "image/jpeg", b"safe")
    metadata_path = tmp_path / "uploads" / "scan_01" / f"{upload.upload_id}.json"
    metadata = metadata_path.read_text(encoding="utf-8")
    metadata_path.write_text(
        metadata.replace(str(Path(upload.path)), str(tmp_path / "other" / upload.stored_name)),
        encoding="utf-8",
    )

    try:
        backend.read_upload("scan_01", upload.upload_id)
        raise AssertionError("tampered path must be rejected")
    except FileNotFoundError:
        pass


def test_file_backend_claim_is_exclusive_and_expired_lease_is_recoverable(tmp_path):
    backend = FileBackend(tmp_path)
    queued = ScanJob.new(
        job_id="job_01",
        session_id="scan_01",
        query="check product",
        product="charger",
        category="electronics",
        markets=["EU"],
        upload_ids=[],
    )
    backend.save_job(queued)

    claimed = backend.claim_job("job_01", lease_seconds=60)
    assert claimed is not None
    assert claimed.state == "running"
    assert claimed.attempts == 1
    assert backend.claim_job("job_01", lease_seconds=60) is None
    assert backend.list_recoverable_jobs() == []

    expired = claimed.model_copy(
        update={"lease_expires_at": utc_now() - timedelta(seconds=1)}
    )
    backend.save_job(expired)
    assert [job.job_id for job in backend.list_recoverable_jobs()] == ["job_01"]
    reclaimed = backend.claim_job("job_01", lease_seconds=60)
    assert reclaimed is not None
    assert reclaimed.attempts == 2


def test_delete_session_cascades_and_audit_has_timestamp(tmp_path):
    backend = FileBackend(tmp_path)
    backend.save_session(ScanSession.new("scan_01", "hash", "electronics", ["EU"]))
    upload = backend.save_upload("scan_01", "document", "note.txt", "text/plain", b"note")
    backend.save_job(
        ScanJob.new("job_01", "scan_01", "q", "p", "electronics", ["EU"], [upload.upload_id])
    )
    backend.append_audit({"event": "scan_started", "sessionId": "scan_01"})
    backend.append_audit({"event": "scan_deleted", "sessionId": "scan_01"})

    backend.delete_session("scan_01")

    assert backend.get_session("scan_01") is None
    assert backend.get_job("job_01") is None
    assert not Path(upload.path).exists()
    lines = (tmp_path / "audit.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    assert all('"timestamp":' in line for line in lines)


def test_purge_expired_sessions_removes_uploads_and_jobs(tmp_path):
    backend = FileBackend(tmp_path)
    expired = ScanSession.new("scan_old", "hash", "electronics", ["EU"]).model_copy(
        update={"expires_at": utc_now() - timedelta(seconds=1)}
    )
    backend.save_session(expired)
    upload = backend.save_upload("scan_old", "document", "note.txt", "text/plain", b"note")
    backend.save_job(
        ScanJob.new("job_old", "scan_old", "q", "p", "electronics", ["EU"], [upload.upload_id])
    )

    assert backend.purge_expired_sessions() == 1
    assert backend.get_session("scan_old") is None
    assert backend.get_job("job_old") is None
    assert not Path(upload.path).exists()


def test_legacy_session_without_expires_at_backfills_from_updated_at(tmp_path):
    """旧 session JSON 无 expires_at -> 基于 updated_at 回填,部署前的老 session 也能过期被清理(P1-1)。"""
    backend = FileBackend(tmp_path)
    backend.save_session(ScanSession.new("scan_legacy", "hash", "electronics", ["EU"]))

    session_path = list(backend.sessions_dir.glob("*.json"))[0]
    data = json.loads(session_path.read_text(encoding="utf-8"))
    data.pop("expires_at", None)
    data["updated_at"] = (utc_now() - timedelta(days=2)).isoformat()
    session_path.write_text(json.dumps(data), encoding="utf-8")

    restored = backend.get_session("scan_legacy")
    assert restored is not None
    # 回填后 expires_at = updated_at(2天前) + 24h = 1天前 -> 已过期
    assert restored.expires_at <= utc_now()
    assert backend.purge_expired_sessions() == 1
    assert backend.get_session("scan_legacy") is None
