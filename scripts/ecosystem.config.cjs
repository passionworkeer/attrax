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
        // De-RAG has no retriever output; regulation-library articles are the
        // production evidence input for image-only scans. Allow an explicit
        // operator override, but keep the deployed default usable.
        USE_KB_INPUT: process.env.USE_KB_INPUT || "true",
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
    {
      // Feature 3: 法规自动更新 watchdog。单次运行后退出（exit 0/2/3），
      // 由 pm2 cron_restart 每天 03:00 UTC 拉起 — 不用 APScheduler、无常驻
      // Python 进程。退出码：0=无变化/仅 cosmetic；2=有真实变化待人工
      // 审阅（data/regulation_supplements/watchdog-{date}/pending_review.json）；
      // 3=部分源失败（errors.json）。注意 pm2 会把非 0 退出码记为 errored
      // 再按 cron 拉起 — 这是预期行为，看 pm2 logs regwatch 即可。
      name: "regwatch",
      cwd: "/opt/attrax",
      script: "/opt/attrax/.venv/bin/python",
      args: ["-m", "scripts.watchdog.orchestrator"],
      interpreter: "none",
      // 2026-09-13: cron_restart never fired — pm2 的 cron 只作用于 online
      // 进程，单次跑完退出的 app 进 stopped 态后不会被唤醒。调度改为
      // orchestrator 内部 sleep 循环（ATTRAX_REGWATCH_RUN_AT，默认 03:00
      // 服务器本地时区 = Asia/Shanghai = 19:00 UTC），进程常驻、崩溃由
      // autorestart 兜底。
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: "/opt/attrax",
        ATTRAX_REGWATCH_ENABLED: process.env.ATTRAX_REGWATCH_ENABLED || "true",
        ATTRAX_REGWATCH_NOTIFY: process.env.ATTRAX_REGWATCH_NOTIFY || "log",
        ATTRAX_REGWATCH_RUN_AT: process.env.ATTRAX_REGWATCH_RUN_AT || "03:00",
      },
    },
  ],
};
