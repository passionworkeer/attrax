# 法规库全量扩展部署记录（2026-09-19）

## 部署前 vs 部署后

| 指标 | 部署前 | 部署后 |
|---|---|---|
| 法规档案（API `meta.total`） | 124 | **1052** |
| 覆盖区域（API `meta.markets`） | 21 | **25** |
| 抓取源（API sources） | 37 | 37 |
| 近期动态 | 60 | 60 |
| BUILD_ID | `YU8SNxMLjsyFVHcWswvRm`（ddc9967） | `zc4WtGp16QVZWuRl3ulj6`（fd17bd1） |
| commit | `f1f3ccf`（git HEAD 滞后） | `fd17bd1`（HEAD = fd17bd1） |

新增条目来源：
- **attrax-docs 增量**：5 条（EMC / GDPR / GPSR / LVD / REACH / RED / RoHS / 玩具安全 / 新电池法规解读 /
  外资审查 / Saber-SASO / PDPA 2010 这 12 条 manifest 中，7 条已存在跳过，5 条新增）
- **regulation-raw 全量**：920 条（CN 235 / US 380 / EU 85 / GLOBAL 71 / DE 36 / CA 28 / JP 12 /
  AU 12 / SG 12 / UK 11 / BR 6 / VN 6 / MY 5 / NZ 5 / IN 5 / ID 4 / SA 3 / TH 3 / KR 3 /
  AE 2 / GCC 1 / UN 5 / IT 3 / FR 1 / MX 1）
- **服务器 watchdog 既有**：3 条 UK 法规（保留）

## 部署步骤

1. **本地 build**：`ATTRAX_TARBALL=docs/evidence/.../attrax-deploy-fd17bd1.tar.gz bash scripts/build-deploy-tarball.sh`
   - BUILD_ID `zc4WtGp16QVZWuRl3ulj6` / commit `fd17bd1` / 59MB tarball
2. **scp**：`scp tarball aliyun-sz:/tmp/attrax-deploy-complete.tar.gz`（61.6MB 压缩传输）
3. **apply-deploy.sh**：`ssh aliyun-sz 'bash /tmp/attrax-apply-deploy.sh'`
   - 解包 standalone / 备份当前 standalone / 重渲染 nginx vhost / pm2 restart nextjs /
     health gate OK after 2 attempts
4. **additive rsync 法规库**：`rsync -avz --exclude='regulations_index.json' /Users/wangjianjun/me/attrax/data/regulations/ aliyun-sz:/opt/attrax/data/regulations/`
   - 214MB 传输 / 服务器 409MB 总 raw/（重叠文件不重复传）
5. **scp 更新脚本**：服务器 git HEAD 落后，`scripts/import_regulation_docs.py` 和
   `scripts/watchdog/auto_ingest.py`（含 domain 字段重建索引能力）必须用 fd17bd1 版本
6. **重建索引**：`python3 scripts/rebuild_index_server.py`（临时脚本）
   → `AutoIngestor._rebuild_index()` 读 25 个区域的 YAML 写 regulations_index.json

### 为什么不用 import_regulation_docs.py 重建索引

`import_regulation_docs.py` 从 manifest 的 `source_root` 读原件做校验，但服务器上没有
`/Users/wangjianjun/me/regulation-raw` 和 `/Users/wangjianjun/me/attrax-docs`（本地工作区）。
直接调 `_rebuild_index()` 跳过原件校验 — raw/ 已通过 rsync 同步到服务器，YAML 已 rsync，
重建索引不需要再读原件。

## 服务器实测（API ground truth）

```
$ ssh aliyun-sz 'curl http://localhost:3000/api/health'
{"timestamp":"2026-09-19T08:08:10Z","frontend":"ok","scanService":{"status":"ok","responseTimeMs":20,"error":null},"demoMode":false}

$ ssh aliyun-sz 'curl http://localhost:3000/api/regulations/archive?limit=3'
{
  "success": true,
  "meta": {"total": 1052, "markets": 25, "withArticles": 36, "generatedAt": "2026-09-19"},
  "data": [...]   # 前 3 个是 articleCount 最高的锚点（domain=null，9-19 批次老条目）
}

$ ssh aliyun-sz 'curl http://localhost:3000/api/regulations/archive?market=us&limit=200'
meta.matching = 400    # US 区域 400 条（之前 20 条）
```

US 区域 `has_CFR=true` / `has_US_CPSC=true`，本批次新增的 US-CFR-* 已入库。

## 客户端渲染验证

`/regulations` 页面副标题数字绑定 `useState stats`（`fetchAll` 完成后填充），SSR HTML 里
数字是占位符。**Desktop app preview 浏览器连接 localhost:3001 dev server**，无法
navigate 到 `https://h2.twinbuddy.xyz/regulations`（preview 工具只服务于本机 dev server），
所以 preview snapshot 显示的是 dev 缓存（1049），不是 prod（1052）。prod 数字以
server-side API 为准。

## 文件归档

| 文件 | 用途 |
|---|---|
| `verify.md` | 改动概要 + 本地 pytest 验证 + dev 验证 |
| `attrax-deploy-fd17bd1.tar.gz` | 部署 tarball（59MB），已部署后可清理 |
| `rebuild_index_server.py` | 服务器端重建索引的临时脚本（一次性） |
| `deploy-1-build.log` | `build-deploy-tarball.sh` 输出 |
| `deploy-2-apply.log` | `apply-deploy.sh` 输出 |
| `deploy-3-rsync.log` | `rsync` 输出 |
| `deploy-4-import.log` | `import_regulation_docs.py` 在服务器上的失败日志（source_root 错误） |
| `deploy-5-rebuild.log` | `_rebuild_index()` 输出 + 索引摘要 |
| `deploy-6-verify.log` | curl 验证（被 ssh banner 误导，校验方法需调整） |
| `deploy-6b-verify.log` | 服务器直 curl /api/health + /api/regulations/archive |
| `deploy-7-ssr.log` | SSR HTML 检查（stats 占位符是 client-side dynamic 设计） |
| `import-2-regulation-raw.log` | 本地 import 920 条输出 |

## 服务器侧遗留

- 服务器 git HEAD 仍落后于 origin/main（fd17bd1），CLAUDE.md §"部署"明确这是设计：
  deploy 只同步 runtime 产物，不 `git pull`。
- `ATTRAX_BUILD_SHA` 在 `rag_service/.env` 仍是历史值（40 字符 hex），未与
  `.deployed` 同步。CLAUDE.md §"部署"§"运维"提到 `.build-sha` 链路但 `.deployed`
  此前一直不存在 —— 这次 `apply-deploy.sh` 在 standalone/.deployed 写入了 `commit=fd17bd1 build_id=zc4WtGp16QVZWuRl3ulj6`，下次 rag-service 重启会从 .build-sha 读取。
- `regwatch` 进程在跑，运行时已 import 旧版 auto_ingest.py。下次 regwatch 重启才会
  加载新版（带 domain 字段的 _rebuild_index），不影响本次部署（索引已显式重建）。