FROM python:3.10-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for caching
COPY rag_service/requirements-prod.txt ./requirements-prod.txt
RUN pip install -r requirements-prod.txt

# Copy source code
COPY . .

# Create data directories and a non-root user, then hand ownership.
# uvicorn must not run as root: a container escape would yield root inside
# the pod, so we drop to UID 1001 (attrax) for the runtime.
# De-RAG §7.7: data/faiss/ no longer exists. Keep data/regulations/ for
# the 44-YAML regulation library + KB anchors + corpus processed/ that
# stays as the download-asset source.
RUN mkdir -p /app/data/regulations /app/data/corpus/processed /app/data/kb/anchors /app/data/backend \
    && (getent group attrax >/dev/null 2>&1 || groupadd -r attrax) \
    && (id -u attrax >/dev/null 2>&1 || useradd -r -u 1001 -g attrax -m -d /home/attrax attrax) \
    && chown -R attrax:attrax /app

# Default port
EXPOSE 8000

# Drop privileges for the runtime process
USER attrax

# Run
CMD ["uvicorn", "rag_service.main:app", "--host", "0.0.0.0", "--port", "8000"]
