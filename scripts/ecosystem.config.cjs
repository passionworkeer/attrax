module.exports = {
  apps: [
    {
      name: "rag-service",
      cwd: "/opt/attrax",
      script: "/opt/attrax/.venv/bin/uvicorn",
      args: ["rag_service.main:app", "--host", "127.0.0.1", "--port", "8001", "--workers", "1"],
      interpreter: "none",
      max_memory_restart: "1300M",
      autorestart: true,
      env: {
        PYTHONUNBUFFERED: "1",
        // 2026-09-10: 真值只在服务器本地文件/环境，git 不携带（审计 4.1）
        // 2026-09-12: pydantic-settings reads rag_service/.env on import,
        // so when pm2 spawns this process without RAG_INTERNAL_SECRET
        // in its own env, the .env fallback keeps the gate configured.
        // To override, prefix the pm2 call: `RAG_INTERNAL_SECRET=… pm2 start …`.
        RAG_INTERNAL_SECRET: process.env.RAG_INTERNAL_SECRET || "",
        APP_ENV: "production",
      },
    },
    {
      name: "nextjs",
      cwd: "/opt/attrax/.next/standalone",
      script: "server.js",
      interpreter: "node",
      max_memory_restart: "768M",
      autorestart: true,
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        HOSTNAME: "127.0.0.1",
        RAG_SERVICE_URL: "http://127.0.0.1:8001",
        // 2026-09-10: 真值只在服务器本地文件/环境，git 不携带（审计 4.1）
        RAG_INTERNAL_SECRET: process.env.RAG_INTERNAL_SECRET || "",
        DAILY_FREE_SCAN_LIMIT: "3",
        DEMO_MODE: "false",
      },
    },
    {
      name: "portfolio",
      cwd: "/opt/portfolio/.next/standalone",
      script: "server.js",
      interpreter: "node",
      max_memory_restart: "512M",
      autorestart: true,
      env: {
        NODE_ENV: "production",
        PORT: "3002",
        HOSTNAME: "127.0.0.1",
        NEXT_PUBLIC_APP_URL: "https://resume.wangjianjun.xyz",
      },
    },
  ],
};
