# Attrax Server Config (infra/)

> **Historical snapshots** captured 2026-06-21 at `120.77.36.107`（aliyun-sz 时代）after 11 rounds of hardening.
> Attrax 生产已迁移至腾讯云首尔 lighthouse（`43.155.141.192`）；下列 conf 仍适用于新机参考，但 **Ansible 流程已不维护**，当前部署走 git bundle + tar + pm2（见根目录 `README.md` §部署 与 `NEXTJS-16-STANDALONE-NOTES.md`）。
> Companion: `../SECURITY.md` for the security policy.

## 当前活跃文件（lighthouse 时代）

| File | Purpose |
|---|---|
| `NEXTJS-16-STANDALONE-NOTES.md` | Next 16 standalone 部署坑（`_next/static` alias、`public/` symlink、nginx 站配）——当前部署必读 |
| `nginx-attrax-locations.conf` | nginx `location` 块快照（lighthouse 当前） |

## Files

| File | Server path | Purpose |
|---|---|---|
| `nginx-nginx.conf` | `/etc/nginx/nginx.conf` | Main nginx config (http block, server_tokens, buffer/timing) |
| `nginx-attrax-site.conf` | `/etc/nginx/sites-available/attrax` | Attrax vhost (TLS, reverse proxy, rate limit, headers) |
| `nginx-custom-error-pages.conf` | `/etc/nginx/custom-error-pages.conf` | 404/403/5xx custom pages |
| `sysctl-99-attrax-hardening.conf` | `/etc/sysctl.d/99-attrax-hardening.conf` | 22 kernel hardening params |
| `sshd-00-attrax-hardening.conf` | `/etc/ssh/sshd_config.d/00-attrax-hardening.conf` | MACs, MaxAuthTries, Alives, Banner |
| `sshd-banner.txt` | `/etc/ssh/banner` | Login legal warning |
| `journald-00-attrax.conf` | `/etc/systemd/journald.conf.d/00-attrax.conf` | 200M cap, 14-day retention |
| `fail2ban-filter-attrax-404-probe.conf` | `/etc/fail2ban/filter.d/attrax-404-probe.conf` | Custom 4xx probe filter |
| `fail2ban-jail-attrax-404-probe.conf` | `/etc/fail2ban/jail.d/attrax-404-probe.conf` | Custom 404 probe jail |
| `cron-attrax-backup` | `/etc/cron.d/attrax-backup` | Daily 03:00 backup |
| `cron-attrax-uptime` | `/etc/cron.d/attrax-uptime` | Every 5 min health check |
| `backup-data.sh` | `/opt/attrax/scripts/backup-data.sh` | FAISS + .env tar.gz |
| `uptime-check.sh` | `/opt/attrax/scripts/uptime-check.sh` | `/api/health` curl |

## Applying to a new server

```bash
# 1. nginx
sudo cp nginx-*.conf /etc/nginx/
sudo cp nginx-custom-error-pages.conf /etc/nginx/
sudo ln -sf /etc/nginx/sites-available/attrax /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 2. sysctl
sudo cp sysctl-99-attrax-hardening.conf /etc/sysctl.d/
sudo sysctl -p /etc/sysctl.d/99-attrax-hardening.conf

# 3. sshd
sudo cp sshd-00-attrax-hardening.conf /etc/ssh/sshd_config.d/
sudo cp sshd-banner.txt /etc/ssh/banner
sudo chmod 644 /etc/ssh/banner
sudo sshd -t && sudo systemctl reload ssh

# 4. journald
sudo mkdir -p /etc/systemd/journald.conf.d
sudo cp journald-00-attrax.conf /etc/systemd/journald.conf.d/
sudo systemctl restart systemd-journald

# 5. fail2ban
sudo cp fail2ban-filter-attrax-404-probe.conf /etc/fail2ban/filter.d/
sudo cp fail2ban-jail-attrax-404-probe.conf /etc/fail2ban/jail.d/
sudo systemctl restart fail2ban

# 6. cron
sudo cp cron-attrax-* /etc/cron.d/
sudo cp backup-data.sh uptime-check.sh /opt/attrax/scripts/
sudo chmod 700 /opt/attrax/scripts/backup-data.sh
sudo chmod 700 /opt/attrax/scripts/uptime-check.sh
sudo chown admin:admin /opt/attrax/scripts/backup-data.sh /opt/attrax/scripts/uptime-check.sh
sudo mkdir -p /opt/attrax/logs && sudo chown admin:admin /opt/attrax/logs && sudo chmod 750 /opt/attrax/logs
```

## Generating TLS cert for production

Self-signed certs are fine for staging. For public launch, use a real domain + Let's Encrypt:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
# Auto-renew via systemd timer
```

Then update `nginx-attrax-site.conf`:
- Replace `ssl_certificate` / `ssl_certificate_key` paths with Let's Encrypt paths
- Add `ssl_dhparam /etc/ssl/dhparam.pem;` (generate with `openssl dhparam -out /etc/ssl/dhparam.pem 2048`)

## Regenerating this directory

```bash
# From the server (after editing)
ssh root@120.77.36.107 '
  cat /etc/nginx/sites-available/attrax > /tmp/nginx-attrax-site.conf
  cat /etc/nginx/nginx.conf > /tmp/nginx-nginx.conf
  # ... etc
'

# From the repo
scp root@120.77.36.107:/tmp/nginx-attrax-site.conf docs/infra/
```

Or use a dedicated IaC tool (Ansible, Puppet, Chef) — see roadmap.
