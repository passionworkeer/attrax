#!/usr/bin/env python3
"""
main.py - FastAPI entry point for rag-service

POST /scan → Agentic RAG graph
GET /health
GET /health/qdrant
"""
import time
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from qdrant_client import QdrantClient

from config import settings
from orchestrator.graph import run_compliance_graph
from orchestrator.nodes.retriever import set_retriever
from orchestrator.nodes.generator import set_generator
from orchestrator.nodes.verifier import set_verifier
from retrieval.hybrid_retriever import HybridRetriever
from retrieval.cohere_embedder import CohereEmbedder
from retrieval.bm25_retriever import BM25Retriever
from generate.report_generator import ReportGenerator
from verify.citation_verifier import CitationVerifier

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global retriever (initialized on startup)
_retriever: Optional[HybridRetriever] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize on startup."""
    global _retriever

    logger.info("Starting rag-service...")

    # Initialize Qdrant client
    try:
        qc = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
        qc.health()  # Check connection
        logger.info("Qdrant connected")
    except Exception as e:
        logger.warning(f"Qdrant not available: {e}")
        qc = None

    # Initialize embedder
    embedder = CohereEmbedder(api_key=settings.cohere_api_key) if settings.cohere_api_key else None

    # Initialize BM25
    bm25 = BM25Retriever()

    # Initialize HybridRetriever
    _retriever = HybridRetriever(
        embedder=embedder,
        bm25=bm25,
        qdrant_client=qc,
        cohere_reranker_key=settings.cohere_api_key,
    )

    # Inject into orchestrator nodes
    from orchestrator.nodes import retriever, generator, verifier
    retriever.set_retriever(_retriever)
    generator.set_generator(ReportGenerator(api_key=settings.anthropic_api_key))
    verifier.set_verifier(CitationVerifier())

    logger.info("rag-service ready")
    yield
    logger.info("rag-service shutting down")


app = FastAPI(title="火鹰合规 RAG Service", version="0.1.0", lifespan=lifespan)


class ScanRequest(BaseModel):
    query: str
    product: str = ""
    category: str = ""
    markets: list[str] = ["EU"]
    vision_result: Optional[dict] = None


class ScanResponse(BaseModel):
    status: str      # PASS | WARN | REJECTED
    report: str
    agent_trace: list[dict]
    loop_count: int


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/health/qdrant")
def qdrant_health():
    try:
        qc = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
        qc.health()
        return {"status": "ok", "qdrant": "connected"}
    except Exception as e:
        return {"status": "error", "qdrant": str(e)}


@app.post("/scan", response_model=ScanResponse)
def scan(req: ScanRequest):
    """
    Run Agentic RAG compliance scan.

    Returns structured report with agent_trace and verification status.
    """
    if settings.demo_mode:
        return ScanResponse(
            status="WARN",
            report="DEMO MODE: 请配置 COHERE_API_KEY 和 ANTHROPIC_API_KEY 以启用真实服务。",
            agent_trace=[{"node": "demo", "message": "demo mode active"}],
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
        )
    except Exception as e:
        logger.error(f"Scan failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/scan/stream")
def scan_stream(req: ScanRequest):
    """Streaming version - yields agent_trace events as they happen."""
    async def event_generator():
        if settings.demo_mode:
            yield f"data: {'DEMO MODE' + chr(10)}\n\n"
            return

        # Simple SSE: stream final result
        try:
            result = run_compliance_graph(
                query=req.query, product=req.product,
                category=req.category, markets=req.markets,
                vision_result=req.vision_result or {},
            )
            yield f"data: {result['status']}|{result['final_report'][:200]}\n\n"
        except Exception as e:
            yield f"data: ERROR|{str(e)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ── Bulk ingestion endpoint ───────────────────────────────────────────────────
@app.post("/ingest")
def ingest(chunks: list[dict]):
    """
    Ingest chunks into vector store.
    Called by build_corpus.py after LegalChunker.
    """
    if _retriever is None:
        raise HTTPException(status_code=503, detail="Retriever not initialized")

    try:
        _retriever.load_chunks(chunks)
        # Also embed and upsert to Qdrant if client available
        return {"status": "ok", "chunks_loaded": len(chunks)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
