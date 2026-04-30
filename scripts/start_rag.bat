@echo off
REM start_rag.bat - Start the RAG service

echo ====================================
echo   火鹰合规 RAG Service
echo ====================================

REM Check Python venv
if not exist ".venv\Scripts\python.exe" (
    echo ERROR: .venv not found. Run:
    echo   .venv\Scripts\python.exe -m venv .venv
    exit /b 1
)

REM Check .env
if not exist "rag-service\.env" (
    echo WARNING: rag-service\.env not found.
    echo Copy rag-service\.env.example to rag-service\.env and add your API keys.
)

REM Check Qdrant
curl -s http://localhost:6333/healthz > nul 2>&1
if errorlevel 1 (
    echo WARNING: Qdrant is not running.
    echo To start Qdrant:
    echo   docker run -d --name qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant
    echo.
)

echo Starting rag-service on http://localhost:8000
echo Press Ctrl+C to stop.

.venv\Scripts\python.exe -m uvicorn rag_service.main:app --reload --host 0.0.0.0 --port 8000
