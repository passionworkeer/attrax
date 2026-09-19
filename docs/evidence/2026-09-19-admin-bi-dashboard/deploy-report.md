# 2026-09-19 管理员 BI 看板部署记录

## 部署内容

- 分支 `codex/admin-bi-dashboard`，commit `063090d`（rebase 到 main `439e862` 之后）
- BUILD_ID `i-24Q0OTH4e-zGoW3fQK6`，本地构建 tarball 59MB（ops 12 文件）
- 服务器：apply-deploy 全流程（standalone 换树 → pm2 startOrRestart nextjs → nginx 重渲染 reload → health gate 第 2 次尝试通过）

## 服务器侧手工步骤（apply-deploy 之外）

1. `scp scripts/{setup-admin,verify-admin}.mjs → /opt/attrax/scripts/`（不在 ops 清单内）
2. `scp scripts/watchdog/{orchestrator,metrics}.py → /opt/attrax/scripts/watchdog/` + `pm2 restart regwatch`
3. `node /opt/attrax/scripts/setup-admin.mjs /opt/attrax` —— 生产凭据首次生成：
   - `/opt/attrax/.admin-auth.json`（scrypt 哈希，0600，gitignore）
   - `/opt/attrax/.deploy/admin-access.txt`（明文密码，0600，仅 root 可读）
4. `python3 /opt/attrax/scripts/retain-admin-audit.py --root /opt/attrax` —— 存量审计全量导入：
   `{"files": 2, "scanned": 459, "imported": 459, "undated": 82, "total": 459}`
   （82 条无时间戳的旧记录按设计保留、不进日期曲线，界面有说明）
5. git bundle 同步：服务器新增分支引用 `codex/admin-bi-dashboard → 063090d`；
   服务器 main 有本地证据提交（8108ef0），未动

## 验证结果

### 本地（dev server :3015，浏览器实测）

- 未登录 `/admin` → 307 跳转 `/admin/login`；登录后看板渲染本地真实数据
  （法规 1,049 / 25 市场 / 37 来源——worktree 检出的索引原样读取）
- 流量采集端到端：访问首页 → `data/admin/analytics.sqlite` 落一行 page 记录，
  visitor 去重 + `traffic_since` 初始化
- 指标切换（访客↔API）、周期切换（7/30/90，X 轴随窗口变化）、CSV 导出按钮、
  会话过期提示（`?expired=1`）均实测通过
- `verify-admin.mjs` 本地全过（9 项检查）

### 生产（twinbuddy.xyz）

- `verify-admin.mjs` 9/9 通过：匿名拒绝 / 伪造会话拒绝 / 页面跳转 / 跨站登录拒绝 /
  错误密码拒绝 / 安全 Cookie（HttpOnly+SameSite=Strict+Secure）/ 日期校验 /
  7-30-90 天聚合一致性 / 退出后会话撤销
- 部署后抽查（https 直连）：法规 **1052** / 25 市场 / 37 来源 / 扫描 7 天 93 次全部
  完成 / 平均耗时 52 秒 / 访客采集已开始计数（trafficSince 17:16）
- 新 watchdog metrics 管线当轮即写出 `watchdog-runs.jsonl`：
  30 源全抓取、1 新增（UK-SVHC）、3 更新、4 证据、0 错误
- 公网页面回归：`/`、`/regulations`、`/admin/login`、`/api/health` 全部 200

## 已知现象（已确认非缺陷）

- **verify 首次运行读到法规 61 条**：时间 17:14:28，恰落在 regwatch 重启后首轮
  ingest（17:14:16–17:14:38，1 新增/3 更新）的中间。索引重建是原子写，但巡检
  应用变更期间读取的是重建序列中的瞬时状态；17:15 重建完成后自愈为 1052，
  部署后抽查与公网 `/regulations` 一致。后续巡检固定在每日 03:00，与看板的
  常规使用时间不重叠，界面数字带 30 秒缓存，无持久影响
- 82 条无时间戳历史审计无法归入日期曲线（界面明确标注）；流量采集自
  2026-09-19 17:16 起算，之前无访客数据可回填（界面同样标注）

## 日志文件

- `deploy-1-apply.log` —— apply-deploy 完整输出
- `verify-prod.log` —— 生产 verify-admin.mjs 输出（不含密码与 Cookie）

## 第二次部署（同日晚）：合并进 main + 首页入口 + 演示数据 + 指定密码

- 变基到 main `8108ef0`（并行会话的法规死链修复已包含），main 快进到 `ee99a27` 并推送
- BUILD_ID `k4ZwDZL2ye3KAOkgN_cE1`（commit ee99a27 = main tip），health gate 第 2 次尝试通过
- 服务器侧：`setup-admin.mjs --password` 轮换为运营指定口令（原子替换哈希 + 清空全部旧会话），
  口令文件 `/opt/attrax/.deploy/admin-access.txt`（0600），git 文档不记录口令明文
- 生产验证：verify-admin 9/9 通过（30 天真实数据：法规 1052 / 25 市场 / 37 源 / 扫描 114 次 / 访客 7——
  访客为当天下午起采集的真实计数）；首页出现「管理后台」入口；登录后 /admin 含
  「真实数据 / 演示数据」切换（演示口径 30 天 42 访客 / 343 次扫描）
- 服务器 git：分支引用更新到 ee99a27；main 保持 8108ef0——其工作树有 watchdog 未提交的
  法规增量（合并会覆盖），按既有约定服务器 git 允许落后，真实版本以 `.deployed` 为准
