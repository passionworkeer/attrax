"""Generic polite downloader used by regulation-raw.

Only job: given a URL + desired local path, fetch it and record the outcome.
No parsing, no post-processing -- this folder is scrape-and-store only.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent.parent

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# Content types that mean "we got a real document" vs "we got a WAF/JS shell".
WAF_MARKERS = (
    b"aws-waf",
    b"awswaf",
    b"challenge.js",
    b"Just a moment",
    b"Enable JavaScript and cookies to continue",
    b"cf-challenge",
    b"Attention Required! | Cloudflare",
    b"<title>Access Denied</title>",
    b"Request Rejected",
)

EXT_BY_CT = {
    "application/pdf": ".pdf",
    "application/xml": ".xml",
    "text/xml": ".xml",
    "application/rdf+xml": ".rdf",
    "application/json": ".json",
    "application/zip": ".zip",
    "application/xhtml+xml": ".xhtml",
    "text/html": ".html",
    "text/plain": ".txt",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}


@dataclass
class Result:
    market: str
    name: str
    url: str
    path: str = ""
    status: str = "pending"  # ok | http_403 | waf | empty | error | skipped
    http_code: int = 0
    content_type: str = ""
    bytes: int = 0
    sha256: str = ""
    note: str = ""
    elapsed_s: float = 0.0
    fetched_at: str = ""

    def to_row(self) -> dict:
        return asdict(self)


def _slug(text: str, maxlen: int = 120) -> str:
    text = re.sub(r"[^\w\-.]+", "_", text, flags=re.UNICODE)
    text = re.sub(r"_+", "_", text).strip("_.")
    return text[:maxlen] or "unnamed"


def safe_name(name: str, ext: str) -> str:
    return _slug(name) + ext


def _looks_like_waf(body: bytes) -> bool:
    head = body[:4096]
    return any(m in head for m in WAF_MARKERS)


def fetch_one(
    market: str,
    name: str,
    url: str,
    *,
    accept: str = "*/*",
    lang: str = "",
    outdir: Path | None = None,
    filename: str = "",
    force_ext: str = "",
    timeout: int = 45,
    retries: int = 2,
    retry_wait: float = 2.0,
    min_bytes: int = 256,
) -> Result:
    """Download one URL into ROOT/<market>/<filename>. Never raises."""
    res = Result(market=market, name=name, url=url)
    outdir = outdir or (ROOT / market)
    outdir.mkdir(parents=True, exist_ok=True)

    headers = {
        "User-Agent": UA,
        "Accept": accept,
        "Accept-Encoding": "identity",
        "Connection": "close",
    }
    if lang:
        headers["Accept-Language"] = lang

    last_err = ""
    started = time.time()
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                code = resp.getcode()
                body = resp.read()
                ct = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()

            # A 202 with an empty/short body is the AWS WAF challenge page.
            if code in (202, 203) and len(body) < 4096:
                res.status, res.http_code, res.bytes = "waf", code, len(body)
                res.note = "challenge page (202/203 short body)"
                break

            if code >= 400:
                res.status, res.http_code = f"http_{code}", code
                res.bytes = len(body)
                break

            if _looks_like_waf(body):
                res.status, res.http_code, res.bytes = "waf", code, len(body)
                res.note = "blocked by WAF/JS challenge"
                break

            if len(body) < min_bytes:
                res.status, res.http_code, res.bytes = "empty", code, len(body)
                res.note = f"body < {min_bytes} bytes"
                break

            ext = force_ext or EXT_BY_CT.get(ct, ".bin")
            fname = filename or safe_name(name, ext)
            if not filename and not fname.endswith(ext):
                fname += ext
            dest = outdir / fname
            dest.write_bytes(body)

            res.status = "ok"
            res.http_code = code
            res.content_type = ct
            res.bytes = len(body)
            res.sha256 = hashlib.sha256(body).hexdigest()
            res.path = str(dest.relative_to(ROOT))
            break

        except urllib.error.HTTPError as e:
            res.status, res.http_code = f"http_{e.code}", e.code
            last_err = f"HTTP {e.code}"
            if e.code in (403, 404, 410, 451):
                break  # retrying a hard block is pointless
        except Exception as e:  # timeouts, DNS, TLS, resets
            last_err = f"{type(e).__name__}: {e}"
            res.status = "error"
        if attempt < retries:
            time.sleep(retry_wait * (attempt + 1))

    if last_err:
        res.note = (res.note + " | " if res.note else "") + last_err
    res.elapsed_s = round(time.time() - started, 1)
    res.fetched_at = time.strftime("%Y-%m-%dT%H:%M:%S")
    return res


def run_all(entries: Iterable[dict], *, quiet: bool = False) -> list[Result]:
    results: list[Result] = []
    for i, e in enumerate(entries, 1):
        r = fetch_one(**e)
        results.append(r)
        if not quiet:
            flag = {"ok": "OK ", "waf": "WAF", "empty": "EMP", "error": "ERR"}.get(
                r.status, "!! "
            )
            extra = f"{r.bytes}B {r.content_type}" if r.status == "ok" else r.note
            print(f"[{i:>4}] {flag} {r.market:<5} {r.name[:60]:<60} {extra}")
    return results


def write_manifest(results: list[Result], path: Path | None = None) -> None:
    path = path or (ROOT / "_manifest.json")
    rows = [r.to_row() for r in results]
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "total": len(rows),
        "ok": sum(1 for r in rows if r["status"] == "ok"),
        "failed": sum(1 for r in rows if r["status"] != "ok"),
        "bytes": sum(r["bytes"] for r in rows if r["status"] == "ok"),
        "results": rows,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    csv_path = path.with_suffix(".csv")
    cols = [
        "market", "name", "status", "http_code", "content_type", "bytes",
        "path", "sha256", "url",
    ]
    import csv

    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in sorted(rows, key=lambda x: (x["market"], x["name"])):
            w.writerow(r)


def write_skipped(results: list[Result], path: Path | None = None) -> None:
    """Records every URL we could not download, so it can be opened by hand."""
    path = path or (ROOT / "_SKIPPED.md")
    bad = [r for r in results if r.status != "ok"]
    lines = [
        "# 未能直接下载的法规链接",
        "",
        "> 本文件由 `_tools/fetch.py` 自动生成。以下 URL 在本机实测无法直接下载",
        "> （WAF 挑战 / 403 / JS 空壳 / 404）。它们仍可在浏览器中手动打开，",
        "> 或换网络环境后重试。",
        "",
        f"总计 {len(bad)} 条。",
        "",
        "| 市场 | 名称 | 状态 | HTTP | 原因 | 链接 |",
        "|:---|:---|:---|:---:|:---|:---|",
    ]
    for r in sorted(bad, key=lambda x: (x.market, x.name)):
        link = f"[打开]({r.url})"
        note = (r.note or "").replace("|", "\\|")
        lines.append(
            f"| {r.market} | {r.name} | `{r.status}` | {r.http_code} | {note} | {link} |"
        )
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
