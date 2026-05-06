@echo off
cd /d "%~dp0"
title 火鹰合规

echo ====================================
echo   火鹰合规 - All Services
echo ====================================

REM Start RAG service in background (FAISS_INDEX_DIR defaults to %cd%\data\faiss)
echo [1/2] Starting RAG service on port 8001...
start "火鹰合规 RAG" cmd /c "cd /d %~dp0 && D:\python\python.exe -m uvicorn rag_service.main:app --host 0.0.0.0 --port 8001"

REM Wait a moment for RAG to start
timeout /t 3 /nobreak >nul

REM Start Next.js dev server
echo [2/2] Starting Next.js on http://localhost:3000...
start "火鹰合规 Frontend" cmd /c "npm run dev"

echo.
echo ====================================
echo   All services started!
echo   Frontend:  http://localhost:3000
echo   RAG:       http://localhost:8001
echo ====================================
