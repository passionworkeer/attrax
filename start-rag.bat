@echo off
cd /d "%~dp0"
title 火鹰合规 RAG Service

echo ====================================
echo   火鹰合规 RAG Service
echo ====================================

REM Configure FAISS index location
REM   Dev:  defaults to data/faiss/ (relative to project root)
REM   Prod: set FAISS_INDEX_DIR env var to an absolute path
REM The service auto-handles non-ASCII paths (Chinese chars) internally.
if not defined FAISS_INDEX_DIR (
    set FAISS_INDEX_DIR=%cd%\data\faiss
)

REM Check FAISS index
if not exist "%FAISS_INDEX_DIR%\legal_chunks.index" (
    echo WARNING: FAISS index not found at %FAISS_INDEX_DIR%
    echo Run: scripts\build_faiss.py
    echo.
)

echo FAISS_INDEX_DIR=%FAISS_INDEX_DIR%
echo Starting rag-service on http://localhost:8001
echo Press Ctrl+C to stop.
echo.

REM Prefer local virtual environments, then fall back to Python on PATH.
set "PYTHON=%~dp0.runvenv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=%~dp0rag_service\.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"

"%PYTHON%" -m uvicorn rag_service.main:app --host 0.0.0.0 --port 8001
