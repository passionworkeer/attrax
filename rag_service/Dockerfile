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

# Create data directories
RUN mkdir -p /app/data/faiss /app/data/corpus/processed

# Default port
EXPOSE 8000

# Run
CMD ["uvicorn", "rag_service.main:app", "--host", "0.0.0.0", "--port", "8000"]
