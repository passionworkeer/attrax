#!/usr/bin/env python3
"""
main.py - FastAPI entry point for rag-service

POST /scan → Agentic RAG graph
GET /health
"""
import os
import io
import json
import logging
import base64
from collections import deque
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor

# Default timeouts (seconds) — prevents executor thread exhaustion on slow LLM calls
_SCAN_TIMEOUT_SECS = 280
_PROFIT_TIMEOUT_SECS = 60
_MAX_BODY_SIZE_BYTES = 50 * 1024 * 1024
_RATE_LIMIT_WINDOW_SECS = 60
_RATE_LIMIT_MAX_REQUESTS = 30
_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "RAG_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]
_MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024
_MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024
_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
_RATE_LIMITED_PATHS = {"/scan", "/scan-multipart", "/profit-report"}
_rate_limit_hits: dict[str, deque] = {}
_rate_limit_lock = asyncio.Lock()

# Load .env so os.environ.get() picks up values
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except Exception:
    pass

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from rag_service.config import settings
from rag_service.orchestrator.graph import run_compliance_graph
from rag_service.retrieval.faiss_retriever import FaissRetriever
from rag_service.schemas.report_package import ReportPackage
from rag_service.retrieval.hybrid_retriever import HybridRetriever
from rag_service.retrieval.bm25_retriever import BM25Retriever
from rag_service.generate.report_generator import ReportGenerator
from rag_service.verify.citation_verifier import CitationVerifier
from rag_service.orchestrator.nodes import vision as vision_node

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_APP_ROOT = Path(__file__).parent.parent.resolve()

_FAISS_ASCII_DIR = Path(os.environ.get("FAISS_INDEX_DIR", _APP_ROOT / "data" / "faiss"))
FAISS_INDEX_DIR = _FAISS_ASCII_DIR
CHILD_INDEX = str(FAISS_INDEX_DIR / "legal_chunks.index")
CHILD_META = str(FAISS_INDEX_DIR / "legal_chunks_meta.json")

_retriever: Optional[HybridRetriever] = None
# Worker count comes from settings.scan_worker_concurrency (default 8) so
# the 8-market fan-out doesn't serialize behind a single in-flight scan.
_executor = ThreadPoolExecutor(
    max_workers=settings.scan_worker_concurrency
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _retriever

    logger.info("Starting rag-service...")

    # P0-6: fail-closed internal-secret policy. Must run before anything that
    # would consume LLM/embedding quota. See _enforce_secret_policy for the
    # exact dev/demo vs production matrix.
    _enforce_secret_policy(settings)

    bm25 = BM25Retriever()

    # Pre-warm embedder at startup to avoid 3-8s probe delay on first query
    from rag_service.retrieval.hybrid_retriever import _probe_embedders
    warm_embedder, warm_name = _probe_embedders()
    if warm_embedder:
        logger.info(f"Embedding pre-warmed: {warm_name}")
    else:
        logger.warning("Embedding: all providers unavailable (BM25-only mode)")

    faiss_ret = None
    if os.path.exists(CHILD_INDEX) and os.path.exists(CHILD_META):
        try:
            faiss_ret = FaissRetriever.load(CHILD_INDEX, CHILD_META)
            logger.info(f"Faiss index loaded: {len(faiss_ret)} vectors")
        except Exception as e:
            logger.warning(f"Failed to load Faiss index: {e}")
    else:
        logger.info(f"Faiss index not found at {FAISS_INDEX_DIR}")

    _retriever = HybridRetriever(bm25=bm25, faiss_retriever=faiss_ret)

    chunks = faiss_ret.chunks if faiss_ret else []
    if chunks:
        _retriever.load_chunks(chunks)
        logger.info(f"BM25 index built with {len(chunks)} chunks")

    from rag_service.orchestrator.nodes import vision as vision_node_module
    from rag_service.orchestrator.nodes import generator
    from rag_service.orchestrator.nodes import verifier
    from rag_service.orchestrator.nodes import retriever as retriever_node
    retriever_node.set_retriever(_retriever)
    generator.set_generator(ReportGenerator(api_key=settings.mimotalk_api_key or None))

    # P0-3b: surface the NLI-degraded mode at startup. CitationVerifier() is
    # constructed without an injected NLI model, so verification falls back to
    # text-overlap matching (weaker grounding). Best-effort attribute probe —
    # if a future change auto-loads NLI inside __init__, the warning is silent.
    _cv = CitationVerifier()
    _nli_loaded = any(
        getattr(_cv, _attr, None) is not None
        for _attr in ("nli_model", "nli", "_nli_model", "model")
    )
    if not _nli_loaded:
        logger.warning(
            "NLI verifier not loaded — citation verification degraded to "
            "text-overlap mode"
        )
    verifier.set_verifier(_cv)
    vision_node_module.set_vision_analyzer(vision_node.VisionAnalyzer(settings.mimotalk_api_key or None))

    # ── Pre-warm embedding cache with common compliance queries ─────────────────
    # Embedding these at startup populates the LRU cache so the first real user
    # query hits cache immediately (~0.1ms instead of 100-300ms per embed call).
    if warm_embedder is not None:
        import time
        t0 = time.monotonic()
        common_queries = [
            "充电宝 合规 EU",
            "蓝牙耳机 CE RoHS",
            "锂电池 运输 法规",
            "玩具 安全 EN71",
            "电子产品 环保 RoHS",
            "出口欧盟 合规要求",
        ]
        try:
            warm_embedder.embed_batch(common_queries, batch_size=len(common_queries))
            logger.info(
                f"Query pre-warming done: {len(common_queries)} queries "
                f"embedded in {time.monotonic()-t0:.1f}s (cache populated)"
            )
        except Exception as e:
            logger.warning(f"Query pre-warming skipped: {e}")
    else:
        logger.info("Query pre-warming skipped: no embedder available")

    logger.info("rag-service ready")
    yield
    logger.info("rag-service shutting down")
    _executor.shutdown(wait=False)


app = FastAPI(title="火鹰合规 RAG Service", version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def _client_ip(request: Request) -> str:
    """
    Extract a stable client identifier for rate limiting.

    X-Forwarded-For is only honored when the immediate socket peer is a
    configured trusted reverse proxy (settings.trusted_proxies). This
    prevents arbitrary clients from spoofing XFF to bypass per-IP limits.

    If the peer is untrusted or empty (e.g. request.client is None — common
    when the app is behind a misconfigured proxy), we previously fell back
    to the literal string "unknown", which collapses every such request
    into a single rate-limit bucket and effectively disables per-client
    limiting. Instead we derive a keyed hash from the User-Agent with a
    per-process salt so that distinct UAs are still distinguished, while
    no plaintext UA is stored in the rate-limit map. Salt is regenerated
    on each process start so the bucket keys are not correlatable across
    restarts (sufficient for rate-limiting purposes).
    """
    peer = request.client.host if request.client else ""
    peer_norm = (peer or "").lower()
    if peer_norm and peer_norm in settings.trusted_proxies:
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",", 1)[0].strip()
        if first:
            return first

    if peer:
        # Untrusted direct connection — use the real socket peer.
        return peer

    # request.client is None (e.g. proxy that doesn't populate client scope).
    # Fall back to a salted UA hash so we still distinguish different clients.
    logger.warning(
        "request.client is None — falling back to UA-hash for rate limiting "
        "(path=%s)", request.url.path,
    )
    return _ua_hash_fallback(request)


# Per-process salt; regenerated on each startup. Module-level so it is
# computed exactly once (importing main.py is the natural lifecycle hook).
import secrets as _secrets
_UA_HASH_SALT: str = _secrets.token_hex(16)


def _ua_hash_fallback(request: Request) -> str:
    """Salted SHA-256 of User-Agent, truncated. Never returns 'unknown'.

    Returns a stable per-process identifier for the UA so the rate-limit
    map still distinguishes distinct UAs even when no socket peer exists.
    Prefix marks it as a hash-derived key for observability.
    """
    ua = request.headers.get("user-agent", "")
    import hashlib
    digest = hashlib.sha256(f"{_UA_HASH_SALT}:{ua}".encode("utf-8")).hexdigest()
    return f"ua:{digest[:16]}"


@app.middleware("http")
async def protect_requests(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_BODY_SIZE_BYTES:
        return JSONResponse(
            status_code=413,
            content={"error": "Request too large"},
        )

    # Shared-secret guard for internal write endpoints. When
    # settings.rag_internal_secret is set, /scan, /scan-multipart, and
    # /profit-report must carry header X-Internal-Secret with a matching
    # value or receive 401. P0-6 made this fail-closed: in non-demo,
    # non-RAG_ALLOW_INSECURE deployments the secret is ALWAYS set at startup
    # (explicitly by the operator or auto-generated), so the guard below is
    # effective in production. The empty-secret fail-open case only survives
    # for DEMO_MODE and explicit insecure opt-outs. GET /health and /ready
    # are not in _RATE_LIMITED_PATHS and are therefore never write-gated;
    # their detailed fields are filtered by _is_privileged instead.
    secret = settings.rag_internal_secret
    if secret and request.url.path in _RATE_LIMITED_PATHS:
        provided = request.headers.get("x-internal-secret", "")
        # Use hmac.compare_digest to avoid timing-attack leakage.
        import hmac as _hmac
        if not provided or not _hmac.compare_digest(provided, secret):
            return JSONResponse(
                status_code=401,
                content={"error": "Unauthorized"},
            )

    if request.url.path in _RATE_LIMITED_PATHS:
        now = time.monotonic()
        ip = _client_ip(request)
        async with _rate_limit_lock:
            hits = _rate_limit_hits.get(ip)
            if hits is None:
                hits = deque(maxlen=_RATE_LIMIT_MAX_REQUESTS)
                _rate_limit_hits[ip] = hits
            # Evict expired entries
            while hits and now - hits[0] >= _RATE_LIMIT_WINDOW_SECS:
                hits.popleft()
            if len(hits) >= _RATE_LIMIT_MAX_REQUESTS:
                return JSONResponse(
                    status_code=429,
                    content={"error": "Too many requests"},
                )
            hits.append(now)

    return await call_next(request)


class ScanRequest(BaseModel):
    query: str = ""
    product: str = ""
    category: str = ""
    markets: list[str] = ["EU"]
    vision_result: Optional[dict] = None
    images: Optional[list[dict]] = None  # [{"buffer": base64_str, "mime_type": str, "name": str}]
    documents: Optional[list[dict]] = None  # [{"name": str, "mime_type": str, "text": str}]
    pdfs: Optional[list[dict]] = None  # [{"name": str, "buffer": base64_str}] — extracted server-side via pdfplumber


class ScanResponse(BaseModel):
    status: str
    report: str
    agent_trace: list[dict]
    loop_count: int
    documents: Optional[list[dict]] = None
    report_package: Optional[ReportPackage] = None


class ProfitReportRequest(BaseModel):
    product: str = ""
    category: str = ""
    markets: list[str] = ["EU"]


class ProfitReportResponse(BaseModel):
    status: str
    report: str
    product: str
    market: str


def _current_embedding_provider() -> str:
    """Best-effort read of the active embedding provider name.

    Returns one of: 'modelscope_api', 'ollama', 'none', or 'unknown' if
    the retriever / embedder is not yet initialized. Defensive: never raises.

    Contract: HybridRetriever exposes `self.embedder_name` as a public
    attribute (set when an embedder is selected). We read it directly;
    getattr-with-default guards against older retriever instances that
    predate the attribute. The previous implementation reflected into a
    module-level private global of hybrid_retriever, which coupled main.py
    to an internal symbol that could change without notice.
    """
    if _retriever is None:
        return "none"
    try:
        return getattr(_retriever, "embedder_name", None) or "unknown"
    except Exception:
        return "unknown"


def _enforce_secret_policy(s: "settings.__class__") -> None:
    """P0-6 fail-closed guard for RAG_INTERNAL_SECRET at startup.

    Without this, an operator who forgets to set the secret leaves /scan,
    /scan-multipart, and /profit-report wide open — anyone who can reach the
    RAG port bypasses the frontend's rate limits and burns unbounded
    LLM/embedding quota (cost DoS). The middleware's ``if secret and ...``
    guard was fail-open precisely in that case.

    Policy:
      - demo_mode=True                       → lenient (dev/demo), no action.
      - secret already set                   → production posture, no action.
      - RAG_ALLOW_INSECURE=true              → explicit opt-out; warn loudly.
      - non-demo + empty secret + production → RuntimeError (refuse to boot).
      - non-demo + empty secret + non-prod   → auto-generate an ephemeral
        secret so write endpoints fail closed (401) instead of open; printed
        once so the operator can wire the frontend if needed.

    Reads ENV/NODE_ENV via settings.app_env. Truthy demo_mode short-circuits
    every check so local development and the test suite are unaffected.
    """
    if s.demo_mode:
        return
    if s.rag_internal_secret:
        logger.info("Internal secret policy: configured (write endpoints gated).")
        return
    if s.allow_insecure:
        logger.warning(
            "SECURITY: RAG_ALLOW_INSECURE=true — internal write endpoints "
            "(/scan, /scan-multipart, /profit-report) are OPEN. This is an "
            "explicit operator opt-out and should only be used behind a "
            "private network with equivalent auth at the edge."
        )
        return

    is_prod = s.app_env in ("production", "prod")
    if is_prod:
        raise RuntimeError(
            "Refusing to start: RAG_INTERNAL_SECRET is empty in production. "
            "Set RAG_INTERNAL_SECRET (or DEMO_MODE=true, or "
            "RAG_ALLOW_INSECURE=true to explicitly accept the risk) before "
            "starting the service. Without it, internal write endpoints would "
            "be open and bypass the frontend rate limit / auth."
        )

    # Non-prod, non-demo, no secret: fail closed by generating an ephemeral
    # secret. Frontend calls without the header will now 401 — the operator
    # sees this once in the logs and can copy the secret into RAG_INTERNAL_SECRET.
    import secrets as _s
    generated = _s.token_urlsafe(32)
    s.rag_internal_secret = generated
    logger.warning(
        "SECURITY: RAG_INTERNAL_SECRET was empty — generated an EPHEMERAL "
        "secret for this process. Write endpoints (/scan, /scan-multipart, "
        "/profit-report) now require header 'X-Internal-Secret: <value>' "
        "with this value. To wire the frontend, set RAG_INTERNAL_SECRET to a "
        "fixed value in rag_service/.env and the frontend env, or set "
        "DEMO_MODE=true for local dev. Ephemeral value: %s",
        generated,
    )


def _is_privileged(request: Request) -> bool:
    """Whether the caller may see detailed /health and /ready diagnostics.

    P1-5: the unauthenticated probes previously leaked deployment details
    (running mode, configured API keys, embedding provider, dim-mismatch
    counters) that aid reconnaissance. Detailed fields are now returned only
    when at least one of these holds:
      - DEMO_MODE is on (local/dev/test — the test suite relies on this).
      - A valid X-Internal-Secret header is present (operator/monitoring).
      - The peer is loopback (operator SSH tunnel / sidecar scraping).
      - RAG_ALLOW_INSECURE=true (explicit diagnostic opt-out).
    Minimal fields used by the frontend (/health: status) and by k8s probes
    (/ready: ready, checks, version) are ALWAYS returned so probes keep working
    without credentials.
    """
    if settings.demo_mode or settings.allow_insecure:
        return True
    secret = settings.rag_internal_secret
    if secret:
        provided = request.headers.get("x-internal-secret", "")
        if provided:
            import hmac as _hmac
            if _hmac.compare_digest(provided, secret):
                return True
    peer = (request.client.host if request.client else "") or ""
    if peer in ("127.0.0.1", "::1", "localhost"):
        return True
    return False


@app.get("/health")
def health(request: Request):
    """Liveness probe — minimal public surface (status only).

    Frontend ``/api/health`` consumes only ``status`` (see
    ``app/api/health/route.ts``). Detailed fields (demo_mode,
    embedding_provider, dense_dim_mismatch_count, version) are gated behind
    ``_is_privileged`` so an unauthenticated internet caller cannot probe
    the deployment mode or embedding provider.
    """
    faiss_ok = _retriever is not None and _retriever.faiss_retriever is not None
    status = "ok" if faiss_ok else "degraded"
    body: dict = {"status": status}
    if _is_privileged(request):
        body.update({
            "version": app.version,
            "demo_mode": settings.demo_mode,
            "embedding_provider": _current_embedding_provider(),
            "dense_dim_mismatch_count": (
                getattr(_retriever, "dense_dim_mismatch_count", 0)
                if _retriever else 0
            ),
        })
    return JSONResponse(body)


@app.get("/ready")
def ready(request: Request):
    """
    Readiness probe — checks all critical dependencies.
    Used by Kubernetes / load-balancer to decide whether to route traffic here.

    P1-5: ``ready``, ``checks``, and ``version`` are ALWAYS returned so k8s
    probes work without credentials (the test suite also asserts these).
    Sensitive diagnostics (demo_mode, embedding_provider, embedding_status,
    dense_dim_mismatch_count, warnings) are gated behind ``_is_privileged``.

    Embedding has a graceful-degradation path: if ModelScope is unavailable,
    the service falls back to Ollama, then to BM25-only. ModelScope key
    absence therefore does NOT block readiness; it is reported as a warning
    to privileged callers only.
    """
    modelscope_present = bool(settings.modelscope_api_key.strip())
    has_modelscope = settings.demo_mode or modelscope_present

    # Hard gates: FAISS index and LLM key are required for any useful output.
    checks = {
        "faiss": _retriever is not None and _retriever.faiss_retriever is not None,
        "bm25": _retriever is not None,
        "mimotalk_api_key": settings.demo_mode or bool(settings.mimotalk_api_key.strip()),
        # Informational only — not part of readiness gate (Ollama fallback exists).
        "modelscope_api_key": has_modelscope,
        "config_loaded": True,
    }
    gate_keys = ("faiss", "bm25", "mimotalk_api_key", "config_loaded")
    all_ok = all(checks[k] for k in gate_keys)

    body: dict = {
        "ready": all_ok,
        "checks": checks,
        "version": app.version,
    }
    if _is_privileged(request):
        warnings = []
        embedding_status = "ok"
        if not has_modelscope:
            warnings.append("modelscope_api_key missing — embedding degraded to ollama_fallback")
            embedding_status = "ollama_fallback"
        body.update({
            "demo_mode": settings.demo_mode,
            "embedding_provider": _current_embedding_provider(),
            "embedding_status": embedding_status,
            "dense_dim_mismatch_count": (
                getattr(_retriever, "dense_dim_mismatch_count", 0)
                if _retriever else 0
            ),
            "warnings": warnings,
        })
    return JSONResponse(body, status_code=200 if all_ok else 503)


def _parse_markets(value: str) -> list[str]:
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(item) for item in parsed if str(item).strip()]
    except Exception:
        pass
    return [item.strip() for item in value.split(",") if item.strip()] or ["EU"]


def _has_magic(value: bytes, signature: bytes) -> bool:
    return value.startswith(signature)


def _validate_image_upload(upload: UploadFile, content: bytes) -> None:
    if len(content) > _MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")
    if upload.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported image type")
    if upload.content_type == "image/jpeg" and not _has_magic(content, b"\xff\xd8\xff"):
        raise HTTPException(status_code=400, detail="Invalid image content")
    if upload.content_type == "image/png" and not _has_magic(content, b"\x89PNG"):
        raise HTTPException(status_code=400, detail="Invalid image content")
    if upload.content_type == "image/webp" and not (content.startswith(b"RIFF") and content[8:12] == b"WEBP"):
        raise HTTPException(status_code=400, detail="Invalid image content")


def _validate_pdf_upload(upload: UploadFile, content: bytes) -> None:
    if len(content) > _MAX_PDF_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="PDF too large")
    if upload.content_type != "application/pdf" and not (upload.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Unsupported PDF type")
    if not _has_magic(content, b"%PDF"):
        raise HTTPException(status_code=400, detail="Invalid PDF content")


async def _build_scan_request_from_multipart(
    query: str,
    product: str,
    category: str,
    markets: str,
    documents: str,
    images: list[UploadFile],
    pdfs: list[UploadFile],
) -> ScanRequest:
    image_items = []
    for image in images:
        content = await image.read()
        _validate_image_upload(image, content)
        image_items.append({
            "buffer": base64.b64encode(content).decode("ascii"),
            "mime_type": image.content_type or "image/jpeg",
            "name": image.filename or "image",
        })

    parsed_documents = []
    try:
        value = json.loads(documents) if documents else []
        if isinstance(value, list):
            parsed_documents = [item for item in value if isinstance(item, dict)]
    except Exception:
        parsed_documents = []

    pdf_items = []
    for pdf in pdfs:
        content = await pdf.read()
        _validate_pdf_upload(pdf, content)
        pdf_items.append({
            "name": pdf.filename or "document.pdf",
            "buffer": base64.b64encode(content).decode("ascii"),
        })

    return ScanRequest(
        query=query,
        product=product,
        category=category,
        markets=_parse_markets(markets),
        images=image_items,
        documents=parsed_documents,
        pdfs=pdf_items,
    )


async def _run_scan_request(req: ScanRequest) -> ScanResponse:
    """Run the main compliance scan endpoint."""
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="query is required")

    if settings.demo_mode:
        return ScanResponse(
            status="DEMO",
            report="## Demo 模式\n\n当前运行于演示模式，未连接真实 LLM 服务。\n\n要启用完整功能，请配置环境变量 `MIMOTALK_API_KEY`。\n\n参考文档：`.env.example` 或 `rag_service/.env`",
            agent_trace=[{
                "node": "demo",
                "status": "DEMO",
                "message": "demo mode active — configure MIMOTALK_API_KEY for full service",
            }],
            loop_count=0,
        )

    decoded_images = []
    if req.images:
        for img in req.images:
            buf = base64.b64decode(img.get("buffer", ""))
            decoded_images.append({
                "buffer": buf,
                "mime_type": img.get("mime_type", "image/jpeg"),
            })

    # Extract text from user-uploaded PDFs using pdfplumber
    extracted_pdf_docs = []
    if req.pdfs:
        try:
            import pdfplumber
            for pdf_item in req.pdfs:
                name = pdf_item.get("name", "unknown.pdf")
                buf = base64.b64decode(pdf_item.get("buffer", ""))
                text_parts = []
                try:
                    with pdfplumber.open(io.BytesIO(buf)) as pdf:
                        for page in pdf.pages:
                            page_text = page.extract_text() or ""
                            if page_text.strip():
                                text_parts.append(page_text)
                except Exception as e:
                    logger.warning(f"PDF extraction failed for {name}: {e}")
                full_text = "\n".join(text_parts)
                extracted_pdf_docs.append({
                    "name": name,
                    "mime_type": "application/pdf",
                    "text": full_text[:5000],
                })
        except ImportError:
            logger.warning("pdfplumber not available")

    # Merge extracted PDF text into documents list
    all_docs = (req.documents or []) + extracted_pdf_docs

    loop = asyncio.get_running_loop()
    try:
        # Enforce a wall-clock timeout to prevent thread pool exhaustion.
        # The executor continues running but we return a clean 504 to the client.
        result = await asyncio.wait_for(
            loop.run_in_executor(
                _executor,
                lambda: run_compliance_graph(
                    query=req.query,
                    product=req.product,
                    category=req.category,
                    markets=req.markets,
                    vision_result=req.vision_result or {},
                    images=decoded_images,
                    documents=all_docs,
                ),
            ),
            timeout=_SCAN_TIMEOUT_SECS,
        )
    except asyncio.TimeoutError:
        logger.error(f"/scan timed out after {_SCAN_TIMEOUT_SECS}s")
        raise HTTPException(status_code=504, detail="Scan request timed out. Please try again.")
    except Exception as e:
        logger.exception("run_compliance_graph failed")
        raise HTTPException(status_code=500, detail="Compliance graph error")

    # Cap displayed documents at 15 — enough to be useful without overwhelming the UI
    DISPLAY_DOC_CAP = 15
    display_docs = result.get("documents") or result.get("retrieved_chunks", [])
    return ScanResponse(
        status=result["status"],
        report=result["final_report"],
        agent_trace=result["agent_trace"],
        loop_count=result["loop_count"],
        documents=display_docs[:DISPLAY_DOC_CAP],
        report_package=result.get("report_package") or None,
    )


@app.post("/scan", response_model=ScanResponse)
async def scan(req: ScanRequest):
    return await _run_scan_request(req)


@app.post("/scan-multipart", response_model=ScanResponse)
async def scan_multipart(
    query: str = Form(""),
    product: str = Form(""),
    category: str = Form(""),
    markets: str = Form("[\"EU\"]"),
    documents: str = Form("[]"),
    images: list[UploadFile] = File(default=[]),
    pdfs: list[UploadFile] = File(default=[]),
):
    req = await _build_scan_request_from_multipart(
        query=query,
        product=product,
        category=category,
        markets=markets,
        documents=documents,
        images=images,
        pdfs=pdfs,
    )
    return await _run_scan_request(req)


# ─── Profit Report ────────────────────────────────────────────────────────────

@app.post("/profit-report", response_model=ProfitReportResponse)
async def profit_report(req: ProfitReportRequest):
    """
    生成合规成本与利润分析报告。

    接收产品类型和市场，从语料库检索相关文档，生成带完整成本表格的 markdown 报告。
    充电宝和乒乓球拍使用预置数据（无需 LLM 调用），其他产品尝试 LLM 填充。
    """
    market = req.markets[0] if req.markets else "EU"
    product_type = req.product or req.category or "通用产品"

    if settings.demo_mode:
        return ProfitReportResponse(
            status="DEMO",
            report="## Demo 模式\n\n当前运行于演示模式，未连接真实 LLM 服务。\n\n要启用完整功能，请配置环境变量 `MIMOTALK_API_KEY`。",
            product=product_type,
            market=market,
        )

    def _generate() -> str:
        # Retrieve relevant chunks from FAISS/BM25 index
        if _retriever is None:
            logger.warning("Retriever not initialized, using empty chunks")
            chunks = []
        else:
            # Search for profit/cost related keywords
            search_queries = [
                f"{product_type} 合规 成本 利润",
                f"{product_type} BOM 材料成本",
                f"{product_type} 认证费 EPR",
            ]
            retrieved = _retriever.retrieve(search_queries[0], top_k=20)
            # Also fetch by keyword combinations
            for q in search_queries[1:]:
                try:
                    additional = _retriever.retrieve(q, top_k=10)
                    doc_ids = {r.get("doc_id") or r.get("chunk_id") for r in retrieved}
                    for item in additional:
                        if (item.get("doc_id") or item.get("chunk_id")) not in doc_ids:
                            retrieved.append(item)
                            doc_ids.add(item.get("doc_id") or item.get("chunk_id"))
                except Exception:
                    pass
            chunks = _normalize_chunks(retrieved)

        gen = ReportGenerator(api_key=settings.mimotalk_api_key or None)
        return gen.generate_profit_report(
            product_type=product_type,
            market=market,
            chunks=chunks,
        )

    loop = asyncio.get_running_loop()
    try:
        report_text = await asyncio.wait_for(
            loop.run_in_executor(_executor, _generate),
            timeout=_PROFIT_TIMEOUT_SECS,
        )
    except asyncio.TimeoutError:
        logger.error(f"/profit-report timed out after {_PROFIT_TIMEOUT_SECS}s")
        raise HTTPException(status_code=504, detail="Profit report timed out. Please try again.")

    return ProfitReportResponse(
        status="SUCCESS",
        report=report_text,
        product=product_type,
        market=market,
    )


def _normalize_chunks(results: list) -> list[dict]:
    """Normalize retriever output to the standard chunk dict format."""
    out = []
    for item in results:
        if isinstance(item, dict):
            out.append({
                "content": item.get("content", "") or item.get("text", ""),
                "doc_name": item.get("doc_name", "") or item.get("source", ""),
                "chunk_id": item.get("chunk_id", ""),
                "score": item.get("score", 0.0),
            })
    return out



async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all for unhandled exceptions without leaking internals."""
    logger.exception("Unhandled exception")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"},
    )

app.add_exception_handler(Exception, global_exception_handler)
