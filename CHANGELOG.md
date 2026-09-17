# Changelog

本项目所有重要修复的根因记录,供未来对账 / post-mortem / 新人上手。

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
