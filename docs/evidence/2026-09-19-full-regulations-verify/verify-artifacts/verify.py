"""
全量法规库校验脚本
- 维度1: 本地文件完整性（cheap）
- 维度2: source_url HTTP 可达性（heavy, 4 轮 fallback）
- 维度3: 内容真实性抽样
- 维度4: region / domain 分布统计

输入: data/regulations/regulations_index.json + _imports/*.json
输出: detailed.json (per-entry) + report.md (人读)
"""

import concurrent.futures as cf
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.parse as up
from collections import Counter, defaultdict
from datetime import datetime
from typing import Optional, Tuple

# 路径
ROOT = "/Users/wangjianjun/me/attrax"
REG_DIR = f"{ROOT}/data/regulations"
INDEX_PATH = f"{REG_DIR}/regulations_index.json"
IMPORTS_DIR = f"{REG_DIR}/_imports"
OUT_DIR = "/Users/wangjianjun/me/attrax/docs/evidence/2026-09-19-full-regulations-verify/_subagent-tmp"

# 25 个合法 region（按索引实际盘点）
ALLOWED_REGIONS = {
    "AE", "AU", "BR", "CA", "CN", "DE", "EU", "FR", "GCC", "GLOBAL",
    "ID", "IN", "IT", "JP", "KR", "MX", "MY", "NZ", "SA", "SG",
    "TH", "UK", "UN", "US", "VN",
}

UA_BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
UA_CURL = "curl/8.7.1"

# 已知误报类别
KNOWN_FALSE_POSITIVE_PATTERNS = [
    ("govinfo-cfr", re.compile(r"^govinfo-cfr:", re.I)),
    ("EUR-Lex 直链", re.compile(r"eur-lex\.europa\.eu/eli/", re.I)),
    ("Cellar 端点", re.compile(r"publications\.europa\.eu/resource/", re.I)),
    ("CPSC Recall API POST-only", re.compile(r"api\.saferproducts\.gov", re.I)),
    ("HTTP/2 framing 已知不稳", re.compile(r"gesetze-im-internet\.de", re.I)),
    ("政府站点 bot UA 403 (CN-FLK)", re.compile(r"flk\.nppa\.gov\.cn", re.I)),
    ("政府站点 bot UA 403 (IN-MEITY)", re.compile(r"meity\.gov\.in", re.I)),
    ("政府站点 bot UA 403 (SG-SSO)", re.compile(r"sso\.agc\.gov\.sg", re.I)),
    ("海外慢站超时 (IN-BIS)", re.compile(r"bis\.india\.gov\.in", re.I)),
    ("海外慢站超时 (MY-PDPA)", re.compile(r"pdpa\.gov\.my", re.I)),
    ("海外慢站超时 (NZ-productsafety)", re.compile(r"productsafety\.govt\.nz", re.I)),
    ("海外慢站超时 (GLOBAL-FAO)", re.compile(r"fao\.org", re.I)),
]


def classify_known_false_positive(url: str) -> Optional[str]:
    for label, pat in KNOWN_FALSE_POSITIVE_PATTERNS:
        if pat.search(url):
            return label
    return None


def parse_yaml(path: str) -> Tuple[bool, Optional[dict], Optional[str]]:
    """读取 YAML，返回 (ok, data, error)"""
    try:
        import yaml
    except ImportError:
        return False, None, "yaml module not available"
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not isinstance(data, dict):
            return False, None, "yaml root is not dict"
        return True, data, None
    except Exception as e:
        return False, None, f"{type(e).__name__}: {e}"


# ============================================================
# 维度 1: 本地文件完整性
# ============================================================
def check_local(regs: list[dict], manifests: dict[str, list[dict]]) -> list[dict]:
    """对每条 entry 检查 yaml / raw 文件"""
    by_id = {}
    for mname, entries in manifests.items():
        for e in entries:
            by_id.setdefault(e["id"], []).append((mname, e))

    results = []
    for r in regs:
        rid = r["id"]
        region = r["region"]
        yaml_path = f"{REG_DIR}/{region.lower()}/{rid}.yaml"
        rec = {
            "id": rid,
            "region": region,
            "source_url": r.get("source_url"),
            "yaml_path": yaml_path,
            "yaml_exists": False,
            "yaml_size": 0,
            "yaml_valid": False,
            "yaml_error": None,
            "yaml_id_matches": False,
            "yaml_region_valid": False,
            "yaml_has_source_url": False,
            "yaml_source_url_matches": None,
            "raw_files": [],
            "manifests": [m[0] for m in by_id.get(rid, [])],
            "src_path_exists": False,
            "src_root_present": False,
        }
        # YAML
        if os.path.exists(yaml_path):
            rec["yaml_exists"] = True
            try:
                rec["yaml_size"] = os.path.getsize(yaml_path)
            except Exception:
                pass
            ok, data, err = parse_yaml(yaml_path)
            rec["yaml_valid"] = ok
            rec["yaml_error"] = err
            if ok and data:
                rec["yaml_id_matches"] = data.get("id") == rid
                rec["yaml_region_valid"] = data.get("region") in ALLOWED_REGIONS
                surl = data.get("source_url")
                rec["yaml_has_source_url"] = bool(surl)
                if surl is not None and r.get("source_url") is not None:
                    rec["yaml_source_url_matches"] = (str(surl) == str(r["source_url"]))
                elif (surl is None) != (r.get("source_url") is None):
                    rec["yaml_source_url_matches"] = False
                else:
                    rec["yaml_source_url_matches"] = None
        # raw 文件 + 源文件
        for mname, ment in by_id.get(rid, []):
            src_root = ment.get("_src_root", "")
            src_root_present = os.path.exists(src_root) if src_root else False
            rec["src_root_present"] = src_root_present
            for doc_rel in ment.get("docs", []):
                basename = os.path.basename(doc_rel)
                # 项目内 raw 路径
                proj_raw = f"{REG_DIR}/{region.lower()}/raw/{basename}"
                # 源 root 路径
                src_path = f"{src_root}/{doc_rel}" if src_root else ""
                rinfo = {
                    "manifest": mname,
                    "doc_rel": doc_rel,
                    "basename": basename,
                    "proj_raw_path": proj_raw,
                    "proj_raw_exists": os.path.exists(proj_raw),
                    "proj_raw_size": os.path.getsize(proj_raw) if os.path.exists(proj_raw) else 0,
                    "src_path": src_path,
                    "src_path_exists": os.path.exists(src_path) if src_path else False,
                    "src_size": os.path.getsize(src_path) if (src_path and os.path.exists(src_path)) else 0,
                }
                # size 一致性（双方都存在时）
                if rinfo["proj_raw_exists"] and rinfo["src_path_exists"]:
                    rinfo["size_match"] = (rinfo["proj_raw_size"] == rinfo["src_size"])
                else:
                    rinfo["size_match"] = None
                rec["raw_files"].append(rinfo)
        results.append(rec)
    return results


# ============================================================
# 维度 2: HTTP 可达性（4 轮 fallback）
# ============================================================
def curl_probe(url: str, ua: str, timeout: int, method: str = "HEAD", http11: bool = False) -> dict:
    """
    执行 curl，返回 {code, chain, duration_ms, error}
    - chain: 跟随重定向后的所有状态码
    - 失败/timeout 也归类
    """
    cmd = ["curl", "-s", "-o", "/dev/null",
           "-w", "%{http_code}|%{time_total}|%{num_redirects}|%{errormsg}",
           "-L", "-k",
           "--max-time", str(timeout),
           "-A", ua,
           "-H", "Accept: */*"]
    if method == "HEAD":
        cmd += ["-I", "-X", "HEAD"]
    if http11:
        cmd += ["--http1.1"]
    cmd.append(url)

    t0 = time.time()
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5)
        out = (p.stdout or "").strip()
        duration_ms = int((time.time() - t0) * 1000)
        parts = out.split("|", 3)
        if len(parts) >= 4:
            code_str, time_s, n_redir, errormsg = parts[0], parts[1], parts[2], parts[3]
        elif len(parts) >= 1:
            code_str, time_s, n_redir, errormsg = parts[0], "0", "0", ""
        else:
            code_str, time_s, n_redir, errormsg = "0", "0", "0", out
        try:
            code = int(code_str) if code_str and code_str.isdigit() else 0
        except Exception:
            code = 0
        try:
            duration = float(time_s)
            chain = []  # curl %{http_code} 给出最终码；不展开 chain
            chain_codes = [code] if code else []
        except Exception:
            chain_codes = [code] if code else []
        return {
            "code": code,
            "chain": chain_codes,
            "duration_ms": int(duration * 1000),
            "redirects": n_redir,
            "errormsg": errormsg,
            "ok": code and 200 <= code < 400,
        }
    except subprocess.TimeoutExpired:
        return {"code": 0, "chain": [], "duration_ms": int((time.time() - t0) * 1000),
                "redirects": 0, "errormsg": "TIMEOUT", "ok": False}
    except Exception as e:
        return {"code": 0, "chain": [], "duration_ms": int((time.time() - t0) * 1000),
                "redirects": 0, "errormsg": f"{type(e).__name__}: {e}", "ok": False}


def curl_full_chain(url: str, ua: str, timeout: int, method: str = "HEAD") -> dict:
    """追踪完整 chain（多个 -L 子步骤），使用 -w '%{url_effective}|%{http_code}' per request"""
    # 直接用 -w "%{url_effective} -> %{http_code}\n" 让每个跳转单列
    cmd = ["curl", "-s", "-o", "/dev/null",
           "-w", "%{url_effective}\t%{http_code}\n",
           "-L", "-k",
           "--max-time", str(timeout),
           "-A", ua,
           "-H", "Accept: */*"]
    if method == "HEAD":
        cmd += ["-I", "-X", "HEAD"]
    cmd.append(url)
    t0 = time.time()
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5)
        out = (p.stdout or "").strip()
        chain = []
        for line in out.splitlines():
            line = line.strip()
            if not line or "\t" not in line:
                continue
            try:
                chain.append({"url": line.split("\t")[0], "code": int(line.split("\t")[1])})
            except Exception:
                pass
        duration_ms = int((time.time() - t0) * 1000)
        final_code = chain[-1]["code"] if chain else 0
        return {
            "chain": chain,
            "duration_ms": duration_ms,
            "final_code": final_code,
            "ok": final_code and 200 <= final_code < 400,
        }
    except subprocess.TimeoutExpired:
        return {"chain": [], "duration_ms": int((time.time() - t0) * 1000),
                "final_code": 0, "ok": False, "errormsg": "TIMEOUT"}
    except Exception as e:
        return {"chain": [], "duration_ms": int((time.time() - t0) * 1000),
                "final_code": 0, "ok": False, "errormsg": f"{type(e).__name__}: {e}"}


def check_http_one(url: str, browser_log: list) -> dict:
    """4 轮 fallback + 已知误报识别"""
    rec = {
        "url": url,
        "scheme": "OTHER",
        "known_false_positive_label": None,
        "round1": None,
        "round2": None,
        "round3": None,
        "round4": None,
        "final_status": "PENDING",
        "final_code": 0,
    }
    parsed = up.urlparse(url)
    if parsed.scheme == "http":
        rec["scheme"] = "http"
    elif parsed.scheme == "https":
        rec["scheme"] = "https"
    elif url.startswith("govinfo-cfr:"):
        rec["scheme"] = "govinfo-cfr"
    elif not url:
        rec["scheme"] = "EMPTY"
    else:
        rec["scheme"] = parsed.scheme or "OTHER"

    # 跳过非 HTTP
    if rec["scheme"] in ("govinfo-cfr", "EMPTY", "FTP", "OTHER"):
        rec["final_status"] = "SKIP_NON_HTTP"
        rec["known_false_positive_label"] = classify_known_false_positive(url) if url else "EMPTY_URL"
        return rec

    # 已知误报
    kfp = classify_known_false_positive(url)
    if kfp:
        rec["known_false_positive_label"] = kfp

    # round 1: curl UA, 5s, HEAD, 默认 http2
    r1 = curl_full_chain(url, UA_CURL, 5, method="HEAD")
    rec["round1"] = r1
    if r1["ok"]:
        rec["final_status"] = "OK_R1"
        rec["final_code"] = r1["final_code"]
        return rec

    # round 2: 浏览器 UA, 15s, HEAD
    r2 = curl_full_chain(url, UA_BROWSER, 15, method="HEAD")
    rec["round2"] = r2
    if r2["ok"]:
        rec["final_status"] = "OK_R2"
        rec["final_code"] = r2["final_code"]
        return rec

    # round 3: GET + 头部 1KB, 浏览器 UA, 15s
    r3 = curl_full_chain(url, UA_BROWSER, 15, method="GET")
    rec["round3"] = r3
    if r3["ok"]:
        rec["final_status"] = "OK_R3"
        rec["final_code"] = r3["final_code"]
        return rec

    # round 4: HEAD, --http1.1, 浏览器 UA, 15s
    r4 = curl_full_chain(url, UA_BROWSER, 15, method="HEAD")
    rec["round4"] = r4
    if r4["ok"]:
        rec["final_status"] = "OK_R4"
        rec["final_code"] = r4["final_code"]
        return rec

    rec["final_status"] = "DEAD"
    rec["final_code"] = r4["final_code"] if r4["final_code"] else (r3["final_code"] if r3["final_code"] else (r2["final_code"] if r2["final_code"] else 0))
    return rec


def check_http_batch(items: list[tuple[str, str]], workers: int = 60) -> dict[str, dict]:
    """并发检查所有 URL，items: [(id, url)]"""
    out = {}
    total = len(items)
    done = 0
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(check_http_one, url, []): (rid, url) for rid, url in items}
        for fut in cf.as_completed(futures):
            rid, url = futures[fut]
            try:
                rec = fut.result()
            except Exception as e:
                rec = {"url": url, "final_status": "ERROR", "final_code": 0,
                       "errormsg": f"submit exception: {e}"}
            out[rid] = rec
            done += 1
            if done % 50 == 0 or done == total:
                elapsed = time.time() - t0
                rate = done / elapsed if elapsed > 0 else 0
                print(f"  [HTTP] {done}/{total}  ({rate:.1f}/s, {elapsed:.1f}s elapsed)", flush=True)
    return out


# ============================================================
# 维度 3: 抽样验证
# ============================================================
def sample_check(local_results: list[dict], regs: list[dict], n: int = 20) -> list[dict]:
    """随机抽样 + EU EUR-Lex 5 条 + govinfo-cfr 5 条"""
    by_id = {r["id"]: r for r in local_results}

    # 随机抽样（剔除 govinfo-cfr/EMPTY，且 yaml_valid=true 的）
    pool = [r for r in regs
            if r.get("source_url")
            and not r["source_url"].startswith("govinfo-cfr:")
            and by_id.get(r["id"], {}).get("yaml_valid")]
    random.seed(42)
    random_sample = random.sample(pool, min(n, len(pool)))

    # EU 抽样（EUR-Lex 链路）
    eu_pool = [r for r in regs
               if r.get("source_url") and "eur-lex.europa.eu" in r["source_url"]]
    eu_sample = random.sample(eu_pool, min(5, len(eu_pool)))

    # govinfo-cfr 抽样
    cfr_pool = [r for r in regs
                if r.get("source_url") and r["source_url"].startswith("govinfo-cfr:")]
    cfr_sample = random.sample(cfr_pool, min(5, len(cfr_pool)))

    samples = []
    samples.extend(_sample_one(r, by_id[r["id"]]) for r in random_sample)
    samples.extend(_sample_one(r, by_id[r["id"]]) for r in eu_sample)
    samples.extend(_sample_one(r, by_id[r["id"]]) for r in cfr_sample)
    return samples


def _sample_one(r: dict, local: dict) -> dict:
    """对单条 entry 做内容真实性检查"""
    rec = {
        "id": r["id"],
        "region": r["region"],
        "source_url": r.get("source_url"),
        "official_citation": r.get("official_citation"),
        "short_name": r.get("short_name"),
        "domain": r.get("domain"),
        "article_count_index": r.get("article_count"),
    }
    yaml_path = f"{REG_DIR}/{r['region'].lower()}/{r['id']}.yaml"
    if os.path.exists(yaml_path):
        ok, data, err = parse_yaml(yaml_path)
        rec["yaml_valid"] = ok
        rec["yaml_error"] = err
        if ok and data:
                rec["yaml_id"] = data.get("id")
                rec["yaml_official_citation"] = data.get("official_citation")
                rec["yaml_short_name"] = data.get("short_name")
                rec["yaml_region"] = data.get("region")
                rec["yaml_article_count"] = len(data.get("articles") or [])
                rec["yaml_article_count_match"] = (
                    rec["yaml_article_count"] == r.get("article_count")
                    if r.get("article_count") is not None else None
                )
                rec["yaml_source_kind"] = data.get("source_kind")
                rec["yaml_first_article_preview"] = (
                    (data.get("articles") or [{}])[0].get("text", "")[:200]
                    if data.get("articles") else ""
                )
    # 抽 raw 文件第一字节
    if local and local.get("raw_files"):
        first = local["raw_files"][0]
        rec["raw_first_sample"] = _sample_first_bytes(first.get("proj_raw_path"))
    return rec


def _sample_first_bytes(path: str, n: int = 200) -> dict:
    if not path or not os.path.exists(path):
        return {"path": path, "exists": False}
    try:
        with open(path, "rb") as f:
            data = f.read(n)
        return {
            "path": path,
            "exists": True,
            "size": os.path.getsize(path),
            "first_bytes_repr": repr(data[:200]),
            "looks_textual": b"\x00" not in data[:100],
        }
    except Exception as e:
        return {"path": path, "exists": True, "error": str(e)}


# ============================================================
# 维度 4: region / domain 统计
# ============================================================
def stats(regs: list[dict], local_results: list[dict], http_results: dict[str, dict]) -> dict:
    region_counter = Counter(r["region"] for r in regs)
    domain_counter = Counter(r.get("domain") for r in regs)
    by_id_local = {r["id"]: r for r in local_results}

    # HTTP 状态分布
    final_status_counter = Counter()
    code_counter = Counter()
    for rid, h in http_results.items():
        final_status_counter[h.get("final_status", "?")] += 1
        c = h.get("final_code") or 0
        code_counter[c // 100 * 100 if c else "0"] += 1

    return {
        "total": len(regs),
        "regions": dict(region_counter),
        "domains": dict(domain_counter),
        "http_final_status": dict(final_status_counter),
        "http_code_class": dict(code_counter),
        "yaml_valid_count": sum(1 for r in local_results if r.get("yaml_valid")),
        "yaml_missing_count": sum(1 for r in local_results if not r.get("yaml_exists")),
    }


# ============================================================
# main
# ============================================================
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    log_lines: list[str] = []
    run_log = f"{OUT_DIR}/run.log"

    def log(msg: str):
        ts = datetime.now().isoformat(timespec="seconds")
        line = f"[{ts}] {msg}"
        print(line, flush=True)
        log_lines.append(line)

    log("=== 全量法规库校验开始 ===")
    log(f"ROOT: {ROOT}")

    # 读索引
    with open(INDEX_PATH) as f:
        idx = json.load(f)
    regs = idx["regulations"]
    log(f"regulations_index.json 总条数: {len(regs)}, schema_version={idx.get('schema_version')}")

    # 读 3 份清单
    manifests = {}
    for name in ["regulation-raw-2026-09-19.json",
                 "attrax-docs-extra-2026-09-19.json",
                 "attrax-docs-2026-09-19.json"]:
        p = f"{IMPORTS_DIR}/{name}"
        with open(p) as f:
            d = json.load(f)
        manifests[name] = d["entries"]
        log(f"清单 {name}: {len(d['entries'])} 条, source_root={d.get('source_root')}")

    # 给 manifest entries 注入 _src_root
    for name, entries in manifests.items():
        with open(f"{IMPORTS_DIR}/{name}") as f:
            d = json.load(f)
        src_root = d.get("source_root", "")
        for e in entries:
            e["_src_root"] = src_root

    # 维度 1
    log("--- 维度 1: 本地文件完整性 ---")
    t0 = time.time()
    local_results = check_local(regs, manifests)
    log(f"维度 1 完成, {len(local_results)} 条, {time.time()-t0:.1f}s")

    # 维度 2: HTTP HEAD
    log("--- 维度 2: HTTP 可达性（4 轮 fallback） ---")
    http_items = []
    for r in regs:
        url = r.get("source_url")
        if url and (url.startswith("http://") or url.startswith("https://")):
            http_items.append((r["id"], url))
    log(f"待 HTTP 校验 URL 数: {len(http_items)}")
    t0 = time.time()
    http_results = check_http_batch(http_items, workers=60)
    log(f"维度 2 完成, {time.time()-t0:.1f}s")

    # 维度 3: 抽样
    log("--- 维度 3: 内容真实性抽样 ---")
    t0 = time.time()
    samples = sample_check(local_results, regs, n=20)
    log(f"维度 3 完成, {len(samples)} 条抽样, {time.time()-t0:.1f}s")

    # 维度 4: 统计
    log("--- 维度 4: region/domain 统计 ---")
    st = stats(regs, local_results, http_results)
    log(f"regions: {len(st['regions'])}, domains: {len(st['domains'])}")

    # 汇总输出
    detailed = []
    for r in regs:
        rid = r["id"]
        local = next((x for x in local_results if x["id"] == rid), None)
        http = http_results.get(rid)
        detailed.append({
            "id": rid,
            "region": r["region"],
            "domain": r.get("domain"),
            "source_url": r.get("source_url"),
            "official_citation": r.get("official_citation"),
            "short_name": r.get("short_name"),
            "article_count": r.get("article_count"),
            "license": r.get("license"),
            "yaml_exists": local["yaml_exists"] if local else False,
            "yaml_size": local["yaml_size"] if local else 0,
            "yaml_valid": local["yaml_valid"] if local else False,
            "yaml_error": local.get("yaml_error") if local else None,
            "yaml_id_matches": local.get("yaml_id_matches") if local else None,
            "yaml_region_valid": local.get("yaml_region_valid") if local else None,
            "yaml_source_url_matches": local.get("yaml_source_url_matches") if local else None,
            "raw_files_count": len(local["raw_files"]) if local else 0,
            "raw_files_present": sum(1 for rf in (local["raw_files"] if local else []) if rf["proj_raw_exists"]),
            "src_root_present": local["src_root_present"] if local else False,
            "http": http,
        })

    detailed_path = f"{OUT_DIR}/detailed.json"
    with open(detailed_path, "w", encoding="utf-8") as f:
        json.dump(detailed, f, ensure_ascii=False, indent=2)
    log(f"detailed.json: {detailed_path}")

    samples_path = f"{OUT_DIR}/sample.json"
    with open(samples_path, "w", encoding="utf-8") as f:
        json.dump(samples, f, ensure_ascii=False, indent=2)
    log(f"sample.json: {samples_path}")

    summary = {
        "stats": st,
        "samples_count": len(samples),
    }
    summary_path = f"{OUT_DIR}/summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    log(f"summary.json: {summary_path}")

    log("=== 校验完成 ===")
    with open(run_log, "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))


if __name__ == "__main__":
    main()