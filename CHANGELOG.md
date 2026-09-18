# Changelog

本项目所有重要修复的根因记录,供未来对账 / post-mortem / 新人上手。

## [Unreleased] - 2026-09-18

**并发加固总批次:一次全栈并发审计(5 个方向)+ 修复**

**背景**
- 起因是"并发这方面有没有做很强的加固"这个问题。按前端 BFF / RAG 管线 / 存储与文件后端 / 外部采集 / 服务器基础设施五个方向各派一个审查,逐条给出 severity + file:line。结论:**底层存储与单进程内的并发原语做得好**(O_EXCL 跨进程锁、tmp+os.replace 原子写、RLock 串行化状态写、`asyncio.wait_for` 兜底),但**多进程边界、长跑生命周期、突发流量、跨子系统资源竞争这四个维度缺位**——多处靠"部署约定"活着(instances:1、单 upstream、单磁盘备份)
- 修复原则(用户指定):**凡会拖慢当前热路径的加固一律不做**。据此明确跳过两项:audit.jsonl 与 session JSON 的逐次 fsync(happy path 上多一次落盘)。其余 HIGH + MEDIUM 全部实施,LOW 只做不引入热路径开销的

**修复 — 前端 BFF**
- **H1 限流器跨进程原子性**(`1a6bd0c`):文件桶的读-改-写用 `O_CREAT|O_EXCL` 锁文件包住(3 次指数退避 + jitter,预算 <50ms),抢不到锁退回进程内限流。此前靠 `instances: 1` 约定活着,一旦 PM2 多实例,每个 worker 各自计数、限流静默失效。同步加 production + 多实例的一次性启动告警
- **H2/H3 请求体流式转发**(`f405713`):`POST /api/scan` 与 `/evidence` 不再 `request.formData()` 整份读进堆再重新序列化——50MB 上限 × 并发上传足以顶破 nextjs 的 `max_memory_restart(768M)`,且每请求解析+序列化各两遍。现在把 `request.body` 流直接交给上游 fetch(`duplex: "half"`),字段与文件按原字节到达 RAG
- **契约随之变化**:浏览器发出的字段名就是 RAG 看到的字段名(上传页改发 `declared_facts`,并把文本字段排在文件前面,以便 BFF 的 8KB 嗅探能读到 `category`);RAG 的 `/api/v1/scans` 接受旧名 `userDeclaredFacts` 与逗号分隔的 `markets`,并在 `query` 为空时按 BFF 原来的措辞合成。逐文件类型/魔数/数量/总大小校验下沉到 RAG `_read_uploads`(本来就是唯一真值源);BFF 保留 Content-Length 上限、Content-Type 嗅探、限流与 category 早检
- **嗅探器真 bug**:分段正则把「字段值」当成了「头部块」,`name="category"` 永远匹配不上 → `INVALID_CATEGORY` 早检与 category 取值一直失效。修正为 `--boundary\r\n((?:[^\r\n]+\r\n){1,8})\r\n([^\r\n]*)`
- **M3 revision 幂等键**(`f405713`):改为客户端传入(每次点击生成),BFF 透传。此前固定 `${sessionId}:revision`,第二次重扫被静默吞掉
- **M8 资产流式回传**(`f405713`):`streamScanAsset` 返回未读的 `Response`,BFF 直接管道 `response.body`。结果页轮播并发取图不再每张留一份完整堆副本
- **>8KB 上传整条挂死**(`8ff0866`):嗅探 `category` 的第一版用 `body.tee()` 撕出分支、读满 8KB 后 `cancel()` 它——**任何超过嗅探窗口的请求体都会死锁**,44KB 的真实产品图在 BFF 里停到客户端超时,RAG 侧连 POST 记录都没有。阈值正好是 8KB:以下能读到 `done` 走完循环所以正常,这也是小 fixture 单测与 610 字节桩请求都漏掉它的原因。改为单 reader 读前缀 + 回放流,没有第二条分支要协调。**只有真实 socket 支撑的请求流能复现**,证据见 `docs/evidence/2026-09-18-concurrency-hardening/`

**修复 — RAG 服务与存储**
- **H11 幂等检查与写入同临界区**:`check_and_append_audit_marker` 在一次 `_lock` 内完成「查 + 写」,两个同 key 的并发补充证据不再双份入库
- **H12 重扫幂等落两份**:两个来源互为补集——job 记录(在 audit 之前落盘,能覆盖崩溃窗口与「运行中且租约有效」的 job)+ audit log(job 完成后会被删除,只有它能拦住迟到的同 intent 重试,否则重试一次就再付一次完整 LLM 扫描)。落盘走 `save_job_if_marker_absent`,查与写在同一次锁内
- **H5 session 读-改-写原子化**:新增 `update_session_atomic`,进度回调 / 阶段切换 / 租约心跳三处共用,不再互相覆盖 `stage_text`/`progress`
- **H13 vision cache 加锁**:get(含 utime)/put/evict 全程持锁,消除过度驱逐与 mtime 抖动
- **M3 陈旧 job 锁**:回收条件从「只看老化」改为「持有者 PID 已死立即回收,否则沿用 60s 老化」——被 SIGKILL 的 worker 留下的锁不再让该 job 停摆一分钟,PID 复用也不会永久卡死
- **M4 会话清理**:`purge_expired_sessions` 的识别与删除合并到同一次持锁,消除并发删除导致的假 `scan_expired` 事件与超计数
- **M5 上传锁范围**:`save_upload` 的大块字节写移到锁外,锁只覆盖原子 rename 与元数据写。此前单次 10MB 写会串行化整个后端的会话/任务读取

**修复 — 外部采集(watchdog)**(`9dc1f55`)
- **H14 连接池 + 重试抖动**:`urllib.request` 换成进程级单例 `httpx.Client`(`max_connections=8` 的 keep-alive 池),退避改为 full jitter。此前每次抓取都新建 TCP+TLS,且 8 个 worker 在 2s/4s 同一时刻齐步重试——对一个刚抖动的 CDN 是最坏的打法
- **H15 原子写**:`_write_yaml` / `INDEX_PATH` / `.auto_state.json` 改为 tmp + `os.replace`;`safe_load` 失败不再静默 `continue`,改为记 error
- **H16/M20 并行 ingest**:单个源抓完+diff 出真变化就立刻投进独立的有界 ingest 池(与抓取池分开),不再等抓取阶段全部排空后在主线程串行写。同 regulation 的写入用 per-regulation 锁串行;索引重建仍是收尾的单线程步骤
- **M19 缓存命名空间**:条件请求缓存键从 URL 改为 `source_id:url`,并在 `--ack`/`--revert` 时按 source 失效

**验证**
- vitest 998/998、tsc、eslint 全绿;pytest 后端 731 passed / 5 skipped;watchdog pytest 139 全绿;双 OpenAPI 契约门控通过(快照与 types.gen.ts 已按新签名重新生成)
- **真实 HTTP 端到端**(不只是单测):Next.js dev + undici + 桩上游,确认上游收到 `transferEncoding: chunked` 且无 `Content-Length`——即请求体确实在流式转发而非缓冲;字段、文件、内部密钥完整到达
- **真实产品图跑完整链路**(44KB,经真实 RAG 服务):`status=ready`、`compliance=WARN`、`declaredFacts={"battery":"否"}`、`originalQuery` 为按浏览器 category+markets 合成的原措辞、`agentTrace=[vision,generate,verify]`、`degraded` 为空
- **死锁回归证据**:4000B / 9000B / 40000B 三档在修复前后对比(修复前 9KB 与 40KB 必然超时,修复后均返回 RAG 的 400 签名拒绝即 body 完整到达)。完整记录与复现步骤见 `docs/evidence/2026-09-18-concurrency-hardening/`

---

**服务器基础设施并发硬化批次:nginx 重试 / 连接限流 / TCP TIME_WAIT / pm2 graceful drain / 备份快照**

**背景**
- 上一轮线上实测把 nginx vhost 端口、备份 cron、3001 地雷等"工具自身已失效"的问题抓出来后,自然延伸到部署基础设施本身的并发硬化:nginx 默认配置 / sysctl 默认值 / pm2 默认行为都不防"小流量 + 长轮询"这一组合的并发陷阱。RAG long-poll (最多 280s) + 限流是按 r/s 而非并发连接数计,意味着慢客户端 + 大量并发连接可以让 worker 池打满而 `limit_req` 不报警。本次 11 项全部围绕"配置不动也活得好 + 慢客户端打不死",都是离线、零 hot path 风险

**修复(按严重性)**
- **H8 / proxy_next_upstream 重试**:`docs/infra/nginx-attrax-vhost-prod.conf.template` 在 `/api/scan` 与 `/` location 显式 `proxy_next_upstream error timeout http_502 http_503 http_504; proxy_next_upstream_tries 2;`。当前单 upstream 时 retry 是 no-op(没有第二目标),但**故意**写上,加第二个 backend 时无须改 vhost。`max_fails=3 fail_timeout=30s`(M9) 在 upstream 上先把真抖动的实例标 down、retry 不会无脑打死
- **H10 / limit_conn 每 IP 20**:`docs/infra/nginx-nginx.conf` 加 `limit_conn_zone $binary_remote_addr zone=attrax_conn:10m;`,vhost server block 加 `limit_conn attrax_conn 20;`。`limit_req` 只卡速率不卡并发连接,慢客户端 / 并行扫描器保持连接不释放就能打满 worker;20 远高于任何真实单用户场景(long-poll + 上传 + 几 tab)、远低于 worker_connections/2
- **H9 / multi_accept on**:`docs/infra/nginx-nginx.conf` events 块取消注释 `multi_accept on`。epoll + 现代内核下安全,减少 worker wakeup 频率
- **M11 / sysctl TIME_WAIT**:`docs/infra/sysctl-99-attrax-hardening.conf` 加 `net.ipv4.tcp_tw_reuse = 1` + `net.ipv4.ip_local_port_range = 1024 65535`。RAG 出站连接(LLM/MiniMax/DeepSeek/Anthropic)走完会进 TIME_WAIT ~60s,默认 28k 端口在持续扫描下会耗尽;reuse + 全端口范围保住长轮询 + 流式响应下的出站重连
- **M9 / 上游 max_fails / fail_timeout**:vhost upstream 行加 `max_fails=3 fail_timeout=30s`。nginx 默认 1 失败 / 10s 太激进,一次瞬时错误就把 upstream 标 down 10s
- **M10 / fail2ban 不再误抓 5xx**:`docs/infra/fail2ban-filter-attrax-404-probe.conf` 删 `|5[0-9][0-9]`,只留 4xx。正常用户在 nginx reload / healthcheck 自愈期间碰到 502/503/504 会累积失败、24h 封禁——5xx 是服务端失败,不代表探测行为。sensitive-path 探测永远回 4xx,本次只损失"恶意 POST 把服务端搞挂"这一极小场景
- **M15 / pm2 graceful drain**:`scripts/ecosystem.config.cjs` nextjs 块加 `kill_timeout: 10000`。healthcheck level-3 `pm2 restart nextjs` 在 long-poll 中途触发时,旧进程最多 10s 排空活跃连接(远小于 long-poll 280s 超时),**避免** ECONNRESET。**未加 `wait_ready: true`**:它要求应用主动 `process.send("ready")`,而 Next.js 从不发送(`node_modules/next/dist` 里唯一相关分支被 `NEXT_PRIVATE_WORKER` 挡住,standalone `server.js` 不设置该变量),加上去只会让 pm2 永远等一个不会到来的信号
- **M16 / logrotate ownership**:`docs/infra/logrotate-attrax` 两处 `su ubuntu ubuntu` → `su root root` + `create 0640 root root`。aliyun-sz 只有 root/admin,ubuntu 用户不存在;原配置下 logrotate 静默跳过。注释更新指向本次实测
- **M12 / 备份快照 cp -al**:`scripts/backup-data.sh` 在 tar 之前先 `cp -al` 把 `data/backend/{sessions,jobs,uploads}` 硬链接到 `/opt/attrax/backups/.snap-$STAMP/`(O(1) per file,与 live tree 共享 inode),然后 tar 快照而非 live tree,杜绝 RAG workers 写到一半被 tar 读走导致 session JSON 撕裂。tar 命令加 `--exclude='*.tmp' --exclude='*.lock'`。trap EXIT 清理快照
- **M13 / 备份纳入 sessions/jobs/uploads**:同脚本 ITEMS 显式列这三个目录(经 M12 快照路径)。中间进行中的扫描不再丢
- **M14 / 异地备份配置文档化**:`scripts/backup-remote.sh` 头部加 .env.example 式 docstring(rsync over SSH / NFS / S3 三种配法 + 安装步骤),日志补一句引导"set BACKUP_REMOTE_DEST in /opt/attrax/.env"。aliyun-sz 仍未配置 `BACKUP_REMOTE_DEST`(单盘风险,继承上一轮观测)

**验证**
- 本地 `bash -n scripts/backup-data.sh` / `scripts/backup-remote.sh` 语法通过
- `node -e "require('./scripts/ecosystem.config.cjs')"` 加载成功(在 dev placeholder 模式;生产 `APP_ENV=production` 仍 fail-closed 抛错,不变)
- nginx/logrotate 二进制本机不可用,只能视觉检查;配置文件已自检 `events {}` / `http {}` / `server {}` / `upstream {}` / `location {}` 块平衡
- **运行时验证需 aliyun-sz 部署后**:`nginx -t` 必须通过;logrotate 跑 `logrotate -d` 看是否能 rotate;`pm2 restart nextjs` 期间 long-poll 用户不报 ECONNRESET;`/opt/attrax/backups/` 出现 `.snap-*` 目录但 tar 结束后被清理(否则 trap 没生效)

**遗留观察(需上线后第一时间核对)**
- **BACKUP_REMOTE_DEST 仍未配置**:与上一轮一致,本次只把配置入口文档化
- **首次备份需实测**:`trap cleanup EXIT` 会在正常退出与 `set -e` 失败退出时都删快照,但仍要确认首跑后 `/opt/attrax/backups/` 无 `.snap-*` 残留,且 tarball 里确实含 `data/backend/{sessions,jobs,uploads}`(`tar -tzf attrax-data-*.tar.gz | grep backend`)

**线上实测批次:回归脚本假绿 / 备份从未运行 / nginx 3001 地雷文件 / watchdog CLI 直跑失败**

**背景**
- 对 twinbuddy.xyz(aliyun-sz)做全链路实测:公网健康 + 真实扫描 + Playwright 生产回归 + 导出端点 + 服务器日志/配置审计。核心链路本身健康(真实扫描 3/3 通过,provider=minimax,source=real),实测挖出的全部是"守卫工具自身已失效"的问题——与 9-17 源审计同构:失败都有记录,没有人看

**修复**
- **生产回归脚本 UI 漂移 + 退出码假绿**(691a985):`run-production-regression.ts` 的 `selectOption("#blaze-category")` 对 Base UI Select 报 `Element is not a <select>`;市场按钮选中态检测用旧 `bg-white/40` class(现为 `aria-pressed` + CSS Module),永远判未选中会把已选市场点反;条件问题收在 `<details>` 里默认折叠,选项按钮全部不可见;页面有两个 `type="submit"`(页头 CTA 经 `form=` 关联)触发 strict mode violation。且所有用例失败时 `main()` 正常返回、退出码 0——CI/cron 把全挂的回归当绿色。全部修正 + 失败时 exit 1 + 默认 BASE_URL 改 twinbuddy.xyz(旧 wangjianjun.xyz 已随 lighthouse 退役,现 401)
- **备份 cron 指向不存在的用户**(7fd8bd2):`cron.d/attrax-backup{,-remote}` 以 `ubuntu` 跑,但 aliyun-sz 只有 root/admin;cron 对不存在用户静默跳过,3am/4am 任务从未执行(`/opt/attrax/backups`、`/opt/attrax/logs/attrax-backup.log` 均不存在——脚本首行就会 mkdir,不存在即从未运行)。文档注释"pm2 runs as ubuntu (pm2-ubuntu.service)"描述的是 lighthouse 旧机。cron 用户改 root,`infra-cron-references.test.ts` 允许列表同步 root/admin,手动首跑验证成功(1.7M)。异地备份仍空转(BACKUP_REMOTE_DEST 未配置,单盘风险)
- **apply-deploy 清 sites-available 3001 地雷**(389ee5c):`/etc/nginx/sites-available/attrax` 是旧手工流程副本、仍写 3001;渲染真值在 sites-enabled/attrax 正规文件,副本不被引用但任何"从 sites-available 恢复"的标准 Debian 操作都会带回 502。[8.5] 渲染后删除(仅当 sites-enabled 非软链),PORTS.md 补记单一真值
- **watchdog CLI sys.path 引导**(691a985):`python3 scripts/watchdog/xxx.py` 直跑时 `sys.path[0]` 是脚本目录而非仓库根,`from scripts.watchdog...` 直接 ModuleNotFoundError;check_sources / review / auto_ingest 补仓库根引导(生产机 `python3 scripts/watchdog/check_sources.py` 实测踩中,修复后 30/30 healthy)
- **孤儿 cron 清理**(服务器):`attrax-uptime` 每 5 分钟跑不存在的 `uptime-check.sh`(无 MTA 输出被丢,自 8-10 起静默失败);`attrax-data-rotation` / `attrax-queue-perms` 指向已随 de-RAG 删除的 `data/scan-queue`(2>/dev/null 空转)。全部移除

**部署与验证**
- 389ee5c tarball 部署(BUILD_ID `Et6wM48xv7j4kP69ApVCJ`):apply-deploy 新 [8.5] 首次实战(重渲染 vhost→3000 + 删地雷 + `nginx -t` + reload + health gate 2 次通过);服务器 git 经 bundle 快进对齐 HEAD
- vitest 987 / pytest 822 全绿;生产回归 3/3(Anker EU 80 分 56s / 小米水壶 EU 75 分 128s / LEGO US 88 分 153s,全部 source=real);部署前后各一次 API 冒烟扫描通过;导出端点按契约(compliance md 200 / roadmap csv 200 / 无 cookie 401)
- 遗留观察(未修,产品/配置决策):MiniMax 报告 ~16.4k 字符顶到输出上限后走 repair 有界重试(日志常见 `direct json.loads failed: Unterminated string` → `repaired in one bounded retry`),最终报告 ~12k 字符,功能无损

## [Unreleased] - 2026-09-17

**法规数据源全量实测审计:35 个源里 15 个实际没在追踪任何东西**

**背景**
- 对 35 个注册源做全量实测(生产机真实抓取,走各自 collector 完整路径),发现 9 个源 `source_url` 返回 403/404,自 2026-09-16 上线起每个 pass 都在失败 —— 生产机自己的 `errors.json` 早已逐条记录,但没有告警、没有断言、没人看。根因:`human_view_status` 是手工字段,填的是「浏览器能不能打开」,与抓取能力无关
- 修完 URL 后暴露第二层:6 个源返回 200 但正文只有 24–224 字符(JS 渲染 SPA,stdlib `html.parser` 拿不到正文)。摘要**永远不变**,看起来像「这个源一直没变化」,比不追踪更糟

**修复与新增**
- 换通道:`us-cpsc-recalls-rss`(403)→ SaferProducts.gov REST API(新 `cpsc_recall_api` collector);JP/BR 换到实测 200 端点;CN/KR/AE/SA/IN 五个 JS 空壳标 `fetch_status: shell_only`;EU Safety Gate API 已整体下线,标 `unreachable`
- 新增源(全部实测):`us-cpsc-recalls-api`、`us-fda-device-recalls`、`us-fda-food-enforcement`(`food_contact` 品类此前零召回信号)
- 修掉三个「假可用」bug:OpenFDA 不显式排序会返回档案库任意切片(device 实测 2003 年记录),30 天窗口过滤后摘要为空 —— 空摘要与「真的没有召回」无法区分;且 device 端点没有 `recall_initiation_date` 字段,对它排序是 HTTP 500,须按端点声明排序字段
- 抓取改造:并行抓取(线程池 `ATTRAX_REGWATCH_FETCH_WORKERS`,默认 8;原串行最坏 6300s)+ 协作式 60s deadline(socket 阻塞的线程杀不掉,由 `fetch_url` 在每次尝试/backoff 前检查预算);`source_type` plugin 注册表(新源 = 新文件 + `@register`);304 短路;cookie jar + Accept-Language/Encoding;大文档双信号 diff(Jaccard 对句序换位不敏感,叠加行级 LCS 取较小值);UA 季度轮换
- 删除 5 个被数据中心 IP 段硬封的 collector(UK legislation.gov.uk / TGA / ACCC / EU Cellar SPARQL / Health Canada,带完整浏览器头也 403)
- 新守卫:`scripts/watchdog/check_sources.py`(走真实 collector 抓一遍,报 ok/304/thin/TIME/FAIL,结构不变量测试当场抓出 `canada_justice_xml` 与 `direct_url` 两个从未显式注册的源);`fetch_status` 三态门控整个 pass(已知抓不到的源不再每晚灌 errors.json);`review.py` 复核/回滚 CLI(自动入库的配套人工闸门)
- 数据:14 篇 9 市场法规 YAML 手工创建 + 对应 KB anchors;22 篇补 `source_kind`(11 篇凭空造的 `private_summary` 改成语义正确且已被 `quote_matcher` 处理的 `curated_summary`);`regulations_index.json` 按实际 58 篇重建;`/health/watchdog` 运维端点 + BFF 透传;OpenAPI snapshot + types.gen.ts 补齐该端点

**验证**
- pytest 776 passed(rag_service/ + scripts/watchdog/);生产机 `check_sources` **30/30 healthy, 0 thin, 0 failed**;端到端 dry-run 30 源 64 秒抓完
- 完整审计记录(含 GitHub 同类项目调研结论:无可复用捷径)见 `docs/regulations/SOURCE-AUDIT-2026-09-17.md`

## [Unreleased] - 2026-09-17

**对抗审查 round 5:契约漂移 + 限流分桶 + 401 cookie + 运维配置**

**背景**
- 前端 / rag_service / 跨链路契约三路并行对抗审查后的修复批次。多数发现是「靠宽容度活着」的隐性契约与配置漂移,当天功能不受影响,但会在下一次收紧重构 / 多用户并发 / docker 部署时静默退化。审查共报 ~45 项,复核后约一半为误报(见文末),全部先验证后修改

**修复(按严重性)**
- **限流单桶**:RAG `_client_ip` 只在 socket peer 属于 trusted_proxies(默认 `127.0.0.1,::1`)时读 X-Forwarded-For;BFF 从 127.0.0.1 发起所有上游调用却什么都不转发 → 全部用户共享同一个 30 req/60s 写桶,一个调用者即可把其他人的扫描创建打成 429。`v1-adapter` 新增 `UpstreamForward(clientIp/requestId)` + `upstreamForwardFrom(request)`(取 x-real-ip:nginx `$remote_addr` 覆写值,BFF 自身限流同样信任它),6 个 BFF 路由全部透传;`middleware.ts` 用 `NextResponse.next({request:{headers}})` 把 request-id 注入转发请求头,handler 与 RAG 首次能对上同一个 id
- **DecisionNode.severity 契约缺口**:前端评分公式依赖 `decisionView.nodes[].severity`,但 Pydantic / OpenAPI snapshot / types.gen.ts 全无该字段 —— 一直靠 `extra="allow"` 兜底,一次收紧即静默退化为 fallback 100/A。`report_package.py` 显式声明 `Literal["critical","high","medium","info"]`,snapshot + types 重新生成
- **assets 二进制响应契约**:`GET /scans/{id}/assets/{index}` 在 OpenAPI 里声明为 `application/json` + 空 schema,codegen client `await res.json()` 遇真实字节流必爆。补 `responses` 声明 binary + 401/404 envelope
- **ephemeral secret 写日志(信息泄露)**:`_enforce_secret_policy` 的非 prod 分支把自动生成的 `RAG_INTERNAL_SECRET` 明文打进 logger.warning —— 任何能读日志的人可伪造 `X-Internal-Secret` 绕过写端点。改为只打 pid,真值提示从 `/proc/<pid>/environ` 取
- **401 不清 cookie**:scan 轮询 / evidence / revisions / asset / report 五个 BFF 路由 401 时不发清除头,死 token 在浏览器侧存留 24h TTL 反复重试。新增 `withClearedSessionCookie()`,401/403 统一带 `Max-Age=0`
- **burning 页导航 guard**:`navigatedRef` 名为 ref 实为 useState,timer 回调读到的是调度时的旧闭包(guard 首次恒 false);且 render 期读 ref 违反 react-hooks/refs。拆成 ref(仅回调内读写的同步去重)+ state(渲染侧隐藏按钮)
- **报告路由信封**:`app/api/report/...` 14 处裸 `{error:{code,message}}` 统一改走 `fail()` 信封,与 scan/* 一致(监控聚合不再面对两种 error shape)
- **运维配置**:docker-compose 补 `DEEPSEEK_*` env(docker 部署此前无法启用降级);`ATTRAX_BUILD_SHA` 增加落地链路(build tarball 写 `.build-sha` → apply-deploy 拷到 `/opt/attrax/.build-sha` → ecosystem 启动时读,与 `.deployed` 一致);preflight secret 最小长度 32→48(对齐文档承诺);nginx vhost 删不存在的 `attrax-engagement.conf` include、README 落盘文件名改 `attrax-locations.conf`(与 vhost include 一致,此前照 README 安装 `nginx -t` 直接失败);twinbuddy 时代 `nginx-attrax-site.conf` 移入 `docs/archive/`;`app/regulations/[docId]/page.tsx` 删 phantom `NEXT_PUBLIC_RAG_SERVICE_URL`;backup 清单删不存在的 `.env.production`;`.dockerignore` 排除 `data/regulation_eval|regulation_reports`
- **依赖**:`requirements-prod.txt` 补 `Pillow`(vision 降采样隐式依赖显式化),删 0 importer 的 `cryptography`
- **死代码**:`lib/schemas.ts` 整件(22 个 export 里 21 个零引用,`SessionIdSchema` 内联进唯一消费者)+ `tests/unit/schemas.test.ts`;`findingsForObservation`(注释声称 tests 用,实际零引用);`blazeRoadmapRows` 死链条(mock 原始数组 → complipilot 转换重导出 → 无人消费);mock 的 `createMockProfitReportEU/US`
- **类型单源化**:`CitationRefContract` 收敛到 `report-package-schema.ts`(经 `lib/types.ts` re-export),`CitationChip` 不再手写第二份,消除字段 drift 风险

**验证**
- vitest 915 passed(新增 3 条透传单测、2 条 401 cookie 断言);tsc / eslint 0 error
- pytest 655 passed / 5 skipped(独立 git worktree 干净检出)
- `check:rag-openapi` / `check:rag-contract` 双 gate 通过;`npm run build` exit 0,standalone 产出正常
- 注意:共享工作树首轮 pytest 的 8 个失败经查是另一 session 未合并的法规数据(58 vs 44 YAML)污染所致,worktree 隔离复测全绿 —— 见下条方法说明

**方法说明(供下轮参考)**
- 三路 agent 报告的误报率约 50%,典型:①「后端不填 assets」——实际 `get_scan` 从 `list_uploads` 构建;②「html_parser 四个函数死代码」——实际是 `parse_html` 的内部助手;③「ObservationVM 等死导出」——实为文件内活跃类型。所有发现均先 grep/Read 复核再改,误报无一进入本清单
- 未处理(记录在案):`useScanPolling` 无 AbortController(卸载后 in-flight 请求跑完,无 setState 风险,低);401 后的「重新扫描」直达链路(现有文案已提示,UX 增强);RAG 侧 evidence/revisions 未加限流(revisions 有 idempotency 守卫,无成本放大);OpenAPI 各路由的 4xx/5xx responses 显式声明(目前仅 asset 路由补齐)

## [Unreleased] - 2026-09-17

**修复:/ready 轮询反复清空法规缓存(生产实测)**

**背景**
- 生产 `pm2 logs rag-service` 反复出现 `regulation library changed on disk — cache rebuilt (49 regulations)`,但库根本没变 —— 单个日志窗口内 26 次。仓库里唯一会写法规的是 03:00 的 `scripts/watchdog/auto_ingest.py`,不存在高频写入者
- 根因:`main._readiness_snapshot()` 无条件调用 `kb_loader.invalidate_cache()` 和 `article_loader.invalidate_cache()`;而 `article_loader.invalidate_cache()` 会**无条件** `_rebuild_generation()`。uptime monitor 每 5 分钟打一次 `/ready`,即每天约 288 次 generation tick
- 连带伤害:①`verifier._sync_article_cache()` 见 generation 变化即清空 `_ARTICLE_TEXT_CACHE`,于是两次扫描之间的轮询把引用逐字核对缓存打掉,每条 citation 重新读 YAML;②每次 `/ready` 都重新解析 49 篇法规 + 全部 KB anchors
- 注意 `/ready` 是**读探针**。它此前是 kb_loader 唯一的热更新来源 —— 所以修复不能只是"删掉 invalidate",否则 regwatch 自动入库的新 anchor 在进程重启前不可见

**实现**
- `rag_service/retrieval/article_loader.py`:`_load_all()` 单次计算 stamp、用 `_cache_lock` 串行化(避免并发扫描各自重建);tick 与日志改由「stamp 真的变了」判定,不再用 `_cache is not None` —— 那个判据会把任何 `invalidate_cache()` 之后的例行重建都报成 "changed on disk"。`invalidate_cache()` 额外清 `_cache_stamp`("无缓存即无基线"),否则下一次重建会把"换 root / 空转"误判成磁盘变更
- `rag_service/retrieval/kb_loader.py`:原本**没有任何** staleness 护栏(只在 `_cache is None` 时重读,长时间进程会一直吃旧 anchors)。补上同样的 stamp 自失效 + 锁,让去掉 `/ready` 的 invalidate 之后热更新仍然成立;顺带删掉未使用的 `import os`
- `rag_service/main.py`:`_readiness_snapshot()` 不再调用 invalidate。两个 loader 都按 stamp 自失效,读路径本身就是新鲜的 —— 读探针不再改缓存状态

**验证**
- 新增 `rag_service/tests/test_readiness_cache_stability.py`(7 例):3 例锁死「/ready 不得 tick generation、不得清 verifier 缓存」;4 例锁死「去掉 invalidate 后新鲜度仍在」(`/ready` 能报出磁盘上新加的法规;kb_loader 与 article_loader 无需 invalidate 即可看到新增/改动)
- 反向验证:把旧的 `invalidate_cache()` 两行临时加回 `_readiness_snapshot()`,前 3 例立刻全红(`assert 8 == 7`)—— 证明护栏不是空转
- pytest `rag_service/tests/` 594 passed(原 587 + 新增 7);过程中暴露并修掉了一个既有 fixture 卫生问题:`invalidate_cache()` 残留的旧 stamp 会让"换 root 后的首次重建"看起来像磁盘变更

## [Unreleased] - 2026-09-16

**功能:报告生成降级(MiniMax 全挂时仍出真报告)**

**背景**
- 识图降级上线后,MiniMax 整体挂掉时扫描仍是 `degraded`:视觉证据拿到了,但报告生成是 MiniMax-only,只能退回 mock 包。本次把生成也接上降级,实现「MiniMax 全挂 → DeepSeek 接管 → `ready` + 真报告」

**实现**
- `rag_service/config.py`:新增 `DEEPSEEK_ANTHROPIC_BASE_URL`(默认 `https://api.deepseek.com/anthropic/v1`,**含 `/v1`**),`resolve_deepseek_config()` 扩为 5 元组
- `rag_service/generate/report_generator.py`:
  - `_generate_mimotalk`(唯一传输方法,4 个调用点共用:主生成 / JSON 修复 / `generate` / profit-fill)在 primary 失败后,把同一份 body 重发到 DeepSeek 的 Anthropic 兼容端点,只用 base_url + 凭据 + model 三项差异
  - `_read_mimotalk_response` 改为拼接所有 `type=="text"` 块(跳过 `thinking`)
  - `provider` 改为「实际服务的供应商」,默认仍 `minimax`
- `rag_service/pipeline/nodes/generator.py`:生成后刷新 `provider`(原实现 :362 在生成前抓取、:488 复用,会把降级报告谎报成 MiniMax 的)
- 范围:识图仍走已验证的 OpenAI 兼容端点;不做 circuit breaker(生成器是进程级单例,粘性降级会在 MiniMax 恢复后一直用 DeepSeek)

**踩坑(重要,两个)**
- **位置读取响应会恒空**:DeepSeek 的 Anthropic 端点返回 `content[0]={"type":"thinking"}`、`content[1]={"type":"text"}`。原来的 `content[0].get("text","")` 恒为 `""` → `ValueError("mimoTalk returned empty response")` → 直接走 mock 包。实测把生成器传输指向 DeepSeek,4096/16384 都拿到这个错 —— 表面像"降级也挂了 / key 不对",实际只是读错了块
- **重试预算会吃掉降级机会**:`_LLM_MAX_ATTEMPTS=3` × `timeout=90s` + backoff(1s+2s) ≈ **273s**,而 `main._SCAN_TIMEOUT_SECS = 280`。纯超时型故障下,primary 重试就把整轮扫描预算耗尽,**DeepSeek 根本没机会被调用**。故配置了降级 key 时 primary 只试 1 次(无降级 key 时保持原来 3 次重试)。识图侧同样问题(3 × 60s),且「有降级就不要把预算耗在重试上」

**验证**
- pytest `rag_service/tests/` 587 passed(新增 `test_report_generator_fallback.py` 12 例;`conftest.py` 的 autouse fixture 补清 `DEEPSEEK_MAX_TOKENS` / `DEEPSEEK_ANTHROPIC_BASE_URL`,顺带修掉「开发者 .env 里的非默认预算会漏进断言」的潜在 flake)
- 本地真实扫描,故意用坏 MiniMax key:`status=ready`、trace `provider=deepseek`、`reportPackage.auditMetadata.provider=deepseek`(改动前同一场景是 `degraded` + mock 包)
- 本地真实扫描,MiniMax 正常:`provider=minimax`、`source=real`,无回归

**功能:识图供应商降级(MiniMax → DeepSeek)**

**背景**
- 识图只有 MiniMax 一条路。它偶发不可用(超时 / 401 / 5xx)时,整条扫描在第一步就丢掉视觉证据,下游 findings 全部退化成 `not_assessed`

**实现**
- `rag_service/config.py`:`DEEPSEEK_{API_KEY,BASE_URL,MODEL,MAX_TOKENS}` + `resolve_deepseek_config()`,沿用既有 `os.environ.setdefault` 桥接(让 `Settings(_env_file=None)` 也能看到 `.env` 值)
- `rag_service/pipeline/nodes/vision.py`:
  - `_vision_text()` 统一「缓存查找 → primary → 降级」,free-form 与 checklist 两条 prompt 共用
  - `_call_mimotalk` / `_call_deepseek` 抽到共享的 `_post_json`(同一套重试语义:网络类重试 3 次/1s+2s,HTTPError 不重试)
  - `_to_openai_messages()` 把 Anthropic 的 `image`+`source` 块翻译成 OpenAI 的 `image_url`+data URL
  - `available` 改为「任一供应商有 key」——只有降级 key 的部署不再静默变瞎
- 缓存分层:降级结果写入按 `fallback_model` 算的独立 key,不会被当成 primary 结果回放;primary 每次仍重试(可能已恢复),降级缓存只省掉重复的 DeepSeek 调用
- 范围:**只降级识图**。报告生成(`report_generator.py`)保持 MiniMax-only,降级不影响它

**踩坑(重要)**
- `deepseek-flash` 是 reasoning 模型:`reasoning_content` 与 `content` **共用** `max_tokens` 预算,reasoning 用量随图片复杂度波动(实测单张铭牌 1.2k–4.9k tokens)
- 沿用 primary 的预算(3072)会拿到 **HTTP 200 + `content: ""`** —— 表面像"降级也挂了 / key 不对",真实原因是预算被 reasoning 吃光
- 故降级通道用独立预算 `DEEPSEEK_MAX_TOKENS=16384`(8192 实测已够,16384 留余量;16384/32768 均被端点接受),并在「空 content + 有 reasoning_content」时打显式错误日志指向该变量

**验证**
- pytest `rag_service/tests/` 574 passed(新增 `test_vision_fallback.py` 27 例;`conftest.py` 新增 autouse fixture 清空 `DEEPSEEK_*`,防止单测打到线上端点)
- 真实图片:两条路都实测 —— MiniMax 正常返回;DeepSeek free-form / checklist(12 项) / 多图(3 张 → 36 observations、23 带 bbox)均返回结构化观察
- 真实进程:把 MiniMax key 换成坏 key 启动 → 日志 `vision: primary provider (MiniMax-M3) failed, served by fallback (deepseek-flash)`,视觉仍产出 3 certs / 12 observations;扫描重试的第 2、3 次走降级缓存(未重复调 DeepSeek)
- 本地真实扫描(MiniMax 正常):`POST /api/v1/scans` → `status=ready` / `source=real`,trace `vision mode=checklist observationCount=12`、`generate provider=minimax status=success`、`verify status=success`
- 备注:本地 `USE_KB_INPUT` 未设时 generate 会走 `no_documents` → `degraded`。它是 `os.environ` 读取(不是 `.env`),生产由 `scripts/ecosystem.config.cjs` 注入 `USE_KB_INPUT=true`;本地需显式导出

**生产事故:线上部分路由 500 + 图片全 404(`/opt/attrax/.next/standalone` 被删)**

**症状**
- 部分路由 500,前端渲染 branded「Runtime error / Something caught fire」错误页
- `/complipilot/logo.png`、`ocean-poster.png`、`ocean-hero.mp4` 全部 404
- 干扰项:`/`、`/upload`、`/pricing`、`/api/health` 仍返回 200 —— 只 curl 首页会误判"线上正常"

**真根因**
- pm2 `nextjs` 进程的 cwd `/opt/attrax/.next/standalone` **已被删除**（`/proc/<pid>/cwd` → `... (deleted)`）
- 触发者:当天 12:11~12:15 在服务器 `/opt/attrax` 里跑了 `npm install && npm run build`。`next build` 一开跑就清空 `.next/`,把运行中进程赖以加载 chunk 的 standalone 一起删了
- 证据:`/tmp/attrax-build.done` = `BUILD_DONE_127`（exit 127）、`/tmp/attrax-build2.done` = `BUILD2_DONE_1`（build 卡在 "Creating an optimized production build" 后死掉），两次都没产出 standalone
- 进程没立刻死（Linux 保留被删目录 inode），但 Node 按需加载 chunk:
  - `ChunkLoadError: Failed to load chunk server/chunks/ssr/_1z4zay9._.js` → `Cannot find module '/opt/attrax/.next/standalone/.next/server/chunks/ssr/_1z4zay9._.js'`
  - `Invariant: The client reference manifest for route "/profit/[sessionId]" does not exist`
  - `Invariant: The client reference manifest for route "/regulations/[docId]" does not exist`
  - `Failed to load static file for page: /500 ENOENT: .../standalone/.next/server/pages/500.html`（连 500 页面都加载不出）
  - nginx `/complipilot/*` 的 `root /opt/attrax/.next/standalone/public` 一起失效 → 图片 404

**修复**
- 本地 `scripts/build-deploy-tarball.sh` 重建完整 tarball（`COPYFILE_DISABLE=1` 去掉 macOS AppleDouble `._*` 垃圾条目）→ BUILD_ID `gaEfawLViEVVL-teld9_G` / commit `1fc4472` / 112MB
- 旧 `.next/static`（服务器上被中断构建留下的产物）备份到 `/opt/attrax/.next/_broken-<stamp>/static`
- 解包 tarball 出新的 `.next/standalone/`；`.next/static` 重指软链 → `standalone/.next/static`；`.next/BUILD_ID` 回写；`pm2 restart nextjs`
- 重启后 `/proc/<pid>/cwd` → `/opt/attrax/.next/standalone`（不再是 deleted）

**验证**
- 路由:`/profit/test` 500→200;`/regulations/updates` 500→404（正确语义，它本就不是合法 docId）
- 静态:首页 16 个 chunk/css 全 200（`application/javascript` / `text/css`）；`/upload` 页资源 0 个非 200
- 图片:`/complipilot/{logo.png,ocean-poster.png,ocean-hero.mp4}` 200 + `image/png` / `video/mp4`
- 真实扫描:POST `/api/scan` → 45s 达到 `resultReady=true`
- 日志回归:重启后反复打 500 路由，`nextjs-error.log` 新增错误行 **0**
- 单测/构建:本地 `npm run build` 通过

**治本(新增防回归)**
- `scripts/guard-no-server-build.mjs` + `package.json` `prebuild` 钩子 —— cwd 在 `/opt/` 下直接拒绝 `next build` 并打印正确部署流程；逃生舱 `ATTRAX_ALLOW_SERVER_BUILD=1`
- 已在两侧实测:本地 exit 0（放行）、`/opt/attrax` exit 1（拦截）、`ATTRAX_ALLOW_SERVER_BUILD=1` exit 0（放行）
- `CLAUDE.md` §部署雷区 + §最近修复 记录该雷区

**⚠️ 同期发现的独立线上问题（非本次代码 bug，需运营侧处理）**
- MiniMax LLM **Token Plan 配额已耗尽**。直连 `https://api.minimaxi.com/anthropic/v1/messages` 返回:
  `429 {"type":"rate_limit_error","message":"已达到 Token Plan 用量上限：请升级 Token Plan 套餐或购买积分补充用量。 (2056)"}`
- 影响:每次扫描的 `generate` 节点 429 → `validationStatus: fallback` → 会话 `status: degraded`（有降级横幅，非静默）；vision 节点仍正常
- 时间线:2026-09-15 14:34~14:38 的三次扫描仍是 `status: ready` / `validationStatus: normalized`；2026-09-16 起全部 degraded → 配额是在这之间耗尽的
- 处理:需充值 Token Plan / 购买积分，代码侧无需改动

---

## [Unreleased] - 2026-09-15

**Adversarial review round 4 (P0 + P1 + 文档同步, HEAD `2d8fa19`)**:

**P0 hazard coverage honesty**:
- `lib/result/inspection-view-model.ts:coverageOf()` — hazard+0 findings → "observed" 的旧逻辑会让 J09-skipped unreadable 检查渲染绿色"已观察" badge（用户声明 `magnets: absent` 后模糊照片被判合规）。修复：只有 `present_readable` 才 collapse 到 "observed"；其它走原 visibility 分支
- `components/result/InspectionChecklistPanel.tsx:rowFromVMCheck()` — 删除对 hazard check 的 `not_in_view` / `absent_in_visible_scope` → `present_readable` 强制 override；visiblity 透传由 coverageOf 决定

**P0 hazard matcher + immutability**:
- `rag_service/pipeline/nodes/findings_builder.py:_is_negative_hazard_observation` — 旧 substring 匹配会被对比词 `但 / 但是 / 然而 / 不过 / but / however / yet` 引入的真实 defect 截胡（`"外壳平整，无可见裂纹…但电池仓附近可见明显氧化锈迹"` → 锈迹 finding 被静默丢弃）。修复：抽出 `_CONTRAST_MARKERS`，新增 `_is_dominantly_negative_hazard_description` 要求 negative phrase **且**无 contrast marker
- 同文件 for-loop 直接 mutate `obs["visibility"]` — 违反 CLAUDE.md 不可变模式。修复：用 `effective_obs = {**obs, "visibility": "present_readable"}` 浅拷贝用于 rank/best，**不**写回 caller's observations list

**P1 NEGATIVE_VALUES 抽共享模块**:
- 新增 `rag_service/pipeline/nodes/declared_facts.py` — `NEGATIVE_VALUES` frozenset + `is_negative_value(value)` helper（strip + lower + set 查；非 str 返回 False）
- `findings_builder.py` + `generator.py` 都改 import 这一个 source of truth；消除两处字面 set 重复

**Chore cleanup**:
- `components/result/InspectionChecklistPanel.tsx` — 删除 stale `CHECK_CATALOG` 导入 + `let visibility` 改 `const`（override 删除后不再 reassign）+ 移除 unused `isHazard` 分支
- `.gitignore` — 新增 `.DS_Store`、`.screenshots/regression-*/`、`规航AI-三产品完整测试包-20260914{,.zip}`（Unicode 模式 `git check-ignore` 验证匹配）
- `scripts/run-production-regression.ts` — 把 3 处硬编码 `/Users/wangjianjun/me/attrax/...` test-package 路径 + `localhost:3001` 风格的本地 artifact dir + 3 处硬编码 prod URL 全部改成 `__dirname` 相对路径 + env override（`ATTRAX_REGRESSION_PKG_DIR` / `ATTRAX_REGRESSION_OUT_DIR` / `ATTRAX_REGWATCH_ARTIFACT_DIR` / `ATTRAX_REGRESSION_BASE_URL`）；缺包时给出 fail-loud 错误而不是跑到一半崩
- `.screenshots/_check.mjs` / `_verify.mjs` / `_verify_tabs.mjs` — 删除 Windows 路径泄漏 `E:/desktop/火鹰合规/` + 错误的 `localhost:3001` 端口

**P2 cleanup (本次独立 sweep)**:
- `scripts/build-deploy-tarball.sh` — 4 处注释 + 最后 log 行的 phantom `apply-upload-fix.sh` 改为 `/tmp/attrax-apply-deploy.sh`
- `scripts/ecosystem.config.cjs` — 删 stale "pm2 cron_restart 每天 03:00 UTC 拉起" 注释块（2026-09-13 决定已改成常驻 daemon，但旧注释仍误导）
- `docs/WATCHDOG.md` + `scripts/watchdog/README.md` — auto-ingest 契约对齐（README 旧版说"库不会自动重建"与 WATCHDOG.md + 实际代码 `ATTRAX_REGWATCH_AUTO_INGEST=true` 默认矛盾）；回滚命令去掉已删除的 `scripts/build_regulation_library.py` 引用
- `docs/infra/NEXTJS-16-STANDALONE-NOTES.md` — 删除 phantom `pages.module.css` 引用，改成实际存在的 `components/complipilot/{homepage,flow-shell,scan-image-stage,bright-flow}.module.css`

**部署 (lighthouse `43.155.141.192`)**:
- 前端 BUILD_ID `oylglbgj1A5mqY-TZ56my` / commit `8ded0ce`（tarball 通过 `attrax-apply-deploy.sh`）
- RAG service: 3 个 Python 文件 rsync + `ATTRAX_BUILD_SHA=8ded0ce` 手改 `.env`（pydantic-settings 启动读 .env）+ pm2 restart；pytest 59/59 全绿（含 4 例新 mixed-state + 1 例新 no-mutation）

---

## [Unreleased] - 2026-09-14

### Cleanup (this batch)

**Documentation fixes**:
- CLAUDE.md: removed false claims (LangGraph still used; lib/pipeline/scan.ts deleted; Next.js 16.2.4; etc.)
- docs/: deleted DEPLOYMENT.md, RECOVERY.md, E2E-REPORT-20260718.md, DEPLOY-CHECKLIST.md (referenced defunct Aliyun SZ server 120.77.36.107)
- docs/: rewrote PROJECT-STATUS.md, MOCK-REAL-MAPPING.md to match current architecture
- docs/superpowers/specs/2026-{05,07}-*: marked SUPERSEDED
- docs/API-CONTRACT.md: strengthened v1-canocal banner; legacy endpoints marked backward-compat only
- docs/FRONTEND-BACKEND-INTEGRATION.md: env keys corrected (MINIMAX_API_KEY, PAI_API_KEY)
- docs/WATCHDOG.md: removed stale `--exclude='data/faiss'` from rsync (data/faiss no longer exists)
- README.md: tree updated; DEPLOYMENT.md references redirected to docs/README.md §生产部署

**Data hygiene**:
- data/regulation_supplements/*/raw/: untracked from git (~400MB, 369 files)
- public/fonts/NotoSansSC-Regular.ttf: **kept tracked** (briefly untracked, then reverted — adversarial review showed CI + fresh clones break without it: report-export vitest reads it from disk, e2e export-downloads fetches it at runtime; a fetch-script alternative downloaded the wrong font flavor OTTO vs TrueType and would corrupt jsPDF output)
- .gitignore: tightened to prevent re-tracking (`data/regulation_supplements/*/raw/`)

**Dead code removed**:
- components/burning/BurningAnimation.tsx (177 LOC)
- app/api/session-access.ts (58 LOC)
- lib/pipeline/session-store.ts (~300 LOC) + lib/pipeline/upload-storage.ts
- lib/server-i18n.ts (sole production caller removed)
- scripts/collect_global_regulation_sources.py (906 LOC)
- scripts/deploy.sh, scripts/deploy.ps1
- tests/pressure/{load-test.js,simple-load-test.sh}
- tests/e2e/api-integration.spec.ts
- tests/unit/burning-animation.test.tsx + tests/unit/{session-store,upload-storage}.test.ts
- lib/rag-client/v1-adapter.ts getRoadmap/getTrace + corresponding test

**i18n consolidation**:
- lib/i18n.tsx TranslationProvider: removed
- All consumers (5 result/ components, regulations page) use BlazeLocaleProvider's locale

**Backend logic fixes**:
- main.py lifespan: graceful shutdown awaits scan_service.wait_for_idle() with bounded timeout
- _run_public_scan_payload: no longer double base64-encodes (passes bytes through)
- vision.py: replaced nested ThreadPoolExecutor with asyncio.gather + semaphore + asyncio.to_thread for sync LLM
- vision.py / report_generator.py: process-level proxy env pop replaced with per-request opener bypass
- application/scans.py: lease_task registered to _tasks; cleanup callback hardened against backend shutdown

## 2026-09-14 — judge review 批处理 A/A1/B1/C2 + 全项目死代码清理

**背景**:`docs/plans/2026-09-14-judge-review-and-optimization-plan.md` 冻结（11 节 J01–J11），当日完成 Batch A / A1 / B1 / C2 实施 + 第二轮全项目对抗性死代码扫描（3 subagent 并行：前端 / 后端 / 文档）。

**judge review 实施（batch A/A1/B1/C2）**:
- **A1**（58dbbf8）：J01 进度终态契约（`resultReady` + `completing` state）——修三次真实扫描卡 99% 的根因
- **A**（6b57148）：J04 引用契约（`source`/`literal`/`semantic` 分层）、J05 缺省未验证、J06 证据包 CJK 字体、J07 无依据罚款数字移除、J11 标题 fallback
- **B1+C2**（cdb069f）：J02/J09 语义检查（`(semantic, visibility)` 真值表替代全局规则；`declared_facts` 关闭电池仓检查）；J10 证据/重扫循环（`POST /scans/{id}/evidence` + `/revisions`，`EvidenceRequestPanel` UI）

**死代码清理（chore/cleanup-2026-09-14 分支）**:
- 删孤儿路由 20 文件 -3518 行：`/trace` + `/roadmap` 页面（结果页已有内联面板）+ 2 个孤儿 API + `useSessionId` + `components/trace/*` 5 文件 + `lib/format.ts` + 4 个孤儿测试
- 删 3 个死脚本 + `legal_parser.py` 共 -2255 行：`build_regulation_library.py` + `migrate_must_check_to_kb.py`（死 dyad）、`schema_validator.py`（仅测试调用）
- 删 `PROJECT_ANALYSIS.md`（自标 SUPERSEDED）+ `dist/attrax-regulations-cron-slim.zip`（4.3MB 二进制制品）+ `pixel.png`（仅被死测试引用）；`.gitignore` 加 `/dist/`
- **保留**（subagent 反向纠错）：`lib/mock/roadmap.ts`（结果页 export 链引用）、`/api/regulations/[docId]`（evidence-pack 引用）—— 这两个本来在删除清单上

**文档同步**:README 737 → 180 行重写（去掉 FAISS/LangGraph 中心叙事与"准确率>85%"无依据声明）；CLAUDE.md 同步 de-RAG 过渡态 + 2026-09 时间线 + 部署雷区专节。

## 2026-09-13 — 视觉检查 Batch A–E + 两次生产回归修复

**背景**：执行 `docs/plans/2026-09-13-visual-inspection-and-progress-plan.md` 全批次。

**交付**（e1244aa + 1698d67）:
- **Batch A**（988b726）：真实阶段事件、imageId 热点、去固定 85%/管线风险误报
- **Batch B**（1f3319b）：视觉检查清单（`data/inspection_profiles/*.yaml` 11 个 profile）、v2 observations、grounding verifier
- **Batch C**（10c935a）：intrinsic-ratio canvas、扁平证据框、真实裁片悬浮
- **Batch D**（e1244aa）：适用性引擎（三态 ProductFacts）、确定性 findings（零 LLM）、视觉缓存（sha256 键 500 LRU）
- **Batch E**（e1244aa）：mask contract（`FloatingEvidenceCrop` maskUrl）、`scripts/eval_grounding.py` + 标注格式文档
- `ATTRAX_BUILD_SHA` 改 pydantic-settings 读 `.env`（1698d67）——`pm2 restart` 即生效，避开 pm2 env 雷区

**生产回归（3a8dc1a + b6cea17，部署后真实扫描暴露）**:
- `_parse_vision_text` 结构化分支丢 `observations` key → 透传原始数组（单测 mock 不到"中间层丢 key"，教训：新链路字段透传要端到端测）
- 六个管线节点被误判为风险 → 过滤表按**精确 node.id** 匹配（不能按 type）
- 零风险扫描被错送 `ResultIncompletePanel` → 有 observations/findings 层就正常渲染

**验证**：pytest 464/464、vitest 967/967、生产两次真实扫描（充电器 EU/UK）阶段事件 12→36→93→100 全程可见。

## 2026-09-10 — 2026-09-09 审计批处理（详见 docs/plans/2026-09-09-optimization-audit.md）

**背景**:2026-09-09 只读审计发现文档/代码系统性脱节与死代码债务。本日按审计清单批量修复,全部验证后部署。

**代码变更**:
- 删除死代码 ~1446 行:`lib/pipeline/scan.ts` + `scan-queue.ts`(937,被 v1-adapter 绕过)、`components/upload/UploadForm.tsx`(509,已标 @deprecated)、`LegacyResultView` 及 5 个对应测试文件;`upload-storage.ts` 标 @deprecated
- **P0-1 渲染闭环**:`DegradedBanner`/`SourceNotice` 此前定义了但从未被任何页面渲染 —— 现接入 `app/result/[sessionId]/page.tsx` 成功态与空风险态,降级原因由新 `use-result-loader` hook 记录
- `result/[sessionId]/page.tsx` 1215 → 807 行:纯函数抽到 `lib/result-view-helpers.ts`,轮询抽到 `use-result-loader.ts`,非成功态抽到 `result-state-panels.tsx`
- `ALLOWED_MARKETS`/`MAX_MARKETS_PER_SCAN` 收敛到 `rag_service/config.py` 唯一来源(原 3 处重复)
- 安全:POST /api/scan 的 accessToken 响应体暴露从 `NODE_ENV!=="production"` 改为 `ATTRAX_DEBUG_TOKEN=1` 显式 opt-in
- 依赖:npm 删 5 个零引用包;`next` 16.2.6→16.3.4 等,npm audit 11 漏洞(含 1 critical: Next RCE)→ **0**;requirements 删 cohere;`requirements.txt`→`requirements-snapshot.txt`
- `generator.py` agent_trace 分离处加维护红线注释(防 32k trace 事故复发)

**文档变更**:CLAUDE.md/README/PROJECT-STATUS/RAG-ARCHITECTURE-v3 全部对齐 v1-adapter 现实架构,清除"cohere 已实现"等虚假描述;PROJECT_ANALYSIS.md 标 SUPERSEDED。

**新增测试** 13 个:`result-degraded-banner`(7)、`report-export-modules-smoke`(6,真实 jsPDF+Packer 产物断言)、`test_zip_bomb_docx`(3)。合计 vitest 65 files/927 tests 全绿;pytest 565 全绿;tsc/build 通过。

**评估后暂缓**:CSP nonce 化(需全站动态渲染专项,SSG 页会被 strict-dynamic 阻断)。

## 2026-08-13 — commit `566c4ae` — 文档对账 + 7-21~8-10 部署回写

**背景**:对抗性审查发现 `docs/SERVER-VERSION.md` 滞留在 2026-07-20 的 `f167767`,而服务器 `.deployed` 实际已是 `566c4ae`(2026-08-10 10:22 build)。中间 12 个 commit 已部署但未回写文档。本次只改文档对齐真值,无代码改动。

**服务器真值(SSH `cat /opt/attrax/.next/standalone/.deployed`)**:
- commit=`566c4ae` / commit_full=`566c4ae3af7bafad498568767031c51d26927ac9`
- build_id=`WB3ldfLOxeBRK3xWwClDv` / branch=`main` / ref=`origin/main`
- built_at=`2026-08-10T10:22:50+08:00`
- 探活:前端 `/api/health`=200/6ms;RAG `:8001/health`=`ok`/`demo_mode=false`/`embedding=modelscope_api`/`dense_dim_mismatch_count=0`

**7-21 ~ 8-10 已部署的 12 个 commit(此前未回写 CHANGELOG,现补登)**:

| commit | 主题 |
|---|---|
| `4a00ef3` | docs(server):同步线上真值到 f167767 + trace [sessionId] 部署 |
| `841d880` | fix(frontend):修 35/D 单一问题 — HIGH 不再折成 critical + mock 按 preset 给分数梯度 |
| `b7bf784` | feat(frontend):add uploaded-image 2.5D 扫描阶段 |
| `86fc2fd` | merge:合并 origin/codex/upload-image-stage(前端 2.5D 扫描阶段) |
| `aee801d` | fix(profit-page):真实后端扫描利润页不再用 mock 兜底 |
| `e851f20` | feat(result-page):结果页加利润摘要条 + 利润页 bare 模式加风险 caveat |
| `edb49ae` | refactor(export):利润页 PDF/DOCX 改走 RenderModel,字符与前端一致 |
| `da3f816` | fix(export):利润页 PDF/DOCX 白底白字显示空白,小卡片改白底,成本利润说明走统一 RenderModel |
| `0615689` | docs:define actual financial report integrity |
| `25f9604` | fix(profit):财务报告真实数据闭环,停用 Markdown 猜测与固定 ¥128 |
| `8563cd2` | fix(backend):scan 合规整改 + 队列安全 + 诚实输出(P0-1/P1-1/P1-2) |
| `566c4ae` | fix(ci):清零 CI/CD 暴露的 e2e/audit 债务 + 补服务器健康监控告警 (#4) |

**主线主题**:
1. **利润导出统一**(`edb49ae`/`da3f816`):新增 `ProfitRenderModel` 作为页面 + PDF/DOCX 唯一真值源,修白底白字 + 两入口数字不一致。
2. **财务报告诚实化**(`25f9604`):真实扫描不再用正则从 markdown 猜金额 / 固定 ¥128 兜底;`synthesizeFinancialSummaryIfMissing` 在缺结构化字段时返回 null(诚实降级),而非伪造。
3. **scan 后端整改**(`8563cd2`):P0-1 降级红色 banner + degradedReason 暴露;P1-1 accessTokenHash 防覆盖;P1-2 withWriteLock 串行化 + enqueueScan 失败回滚。
4. **CI 债务清零**(`566c4ae`,PR #4):e2e/audit 暴露的债务清零 + 补服务器健康监控告警。

## 2026-07-20 — commit `6bce766` — 8 个用户可见 bug + 93 CI 测试债 → 0

**部署**:BUILD_ID `8MPBvunubBpYuqCrC_gW4`(上一个 `ekmjiomccTcAos50wKnTw`)。
**SSH 端到端真实扫描验证**:65W 充电器图 → 11 次轮询 55 秒 → 真实 RAG 报告 score=35/D(charger 缺图高危),全链路工作。
**测试**:`npx vitest run` → **943 / 943 passed**(从 93 失败修复)。

### 产品代码 8 个用户可见 bug

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| 1 | standalone 生产 next/image 优化失败,`/complipilot/*` `/mock-fixtures/*` 全部破图(err log 80+ 行 `received null`) | `next.config.ts` | `images.unoptimized: true`(standalone 部署不自带 sharp optimizer) |
| 2 | 英文 demo 合规章导出吐 `{{PRODUCT}}` `{{SCORE}}` 占位符废文本 | `lib/reporting.ts:135` | `locale === "en" ? EN : ZH.replace(...)` 因 `.replace` 优先级高于 `?:`,EN 分支直接返回原模板 → 改 `const tpl = ...; tpl.replace(...)` |
| 3 | 真实扫描 trace 耗时全部显示 `0.0s` | `app/api/trace/[sessionId]/route.ts` | 加 `_traceDurationMs` helper 读 `durationMs ?? duration_ms ?? duration` 兜底(后端 `_camelize` 已转 camelCase,v1 路径之前只读 snake 拿不到) |
| 4 | Demo / 降级模式 UI 显示 `verdict=UNKNOWN` `riskLevel=LOW` | `lib/mock/scan-result.ts` | verdict / riskLevel 从 `nodes[0].metadata` 提升到 `decisionView` 顶层(前端 schema 9c6a76f 已提升、真实后端也在顶层产出),每个 node 加 `severity` |
| 5 | 65W / 加湿器 / 儿童积木 demo 在 upload 选 EU/US 但渲染落回 EU/UK,儿童积木还丢 US-CPSIA-TOY 法规 | `app/upload/page.tsx` `app/result/[sessionId]/page.tsx` | `startPresetDemo` 在 query 里带 `markets=EU,US`(逗号分隔),result page 读 query 传给 `createMockScanResult({ category, markets })`,`createMockScanResult` 本来就支持 `options.markets` |
| 6 | `/[locale]` 首页 eyebrow 仍硬编码 `Blaze Hawks` 与 `{t("title")}` 品牌名自相矛盾 | `app/[locale]/page.tsx:32` | 改为 `{locale === "en" ? "CompliPilot" : "规航AI"}` |

### 产品逻辑 2 个改进

| 问题 | 文件 | 修复 |
|------|------|------|
| UNKNOWN complianceStatus 映射到 `info` / 90/A(过度乐观,合规场景危险:用户据此放行) | `lib/rag-client/v1-result-adapter.ts` `lib/types.ts` | `Severity` union 加 `unknown`,`scoreFor("unknown") = 50/C` 中性档(不是 90/A 绿色);`severityFor` 加 `"unknown"` 映射;`resultScore` 改 UNKNOWN 走 `scoreFor("unknown")` |
| `buildProfitReport` 真实 RAG 路径无 financialSummary 时,删了正则 fallback(3e5259e)后**静默**生成空/伪 content | `lib/reporting.ts` | 优先透传 `backend profitReport.markdown`(后端 LLM 生成的真实分析);既无 financialSummary 也无 backend markdown 时显式返回 `Figures not available` 而非伪造金额 |

### 测试 CI 93 失败 → 0

| 文件 | 失败数 → 0 | 根因 | 修法 |
|------|------------|------|------|
| `tests/unit/report-export.test.ts` | 86 → 0 | 71f9292 启用 PDF/DOCX 客户端导出改用 `doc.output("blob")` 后,测试 mock 缺 `output` 方法 + anchor 缺 `style`,导致 `doc.output is not a function` 整个测试 throw | (1) `jsPDFMethods` 加 `output: vi.fn(() => ({}))`;(2) `mockAnchorRef.current` 加 `style: { display: "" }`;(3) `expect(jsPDFMethods.save).toHaveBeenCalledWith(filename)` → `expect(mockAnchorRef.current.download).toBe(filename)`(实现走 `downloadBlob` 设 `a.download`);(4) 4 个 `removeChild`/`revokeObjectURL` 断言前 `await new Promise(setTimeout)` flush(`downloadBlob` 用 `setTimeout(0)` 异步清理);(5) 1 处品牌名"火鹰"→"规航AI" |
| `tests/unit/v1-result-adapter.test.ts` | 1 → 0 | a2235dd 改 `severityFor` 读 `node.severity` 后,fixture node 只用旧 `status:"warning"` 无 `severity`,fallback 到 `info` → 90/A ≠ 期望 65/C | fixture node 加 `severity: "medium"` |
| `tests/unit/api-scan-session-full.test.ts` | 1 → 0 | score contract fixture 无 agentTrace,UNKNOWN 走 fallback | fixture `agentTrace: [{ node: "synthesis", severity: "medium" }]`(同时和 UNKNOWN→50/C 修复配合) |
| `tests/unit/rag-client-report-package.test.ts` | 已含 | 断言反向(期望 `metadata.verdict`) | 改 `expect(dv.verdict).toBe("REJECTED")` 等顶层断言 |
| `tests/unit/i18n-comprehensive.test.ts` | 已含 | 71f9292 漏改第 93 行 | `'火鹰合规'` → `'规航AI'` |
| `tests/unit/upload-page-actions.test.tsx` | 已含 | 6a360fa 改 `startPresetDemo` 加 `?preset=...` query 后,测试断言还是 `/result/demo` | 断言 `expect.stringContaining("/result/demo?preset=charger")`(包含 markets query 也通过) |
| `tests/unit/reporting-real-profit.test.ts` | 2 → 0 | 期望 buildProfitReport 透传 backend markdown 或 "not available",但实现走合成 markdown | 见上面 `lib/reporting.ts` 修复(同一改动) |
| `tests/unit/useScanPolling.test.tsx` | 3 → 0 | 注释 `// POLL_INTERVAL_MS` 但实际 `POLL_INITIAL_INTERVAL_MS = 2000` 不是 850;同步 `advanceTimersByTime` 不 flush microtask | (1) `850` → `2000`;(2) `advanceTimersByTime(` → `advanceTimersByTimeAsync(`;(3) `renderHook` 后用 `flushInitialPoll()` helper 或 `await act(advanceTimersByTimeAsync(1))` 等初始 fetch 真正发起 |

### 治本机制:`.deployed` 标识

- 之前线上 BUILD_ID 与本地 commit 失联(SERVER-VERSION.md 滞后 1+ 个 commit),靠人工对账。
- `scripts/build-deploy-tarball.sh` 加 `[3.5]` 块:`stage` 时自动写 `commit / commit_full / build_id / branch / ref / built_at` 到 `${STANDALONE}/.deployed`,随 tarball 走、`apply-upload-fix.sh` 解包后落地到 `/opt/attrax/.next/standalone/.deployed`。
- 对账:`ssh attrax 'cat /opt/attrax/.next/standalone/.deployed'` 一次拿到 commit + BUILD_ID + ref,无需再手动维护 `docs/SERVER-VERSION.md` 版本表。

### `.gitignore` 顺手修复

- `规航AI-源码-后端联调-20260717/` 850MB 目录的 pattern 原本被误写在注释行末尾 + 被 stray `\r` 污染,**从未生效**(`git status` 一直显示该目录 `??`)。拆出独立行 + 统一文件 CRLF → LF(符合 `.gitattributes eol=lf`)。
- 新增 `scripts/check-react-418.mjs` 到 throwaway 7/18 debug probe 区块(归 `c0a8bb4` 同一类)。

## 2026-07-19 — `edb2431` — `.deployed` 机制 + 版本对账文档

详见 [docs/SERVER-VERSION.md](docs/SERVER-VERSION.md)。`edb2431` 引入 `.deployed` 治本机制(首次为修复 `6bce766` 部署时使用);同时把 `docs/SERVER-VERSION.md` 从滞后 `db3a54b` 的状态更新到真值 + 标记 `§6 待办 .deployed` 完成。

## 2026-07-18 — `83890ae` — standalone 部署补 static+public staging

`build-deploy-tarball.sh` / `apply-upload-fix.sh` 在 `next.config.output = "standalone"` 下,`.next/static`(客户端 CSS/JS)+ `public/` 不会被自动拷进 `.next/standalone/`,浏览器加载 `/_next/static/*` 全部 404、整站裸奔。事故根因 2026-07-18 19:00(成都阿里云 ECS load 111 + sshd MaxStartups 卡死),事故期间多次部署发现:tarball 内 `static/` 缺失 → 整站 CSS 404。

修复:`build-deploy-tarball.sh` 在 `[3] stage` 步骤把 `.next/static` + `public/` 拷进 `standalone/`,并强校验 `css ≥ 2 + media ≥ 5` + `public/` 存在,不强校验则 `exit 2` 拒绝打包;`apply-upload-fix.sh` 解包后同样校验,不通过就回滚到 `standalone-pre-upload-fix-*` 备份,绝不带病上线。
