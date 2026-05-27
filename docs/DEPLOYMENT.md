# Attrax Server Deployment

This project deploys as two services:

- `web`: Next.js production server on port `3000`
- `rag-service`: FastAPI RAG service on port `8000` inside Docker, exposed as `8001`

## 1. Server Prerequisites

- Docker Engine with Docker Compose
- 4 GB+ RAM for basic demo mode; more RAM is recommended when FAISS is loaded
- Open ports: `3000` for web, optional `8001` for direct RAG diagnostics
- API keys for mimoTalk LLM and ModelScope embedding

## 2. Prepare Environment

From the project root:

```bash
cp .env.production.example .env
```

Edit `.env`:

```env
MIMOTALK_API_KEY=your_real_key
MODELSCOPE_API_KEY=your_real_key
DEMO_MODE=false
RAG_ALLOWED_ORIGINS=https://your-domain.example.com
```

If you are testing without real API keys, set:

```env
DEMO_MODE=true
```

## 3. Prepare RAG Data

The RAG container expects these host directories to exist:

```text
data/faiss/legal_chunks.index
data/faiss/legal_chunks_meta.json
data/corpus/processed/
```

If the FAISS index is missing, rebuild it before deployment:

```bash
python scripts/build_faiss.py
```

The compose readiness check uses `/ready`, so `rag-service` will stay unhealthy until FAISS and BM25 are loaded.

## 4. One-Command Deployment

```bash
npm run deploy:prod
```

This runs deployment preflight checks and then executes `docker compose up -d --build`.
Equivalent wrappers are available as `sh scripts/deploy.sh` and `powershell -File scripts/deploy.ps1`.

Check status:

```bash
docker compose ps
docker compose logs -f web
docker compose logs -f rag-service
```

Health checks:

```bash
curl http://localhost:3000/api/health
curl http://localhost:8001/ready
```

## 5. Reverse Proxy

Point your domain to the `web` service. A minimal Nginx upstream:

```nginx
server {
    listen 80;
    server_name your-domain.example.com;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Use HTTPS in production, then set:

```env
RAG_ALLOWED_ORIGINS=https://your-domain.example.com
```

## 6. Production Notes

- `RAG_SERVICE_URL` is set inside compose to `http://rag-service:8000`; do not change it to `localhost` inside Docker.
- Embedding is API-only through `MODELSCOPE_API_KEY`; Ollama/local model variables are ignored.
- LLM and vision are API-only through `MIMOTALK_API_KEY`.
- `data/sessions` and `public/uploads` are mounted so runtime files survive container restarts.
- `data/faiss` and `data/corpus/processed` are mounted read-only because they are deployment artifacts.

## 7. Update Deployment

```bash
git pull
npm run deploy:prod
docker compose ps
```

If the corpus changes, rebuild FAISS first and then restart:

```bash
python scripts/build_faiss.py
docker compose restart rag-service web
```
