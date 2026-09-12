"""Pluggable notifiers for the regulation watchdog.

Selection via ``ATTRAX_REGWATCH_NOTIFY`` (comma-separated):
- ``log``    (default) — structured lines on stdout/stderr; pm2 captures them.
- ``slack``  — POST a Slack Incoming-Webhook message (needs SLACK_WEBHOOK_URL).
- ``webhook``— POST the JSON report to ATTRAX_REGWATCH_WEBHOOK.

All notifiers are best-effort: a notify failure is logged but never fails
the watchdog pass (a broken Slack hook must not stop change detection).
"""
from __future__ import annotations

import json
import logging
import os
import urllib.request

logger = logging.getLogger("attrax.regwatch.notify")

TIMEOUT_SECONDS = 15


class Notifier:
    def send(self, title: str, body: str, payload: dict | None = None) -> None:  # pragma: no cover - iface
        raise NotImplementedError


class LogNotifier(Notifier):
    def send(self, title: str, body: str, payload: dict | None = None) -> None:
        logger.info("%s\n%s", title, body)


class SlackNotifier(Notifier):
    def __init__(self, webhook_url: str) -> None:
        self.webhook_url = webhook_url

    def send(self, title: str, body: str, payload: dict | None = None) -> None:
        # Slack messages are capped at ~4k chars of text; keep the diff out.
        text = f"*{title}*\n{body[:3500]}"
        _post_json(self.webhook_url, {"text": text})


class WebhookNotifier(Notifier):
    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint

    def send(self, title: str, body: str, payload: dict | None = None) -> None:
        _post_json(
            self.endpoint,
            {"title": title, "body": body, "payload": payload or {}},
        )


def _post_json(url: str, data: dict) -> None:
    request = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            response.read()
    except Exception as exc:  # noqa: BLE001 — notify must never raise
        logger.warning("notify POST failed (%s): %s", url[:80], exc)


def build_notifiers() -> list[Notifier]:
    """Instantiate notifiers from env. Always includes the log notifier so a
    pass is visible in ``pm2 logs regwatch`` even when webhooks are unset."""
    selected = [
        item.strip().lower()
        for item in (os.environ.get("ATTRAX_REGWATCH_NOTIFY") or "log").split(",")
        if item.strip()
    ]
    notifiers: list[Notifier] = [LogNotifier()]

    if "slack" in selected:
        webhook = os.environ.get("SLACK_WEBHOOK_URL", "").strip()
        if webhook:
            notifiers.append(SlackNotifier(webhook))
        else:
            logger.warning(
                "ATTRAX_REGWATCH_NOTIFY=slack but SLACK_WEBHOOK_URL is empty;"
                " skipping slack notifier"
            )

    if "webhook" in selected:
        endpoint = os.environ.get("ATTRAX_REGWATCH_WEBHOOK", "").strip()
        if endpoint:
            notifiers.append(WebhookNotifier(endpoint))
        else:
            logger.warning(
                "ATTRAX_REGWATCH_NOTIFY=webhook but ATTRAX_REGWATCH_WEBHOOK is"
                " empty; skipping webhook notifier"
            )

    return notifiers


def notify_all(
    notifiers: list[Notifier], title: str, body: str, payload: dict | None = None
) -> None:
    for notifier in notifiers:
        try:
            notifier.send(title, body, payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning("notifier %s failed: %s", type(notifier).__name__, exc)
