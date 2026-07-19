module.exports = {
  apps: [
    {
      name: "rag-service",
      script: "/opt/attrax/.venv/bin/uvicorn",
      args: "rag_service.main:app --host 127.0.0.1 --port 8001 --workers 1",
      cwd: "/opt/attrax",
      interpreter: "none",
      env: {
        PYTHONUNBUFFERED: "1",
      },
      max_memory_restart: "1300M",
      out_file: "/var/log/attrax-rag.log",
      error_file: "/var/log/attrax-rag.err.log",
    },
    {
      name: "nextjs",
      script: "/opt/attrax/.next/standalone/server.js",
      cwd: "/opt/attrax/.next/standalone",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        HOSTNAME: "127.0.0.1",
        // 显式注入,避免 next 16 standalone 默认走 localhost (IPv6 优先,127.0.0.1
        // 走不通,nextjs fetch 不 fallback 直接 502)
        RAG_SERVICE_URL: "http://127.0.0.1:8001",
        RAG_INTERNAL_SECRET: "local-dev-shared-secret-attrax-2026",
        DAILY_FREE_SCAN_LIMIT: "3",
        DEMO_MODE: "false",
      },
      max_memory_restart: "500M",
      out_file: "/var/log/attrax-next.log",
      error_file: "/var/log/attrax-next.err.log",
    },
  ],
};
