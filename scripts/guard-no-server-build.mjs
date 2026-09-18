#!/usr/bin/env node
/**
 * prebuild 守卫 — 拒绝在服务器部署目录里跑 `next build`。
 *
 * 2026-09-16 事故复盘:有人在 aliyun-sz 的 /opt/attrax 里直接 `npm run build`。
 * `next build` 一开跑就清空 `.next/`,连 pm2 正在跑的 `nextjs` 的 cwd
 * (`/opt/attrax/.next/standalone`) 一起删掉。进程不会立刻死(Linux 会保留被删
 * 目录的 inode),但 Node 是按需加载 chunk 的:
 *   - 已经加载进内存的路由照常 200(所以 /api/health 和首页看起来"没事")
 *   - 没加载到的路由一个接一个抛 ChunkLoadError / MODULE_NOT_FOUND →
 *     那些页面 500,前端渲染 branded「Runtime error / Something caught fire」
 *   - nginx `root .../standalone/public` 一起失效 → /complipilot/* 图片视频全 404
 *
 * 正确流程:本地构建 → `scripts/build-deploy-tarball.sh` 打包 →
 * scp 到 `aliyun-sz:/tmp/` → `bash /tmp/attrax-apply-deploy.sh`。
 *
 * 确需在该目录构建(例如刻意的灾难恢复):
 *   ATTRAX_ALLOW_SERVER_BUILD=1 npm run build
 */
import process from "node:process";

if (process.env.ATTRAX_ALLOW_SERVER_BUILD === "1") {
  process.exit(0);
}

const cwd = process.cwd();

if (cwd.startsWith("/opt/")) {
  console.error(
    [
      "",
      "\u2717 拒绝在服务器部署目录里执行 next build。",
      `  当前目录: ${cwd}`,
      "",
      "  next build 会清空 .next/,连带删掉 pm2 正在运行的 nextjs 的 cwd",
      "  (.next/standalone),导致线上大面积 ChunkLoadError / 500 / 图片 404。",
      "",
      "  正确做法:",
      "    本地:  npm run build && bash scripts/build-deploy-tarball.sh",
      "    上线:  scp /tmp/attrax-deploy-complete.tar.gz aliyun-sz:/tmp/",
      "           ssh aliyun-sz 'bash /tmp/attrax-apply-deploy.sh'",
      "",
      "  确需在此目录构建: ATTRAX_ALLOW_SERVER_BUILD=1 npm run build",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
