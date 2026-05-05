#!/usr/bin/env python3
"""
main.py - FastAPI entry point for rag-service

POST /scan → Agentic RAG graph
GET /health
"""
import os
import logging
import base64
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional
import asyncio
from concurrent.futures import ThreadPoolExecutor

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

    logger.info("rag-service ready")
    yield
    logger.info("rag-service shutting down")
    _executor.shutdown(wait=False)


app = FastAPI(title="火鹰合规 RAG Service", version="0.2.0", lifespan=lifespan)


class ScanRequest(BaseModel):
    query: str = ""
    product: str = ""
    category: str = ""
    markets: list[str] = ["EU"]
    vision_result: Optional[dict] = None
    images: Optional[list[dict]] = None  # [{"buffer": base64_str, "mime_type": str, "name": str}]
    documents: Optional[list[dict]] = None  # [{"name": str, "mime_type": str, "text": str}]


class ScanResponse(BaseModel):
    status: str
    report: str
    agent_trace: list[dict]
    loop_count: int
    documents: Optional[list[dict]] = None


@app.get("/health")
def health():
    faiss_ok = _retriever is not None and _retriever.faiss_retriever is not None
    return {
        "status": "ok",
        "version": "0.2.0",
        "faiss_index": "loaded" if faiss_ok else "not_found",
        "vector_count": len(_retriever.faiss_retriever) if faiss_ok else 0,
    }


@app.post("/scan", response_model=ScanResponse)
async def scan(req: ScanRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="query is required")

    if settings.demo_mode:
        return ScanResponse(
            status="WARN",
            report="DEMO MODE: 请配置 MIMOTALK_API_KEY 以启用真实服务。",
            agent_trace=[{"node": "demo", "message": "demo mode active"}],
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

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        _executor,
        lambda: run_compliance_graph(
            query=req.query,
            product=req.product,
            category=req.category,
            markets=req.markets,
            vision_result=req.vision_result or {},
            images=decoded_images,
            documents=req.documents,
        )
    )

    return ScanResponse(
        status=result["status"],
        report=result["final_report"],
        agent_trace=result["agent_trace"],
        loop_count=result["loop_count"],
        documents=result.get("documents", []),
    )