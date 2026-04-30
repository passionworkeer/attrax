#!/usr/bin/env python3
"""
main.py - FastAPI entry point for rag-service

POST /scan → Agentic RAG graph
GET /health
"""
import os
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from rag_service.config import settings
from rag_service.orchestrator.graph import run_compliance_graph
from rag_service.retrieval.faiss_retriever import FaissRetriever
from rag_service.retrieval.hybrid_retriever import HybridRetriever
from rag_service.retrieval.bm25_retriever import BM25Retriever
from rag_service.generate.report_generator import ReportGenerator
from rag_service.verify.citation_verifier import CitationVerifier

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_APP_ROOT = Path(__file__).parent.parent.resolve()

# Use ASCII path to avoid Windows FAISS C-I/O issues with Chinese paths
_FAISS_ASCII_DIR = Path("C:/temp/faiss_index")
FAISS_INDEX_DIR = _FAISS_ASCII_DIR
CHILD_INDEX = str(FAISS_INDEX_DIR / "legal_chunks.index")
CHILD_META = str(FAISS_INDEX_DIR / "legal_chunks_meta.json")

# Global retriever (initialized on startup)
_retriever: Optional[HybridRetriever] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize on startup."""
    global _retriever

    logger.info("Starting rag-service...")

    # Initialize BM25 (no external dependency)
    bm25 = BM25Retriever()

    # Initialize Faiss retriever
    faiss_ret = None
    if os.path.exists(CHILD_INDEX) and os.path.exists(CHILD_META):
        try:
            faiss_ret = FaissRetriever.load(CHILD_INDEX, CHILD_META)
            logger.info(f"Faiss index loaded: {len(faiss_ret)} vectors")
        except Exception as e:
            logger.warning(f"Failed to load Faiss index: {e}")
    else:
        logger.info(f"Faiss index not found at {FAISS_INDEX_DIR}, run scripts/build_faiss.py first")

    # Build HybridRetriever (auto-selects LocalEmbedder or ModelScopeEmbedder)
    _retriever = HybridRetriever(
        bm25=bm25,
        faiss_retriever=faiss_ret,
    )

    # Load chunks into BM25
    chunks = faiss_ret.chunks if faiss_ret else []
    if chunks:
        _retriever.load_chunks(chunks)
        logger.info(f"BM25 index built with {len(chunks)} chunks")

    # Inject into orchestrator nodes
    from rag_service.orchestrator.nodes import retriever as retriever_node
    from rag_service.orchestrator.nodes import generator
    from rag_service.orchestrator.nodes import verifier
    retriever_node.set_retriever(_retriever)
    generator.set_generator(ReportGenerator(api_key=settings.anthropic_api_key) if settings.anthropic_api_key else None)
    verifier.set_verifier(CitationVerifier())

    logger.info("rag-service ready")
    yield
    logger.info("rag-service shutting down")


app = FastAPI(title="火鹰合规 RAG Service", version="0.2.0", lifespan=lifespan)


class ScanRequest(BaseModel):
    query: str
    product: str = ""
    category: str = ""
    markets: list[str] = ["EU"]
    vision_result: Optional[dict] = None


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
def scan(req: ScanRequest):
    """Run Agentic RAG compliance scan."""
    if settings.demo_mode:
        return ScanResponse(
            status="WARN",
            report="DEMO MODE: 请配置 COHERE_API_KEY 和 ANTHROPIC_API_KEY 以启用真实服务。",
            agent_trace=[{"node": "demo", "message": "demo mode active"}],
            loop_count=0,
        )

    if not settings.cohere_api_key or not settings.anthropic_api_key:
        return ScanResponse(
            status="WARN",
            report="缺少 API Keys：COHERE_API_KEY 和 ANTHROPIC_API_KEY 都需要配置。",
            agent_trace=[{"node": "config_error", "missing_keys": [
                k for k, v in {"COHERE_API_KEY": settings.cohere_api_key, "ANTHROPIC_API_KEY": settings.anthropic_api_key}.items() if not v
            ]}],
            loop_count=0,
        )

    try:
        result = run_compliance_graph(
            query=req.query,
            product=req.product,
            category=req.category,
            markets=req.markets,
            vision_result=req.vision_result or {},
        )

        return ScanResponse(
            status=result["status"],
            report=result["final_report"],
            agent_trace=result["agent_trace"],
            loop_count=result["loop_count"],
            documents=result.get("retrieved_chunks", []),
        )
    except Exception as e:
        logger.error(f"Scan failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))