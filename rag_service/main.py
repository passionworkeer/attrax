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
_SCAN_TIMEOUT_SECS = 180
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
_executor = ThreadPoolExecutor(max_workers=4)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _retriever

    logger.info("Starting rag-service...")

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
    verifier.set_verifier(CitationVerifier())
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
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",", 1)[0].strip() or (request.client.host if request.client else "unknown")


@app.middleware("http")
async def protect_requests(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_BODY_SIZE_BYTES:
        return JSONResponse(
            status_code=413,
            content={"error": "Request too large"},
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


@app.get("/health")
def health():
    """Liveness probe — returns basic status. Used by /api/health on the frontend."""
    faiss_ok = _retriever is not None and _retriever.faiss_retriever is not None
    return JSONResponse({
        "status": "ok",
        "version": app.version,
        "demo_mode": settings.demo_mode,
    })


@app.get("/ready")
def ready():
    """
    Readiness probe — checks all critical dependencies.
    Used by Kubernetes / load-balancer to decide whether to route traffic here.
    """
    checks = {
        "faiss": _retriever is not None and _retriever.faiss_retriever is not None,
        "bm25": _retriever is not None,
        "mimotalk_api_key": settings.demo_mode or bool(settings.mimotalk_api_key.strip()),
        "modelscope_api_key": settings.demo_mode or bool(settings.modelscope_api_key.strip()),
        "config_loaded": True,
    }
    all_ok = all(checks.values())

    return JSONResponse(
        {
            "ready": all_ok,
            "checks": checks,
            "demo_mode": settings.demo_mode,
            "version": app.version,
        },
        status_code=200 if all_ok else 503,
    )


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

    loop = asyncio.get_event_loop()
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

    loop = asyncio.get_event_loop()
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
