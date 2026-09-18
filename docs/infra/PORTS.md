# Attrax 端口分配表

> 单一来源 = [`scripts/ports.env`](../../scripts/ports.env)。本文档是分配台账；改端口先改 ports.env，再按 [ALIYUN-SZ-DEPLOY.md §4.4](./ALIYUN-SZ-DEPLOY.md) 流程部署。

## 生产（aliyun-sz）

| 端口 | 用途 | 消费方 |
|------|------|--------|
| 3000 | attrax nextjs（standalone server.js） | `ecosystem.config.cjs` `PORT` + nginx `upstream attrax_nextjs`（render 注入） |
| 8001 | rag-service（uvicorn） | `ecosystem.config.cjs` args + nextjs `RAG_SERVICE_URL` |
| 3002 | portfolio nextjs | `ecosystem.config.cjs` `PORT` |

## 本地开发

| 端口 | 用途 |
|------|------|
| 3000 | 前端 dev server（`npm run dev`） |
| 8001 | RAG service（`uvicorn --port 8001`；docker-compose 映射 `127.0.0.1:8001:8000`） |

## 历史（已作废，勿再引用）

- ~~nextjs 3001 / rag 8002（aliyun-sz"端口偏移避免与 LabMemory 撞车"）~~ —— LabMemory 已于 2026-09-18 退役；且实际 ecosystem 从未偏移过，nginx 照旧文档写 3001 直接导致 2026-09-18 全站 502。此后端口只认 ports.env。
- ~~8081 / 8001（LabMemory）~~ —— 服务已下线。

## 改端口流程

```bash
vim scripts/ports.env                  # 唯一入口
node scripts/sync-ports.js             # 镜像 ports.env.cjs
bash scripts/render-nginx-vhost.sh --check
bash scripts/build-deploy-tarball.sh   # ops/ 随包走，apply-deploy 安装 + 重渲染 nginx + startOrRestart pm2
```
