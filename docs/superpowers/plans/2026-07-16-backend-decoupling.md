# Attrax Backend Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all frontend-facing server responsibilities into a versioned, independently deployable FastAPI backend so a replacement frontend only needs HTTP and OpenAPI.

**Architecture:** Keep one FastAPI deployment, but separate public API, application use cases, domain records, and filesystem adapters. The initial adapters preserve the current local-file deployment model while presenting interfaces that can later be replaced by Redis, a database, or object storage.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, asyncio, pytest, existing LangGraph RAG pipeline, Docker Compose, OpenAPI.

---

## File structure

- `rag_service/domain/scans.py`: storage-independent session/job/upload records and status transitions.
- `rag_service/application/ports.py`: repository and runner protocols.
- `rag_service/application/scans.py`: create/query/delete/run/resume scan use cases.
- `rag_service/infrastructure/file_backend.py`: atomic JSON records, binary upload storage, queue recovery, audit log.
- `rag_service/api/models.py`: camelCase envelopes and public response schemas.
- `rag_service/api/dependencies.py`: Bearer extraction and service lookup.
- `rag_service/api/v1.py`: versioned frontend-facing routes.
- `rag_service/main.py`: composition root and legacy endpoint compatibility only.
- `rag_service/tests/test_file_backend.py`: real temporary-directory persistence tests.
- `rag_service/tests/test_scan_service.py`: application behavior tests with an injected runner.
- `rag_service/tests/test_api_v1.py`: full public HTTP contract tests.
- `docs/FRONTEND-BACKEND-INTEGRATION.md`: replacement-frontend handoff.

### Task 1: Repair and freeze the existing baseline

**Files:**
- Modify: `rag_service/main.py`
- Modify: `rag_service/tests/test_api_smoke.py`
- Modify: `rag_service/tests/test_vision_node.py`
- Modify: `rag_service/tests/test_registry_collector_manifest.py`
- Modify: `data/regulation_eval/retrieval_cases.json`
- Modify: `lib/types.ts`

- [ ] **Step 1: Confirm each existing failure independently**

Run:

```powershell
python -m pytest rag_service/tests/test_api_smoke.py::test_health_endpoint rag_service/tests/test_vision_node.py::TestVisionAnalysisNode::test_agent_trace_accumulates rag_service/tests/test_registry_collector_manifest.py::test_registry_supplement_references_existing_files_with_hashes rag_service/tests/test_regulation_retrieval_eval.py::test_curated_retrieval_cases_cover_markets_categories_and_risks -v
npm run typecheck
```

Expected: the four Python tests and the `GeneratedDecisionNode.metadata` type check fail for the already-recorded reasons.

- [ ] **Step 2: Correct liveness semantics and stale reducer expectation**

Change `/health` to always report `status="ok"` when the process can serve the request; dependency state remains exclusively on `/ready`. Rename the vision test to `test_agent_trace_returns_only_new_entry` and assert one new vision entry because LangGraph owns trace reduction.

- [ ] **Step 3: Make corpus integrity verification newline-stable and restore eval coverage**

In the manifest test, compare the manifest with LF-canonicalized bytes only when the raw file differs solely by CRLF conversion; still fail for every other byte change. Add explicit CN, CA, and NZ curated cases with source IDs that exist in `legal_chunks_meta.json`, preserving the schema validated by `validate_cases`.

- [ ] **Step 4: Align the TypeScript contract**

Add this field to `GeneratedDecisionNode`:

```typescript
metadata?: Record<string, unknown>;
```

- [ ] **Step 5: Verify and commit the baseline**

Run:

```powershell
npm run typecheck
npm run test:rag
```

Expected: both commands exit 0.

Commit:

```powershell
git add rag_service/main.py rag_service/tests/test_api_smoke.py rag_service/tests/test_vision_node.py rag_service/tests/test_registry_collector_manifest.py data/regulation_eval/retrieval_cases.json lib/types.ts
git commit -m "fix: restore backend verification baseline"
```

### Task 2: Define domain records and filesystem ports

**Files:**
- Create: `rag_service/domain/__init__.py`
- Create: `rag_service/domain/scans.py`
- Create: `rag_service/application/__init__.py`
- Create: `rag_service/application/ports.py`
- Create: `rag_service/infrastructure/__init__.py`
- Create: `rag_service/infrastructure/file_backend.py`
- Test: `rag_service/tests/test_file_backend.py`

- [ ] **Step 1: Write failing persistence tests**

Cover atomic round-trip, token-hash non-exposure, upload SHA-256, queued-job recovery, and cascading deletion using a real `tmp_path`.

```python
def test_file_backend_round_trips_session_and_deletes_payloads(tmp_path):
    backend = FileBackend(tmp_path)
    session = ScanSession.new("scan_01", "token-hash", category="electronics", markets=["EU"])
    backend.save_session(session)
    upload = backend.save_upload("scan_01", "image", "front.jpg", "image/jpeg", b"abc")
    backend.save_job(ScanJob.new("job_01", "scan_01", [upload]))
    assert backend.get_session("scan_01") == session
    backend.delete_session("scan_01")
    assert backend.get_session("scan_01") is None
    assert not upload.path.exists()
```

- [ ] **Step 2: Verify RED**

Run `python -m pytest rag_service/tests/test_file_backend.py -v`.

Expected: import failure because the modules do not exist.

- [ ] **Step 3: Implement immutable records and protocols**

Define `ScanStatus = Literal["processing", "ready", "degraded", "failed"]`, frozen Pydantic records `ScanSession`, `StoredUpload`, and `ScanJob`, and protocols with `save/get/delete/list` operations. Use `model_dump(mode="json")` for persistence and exclude `access_token_hash` from public serialization.

- [ ] **Step 4: Implement the filesystem adapter**

Use `<root>/sessions`, `<root>/jobs`, `<root>/uploads`, and `<root>/audit.jsonl`. Writes use a sibling temporary file followed by `os.replace`. Filenames use generated IDs, never user-provided paths. `delete_session` removes the session, its jobs, and its upload directory.

- [ ] **Step 5: Verify GREEN and commit**

Run `python -m pytest rag_service/tests/test_file_backend.py -v`.

Commit as `feat(backend): add persistent scan storage ports`.

### Task 3: Build the asynchronous scan application service

**Files:**
- Create: `rag_service/application/scans.py`
- Test: `rag_service/tests/test_scan_service.py`

- [ ] **Step 1: Write failing service tests**

Test that `create_scan` returns the plain token once, stores only its SHA-256, persists uploads before enqueueing, runs an injected async runner, transitions `processing -> ready`, marks exceptions `failed`, and resumes queued/running jobs after restart.

```python
async def test_service_runs_job_and_persists_ready_result(tmp_path):
    async def runner(payload):
        return {"status": "PASS", "report": "ok", "agent_trace": [], "loop_count": 0}
    service = ScanService(FileBackend(tmp_path), runner=runner)
    created = await service.create_scan(ScanSubmission.sample_png())
    await service.wait_for_idle()
    session = service.get_scan(created.session_id, created.access_token)
    assert session.status == "ready"
    assert session.result["complianceStatus"] == "PASS"
```

- [ ] **Step 2: Verify RED**

Run `python -m pytest rag_service/tests/test_scan_service.py -v`.

- [ ] **Step 3: Implement create/query/delete and token verification**

Generate `scan_<ULID-compatible random id>` and a 32-byte URL-safe token. Compare SHA-256 digests with `hmac.compare_digest`. Raise typed `ScanNotFound`, `ScanUnauthorized`, and `ScanNotReady` errors.

- [ ] **Step 4: Implement task execution and recovery**

Keep strong references to asyncio tasks. Claim queued jobs atomically, reconstruct the legacy `ScanRequest` payload from stored files, call the injected runner, normalize snake_case RAG output to camelCase, persist terminal state, and expose `resume_pending()` plus `wait_for_idle()`.

- [ ] **Step 5: Verify GREEN and commit**

Run `python -m pytest rag_service/tests/test_scan_service.py -v`.

Commit as `feat(backend): add asynchronous scan service`.

### Task 4: Expose the independent v1 HTTP API

**Files:**
- Create: `rag_service/api/__init__.py`
- Create: `rag_service/api/models.py`
- Create: `rag_service/api/dependencies.py`
- Create: `rag_service/api/v1.py`
- Create: `rag_service/tests/test_api_v1.py`
- Modify: `rag_service/main.py`
- Modify: `rag_service/config.py`

- [ ] **Step 1: Write failing HTTP contract tests**

Cover `POST /api/v1/scans` returning 202, Bearer-protected polling, wrong/missing token 401, malformed ID 404, roadmap/trace extraction, delete 204, upload validation errors, error envelope request ID, health/ready aliases, and OpenAPI path presence.

- [ ] **Step 2: Verify RED**

Run `python -m pytest rag_service/tests/test_api_v1.py -v`.

- [ ] **Step 3: Implement envelopes, dependencies and routes**

All non-204 responses use:

```json
{"data": {}, "error": null, "meta": {"requestId": "req_..."}}
```

Errors use stable codes such as `INVALID_REQUEST`, `INVALID_FILE_TYPE`, `FILE_TOO_LARGE`, `UNAUTHORIZED`, `NOT_FOUND`, `NOT_READY`, and `SCAN_FAILED`. The create route accepts `images` and `documents` multipart lists and preserves the existing 8-image/5-document and size/signature rules.

- [ ] **Step 4: Compose the service in FastAPI lifespan**

Construct `FileBackend(settings.runtime_data_dir)` and `ScanService(..., runner=_run_scan_request)` once, store it on `app.state`, call `resume_pending()` after RAG initialization, and include the v1 router. Add `runtime_data_dir` and parsed `allowed_origins` settings.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```powershell
python -m pytest rag_service/tests/test_api_v1.py rag_service/tests/test_api_smoke.py -v
```

Commit as `feat(api): expose independent v1 scan backend`.

### Task 5: Produce the frontend handoff and deployment boundary

**Files:**
- Create: `docs/FRONTEND-BACKEND-INTEGRATION.md`
- Modify: `.env.local.example`
- Modify: `docker-compose.yml`
- Modify: `rag_service/README.md`
- Modify: `docs/API-CONTRACT.md`
- Modify: `scripts/capture-openapi.mjs`

- [ ] **Step 1: Add deployment contract tests**

Extend the existing deploy-preflight and OpenAPI tests to require `/api/v1/scans`, `BACKEND_PUBLIC_URL`, and a backend healthcheck that does not depend on Next.js.

- [ ] **Step 2: Verify RED**

Run `npm run test -- tests/unit/deploy-preflight.test.ts && python -m pytest rag_service/tests/test_api_v1.py -v`.

- [ ] **Step 3: Add handoff documentation and configuration**

Document one base URL, multipart field names, Bearer polling, status handling, error codes, `curl` examples, a framework-neutral fetch example, OpenAPI type generation, and local/Docker startup commands. Make the RAG service independently addressable and keep the current web service as an optional legacy consumer.

- [ ] **Step 4: Refresh OpenAPI artifacts**

Capture the live schema, regenerate `lib/rag-client/types.gen.ts`, and ensure the snapshot contains both v1 and legacy paths.

- [ ] **Step 5: Verify and commit**

Run `npm run check:rag-contract` and commit as `docs(api): add replacement frontend handoff`.

### Task 6: Full verification and delivery

**Files:**
- Modify only files required by failures reproduced during this task.

- [ ] **Step 1: Run Python verification**

```powershell
npm run test:rag
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run TypeScript verification**

```powershell
npm run typecheck
npm run lint
npm run test
```

Expected: all commands exit 0.

- [ ] **Step 3: Run build and contract verification**

```powershell
npm run build
npm run check:rag-contract
docker compose config --quiet
```

Expected: all commands exit 0.

- [ ] **Step 4: Review repository state**

Run `git status --short`, `git diff main...HEAD --check`, and `git log --oneline main..HEAD`.

- [ ] **Step 5: Commit any verification-only corrections**

Use a focused commit message and leave the feature branch ready for user review or merge.
