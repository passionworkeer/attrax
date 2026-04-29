# 火鹰合规 RAG Service

Agentic RAG system for cross-border e-commerce compliance scanning.

## Architecture

```
User Upload -> Vision AI -> Query Planner
                            |
                 Parallel Retrieval (LangGraph Send)
                 EU / US / CN markets
                            |
                    Synthesis + Must-Check
                            |
                    Claude Sonnet Report
                            |
              NLI Citation Verification (DeBERTa)
                            |
              PASS / WARN / REJECTED + Final Report
```

## Features

- **Multi-market**: EU + US + CN parallel retrieval
- **Agentic**: LangGraph StateGraph with re-retrieval loop (max 2 rounds)
- **HyDE**: Hypothetical Document Embedding for second-round query refinement
- **NLI Verification**: DeBERTa-v3-large-mnli claim verification (fallback: text overlap)
- **Hard Gate**: CONTRADICTED -> REJECTED, score < 0.7 -> WARN, score >= 0.9 -> PASS
- **Must-Check**: electronics -> RoHS/EMC/LVD, toy -> EN 71, etc.

## Setup

### 1. Python Environment

```bash
# Create venv (already done)
.venv\Scripts\python.exe -m venv .venv

# Install dependencies (already done)
.venv\Scripts\python.exe -m pip install -r rag-service/requirements.txt
```

### 2. API Keys

```bash
cp rag-service/.env.example rag-service/.env
# Edit rag-service/.env and add your keys:
#   COHERE_API_KEY=...
#   ANTHROPIC_API_KEY=...
```

Get your keys:
- **Cohere**: https://dashboard.cohere.com/ (embed-multilingual-v3, rerank-multilingual-v3)
- **Anthropic**: https://console.anthropic.com/ (Claude Sonnet)

### 3. Qdrant Vector DB

```bash
# Start Qdrant
docker run -d --name qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant

# Initialize collections
.venv\Scripts\python.exe scripts/init_qdrant.py

# Ingest corpus
.venv\Scripts\python.exe scripts/build_corpus.py
```

### 4. Start Service

```bash
# Option A: use the batch script
scripts\start_rag.bat

# Option B: manual
.venv\Scripts\python.exe -m uvicorn rag_service.main:app --reload --port 8000
```

## API

### `POST /scan` - Compliance scan

**Request:**
```json
{
  "query": "充电宝出口欧盟需要哪些认证？",
  "product": "USB充电宝",
  "category": "electronics",
  "markets": ["EU", "US"],
  "vision_result": {}
}
```

**Response:**
```json
{
  "status": "PASS",
  "report": "## 合规要求\n\n根据 [REACH Article 22]...",
  "agent_trace": [
    {"node": "query_planner", "sub_queries_count": 2},
    {"node": "synthesis", "total_docs": 20, "unique_docs": 15},
    {"node": "generate", "chunks_count": 15},
    {"node": "verify", "status": "PASS", "attribution_score": 0.95}
  ],
  "loop_count": 0
}
```

### `GET /health` - Health check

### `GET /health/qdrant` - Qdrant status

### `POST /ingest` - Bulk ingest chunks

## Testing

```bash
.venv\Scripts\python.exe -m pytest rag_service/tests/ -v
```

All tests should pass (51 tests).

## Project Structure

```
rag_service/
├── main.py              # FastAPI entry point
├── config.py            # Settings (from .env)
├── parser/              # HTML/DOCX/PDF parsers
├── chunker/             # LegalChunker (Parent-Child)
├── retrieval/           # Cohere + BM25 + RRF + Rerank
├── verify/              # NLI Citation Verifier
├── generate/            # Claude Sonnet Report Generator
└── orchestrator/        # LangGraph Agentic RAG
    ├── state.py         # GraphState TypedDict
    ├── graph.py         # StateGraph assembly
    └── nodes/           # 7 graph nodes

scripts/
├── init_qdrant.py       # Qdrant collection setup
├── build_corpus.py      # Corpus -> chunks -> Qdrant pipeline
└── start_rag.bat        # Service startup script

data/corpus/
├── processed/           # 96 processed JSON files (in git)
└── (source files excluded from git)
```

## Notes

- Docker not available on this system - Qdrant deployment requires Docker Desktop
- API keys required for real service; DEMO_MODE=true for testing without keys
- Corpus already processed: 87/96 files with rawText (91% coverage)
