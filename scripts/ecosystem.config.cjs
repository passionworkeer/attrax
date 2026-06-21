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
      max_memory_restart: "900M",
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
        HOSTNAME: "0.0.0.0",
      },
      max_memory_restart: "500M",
      out_file: "/var/log/attrax-next.log",
      error_file: "/var/log/attrax-next.err.log",
    },
  ],
};
