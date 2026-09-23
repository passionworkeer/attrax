#!/usr/bin/env python3
"""Discovery pass for regulation-raw.

Some portals do not expose a stable URL per document -- you have to read a
search/listing page and pull the document links out of it. This script does
exactly that for the portals where it works from this network:

  * openstd.samr.gov.cn  -- Chinese national standards (GB/GB-T). Detail links
    are JS `showInfo('<hcno>')` calls, so the search page is parsed for hcno.

Everything found is handed to fetch.run_all() and lands under
<market>/<subdir>/ with the same manifest/_SKIPPED bookkeeping as the main run.
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fetch  # noqa: E402

ROOT = fetch.ROOT


def get(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": fetch.UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    for enc in ("utf-8", "gb18030", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


# --------------------------------------------------------------------------
# China -- national standards via openstd.samr.gov.cn
# --------------------------------------------------------------------------
GB_QUERIES = [
    "GB 6675", "GB 18401", "GB 4706", "GB 4806", "GB 4943", "GB 31241",
    "GB 5296", "GB 44495", "GB 38031", "GB 17761", "GB 39669", "GB 21027",
    "GB 31701", "GB 30585", "GB 24613", "GB 18580", "GB 18584", "GB 28480",
    "GB 30002", "GB 30585", "GB 36246", "GB 37772", "GB 40070",
    "GB/T 26572", "GB/T 26125", "GB/T 39560",
    "GB 9706", "GB 1588", "GB 8368", "GB 15979", "GB 27950", "GB 28234",
    "GB 10631", "GB 19593", "GB 19594", "GB 19595",
    "GB 15193", "GB 2760", "GB 2762", "GB 7718", "GB 28050", "GB 29921",
    "GB 31604", "GB 4806.7", "GB 4806.11",
    "GB 19517", "GB 4706.1", "GB 17465", "GB 1002", "GB 2099",
    "GB 8898", "GB 13837", "GB 17625", "GB 9254", "GB 4343",
    "GB 19212", "GB 12350", "GB 15092", "GB 17498",
]


def discover_openstd(queries: list[str]) -> list[dict]:
    """Search openstd, return one detail-page entry per unique standard."""
    base = "https://openstd.samr.gov.cn/bzgk/gb/std_list"
    seen: dict[str, tuple[str, str]] = {}
    for q in queries:
        params = urllib.parse.urlencode({
            "p.p1": "0", "p.p90": "circulation_date", "p.p91": "desc", "p.p2": q,
        })
        try:
            page = get(f"{base}?{params}")
        except Exception as e:
            print(f"  openstd search failed for {q}: {e}")
            continue

        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S)
        for row in rows:
            m = re.search(r"showInfo\('([0-9A-Fa-f]{32})'\)", row)
            if not m:
                continue
            cells = [
                html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            ]
            std_no = next((c for c in cells if re.match(r"^GB", c)), "")
            title = ""
            for c in cells:
                if len(c) > 6 and not re.match(r"^GB", c) and "2026" not in c[:4]:
                    title = c
                    break
            seen[m.group(1)] = (std_no, title)

    entries = []
    for hcno, (std_no, title) in sorted(seen.items()):
        label = f"{std_no} {title}".strip() or hcno
        entries.append(dict(
            market="cn", name=f"CN-GB {label}",
            url=f"https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno={hcno}",
            accept="text/html",
            outdir=ROOT / "cn" / "国家标准",
            filename=f"{fetch._slug(label, 90)}.html",
        ))
    print(f"openstd: {len(entries)} unique standards discovered")
    return entries


# --------------------------------------------------------------------------
# Australia -- legislation.gov.au item pages render their text at /latest/text
# --------------------------------------------------------------------------
AU_ITEMS = [
    ("C2010A00103", "Competition and Consumer Act 2010 (incl. ACL)"),
    ("C2004A03937", "Therapeutic Goods Act 1989"),
    ("C2004A00039", "Trade Practices Act legacy text"),
    ("C2018A00023", "Treasury Laws Amendment (Australian Consumer Law Review)"),
    ("C2004A00001", "Customs Act 1901"),
    ("C2017A00022", "Product Emissions Standards Act 2017"),
]


def discover_au() -> list[dict]:
    return [
        dict(market="au", name=f"AU {label} (legislation.gov.au)",
             url=f"https://www.legislation.gov.au/{ident}/latest/text",
             accept="text/html",
             filename=f"AU-{ident}_{fetch._slug(label, 70)}.html")
        for ident, label in AU_ITEMS
    ]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", choices=["", "openstd", "au"])
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    jobs: list[dict] = []
    if args.only in ("", "openstd"):
        jobs += discover_openstd(GB_QUERIES)
    if args.only in ("", "au"):
        jobs += discover_au()

    print(f"discovery: fetching {len(jobs)} documents")
    results = fetch.run_all(jobs)

    ok = [r for r in results if r.status == "ok"]
    print(f"\ndiscovery done: {len(ok)}/{len(results)} ok")
    disc = ROOT / "_manifest_discovery.json"
    import json
    disc.write_text(json.dumps([r.to_row() for r in results],
                               ensure_ascii=False, indent=2), encoding="utf-8")
    bad = [r for r in results if r.status != "ok"]
    if bad:
        print(f"{len(bad)} failed -- see _manifest_discovery.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
