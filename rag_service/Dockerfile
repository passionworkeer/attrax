FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Create data directories
RUN mkdir -p /app/data/faiss /app/data/corpus/processed

# Default port
EXPOSE 8000

# Run
CMD ["uvicorn", "rag_service.main:app", "--host", "0.0.0.0", "--port", "8000"]