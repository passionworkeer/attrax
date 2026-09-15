# Next.js 16 + Turbopack Standalone 部署笔记（attrax）

> 创建：2026-09-11 — 记录 2026-09-10/11 事故后修复的 attrax 部署真相。
> 实际生产部署路径见本文件（legacy aliyun-sz 路径的 DEPLOY-CHECKLIST.md 已删除；部署入口是 `docs/README.md` §生产部署 + 仓库 CLAUDE.md §部署雷区）。
> lighthouse 上其他 Next 16 站点的等价文档：work 仓 `ops/NEXTJS-16-DEPLOYMENT-NOTES.md`。

## TL;DR

1. **Next 16 + Turbopack 的 `output: "standalone"` 不再把 `.next/static/` 拷进 `standalone/`**。chunks/css/media 留在构建根 `.next/static/`。这是 attrax 之前 `/_next/static/*` 404 的根因。
2. **nginx 已改为 `alias` 模式**：直接指 `/opt/attrax/.next/static/`，不再依赖 `standalone/_next -> .next` 软链（软链在 rsync --delete 后会指向过期 .next/）。
3. **`/opt/attrax/.next/standalone/public/` 必须 rsync** —— 2026-09-10 修复前是空的，导致 `/complipilot/ocean-hero.mp4` + `/complipilot/ocean-poster.png` 404，页面看不到关键演示资源。
4. **`images: { unoptimized: true }` 已开启**（attrax `next.config.ts`）—— 多图站策略，绕过 sharp 跨平台 native binary 坑。
5. **死脚本 `attrax-engagement.js` sub_filter 已移除**（2026-09-10 修复）—— 文件已不存在，但 nginx 还在每页 `</body>` 注入 `<script src>` 导致 console 反复 404。

## 服务器实际布局

```
/opt/attrax/
├── .next/
│   ├── standalone/                  # ← pm2 启动 cwd（server.js + manifest + package.json + node_modules）
│   ├── static/                  # ← nginx 直接 alias 出来（chunks/css/media）
│   └── BUILD_ID                 # build 身份（debug 用）
└── public/                      # 源 public/（rsync 后 standalone/public 才是运行用的）
```

`standalone/.next/` 在 Next 16 下只有 manifest 类文件（BUILD_ID、prerender-manifest.json、required-server-files.json 等），**没有 static/ 子目录**。attrax 之前默认 nginx 站配通过 `root /opt/attrax/.next/standalone` 映射 `/_next/static/...` → 文件系统 `standalone/_next/static/`（少一层 `.next`），所以永远 404。

## nginx 站配（当前正确版本）

参考 `/etc/nginx/snippets/attrax-locations.conf`（在 commit `99f345d` 提交到本仓 `docs/infra/nginx-attrax-locations.conf`）。要点：

```nginx
location ^~ /_next/static/ {
    alias /opt/attrax/.next/static/;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
location ^~ /_next/data/ {
    alias /opt/attrax/.next/static/;
    add_header Cache-Control "public, max-age=0, must-revalidate";
}

# /complipilot/* 全部静态（含 ocean-hero.mp4，2026-09-10 修复）
location ~ ^/complipilot/.+\.(png|webp|mp4)$ {
    root /opt/attrax/.next/standalone/public;
    try_files $uri =404;
    expires 30d;
    add_header Cache-Control "public, max-age=2592000";
}

# 其他：API health/scan 限流 + 代理到 :3000（详见 snippet）
```

**两侧尾斜杠都不能省**（location 末尾 + alias 末尾）。省一个就匹配错位。

`docs/infra/nginx-attrax-locations.conf` 在 attrax 仓 `99f345d` commit 与服务器 `/etc/nginx/snippets/` 同步。修改时两边都要更新：
```bash
scp docs/infra/nginx-attrax-locations.conf lighthouse:/tmp/
ssh lighthouse 'sudo cp /tmp/nginx-attrax-locations.conf /etc/nginx/snippets/ && \
  sudo cp /etc/nginx/snippets/attrax-locations.conf /etc/nginx/snippets/attrax-locations.conf.bak-$(date +%s) && \
  sudo nginx -t && sudo systemctl reload nginx'
```

## 部署标准流程

```bash
# 本地构建
cd attrax
pnpm build

# rsync 三件事
rsync -avz --delete .next/standalone/  lighthouse:/opt/attrax/.next/standalone/
rsync -avz --delete .next/static/      lighthouse:/opt/attrax/.next/static/
rsync -avz --delete public/            lighthouse:/opt/attrax/.next/standalone/public/

# 预压缩
ssh lighthouse "cd /opt/attrax/.next/static && \
  find . \\( -name '*.js' -o -name '*.css' \\) -print0 | \
  while IFS= read -r -d '' f; do \
    gzip -9 -kc \"\$f\" > \"\$f.gz\" && brotli -q 11 -c \"\$f\" > \"\$f.br\"; \
  done"

# 重启（仅代码变更）
ssh lighthouse 'pm2 restart nextjs && pm2 save'
```

### ⚠️ 容易漏

| 漏了就 | 症状 |
|---|---|
| `public/` rsync | `/complipilot/*` + favicon 404 |
| `.next/static/` rsync | 全部 chunks/css/字体 404 |
| `pm2 restart`（不是 reload）| 进程内仍是旧代码 |

### env 改了怎么办

`pm2 restart` **不重读 ecosystem env 段**。改 env 后必须 `pm2 delete && start`：

```bash
ssh lighthouse 'cd /opt/attrax && \
  pm2 delete nextjs && \
  pm2 start scripts/ecosystem.config.cjs && \
  pm2 save'
```

参考案例：2026-09-10 MiniMax key 轮换、ModelScope → PAI 切换、RAG_INTERNAL_SECRET 轮换 —— 全是 `delete && start` 才生效。

## 图片优化策略（attrax 多图站）

attrax `next.config.ts`：

```ts
const nextConfig: NextConfig = {
  images: { unoptimized: true },   // sharp 跨平台坑，多图已 webp
  ...
}
```

**为什么不装 sharp**：本地 macOS arm64 build 把 `@img/sharp-darwin-arm64` 打进 standalone node_modules；linux-x64 服务器加载 `invalid ELF header`。要装 sharp 需：
1. 在 linux 上 build
2. 或 `optionalDependencies: ['@img/sharp-linux-x64']`

attrax 多图但已 webp，`unoptimized: true` 让 next/image 直接 `<img src=...>`，HTML 不会引用 `/_next/image`。`/_next/image` 路由仍存在但无人调用。

## 历史教训

attrax 在 2026-09-10 之前长期处于 `/_next/static/*` 404 状态，但 handoff 说"attrax 200" —— 实际只 curl 了 HTML。**Lighthouse 分数 100/100/100/100 也是骗人的**：SSR HTML + 侧栏文本 LCP 撑住分数，真浏览器页面是裸 HTML + 缺图。

修后 smoke test 必须覆盖真实资源：
```bash
curl -sIk https://wangjianjun.xyz/                          | head -1
curl -sIk "https://wangjianjun.xyz/_next/static/chunks/<H>.js" | head -1
curl -sIk "https://wangjianjun.xyz/_next/static/media/<H>.woff2" | head -1
curl -sIk https://wangjianjun.xyz/complipilot/ocean-poster.png | head -1
curl -sIk https://wangjianjun.xyz/complipilot/ocean-hero.mp4   | head -1
curl -sIk https://wangjianjun.xyz/api/health                  | head -1
```

## 移动端状态

2026-09-11 修复后：97 / 100 / 100 / 100（A11y 96→100 是 footer `proofItems b` contrast 修好的功劳）。

`components/complipilot/{homepage,flow-shell,scan-image-stage,bright-flow}.module.css` 的 `@media (max-width: 820px)` 断点处理 hero/stats/proof/aboutDialog 等的 mobile 布局；attrax 移动体验已可用。

## 跨仓库参考

- work 仓等价文档：`work/ops/NEXTJS-16-DEPLOYMENT-NOTES.md`
- 内存笔记（自动加载）：`~/.claude/projects/-Users-wangjianjun-me/memory/portfolio-deploy-learnings.md`
- nginx 站配快照（已与服务器同步）：`docs/infra/nginx-attrax-locations.conf`
- 完整审计历史：`docs/plans/2026-09-09-optimization-audit.md`