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
if not exist "rag_service\.env" (
    echo WARNING: rag_service\.env not found.
    echo Copy rag_service\.env.example to rag_service\.env and add your API keys.
)

REM FAISS index path (auto-detected by service from FAISS_INDEX_DIR env or default)
set FAISS_INDEX_DIR=%cd%\data\faiss
if not exist "%FAISS_INDEX_DIR%\legal_chunks.index" (
    echo WARNING: FAISS index not found at %FAISS_INDEX_DIR%
    echo Run scripts\build_faiss.py to build the index first.
    echo.
)

echo FAISS_INDEX_DIR=%FAISS_INDEX_DIR%
echo Starting rag-service on http://localhost:8001
echo Press Ctrl+C to stop.

.venv\Scripts\python.exe -m uvicorn rag_service.main:app --reload --host 0.0.0.0 --port 8001
