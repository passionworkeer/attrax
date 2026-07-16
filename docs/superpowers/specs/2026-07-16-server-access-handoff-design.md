# Attrax Server Access Handoff Design

## Goal

Leave a durable, secret-free handoff that lets a future maintainer connect to the current Attrax production server and understand its deployment constraints without changing production today.

## Scope

- Document the verified SSH entry point and local key fingerprint.
- Record the verified production path, process manager, health endpoints, and systemd state.
- Record that `/opt/attrax` is not a Git checkout and that the private repository cannot be cloned anonymously from the server.
- Record the files and directories that must survive any future deployment.
- Record the decision not to deploy the current local `main` because the frontend will be substantially rebuilt later.
- Add a small Codex memory update containing the same operational facts without passwords or private-key material.

## Security Boundary

The repository may contain the server IP, SSH username, public-key fingerprint, and operational commands. It must not contain passwords, API keys, `.env` contents, private keys, or a copy of `authorized_keys`.

## Acceptance Criteria

- `ssh admin@203.0.113.10` works from the current workstation using the existing Ed25519 key.
- The handoff identifies `/opt/attrax`, `PM2_HOME=/home/admin/.pm2`, and `pm2-root.service`.
- The handoff states that production was not updated on 2026-07-16.
- The handoff gives read-only verification commands and a safe key-revocation command.
- The local repository remains on the latest `origin/main`, with only documentation changes committed.
