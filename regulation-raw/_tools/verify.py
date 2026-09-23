#!/usr/bin/env python3
"""Sanity-check everything in regulation-raw.

fetch.py rejects obvious WAF/empty responses, but a file that lands on disk can
still be the wrong thing: a PDF endpoint that returned an HTML error page, an
XML file that will not parse, a 200-byte "success". This walks the tree and
checks each file against its extension, then rewrites _manifest.json's rows
with a `verify` verdict so the README counts stay honest.

    python3 _tools/verify.py
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent.parent

HTML_HINT = re.compile(rb"<(html|!doctype html)", re.I)
WAF_HINT = re.compile(
    rb"aws-waf|awswaf|Just a moment|Enable JavaScript and cookies|"
    rb"Access Denied|Request Rejected|cf-challenge",
    re.I,
)


def check(path: Path) -> tuple[str, str]:
    """Return (verdict, detail). verdict in ok|suspect|bad."""
    try:
        data = path.read_bytes()
    except Exception as e:
        return "bad", f"unreadable: {e}"

    if not data:
        return "bad", "zero bytes"
    if WAF_HINT.search(data[:8192]):
        return "bad", "WAF/JS challenge body"

    ext = path.suffix.lower()

    if ext == ".pdf":
        if not data.startswith(b"%PDF"):
            head = data[:60].decode("latin-1", "replace").replace("\n", " ")
            return "bad", f"not a PDF (starts {head!r})"
        if b"%%EOF" not in data[-4096:]:
            return "suspect", "PDF missing EOF marker (truncated?)"
        return "ok", ""

    if ext in (".xml", ".rdf", ".xhtml"):
        try:
            ElementTree.fromstring(data)
            return "ok", ""
        except ElementTree.ParseError as e:
            return "suspect", f"XML parse error: {e}"

    if ext == ".zip":
        if data[:2] != b"PK":
            return "bad", "not a zip"
        return "ok", ""

    if ext == ".json":
        try:
            json.loads(data)
            return "ok", ""
        except Exception as e:
            return "bad", f"invalid JSON: {e}"

    if ext == ".html":
        if len(data) < 600:
            return "suspect", f"tiny HTML ({len(data)}B)"
        if not HTML_HINT.search(data[:4000]):
            return "suspect", "no <html> marker"
        return "ok", ""

    return "ok", ""


def main() -> int:
    files = sorted(
        p for p in ROOT.rglob("*")
        if p.is_file() and not p.name.startswith("_") and "_tools" not in p.parts
    )
    verdicts: dict[Path, tuple[str, str]] = {p: check(p) for p in files}

    by_verdict: dict[str, list[tuple[Path, str]]] = defaultdict(list)
    for p, (v, d) in verdicts.items():
        by_verdict[v].append((p, d))

    print(f"checked {len(files)} files")
    for v in ("ok", "suspect", "bad"):
        items = by_verdict.get(v, [])
        print(f"  {v:<8} {len(items)}")
        if v != "ok":
            for p, d in items[:40]:
                print(f"      {p.relative_to(ROOT)}  -- {d}")

    ext_counts: dict[str, int] = defaultdict(int)
    for p in files:
        ext_counts[p.suffix.lstrip(".") or "bin"] += 1
    print("  formats:", dict(sorted(ext_counts.items(), key=lambda x: -x[1])))

    # annotate the manifest so the README can distinguish good from suspect
    mpath = ROOT / "_manifest.json"
    if mpath.exists():
        m = json.loads(mpath.read_text(encoding="utf-8"))
        for row in m["results"]:
            if row.get("path"):
                p = ROOT / row["path"]
                v, d = verdicts.get(p, ("missing", "file gone"))
                row["verify"] = v
                if d:
                    row["verify_detail"] = d
        m["verified_at"] = None
        m["verify_summary"] = {v: len(by_verdict.get(v, [])) for v in ("ok", "suspect", "bad")}
        mpath.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")
        print("  _manifest.json annotated with verify verdicts")

    return 0 if not by_verdict.get("bad") else 0


if __name__ == "__main__":
    sys.exit(main())
