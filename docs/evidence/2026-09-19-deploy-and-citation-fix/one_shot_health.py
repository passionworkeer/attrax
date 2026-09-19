#!/usr/bin/env python3
"""Serve exactly ONE /api/health request with 200, then exit.

用于验证 apply-deploy.sh 的自动回滚：部署前健康检查（curl）拿到 200，
之后进程消失，[9] health gate 必然失败 → 触发回滚。
"""
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (stdlib naming)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, *args):  # 静默
        pass


if __name__ == "__main__":
    port = int(sys.argv[1])
    server = HTTPServer(("127.0.0.1", port), Handler)
    server.handle_request()
