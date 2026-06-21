# Attrax Server Config (infra/)

> Snapshots of `/opt/attrax` server configuration files at `203.0.113.10`.
> Captured 2026-06-21 after 11 rounds of hardening.
> Companion: `../SECURITY.md` for the security policy and `../SERVER-OPS.md` for ops manual.

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
ssh root@203.0.113.10 '
  cat /etc/nginx/sites-available/attrax > /tmp/nginx-attrax-site.conf
  cat /etc/nginx/nginx.conf > /tmp/nginx-nginx.conf
  # ... etc
'

# From the repo
scp root@203.0.113.10:/tmp/nginx-attrax-site.conf docs/infra/
```

Or use a dedicated IaC tool (Ansible, Puppet, Chef) — see roadmap.
