#!/usr/bin/env bash
# SSH 通后立刻可以跑的部署脚本（一次性，不是 idempotent）
# 用法：ssh root@203.0.113.10 'bash -s' < scripts/deploy-now.sh
set -euo pipefail

ATTRAX=/opt/attrax
cd "$ATTRAX"

log() { echo "[$(date -Iseconds)] $*"; }

# === §1 健康基线：现在的部署是什么状态？ ===
log "=== §1 当前部署状态 ==="
node_modules/pm2/bin/pm2 list || true
echo "--- git ---"
git log --oneline -3
git status --short
echo "--- disk / mem ---"
df -h /opt/attrax | tail -2
free -m
echo "--- env (只显示 key 名,不显示 value) ---"
sed -E 's/=(.+)/=***/' /opt/attrax/.env | grep -E '^(MINIMAX|MODELSCOPE|RAG_|DEMO_MODE|PORT|HOSTNAME)' || true

# === §2 FAISS 索引 ===
log "=== §2 FAISS 索引检查 ==="
ls -lh /opt/attrax/data/faiss/ 2>&1 || log "FAISS 目录缺失"
if [[ ! -f /opt/attrax/data/faiss/legal_chunks.index ]]; then
  log "FAISS 索引缺失,需要重建"
  log "（脚本不自动重建,因为 MODELSCOPE_API_KEY 走云端 embedding,需要用户在场）"
  log "命令：cd $ATTRAX && D:\python\python.exe scripts/build_faiss.py"
  log "建议先 split_meta_to_shards 避免 1.6GB 内存爆:"
  log "  python -c 'from rag_service.retrieval.faiss_retriever import FaissRetriever; FaissRetriever.split_meta_to_shards(\"data/faiss/legal_chunks_meta.json\", 50)'"
fi

# === §3 停 RAG → build Next.js（必须先停,见 SERVER-OPS §5.4）===
log "=== §3 停 rag-service ==="
node_modules/pm2/bin/pm2 stop rag-service || true
sleep 5
free -m | awk '/Mem:/ {print "available after stop: " $7 " MB"}'

log "=== §3.1 build Next.js ==="
chown -R admin:admin "$ATTRAX"
su admin -c "rm -rf .next/standalone/data && NODE_OPTIONS=--max-old-space-size=1024 npm ci --omit=dev && NODE_OPTIONS=--max-old-space-size=1024 npm run build"

# === §4 拷贝产物 ===
log "=== §4 拷贝构建产物到 standalone ==="
su admin -c 'set -e
  rm -rf .next/standalone/.next/static .next/standalone/public .next/standalone/.env
  cp -r .next/static .next/standalone/.next/static
  cp -r public .next/standalone/public
  cp .env .next/standalone/.env'
chown -R root:root /opt/attrax/.next/standalone
chmod 600 /opt/attrax/.next/standalone/.env

# === §5 启动服务 ===
log "=== §5 启动 pm2 ==="
cd "$ATTRAX"
node_modules/pm2/bin/pm2 start /opt/attrax/scripts/ecosystem.config.cjs
sleep 15
node_modules/pm2/bin/pm2 list

# === §6 端到端验证 ===
log "=== §6.1 健康检查 (内网) ==="
curl -s http://127.0.0.1:8001/health | python3 -m json.tool || log "RAG /health 失败"
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool || log "Frontend /api/health 失败"

log "=== §6.2 公网健康检查 ==="
curl -s https://203.0.113.10/api/health | python3 -m json.tool || log "公网健康检查失败"

log "=== §6.3 真实扫描端到端 ==="
python3 -c "import base64; open('/tmp/pixel.png','wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='))"
SID=$(curl -s -X POST http://127.0.0.1:3000/api/scan \
  -F "category=electronics" \
  -F "markets=EU" \
  -F "images=@/tmp/pixel.png;type=image/png")
echo "scan POST: $SID" | head -c 500
echo

log "=== 部署脚本完成 ==="
log "接下来:用户从 SID JSON 提取 sessionId + accessToken,跑轮询:"
log '  curl -s http://127.0.0.1:3000/api/scan/<sessionId> -H "Authorization: Bearer <accessToken>"'
log "成功标志: status=ready, result.source=real, complianceReport 非空"