#!/usr/bin/env python3
"""
main.py - FastAPI entry point for rag-service

POST /scan → Agentic RAG graph
GET /health
"""
import os
import io
import logging
import base64
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional
import asyncio
from concurrent.futures import ThreadPoolExecutor

# Default timeouts (seconds) — prevents executor thread exhaustion on slow LLM calls
_SCAN_TIMEOUT_SECS = 180
_PROFIT_TIMEOUT_SECS = 60

# Load .env so os.environ.get() picks up values
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except Exception:
    pass

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from rag_service.config import settings
from rag_service.orchestrator.graph import run_compliance_graph
from rag_service.retrieval.faiss_retriever import FaissRetriever
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
    report_package: Optional[dict] = None


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
        "faiss_index": "loaded" if faiss_ok else "not_found",
        "vector_count": len(_retriever.faiss_retriever) if faiss_ok else 0,
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


@app.post("/scan", response_model=ScanResponse)
async def scan(req: ScanRequest):
    """POST /scan — main compliance scan endpoint."""
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
        raise HTTPException(status_code=500, detail=f"Compliance graph error: {e}")

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


# Remove the decorator-style exception handler for FastAPI 0.109 compatibility
# Use FastAPI's add_exception_handler without decorator
from fastapi import Request
from fastapi.responses import JSONResponse

async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all for unhandled exceptions — returns a clean JSON error."""
    logger.exception("Unhandled exception")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc)},
    )

app.add_exception_handler(Exception, global_exception_handler)
