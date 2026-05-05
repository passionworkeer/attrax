@echo off
cd /d "%~dp0"
set PYTHONPATH=%cd%
set FAISS_INDEX_DIR=C:\temp\faiss_index
start "RAG-Service" cmd /c "python -m uvicorn rag_service.main:app --host 0.0.0.0 --port 8001"
echo RAG service starting on http://localhost:8001
