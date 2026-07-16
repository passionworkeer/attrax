from pathlib import Path

from rag_service.domain.scans import ScanJob, ScanSession
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
    assert not list((tmp_path / "sessions").glob("*.tmp"))


def test_file_backend_archives_upload_with_generated_name_and_digest(tmp_path):
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
    assert upload.sha256 == "2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c"
    assert backend.list_uploads("scan_01") == [upload]


def test_file_backend_lists_recoverable_jobs_and_claims_atomically(tmp_path):
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
    running = ScanJob.new(
        job_id="job_02",
        session_id="scan_02",
        query="check toy",
        product="toy",
        category="toys",
        markets=["US"],
        upload_ids=[],
    ).claimed()
    backend.save_job(queued)
    backend.save_job(running)

    assert [job.job_id for job in backend.list_recoverable_jobs()] == ["job_01", "job_02"]
    claimed = backend.claim_job("job_01")
    assert claimed.state == "running"
    assert claimed.attempts == 1
    assert backend.claim_job("job_01") == claimed


def test_delete_session_cascades_jobs_uploads_and_audit_is_append_only(tmp_path):
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
    assert len((tmp_path / "audit.jsonl").read_text(encoding="utf-8").splitlines()) == 2
