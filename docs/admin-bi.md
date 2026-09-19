# 管理员运营看板

入口 `/admin`（首页导航「管理后台」直达），未登录时跳转 `/admin/login`。沿用法规中心的海蓝色和玻璃卡片，使用 Recharts 绘制交互曲线和柱图。布局参考 GitHub `shadcndashboard/next-shadcn-dashboard` 的指标、图表、表格组合；代码在当前项目内实现。

## 演示数据（MVP 推广）

看板右上角可在「真实数据 / 演示数据」间切换。演示数据由 `lib/admin/demo-data.ts` 用固定种子模拟生成：访客按身份模型跨日去重（30 天约 42 人、90 天约 53 人）、扫描近 30 天约 343 次 / 近 90 天约 739 次、失败率约 5%，法规存量与来源规模沿用生产真实数量（1052 条 / 25 市场 / 37 源）。每次进入页面默认回到真实数据；演示态以琥珀色标签与「演示数据 · 非真实统计」提示明示，CSV 导出的文件名带 `-demo` 后缀且表头注明演示口径。

## 使用与统计口径

- 支持最近 7、30、90 天、手动刷新、CSV 导出、移动端布局。
- 独立访客按匿名浏览器 Cookie 去重，仅统计前台页面访问。项目没有注册账户系统；清除 Cookie、更换浏览器会重新计数。已知机器人和预取请求排除。
- API 调用统计业务 HTTP 请求尝试，包含查询、轮询和失败请求；排除管理员、健康检查和静态资源。它不能直接表示 LLM 调用次数。
- 扫描提交来自后端审计日志；完成和失败为任务终态，包含重新审查。旧审计缺少时间的记录不能归入日期曲线。
- 当前法规总量来自生产法规索引。新增法规和抓取文件版本分别显示；导入目录存量不冒充每日自动抓取量。
- 部署前法规数据采用留存每日快照，可能被同日运行覆盖，界面明确标注覆盖范围。部署后的 watchdog 逐轮记录保存在 `data/regulation_supplements/watchdog-runs.jsonl`。
- 新流量按北京时间统计；历史 watchdog 快照保留其 UTC 日期，界面注明。无覆盖日期显示空值。

## 配置与数据

要求 Node.js 22.13 或更高版本，使用内置 SQLite。执行 `node scripts/setup-admin.mjs /opt/attrax` 初始化管理员：密码哈希保存在 `.admin-auth.json`，首次生成的密码保存在 `.deploy/admin-access.txt`，权限均为 0600。初始化不会覆盖已有凭据。轮换为指定密码用 `node scripts/setup-admin.mjs /opt/attrax --password <新密码>`：原子替换哈希文件、更新口令文件，并清空 `admin_sessions`（旧会话立即失效）。登录接口接受 8–256 位密码。

密码使用 scrypt；会话为随机令牌，数据库仅保存哈希，8 小时过期。Cookie 为 HttpOnly、SameSite=Strict，生产使用 Secure。登录和退出验证同源；登录失败受 15 分钟 5 次限流保护。退出会删除服务器会话，旧 Cookie 无法重放。统计 API 每次验证会话，不允许缓存。

运行数据位于 `ATTRAX_PROJECT_ROOT` 下的 `data/admin/analytics.sqlite`；生产默认解析 `/opt/attrax`，不读取 standalone 的构建快照。数据库保存匿名流量和白名单扫描统计字段，不保存 IP、密码、上传内容或查询参数。凭据和运行数据不加入 Git，也排除在构建追踪之外。

`scripts/backup-admin.mjs` 使用 SQLite 在线备份 API，随既有每日备份执行。每日备份（`scripts/backup-data.sh`，cron 驱动）在打包前先运行 `scripts/retain-admin-audit.py` 把扫描审计导入留存库——审计日志轮转后看板历史仍完整，不依赖管理员当天是否打开过看板；留存失败不阻断备份，但会写入备份日志。迁移时同时保留数据库、凭据文件和 watchdog JSONL。轮换管理员凭据时须先备份并删除全部 `admin_sessions`，然后由维护人员使用安全流程生成新配置。

## 发布与验证

在本地构建 Next.js standalone，设置 `ATTRAX_TARBALL` 为仓库 `.deploy/` 路径。服务器使用同一环境变量指向 `/opt/attrax/.deploy/`，执行 `scripts/apply-deploy.sh`。该流程保留上一版并检查健康状态。ops 随包分发 12 个文件（含 `backup-admin.mjs` 与 `retain-admin-audit.py`）；`setup-admin.mjs` 与 `verify-admin.mjs` 不在 ops 清单里，需要单独 scp 到 `/opt/attrax/scripts/`。middleware.ts 在 Next 16 必须保留 `runtime: "nodejs"` 配置——去掉后 webpack 按 edge 目标编译统计链路，`node:` 内置模块直接构建失败。

watchdog 的 `orchestrator.py` 和 `metrics.py` 需要单独备份、同步并重启 `regwatch`。本改动不需要重启扫描后端。

运行 `ADMIN_VERIFY_URL=https://twinbuddy.xyz ADMIN_ACCESS_FILE=.deploy/admin-access.txt node scripts/verify-admin.mjs` 验证真实权限、三种日期范围、聚合一致性和退出撤销。验证输出不包含密码或 Cookie。

参考：[Next.js dashboard](https://github.com/shadcndashboard/next-shadcn-dashboard)、[shadcn Chart 文档](https://ui.shadcn.com/docs/components/base/chart)。
