#!/usr/bin/env python3
"""Runner for regulation-raw.

Resolves the govinfo CFR pseudo-URLs, then fetches every catalog entry with
a small thread pool and writes _manifest.json / _manifest.csv / _SKIPPED.md.

    python3 _tools/download.py                 # everything
    python3 _tools/download.py --market eu us  # subset
    python3 _tools/download.py --only EU-2023  # substring filter
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import catalog  # noqa: E402
import fetch  # noqa: E402

CFR_CACHE = Path(__file__).resolve().parent / "cfr_volumes.json"
CFR_YEAR = "2024"

_lock = threading.Lock()
_cache: dict = {}
if CFR_CACHE.exists():
    try:
        _cache = json.loads(CFR_CACHE.read_text())
    except Exception:
        _cache = {}


def _flush_cache() -> None:
    CFR_CACHE.write_text(json.dumps(_cache, indent=1, sort_keys=True))


def _probe(url: str, timeout: int = 15) -> tuple[int, str, int]:
    req = urllib.request.Request(url, headers={
        "User-Agent": fetch.UA, "Accept": "*/*", "Accept-Encoding": "identity",
    }, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return r.getcode(), (r.headers.get("Content-Type") or "").split(";")[0], len(body)
    except urllib.error.HTTPError as e:
        return e.code, "", 0
    except Exception:
        return 0, "", 0


def resolve_cfr_volume(title: int, part: int) -> int | None:
    """Which CFR volume holds this part on govinfo. Probes XML only; the PDF
    lives in the same volume. Cached on disk, guarded by a lock so concurrent
    workers cannot clobber each other's writes."""
    key = f"{title}/{part}"
    with _lock:
        if key in _cache:
            return _cache[key] or None

    found = None
    for vol in range(1, 15):
        base = f"CFR-{CFR_YEAR}-title{title}-vol{vol}"
        url = f"https://www.govinfo.gov/content/pkg/{base}/xml/{base}-part{part}.xml"
        code, ct, size = _probe(url)
        if code == 200 and size > 500 and "xml" in ct:
            found = vol
            break

    with _lock:
        _cache[key] = found or 0
        _flush_cache()
    return found


def expand_cfr(entries: list[dict], workers: int = 8) -> tuple[list[dict], list[dict]]:
    """Replace govinfo-cfr pseudo URLs with real ones; unresolvable -> skipped."""
    pseudo = [e for e in entries if e["url"].startswith("govinfo-cfr:")]
    rest = [e for e in entries if not e["url"].startswith("govinfo-cfr:")]
    resolved: list[dict] = []
    unresolved: list[dict] = []

    pairs = sorted({(int(e["url"].split(":")[1]), int(e["url"].split(":")[2]))
                    for e in pseudo})
    print(f"CFR: resolving {len(pairs)} title/part pairs across {len(pseudo)} entries")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        vols = dict(zip(pairs, pool.map(lambda p: resolve_cfr_volume(*p), pairs)))

    for e in pseudo:
        _, title, part, fmt = e["url"].split(":")
        vol = vols.get((int(title), int(part)))
        if vol:
            base = f"CFR-{CFR_YEAR}-title{title}-vol{vol}"
            url = f"https://www.govinfo.gov/content/pkg/{base}/{fmt}/{base}-part{part}.{fmt}"
            resolved.append(dict(e, url=url))
        else:
            unresolved.append(e)
    print(f"CFR: resolved {len(resolved)}, unresolved {len(unresolved)}")
    return rest + resolved, unresolved


def candidate_filenames(entry: dict) -> list[str]:
    """Where an entry's payload could live on disk."""
    fn = entry.get("filename")
    if fn:
        return [fn]
    from fetch import safe_name
    return [safe_name(entry["name"], ext)
            for ext in (".html", ".pdf", ".xml", ".json", ".rdf", ".zip", ".xhtml", ".txt", ".bin")]


def repair_manifest() -> int:
    """Trust the filesystem over the manifest.

    Network failures (WAF, timeouts) are transient, but a naive merge records
    them as if the document were never fetched -- which is how an earlier run
    made seven Singapore statutes look lost while their files sat on disk.
    This walks the catalogue, checks each target path, and promotes any entry
    whose file exists back to `ok`.
    """
    entries = catalog.all_entries()
    mpath = fetch.ROOT / "_manifest.json"
    m = json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {"results": []}
    by_key = {(r["market"], r["name"], r["url"]): r for r in m.get("results", [])}

    promoted = 0
    hashed = 0
    for e in entries:
        key = (e["market"], e["name"], e["url"])
        row = by_key.get(key)
        if row and row.get("status") == "ok":
            continue
        for cand in candidate_filenames(e):
            p = fetch.ROOT / e["market"] / cand
            if p.exists() and p.stat().st_size > 256:
                if row is None:
                    row = fetch.Result(market=e["market"], name=e["name"], url=e["url"]).to_row()
                    by_key[key] = row
                row.update({
                    "status": "ok", "http_code": 200, "bytes": p.stat().st_size,
                    "path": str(p.relative_to(fetch.ROOT)),
                    "note": (row.get("note") or "") + " | recovered from disk",
                })
                promoted += 1
                break

    # Every stored file must carry a content hash, otherwise "traceable back to
    # the official bytes" is a claim we cannot back up.
    import hashlib
    for row in by_key.values():
        if row.get("status") != "ok" or row.get("sha256"):
            continue
        p = fetch.ROOT / (row.get("path") or "")
        if not p.exists():
            continue
        h = hashlib.sha256()
        with p.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        row["sha256"] = h.hexdigest()
        if not row.get("bytes"):
            row["bytes"] = p.stat().st_size
        hashed += 1

    rows = list(by_key.values())
    ok = sum(1 for r in rows if r["status"] == "ok")
    m.update({
        "generated_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%S"),
        "total": len(rows), "ok": ok, "failed": len(rows) - ok,
        "bytes": sum(r.get("bytes", 0) for r in rows if r["status"] == "ok"),
        "results": rows,
    })
    mpath.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")

    import csv
    cols = ["market", "name", "status", "http_code", "content_type", "bytes",
            "path", "sha256", "url"]
    with (fetch.ROOT / "_manifest.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in sorted(rows, key=lambda x: (x["market"], x["name"])):
            w.writerow(r)

    objs = [fetch.Result(**{k: v for k, v in r.items()
                            if k in fetch.Result.__dataclass_fields__}) for r in rows]
    fetch.write_skipped(objs)
    print(f"repair: promoted {promoted} from disk, hashed {hashed} -> {ok}/{len(rows)} ok")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", nargs="*", help="only these markets")
    ap.add_argument("--only", default="", help="substring filter on name")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--no-cfr", action="store_true", help="skip CFR entries entirely")
    ap.add_argument("--skip-existing", action="store_true",
                    help="do not re-fetch URLs whose target file is already on disk")
    ap.add_argument("--repair", action="store_true",
                    help="rebuild status from what is actually on disk, then exit")
    args = ap.parse_args()

    if args.repair:
        return repair_manifest()

    entries = catalog.all_entries()
    if args.no_cfr:
        entries = [e for e in entries if not e["url"].startswith("govinfo-cfr:")]
    if args.market:
        want = {m.lower() for m in args.market}
        entries = [e for e in entries if e["market"].lower() in want]
    if args.only:
        entries = [e for e in entries if args.only.lower() in e["name"].lower()]
    if args.skip_existing:
        before = len(entries)
        kept = []
        for e in entries:
            fn = e.get("filename") or ""
            if not fn:
                # entries without an explicit filename land under a name derived
                # from the display name -- check both candidate extensions
                from fetch import safe_name
                fn = None
                for cand in (safe_name(e["name"], ".html"), safe_name(e["name"], ".pdf"),
                             safe_name(e["name"], ".xml"), safe_name(e["name"], ".json")):
                    if (fetch.ROOT / e["market"] / cand).exists():
                        fn = cand
                        break
            if fn and (fetch.ROOT / e["market"] / fn).exists():
                continue
            kept.append(e)
        entries = kept
        print(f"--skip-existing: {before - len(entries)} already on disk, {len(entries)} to fetch")

    print(f"catalog: {len(entries)} requested entries")
    entries, unresolved = expand_cfr(entries, workers=args.workers)

    notes = catalog.notes()
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(fetch.fetch_one, **e): e for e in entries}
        done = 0
        for fut in as_completed(futs):
            e = futs[fut]
            try:
                r = fut.result()
            except Exception as ex:  # never let one entry kill the run
                r = fetch.Result(market=e["market"], name=e["name"],
                                 url=e["url"], status="error", note=str(ex))
            r.note = notes.get(f"{r.market}|{r.name}", "") or r.note
            results.append(r)
            done += 1
            if done % 25 == 0 or done == len(entries):
                ok = sum(1 for x in results if x.status == "ok")
                print(f"  ... {done}/{len(entries)} done, {ok} ok")

    for e in unresolved:
        results.append(fetch.Result(market=e["market"], name=e["name"], url=e["url"],
                                    status="not_in_govinfo", note="part not found in any CFR volume"))

    order = {"ok": 0, "empty": 1, "waf": 2}
    results.sort(key=lambda r: (r.market, r.name))

    # Merge with whatever is already in the manifest so a partial / --skip-existing
    # run does not erase the results of previous runs.
    prev_path = fetch.ROOT / "_manifest.json"
    merged: dict[tuple, dict] = {}
    if prev_path.exists():
        try:
            prev = json.loads(prev_path.read_text(encoding="utf-8"))
            for row in prev.get("results", []):
                merged[(row["market"], row["name"], row["url"])] = row
        except Exception:
            pass
    for r in results:
        key = (r.market, r.name, r.url)
        new = r.to_row()
        old = merged.get(key)
        # A transient WAF/timeout must not erase a document we already have.
        # Only let a new result win if it succeeded, or if the old one also failed.
        if old and old.get("status") == "ok" and new.get("status") != "ok":
            out_path = fetch.ROOT / (old.get("path") or "")
            if out_path.exists():
                continue
        merged[key] = new
    rows = list(merged.values())
    merged_results = []
    for row in rows:
        obj = fetch.Result(**{k: v for k, v in row.items()
                              if k in {f for f in fetch.Result.__dataclass_fields__}})
        merged_results.append(obj)

    fetch.write_manifest(merged_results)
    fetch.write_skipped(merged_results)

    ok = [r for r in merged_results if r.status == "ok"]
    total_bytes = sum(r.bytes for r in ok)
    print("\n=== summary (whole catalog, merged across runs) ===")
    by_market: dict[str, list[int]] = {}
    for r in merged_results:
        a = by_market.setdefault(r.market, [0, 0])
        a[1] += 1
        if r.status == "ok":
            a[0] += 1
    for m in sorted(by_market):
        good, tot = by_market[m]
        print(f"  {m:<6} {good:>4}/{tot:<4}")
    print(f"  TOTAL  {len(ok)}/{len(merged_results)} files, {total_bytes/1e6:.1f} MB")
    print("  manifest -> _manifest.json / _manifest.csv")
    print("  failures -> _SKIPPED.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
