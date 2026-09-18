const fs = require("fs");

// 端口单一来源 = scripts/ports.env，由 scripts/sync-ports.js 镜像成 ports.env.cjs
// 这里 require 进来。改端口只改 ports.env；不要在多处复制粘贴数字。
const PORTS = require("./ports.env.cjs");

// RAG_INTERNAL_SECRET 单一来源 = 服务器本地文件（真值不进 git，审计 4.1）。
// 2026-09-17 之前 rag-service 读 rag_service/.env、nextjs 读启动 pm2 时 shell
// 里 pin 住的 env，两个来源会静默分叉：rag_service/.env 里一个未轮换的弱值
// 让两端"一致地弱"，而文档声称已轮换 48-hex。现在两端都从这里取，缺文件即
// 抛错 → pm2 启动失败 → fail-closed 且响亮。
// 轮换：echo -n "<48-hex>" > /opt/attrax/.rag-internal-secret && chmod 600 … 后
//       pm2 startOrRestart scripts/ecosystem.config.cjs --only rag-service,nextjs
const RAG_INTERNAL_SECRET_FILE = "/opt/attrax/.rag-internal-secret";
const RAG_INTERNAL_SECRET = (
  process.env.RAG_INTERNAL_SECRET || (
    fs.existsSync(RAG_INTERNAL_SECRET_FILE)
      ? fs.readFileSync(RAG_INTERNAL_SECRET_FILE, "utf8")
      : ""
  )
).trim();

// fail-closed in production (real secret must come from the file on the server).
// In local dev the file is absent; fall back to a placeholder so `node` / tests
// can still require this module without crashing.
if (!RAG_INTERNAL_SECRET) {
  if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
    throw new Error(`RAG_INTERNAL_SECRET is empty (source: ${RAG_INTERNAL_SECRET_FILE})`);
  }
  console.warn(
    `[ecosystem.config.cjs] RAG_INTERNAL_SECRET missing (${RAG_INTERNAL_SECRET_FILE}); ` +
      "using dev placeholder. Production must set the real secret on the server."
  );
}

// ATTRAX_BUILD_SHA 单一来源 = /opt/attrax/.build-sha（apply-deploy.sh 从
// standalone/.build-sha 拷过来）。启动 rag-service 时读出来注入 env；
// 与 .deployed 保持一致，避免 /ready 与 audit 日志报旧 SHA。
const ATTRAX_BUILD_SHA_FILE = "/opt/attrax/.build-sha";
let ATTRAX_BUILD_SHA = "unknown";
try {
  ATTRAX_BUILD_SHA = fs.readFileSync(ATTRAX_BUILD_SHA_FILE, "utf8").trim() || "unknown";
} catch {
  // 文件不存在 = 旧部署没建过 → 用 env 兜底（CI 或手工启动）
  ATTRAX_BUILD_SHA = process.env.ATTRAX_BUILD_SHA || "unknown";
}

module.exports = {
  apps: [
    {
      name: "rag-service",
      cwd: "/opt/attrax",
      script: "/opt/attrax/.venv/bin/uvicorn",
      args: ["rag_service.main:app", "--host", "127.0.0.1", "--port", String(PORTS.RAG_PORT), "--workers", "1"],
      interpreter: "none",
      max_memory_restart: "1300M",
      autorestart: true,
      env: {
        PYTHONUNBUFFERED: "1",
        // env 段优先于 rag_service/.env（pydantic-settings 的 env > dotenv），
        // 因此 .env 里的同名旧值不会再遮蔽（该行已移除）。
        RAG_INTERNAL_SECRET,
        ATTRAX_BUILD_SHA,
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
        PORT: String(PORTS.NEXTJS_PORT),
        HOSTNAME: "127.0.0.1",
        RAG_SERVICE_URL: `http://127.0.0.1:${PORTS.RAG_PORT}`,
        // 同 rag-service：单一来源见文件头注释
        RAG_INTERNAL_SECRET,
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
        PORT: String(PORTS.PORTFOLIO_PORT),
        HOSTNAME: "127.0.0.1",
        NEXT_PUBLIC_APP_URL: "https://resume.wangjianjun.xyz",
      },
    },
    {
      // Feature 3: 法规自动更新 watchdog。2026-09-13 决定改成常驻 daemon —
      // pm2 cron_restart 只作用于 online 进程，单次跑完退出的 app 进 stopped
      // 态后不会重新拉起。调度改为 orchestrator 内部 sleep 循环
      // （ATTRAX_REGWATCH_RUN_AT，默认 03:00 服务器本地时区 =
      // Asia/Shanghai = 19:00 UTC），进程常驻、崩溃由 autorestart 兜底。
      // 单次 pass 退出码：0=无变化/仅 cosmetic；2=有真实变化待人工审阅
      // （pending_review.json）；3=部分源失败（errors.json）— auto_ingest
      // 默认开（ATTRAX_REGWATCH_AUTO_INGEST=true），真实变化自动入库，
      // 退出码改写为 0。具体见 scripts/watchdog/README.md 与 docs/WATCHDOG.md。
      name: "regwatch",
      cwd: "/opt/attrax",
      script: "/opt/attrax/.venv/bin/python",
      args: ["-m", "scripts.watchdog.orchestrator"],
      interpreter: "none",
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
