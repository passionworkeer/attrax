# Attrax 运行与部署约束

仅在本次任务涉及运行配置、构建或部署时读取。具体值以 `scripts/ports.env`、`scripts/ecosystem.config.cjs`、`rag_service/config.py` 和部署脚本的最新内容为准。

## 本地运行

- Next.js 默认使用端口 3000，RAG 默认使用端口 8001；BFF 目标由 `RAG_SERVICE_URL` 配置。Docker 容器内部端口按 `docker-compose` 的实际映射处理。
- 前端通过 `npm run dev` 启动；在仓库根目录运行 `rag_service/.venv/bin/python -m uvicorn rag_service.main:app --reload --port 8001` 启动后端。
- Python 安装清单使用 `rag_service/requirements-prod.txt`；先检查项目已有环境。生产 PM2 配置中的绝对路径用于服务器部署。
- 主模型使用 `LLM_*` 配置。DeepSeek 的识图端点与报告生成端点分别遵循 OpenAI、Anthropic 兼容协议；预算、超时、重试和供应商标记按照当前实现维护。
- 中间目录位于当前工作目录内并加入 `.gitignore`。构建交付包及应用交付包时，显式将 `ATTRAX_TARBALL` 指向该目录内的实际文件；脚本内部使用的临时目录也须满足用户约定。

## 数据与认证

- 会话、任务、上传文件由 RAG 文件后端持久保存，过期时间读取 `rag_service/config.py`；管理员认证和统计使用 `data/admin/` 中的本地数据。部署不得覆盖运行数据。
- `RAG_INTERNAL_SECRET` 在生产由 `/opt/attrax/.rag-internal-secret` 提供，所有者为 `root:attrax`、权限为 `640`，服务账号只能读取，通过 PM2 配置同时注入 BFF 与 RAG。密钥缺失时生产启动必须失败；密钥不能进入版本控制、日志或交付报告。
- 管理员密码、认证文件、会话令牌与真实上传内容保持本地或服务器私有存储。调整认证后验证登录、失效、同源检查与访问边界。
- 法规原件、目录登记、正文和锚点必须保持可追溯关联。向服务器同步法规时保留 watchdog 已写入的数据，采用添加或合并方式，并基于服务器实际内容重建索引。
- 备份需要覆盖会话、任务、上传、管理员数据与必要审计记录；核对实际备份产物及定时任务状态。

## 交付包与进程

- 在本地构建 Next.js。禁止在正在提供服务的 `/opt/attrax` 目录运行 `next build` 或绕过 `scripts/guard-no-server-build.mjs`。
- `scripts/build-deploy-tarball.sh` 负责交付包，必须包含 `standalone/.next/static/`、`standalone/public/`、运行标识与 `standalone/ops/`。完整校验交付包后再按已有授权上传。
- 使用版本控制内的 `scripts/apply-deploy.sh` 应用交付包；保留可用产物和运行数据。源码版本与部署的运行产物分别核对，以 `.build-sha`、`.deployed` 和实际服务信息确认版本。
- `.next/static` 指向当前 `standalone/.next/static`；nginx 静态资源配置与当前交付包路径一致。验证 CSS、JavaScript、字体、图片和视频均能读取。
- PM2 从 `scripts/ecosystem.config.cjs` 启动。修改其中的环境变量、路径或进程设置后，使用脚本所采用的 `startOrRestart` 重新读取配置；修改 `.env` 后重启受影响进程。Next.js 进程不发送 PM2 ready 信号，保留当前退出等待配置。
- aliyun-sz 的 PM2 由 `pm2-attrax.service` 以无登录、无 sudo 的 `attrax` 账号运行，PM2_HOME 为 `/var/lib/attrax-app/.pm2`。root 运维通过 `/usr/local/sbin/attrax-pm2` 调用；旧 `pm2-root.service` 已禁用并屏蔽。代码归 root 所有，数据、日志和显式缓存目录可由服务账号写入；部署后执行 `/usr/local/sbin/attrax-runtime-permissions`，不得恢复 root 业务进程。`/usr/local/bin/pm2` 会将 root 的普通 PM2 命令转交服务账号，禁止直接以 root 调用 `/usr/bin/pm2` 或包内 PM2。
- 自愈检查每分钟核对公网 health 和 nextjs、rag-service、regwatch 三个进程，真实状态原子写入 root 私有的 `/var/lib/attrax-healthcheck/process-status.json`。admin 仅能 sudo 执行 `/usr/local/sbin/attrax-admin status|restart|health` 三个固定操作。
- 端口由 `scripts/ports.env` 管理，并经 `scripts/sync-ports.js`、`scripts/render-nginx-vhost.sh` 更新对应配置。nginx 的共享区域定义和使用位置须同步维护。
- nginx 配置检查通过后仍须确认新 worker 与实际请求行为。共享区域 key 发生变化时遵循部署脚本的进程更新检查。

## 部署验证

检查运行版本、进程与端口、静态资源、BFF 到 RAG 的内部认证，并完成授权范围内的新真实扫描：提交成功、轮询结束、报告可读取、引用与导出符合预期。检查重试、限流与错误状态时保留真实请求和响应证据。

按需读取 [端口说明](infra/PORTS.md)、[Next.js standalone 说明](infra/NEXTJS-16-STANDALONE-NOTES.md)、[服务器操作手册](infra/SERVER-OPERATIONS.md)。执行命令前与当前脚本和配置核对，保留用户规定的目录、文件编辑与授权边界。
