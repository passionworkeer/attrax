# Attrax server config (docs/infra/)

> 本目录存 **配置片段**（nginx / sysctl / sshd / journald / fail2ban / cron / logrotate）。
> 可执行运维脚本一律在仓根的 `scripts/` 下 —— 曾经两处各存一份 `backup-data.sh`，
> 结果服务器跑的和文档里的不是同一个文件，已在 2026-09-17 合并为 `scripts/` 单一来源。

## 谁拥有什么（重要，避免再次出现"两套并存"）

| 范围 | 归属 | 位置 |
|---|---|---|
| attrax 的 nginx / 部署 / 备份 / 日志轮转 | **本仓** | `docs/infra/*`（配置）+ `scripts/*`（脚本） |
| 监控台、uptime 探针、`monitor-events.log` 轮转 | **work 仓** | `work/ops/monitor/`（服务器副本 `/home/ubuntu/uptime-check.sh`，cron `/etc/cron.d/uptime-monitor`） |

> 历史上 attrax 仓里还有一套 `uptime-check.sh` + `uptime-alert.sh` + `cron-attrax-uptime`，
> 但 `uptime-alert.sh` 从未安装到服务器，且与 work 仓的实现冲突。已删除，统一归 work 仓 ——
> 详见 `work/ops/monitor/uptime-check.sh` 头部注释（标注了同步方式）。

## 当前活跃文件（lighthouse，腾讯云首尔 43.155.141.192）

| 文件 | 部署到 | 用途 |
|---|---|---|
| `NEXTJS-16-STANDALONE-NOTES.md` | — | Next 16 standalone 部署流程与坑（当前部署必读） |
| `nginx-attrax-locations.conf` | `/etc/nginx/snippets/` | 共享 location 块（静态资源 alias、`/api/scan*` 限流、敏感路径 404） |
| `cron-attrax-backup` | `/etc/cron.d/attrax-backup` | 每日 03:00 本地数据备份（`scripts/backup-data.sh`） |
| `cron-attrax-backup-remote` | `/etc/cron.d/attrax-backup-remote` | 每日 04:00 异地备份 —— **异地目标尚未配置，当前是 no-op**，见文件头注释 |
| `logrotate-attrax` | `/etc/logrotate.d/attrax` | 轮转 `/opt/attrax/logs/*.log`、pm2 日志、`data/backend/audit.jsonl` |

对应的可执行脚本：`scripts/backup-data.sh`、`scripts/backup-remote.sh`、
`scripts/build-deploy-tarball.sh`、`scripts/apply-deploy.sh`。

## 历史快照（⚠️ 阿里云深圳 `120.77.36.107` 时代，该机已退役）

以下文件是 2026-06-21 从旧机抓取的快照，**不要直接 scp 到 lighthouse**；仅作新机参考。
其中的 IP、`admin` 用户、`/opt/attrax/scripts/{uptime,backup}-*.sh` 路径均已不适用。

| 文件 | 旧机路径 |
|---|---|
| `nginx-nginx.conf` | `/etc/nginx/nginx.conf` |
| `nginx-custom-error-pages.conf` | `/etc/nginx/custom-error-pages.conf` |
| `sysctl-99-attrax-hardening.conf` | `/etc/sysctl.d/99-attrax-hardening.conf` |
| `sshd-00-attrax-hardening.conf` | `/etc/ssh/sshd_config.d/00-attrax-hardening.conf` |
| `sshd-banner.txt` | `/etc/ssh/banner` |
| `journald-00-attrax.conf` | `/etc/systemd/journald.conf.d/00-attrax.conf` |
| `fail2ban-filter-attrax-404-probe.conf` | `/etc/fail2ban/filter.d/attrax-404-probe.conf` |
| `fail2ban-jail-attrax-404-probe.conf` | `/etc/fail2ban/jail.d/attrax-404-probe.conf` |

> `attrax-404-probe` jail 未部署到 lighthouse；lighthouse 实际有 4 个 jail
> （`sshd` / `nginx-auth` / `nginx-botsearch` / `recidive`），见 `docs/SECURITY.md`。
> 旧的 Ansible 编排（`deploy-infra.yml` / `inventory.example`）已移入
> `docs/archive/`，因为「Ansible 流程已不维护」。

## 安装到服务器

```bash
# 配置片段（在仓根执行）
# 落地的目标文件名 = `attrax-locations.conf`（不带 nginx- 前缀），与 vhost
# 第 33 行 `include snippets/attrax-locations.conf;` 与生产实际命名一致。
scp docs/infra/nginx-attrax-locations.conf lighthouse:/tmp/
ssh lighthouse 'sudo cp /tmp/nginx-attrax-locations.conf /etc/nginx/snippets/attrax-locations.conf && sudo nginx -t && sudo systemctl reload nginx'

# cron —— 注意安装时要改名：仓内 cron-attrax-backup → /etc/cron.d/attrax-backup
# （与服务器现有命名一致；/etc/cron.d 只接受 注释 / KEY=VALUE / 作业行）
scp docs/infra/cron-attrax-backup docs/infra/cron-attrax-backup-remote lighthouse:/tmp/
ssh lighthouse 'sudo install -m 644 -o root -g root /tmp/cron-attrax-backup /etc/cron.d/attrax-backup'
ssh lighthouse 'sudo install -m 644 -o root -g root /tmp/cron-attrax-backup-remote /etc/cron.d/attrax-backup-remote'
ssh lighthouse 'ls -la /etc/cron.d/'

# logrotate —— 装完务必先 dry-run
scp docs/infra/logrotate-attrax lighthouse:/tmp/
ssh lighthouse 'sudo cp /tmp/logrotate-attrax /etc/logrotate.d/attrax && sudo logrotate -d /etc/logrotate.conf 2>&1 | grep -i error; echo "dry-run exit=$?"'
ssh lighthouse 'sudo systemctl status logrotate --no-pager | head -5'

# 脚本（单一来源 = 本仓 scripts/）
scp scripts/backup-data.sh scripts/backup-remote.sh scripts/apply-deploy.sh lighthouse:/tmp/
ssh lighthouse 'sudo install -o ubuntu -g ubuntu -m 700 /tmp/backup-data.sh /tmp/backup-remote.sh /opt/attrax/scripts/ && sudo install -m 755 /tmp/apply-deploy.sh /tmp/attrax-apply-deploy.sh'
```

> `install` 而不是 `cp`：一次把 owner/mode 定好。注意 `/opt/attrax/scripts/apply-deploy.sh`
> 与服务器既有的 `/tmp/attrax-apply-deploy.sh` 是同一份东西，后者是部署时消费的位置。

## 生成 TLS 证书（生产）

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d wangjianjun.xyz -d www.wangjianjun.xyz
# 自动续期走 certbot.timer
```

## 重新抓取本目录快照

```bash
# 从服务器导出（注意：写清是哪台机 —— 旧文档这里的 IP 早已退役）
ssh lighthouse '
  sudo cat /etc/nginx/snippets/attrax-locations.conf
  sudo cat /etc/logrotate.d/attrax
  sudo cat /etc/cron.d/attrax-backup
  sudo cat /etc/cron.d/attrax-backup-remote
' > /tmp/attrax-infra-dump.txt
```

> 本目录不再走 IaC：Ansible 流程已停止维护，当前是 `docs/infra` + `scripts/` +
> 手动/半自动安装（见上）。仓内没有任何脚本会自动安装这些片段。
