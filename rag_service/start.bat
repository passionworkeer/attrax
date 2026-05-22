@echo off
cd /d D:\Data\Desktop\h\attrax
call .venv\Scripts\activate.bat
python -m uvicorn rag_service.main:app --host 127.0.0.1 --port 8000