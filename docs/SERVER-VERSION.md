# 服务器版本对账 — 2026-07-18

> 服务器 `120.77.36.107` 当前跑的是哪份代码?跟哪个 git ref 一致?
> 改了之后怎么知道已经同步?出问题时怎么回到上一个状态?

## 1. 当前线上版本

| 项 | 值 |
|---|---|
| 服务器 | `admin@120.77.36.107` (ssh 端口默认 22, ed25519 密钥) |
| 部署目录 | `/opt/attrax/` |
| PM2 nextjs PID | `255979` (每次重启会变) |
| PM2 rag-service PID | `243479` (本次部署时已 8h uptime,本次未重启) |
| 当前 BUILD_ID | `E8R5GGlcbH9UZoNgsFsmq` |
| 对应 commit | `db3a54b` (codex/backend-decoupling) |
| 对应 git ref | `origin/codex/backend-decoupling` |
| 上一个 BUILD_ID(回滚点) | `6vo9eDne-1LDAgD903V2c` |
| 上一个对应 commit | `7e7bc95` (PDF/DOCX 浏览器端导出,首次) |
| 当前 commit message | `fix(frontend): 修复浏览器端 PDF/DOCX 下载真正失败的两个根因` |

## 2. git ref 关系图

```
origin/codex/backend-decoupling
└── 7e7bc95 (上一版: 浏览器端 PDF/DOCX 导出)
    └── db3a54b (当前: 修复 detached anchor + fonts/ 缺失 + financialSummary 兜底)
        ↑
        └── 现在服务器上的 /opt/attrax 跟这个 commit 完全一致(源码)
            但 .next/standalone 是本地新 build (BUILD_ID E8R5GGlcbH9UZoNgsFsmq)
```

> 服务器 `/opt/attrax` 不是 git repo (tarball 部署)。
> `git ls-files` 在服务器上跑会报 `fatal: not a git repository`。
> 因此"线上代码 = 哪个 commit"是通过**手动从本仓 commit 推送 + BUILD_ID 匹配**来对账的。

## 3. 怎么验证一致性

### 3.1 在线检查(必跑)

```bash
# 1. 服务器 BUILD_ID
ssh admin@120.77.36.107 'cat /opt/attrax/.next/standalone/.next/BUILD_ID'
# 期望: E8R5GGlcbH9UZoNgsFsmq

# 2. 本地仓 HEAD commit
git -C D:/Data/Desktop/attrax rev-parse HEAD
# 期望: db3a54b... (完整 hash)

# 3. BUILD_ID ↔ commit 一致
git -C D:/Data/Desktop/attrax log --all --oneline | grep db3a54b
# 期望: 能找到 db3a54b fix(frontend): 修复浏览器端 PDF/DOCX 下载真正失败的两个根因

# 4. 关键 API 行为
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/health
# 期望: 200

curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/api/report/demo/profit?format=pdf&lang=zh"
# 期望: 400 (BINARY_EXPORT_REMOVED) — 不是 500

curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/api/report/demo/profit?format=md&lang=zh"
# 期望: 200

# 5. fonts 资源(浏览器端 PDF 必需)
curl -s -o /dev/null -w "%{http_code}\n" "https://www.twinbuddy.xyz/fonts/NotoSansSC-Regular.ttf"
# 期望: 200 (不是 404)

# 6. 真实验证下载(本地 chrome headless)
node D:/Data/Desktop/attrax/e2e-download.mjs
# 期望: "OK 成本利润分析报告_demo.pdf size=618968"
```

### 3.2 离线检查(看 build 产物在不在)

```bash
# 服务器源码覆盖文件 (7 个)
ssh admin@120.77.36.107 'ls -la \
  /opt/attrax/app/api/report/\[sessionId\]/\[reportType\]/route.ts \
  /opt/attrax/app/profit/\[sessionId\]/page.tsx \
  /opt/attrax/app/profit/\[sessionId\]/profit-export-panel.tsx \
  /opt/attrax/app/result/\[sessionId\]/page.tsx \
  /opt/attrax/app/result/\[sessionId\]/result-export-button.tsx \
  /opt/attrax/lib/reporting.ts'
# 期望: 6 个文件都在(generate_report_file.py 已删,不再列出)

# 旧 .next/standalone/.next/static/ 还在
ssh admin@120.77.36.107 'ls /opt/attrax/.next/standalone/.next/static/ | head -5'
# 期望: chunks/  media/  等

# 不应再有 generate_report_file.py
ssh admin@120.77.36.107 'ls /opt/attrax/.next/standalone/scripts/ 2>&1'
# 期望: ls: cannot access ... (已删干净)
```

### 3.3 一键脚本

```bash
bash D:/Data/Desktop/attrax/scripts/organize-and-test.sh
```

会跑 e2e 检查清单,把结果写到 `/tmp/organize-*.log`。
关键看 BUILD_ID 行 = `expected=8yIFraqxGih3H_gxvEx8i actual=6vo9eDne-1LDAgD903V2c`
(注: organize-and-test.sh 是上版本写的,expected 字段是旧 BUILD_ID,需要更新才能用,见 §6)

## 4. 怎么回到上一个稳定版本(回滚)

如果新版本有问题,30 秒回滚:

```bash
# 1. 恢复源码 (用上次部署前的备份)
ssh admin@120.77.36.107 'ls -d /opt/attrax-pre-fix-* | tail -1'
# 输出形如 /opt/attrax-pre-fix-20260718-142403
# 取最新那个,拷回去

ssh admin@120.77.36.107 '
  PREV=/opt/attrax-pre-fix-20260718-142403
  # 还原源码
  cp -a $PREV/../app/api/report/* /opt/attrax/app/api/report/
  cp -a $PREV/../app/profit /opt/attrax/app/
  cp -a $PREV/../app/result /opt/attrax/app/
  cp -a $PREV/../lib/reporting.ts /opt/attrax/lib/
  # 还原 standalone
  rm -rf /opt/attrax/.next/standalone
  cp -a $PREV/standalone /opt/attrax/.next/standalone
  # 重启
  env PM2_HOME=/home/admin/.pm2 /opt/attrax/node_modules/.bin/pm2 restart nextjs --update-env
'

# 2. 验证 BUILD_ID 回到 8yIFraqxGih3H_gxvEx8i
ssh admin@120.77.36.107 'cat /opt/attrax/.next/standalone/.next/BUILD_ID'
# 期望: 8yIFraqxGih3H_gxvEx8i
```

或者更狠的:整个 `/opt/attrax` 用 `attrax-backup-*` 恢复。

完整备份目录(从一开始就保留的,按时间戳):
- `/opt/attrax-backup-20260717-235250/` — 1.7GB,部署前(2026-06-22 状态)全量备份
- `/opt/attrax-pre-handoff-*` — handoff 设计稿部署前的备份
- `/opt/attrax-pre-fix-*` — 本次 PDF/DOCX 修复前的备份

## 5. 怎么再部署一次新版本

1. 本地改代码 → `npm run typecheck` → `npm run build`
2. **关键**:`cp -r public .next/standalone/`(standalone build 不含 public,必须手动)
3. commit + push 到 `origin/codex/backend-decoupling` → 记下 commit hash
4. 打包:
   ```bash
   cd D:/Data/Desktop/attrax
   tar czf /tmp/attrax-fix-src.tar.gz \
     <changed files>
   tar czf /tmp/attrax-fix-standalone.tar.gz -C .next standalone
   tar czf /tmp/attrax-fix-static.tar.gz -C .next static
   ```
5. scp 到服务器
6. 服务器解压(参考 `apply-fix.sh`)
7. `pm2 restart nextjs --update-env`
8. 验证 BUILD_ID + 字体 200 + 真实下载

## 6. 待办

- [ ] `scripts/organize-and-test.sh` 里的 `EXPECTED="8yIFraqxGih3H_gxvEx8i"` 硬编码需要改成从仓 HEAD 推算(或单独维护一个 `EXPECTED_BUILD_ID` env)
- [ ] 本仓 README 增加"如何把本地代码同步到服务器"标准流程(目前只有 `docs/DEPLOY-CHECKLIST.md` 略提到,需要展开)
- [ ] 删 `docs/E2E-REPORT-20260718.md` 里过时的 polling 500 描述(那是已知遗留,不该再列在"未完成")
- [ ] 服务器没有 git,部署时无法做 `git rev-parse HEAD` 自动校验 → 推荐在 `/opt/attrax/.deployed` 写一个 `commit=<hash>` 的标识文件,部署脚本自动写入

## 7. 已知遗留(跟本次修复无关)

| 项 | 状态 | 备注 |
|---|---|---|
| `/api/scan/{sessionId}` polling 偶尔 500 | 已知 | next.js 16.2.6 jest-worker 在 1.6GB 容器下的稳定性 bug,需 ECS 升配才能根治 |
| 路线图 PDF/DOCX 导出 | 未实现 | ResultExportButton 对 roadmap 按钮 disabled,只支持 md/csv 走 API |
| 文档同步(compliance) PDF/DOCX 客户端导出 | 改为跳到页内 #compliance-report anchor | ComplianceReportView 内部用 lib/report-download 下载,实际上完整链路可用 |
| pm2 "In-memory PM2 is out-of-date" | 功能正常 | 7.0.1 in-memory vs 7.0.3 local,跑 `pm2 update` 即可消除警告 |

---

*文档创建于 2026-07-18 14:30 CST*
*当前 commit: 7e7bc95 (origin/codex/backend-decoupling)*
*对应 BUILD_ID: 6vo9eDne-1LDAgD903V2c*