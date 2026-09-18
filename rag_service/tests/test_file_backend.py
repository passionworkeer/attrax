import json
import os
import threading
import time
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


def test_list_uploads_preserves_creation_order_instead_of_random_uuid_order(tmp_path):
    backend = FileBackend(tmp_path)
    first = backend.save_upload(
        "scan_01", "image", "01-overall.jpg", "image/jpeg", b"first"
    )
    second = backend.save_upload(
        "scan_01", "image", "02-nameplate.jpg", "image/jpeg", b"second"
    )

    # Force metadata filenames into the opposite lexical order. The old
    # implementation sorted these random UUID filenames and returned the
    # second image first, breaking vision-image-N -> asset-N mapping.
    directory = tmp_path / "uploads" / "scan_01"
    first_meta = directory / f"{first.upload_id}.json"
    second_meta = directory / f"{second.upload_id}.json"
    first_target = directory / "upload_zzzz.json"
    second_target = directory / "upload_aaaa.json"
    first_meta.rename(first_target)
    second_meta.rename(second_target)

    assert [item.original_name for item in backend.list_uploads("scan_01")] == [
        "01-overall.jpg",
        "02-nameplate.jpg",
    ]


def test_file_backend_rejects_tampered_upload_path_and_digest(tmp_path):
    backend = FileBackend(tmp_path)
    upload = backend.save_upload("scan_01", "image", "front.jpg", "image/jpeg", b"safe")
    metadata_path = tmp_path / "uploads" / "scan_01" / f"{upload.upload_id}.json"
    # 篡改持久化 metadata 的 path 字段。必须走 JSON 解析,不能用字符串 replace:
    # Windows 上存的反斜杠路径在 JSON 文件里被转义成 "\\",naive 的 str.replace
    # 搜索单反斜杠会失配 → 篡改静默不生效 → 测试在不真正验证守卫的情况下假通过。
    # json 往返可在所有 OS 上真正改写该字段。
    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    payload["path"] = str(tmp_path / "other" / upload.stored_name)
    metadata_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

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


def test_save_job_if_marker_absent_lets_only_one_of_two_racers_write(tmp_path):
    """H12：同 marker 的两个并发提交只能落一个 job。

    先前的实现是「先 find_job_by_marker、再 save_job」两步，两步之间另一个
    请求也能看到「还没有 job」，于是排重扫会排出两份。
    """
    backend = FileBackend(tmp_path)
    barrier = threading.Barrier(2)
    written: list[object] = []

    def submit(job_id: str) -> None:
        job = ScanJob.new(
            job_id=job_id,
            session_id="scan_race",
            query="q",
            product="",
            category="toy",
            markets=["EU"],
            upload_ids=[],
            idempotency_marker="revision:scan_race:key-1",
        )
        barrier.wait()
        written.append(backend.save_job_if_marker_absent(job))

    threads = [threading.Thread(target=submit, args=(f"job_{index}",)) for index in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(result is None for result in written) == [False, True]
    assert len(list(backend.jobs_dir.glob("*.json"))) == 1


def test_save_job_if_marker_absent_is_a_no_op_for_unmarked_jobs(tmp_path):
    """没有 marker 的 job（首次扫描）不受影响，各自落盘。"""
    backend = FileBackend(tmp_path)

    def make(job_id: str) -> ScanJob:
        return ScanJob.new(
            job_id=job_id,
            session_id="scan_plain",
            query="q",
            product="",
            category="toy",
            markets=["EU"],
            upload_ids=[],
        )

    assert backend.save_job_if_marker_absent(make("job_a")) is None
    assert backend.save_job_if_marker_absent(make("job_b")) is None
    assert len(list(backend.jobs_dir.glob("*.json"))) == 2


def _write_lock(backend: FileBackend, job_id: str, pid: int, age_seconds: float) -> Path:
    lock_path = backend._job_lock_path(job_id)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(f"{pid} {time.time()}\n", encoding="ascii")
    stamp = time.time() - age_seconds
    os.utime(lock_path, (stamp, stamp))
    return lock_path


def test_job_lock_is_stealable_when_the_holder_process_is_gone(tmp_path):
    """持有者已死就立刻回收，不必等满 60s 老化窗口。

    否则一个被 SIGKILL 的 worker 留下的锁会让这个 job 卡住一分钟——多进程
    部署时就是整整一分钟的扫描停摆。
    """
    backend = FileBackend(tmp_path)
    # 远高于任何平台的 pid_max（Linux 上限 4194304），kill 必然 ESRCH
    lock_path = _write_lock(backend, "job_dead", pid=2**30, age_seconds=0)

    assert backend._job_lock_is_stealable(lock_path) is True


def test_job_lock_of_a_live_holder_is_kept_until_it_ages_out(tmp_path):
    """持有者还活着就只按老化规则处理，不抢锁。"""
    backend = FileBackend(tmp_path)
    fresh = _write_lock(backend, "job_live", pid=os.getpid(), age_seconds=0)
    aged = _write_lock(backend, "job_live_old", pid=os.getpid(), age_seconds=120)

    assert backend._job_lock_is_stealable(fresh) is False
    assert backend._job_lock_is_stealable(aged) is True
