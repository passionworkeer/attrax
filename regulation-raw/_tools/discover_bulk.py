#!/usr/bin/env python3
"""Bulk discovery for sources that expose an enumerable catalogue.

  * Spain BOE -- open-data API. The consolidated-legislation index pages at
    1000 items; each `<identificador>` resolves to the *full text* of the act
    as XML. This is the single highest-yield source found.
  * ETSI -- `etsi.org/deliver/etsi_en/` is a plain Apache directory tree:
    range/standard/version/*.pdf. Walk it for a list of standards and take the
    newest version of each.

    python3 _tools/discover_bulk.py boe --limit 150
    python3 _tools/discover_bulk.py etsi
"""

from __future__ import annotations

import argparse
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fetch  # noqa: E402

ROOT = fetch.ROOT


def get(url: str, accept: str = "*/*", timeout: int = 40) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": fetch.UA, "Accept": accept, "Accept-Encoding": "identity",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# --------------------------------------------------------------------------
# Spain -- BOE open data
# --------------------------------------------------------------------------
BOE_INDEX = "https://www.boe.es/datosabiertos/api/legislacion-consolidada"
BOE_NORMA = BOE_INDEX + "/id/{id}"


def boe_ids(pages: int = 3, start_offset: int = 0) -> list[str]:
    ids: list[str] = []
    for page in range(pages):
        url = f"{BOE_INDEX}?offset={start_offset + page * 1000}&limit=1000"
        try:
            body = get(url, "application/xml")
        except Exception as e:
            print(f"  BOE index page {page} failed: {e}")
            continue
        found = re.findall(rb"<identificador>(BOE-[A-Z]-\d{4}-\d+)</identificador>", body)
        print(f"  BOE index page {page}: {len(found)} ids")
        ids.extend(x.decode() for x in found)
    return list(dict.fromkeys(ids))


def discover_boe(limit: int, offset: int = 0) -> list[dict]:
    ids = boe_ids(pages=max(1, (limit // 1000) + 1), start_offset=offset)[:limit]
    out = []
    for i in ids:
        out.append(dict(
            market="es", name=f"ES BOE consolidated {i}",
            url=BOE_NORMA.format(id=i), accept="application/xml",
            outdir=ROOT / "es" / "boe",
            filename=f"{i}.xml",
        ))
    print(f"BOE: {len(out)} acts queued")
    return out


# --------------------------------------------------------------------------
# ETSI -- Apache directory tree
# --------------------------------------------------------------------------
ETSI_ROOT = "https://www.etsi.org/deliver/etsi_en/"
ETSI_HOST = "https://www.etsi.org"

# Standards most relevant to placing radio/electrical products on the EU market.
# (range-dir, standard-dir). EN 550xx are CENELEC standards and are NOT on
# ETSI's file server, so they are deliberately absent.
ETSI_TARGETS = [
    ("300300_300399", "300328"), ("300300_300399", "30033002"),
    ("300300_300399", "30033001"),
    ("300200_300299", "30022002"), ("300200_300299", "30022001"),
    ("300200_300299", "300208"), ("300200_300299", "300296"),
    ("300400_300499", "30044002"), ("300400_300499", "30044001"),
    ("301400_301499", "30148901"), ("301400_301499", "30148902"),
    ("301400_301499", "30148903"), ("301400_301499", "30148917"),
    ("301400_301499", "30148919"), ("301400_301499", "30148920"),
    ("301400_301499", "30148922"), ("301400_301499", "30148924"),
    ("301400_301499", "30148926"), ("301400_301499", "30148927"),
    ("301800_301899", "301893"), ("301900_301999", "30190801"),
    ("301900_301999", "30190802"), ("301900_301999", "30190813"),
    ("301900_301999", "30190820"), ("301900_301999", "30190849"),
    ("300600_300699", "300698"), ("300600_300699", "300674"),
    ("300700_300799", "30076102"), ("300700_300799", "30076101"),
    ("303600_303699", "303645"), ("303600_303699", "303687"),
    ("302400_302499", "302406"), ("302500_302599", "302567"),
    ("300300_300399", "300338"), ("300300_300399", "300386"),
    ("301500_301599", "301559"), ("301500_301599", "301511"),
    ("303300_303399", "303345"), ("303400_303499", "303417"),
    ("303900_303999", "303980"), ("303200_303299", "303220"),
    ("300300_300399", "300328"), ("301500_301599", "301549"),
]


def _hrefs(base: str) -> list[str]:
    """Absolute hrefs from an Apache directory listing, resolved to the host."""
    try:
        html = get(base, "text/html").decode("utf-8", "replace")
    except Exception as e:
        print(f"    listing failed {base}: {e}")
        return []
    out = []
    for h in re.findall(r'HREF="([^"]+)"', html):
        if "Parent Directory" in h:
            continue
        out.append(h if h.startswith("http") else urllib.parse.urljoin(ETSI_HOST, h))
    return out


def discover_etsi() -> list[dict]:
    out: list[dict] = []
    for rng, std in ETSI_TARGETS:
        base = f"{ETSI_ROOT}{rng}/{std}/"
        versions = [l for l in _hrefs(base) if re.search(r"/\d+\.\d+\.\d+_\d+/$", l)]
        if not versions:
            print(f"  ETSI {std}: no version dirs")
            continue
        newest = sorted(versions)[-1]        # newest version = highest number
        pdfs = [l for l in _hrefs(newest) if l.lower().endswith(".pdf")]
        if not pdfs:
            print(f"  ETSI {std}: no pdf in {newest}")
            continue
        pdf = sorted(pdfs)[0]
        ver = newest.rstrip("/").rsplit("/", 1)[-1]
        out.append(dict(
            market="intl", name=f"ETSI EN {std} v{ver}",
            url=pdf, accept="application/pdf",
            outdir=ROOT / "intl" / "etsi",
            filename=f"ETSI_EN_{std}_v{ver}.pdf",
        ))
        print(f"  ETSI {std}: v{ver} -> {pdf.rsplit('/', 1)[-1]}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["boe", "etsi", "all"])
    ap.add_argument("--limit", type=int, default=150)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    jobs: list[dict] = []
    if args.what in ("boe", "all"):
        jobs += discover_boe(args.limit, args.offset)
    if args.what in ("etsi", "all"):
        jobs += discover_etsi()

    print(f"\nfetching {len(jobs)} documents")
    results = fetch.run_all(jobs)

    ok = [r for r in results if r.status == "ok"]
    mb = sum(r.bytes for r in ok) / 1e6
    print(f"\nbulk discovery: {len(ok)}/{len(results)} ok, {mb:.1f} MB")

    import json
    idx = ROOT / "_manifest_bulk.json"
    prev = []
    if idx.exists():
        try:
            prev = json.loads(idx.read_text(encoding="utf-8"))
        except Exception:
            prev = []
    merged = {(r["market"], r["url"]): r for r in prev}
    for r in results:
        merged[(r.market, r.url)] = r.to_row()
    idx.write_text(json.dumps(list(merged.values()), ensure_ascii=False, indent=1),
                   encoding="utf-8")
    print(f"manifest -> {idx.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
