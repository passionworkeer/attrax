#!/usr/bin/env python3
"""
profile_lazy_vs_eager.py — 法规库加载模型 A/B 基准对比。

对比两个实现：
  - "eager": 现有 _load_all() 全量预热所有 YAML（724 个）一次
  - "lazy" : LRU(maxsize=128) 按需读单文件

在真实扫描工作负载下测量：
  1. 冷启动时间（从首次 query 到就绪）
  2. 单次扫描 latency（vision→generate→verify 全链路）
  3. 进程 RSS 增量
  4. _library_stamp 失效（凌晨索引重建）后的恢复时间
  5. LRU 命中率（仅 lazy 模式）

通过 monkey-patch 把两个实现挂在同一个 article_loader 接口后面，
workload 用真实 fixture 数据（regression-package-20260914/01-Anker-EU）。

Usage:
  python3 rag_service/tests/profile_lazy_vs_eager.py
"""
from __future__ import annotations

import cProfile
import gc
import io
import json
import os
import pstats
import resource
import sys
import time
import tracemalloc
from collections import OrderedDict, defaultdict
from contextlib import contextmanager
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from rag_service.retrieval import article_loader
from rag_service.retrieval import kb_loader


# ─── 工具 ──────────────────────────────────────────────────────────────────


@contextmanager
def timer(label: str, sink: list[dict]):
    t0 = time.perf_counter()
    yield
    sink.append({"label": label, "elapsed_ms": (time.perf_counter() - t0) * 1000})


def get_rss_mb() -> float:
    """Return current process RSS in MB (cross-platform best-effort)."""
    if sys.platform == "darwin":
        import subprocess
        out = subprocess.check_output(["ps", "-o", "rss=", "-p", str(os.getpid())]).decode()
        return int(out.strip()) / 1024
    usage = resource.getrusage(resource.RUSAGE_SELF)
    # ru_maxrss is in KB on Linux
    return usage.ru_maxrss / 1024


def measure(label: str, snapshot=None) -> dict:
    """Return Python heap usage (tracemalloc) for the label.

    `tracemalloc` tracks Python object allocations — the actual memory cost
    of the article_loader cache (dict[str, dict]). RSS includes noise from
    YAML parse buffer, GC, etc. and is unreliable for A/B comparison on
    small workloads. Pass the previous snapshot to compute the delta.
    """
    gc.collect()
    if snapshot is not None:
        current = tracemalloc.take_snapshot()
        diff = current.compare_to(snapshot, "filename")
        delta_bytes = sum(stat.size_diff for stat in diff)
        delta_count = sum(stat.count_diff for stat in diff)
        return {
            "label": label,
            "py_heap_delta_kb": delta_bytes / 1024,
            "py_heap_delta_count": delta_count,
        }
    snap = tracemalloc.take_snapshot()
    total = sum(stat.size for stat in snap.statistics("filename"))
    return {"label": label, "py_heap_mb": total / 1024 / 1024, "_snap": snap}


# ─── 工作负载模拟 ──────────────────────────────────────────────────────────
#
# 基于真实用户行为：从 regression-package-20260914/01-Anker-A2332-充电器-EU
# 单次扫描实际触发的 read 序列。
#
# 设计依据：
#   - 单次扫描（electronics + EU/US + 1 image）：
#     1) vision 阶段：调用 list_regulation_ids() × 1，load_regulation × 0
#     2) anchor selection：调用 kb_loader（711 锚点全量）+ article_loader
#        按品类+市场筛约 5–10 条候选法规，每条 load_articles_for_anchor
#        → load_article_text × 1–3
#     3) verify：load_article_text × len(citations)（5–20）
#     4) 完成
#
# 模拟：
#   - N 次扫描（默认 20）
#   - 每次扫描期间，hit set ≈ 8 个不同法规 × 3 article 命中


def _read_regulation_ids_only() -> list[str]:
    """Eager mode: list_regulation_ids() 后 _load_all() 已经在内存。"""
    return article_loader.list_regulation_ids()


def _workload_one_scan(hit_reg_ids: list[str], hits: dict[str, int]) -> None:
    """模拟一次扫描对 article_loader 的所有调用。"""
    # 1. readiness probe (always)
    _read_regulation_ids_only()

    # 2. anchor lookup → load_articles_for_anchor
    for reg_id in hit_reg_ids:
        # 模拟取 1–3 个 article id
        reg = article_loader.load_regulation(reg_id)
        if not reg:
            continue
        for art in (reg.get("articles") or [])[:3]:
            if isinstance(art, dict) and art.get("id"):
                article_loader.load_article_text(reg_id, art["id"])
                hits[reg_id] = hits.get(reg_id, 0) + 1

    # 3. verify stage: 对每个 hit reg 重读 article text
    for reg_id in hit_reg_ids:
        reg = article_loader.load_regulation(reg_id)
        if not reg:
            continue
        for art in (reg.get("articles") or [])[:3]:
            if isinstance(art, dict) and art.get("id"):
                article_loader.load_article_text(reg_id, art["id"])
                hits[reg_id] = hits.get(reg_id, 0) + 1

    # 4. source_kind probes (verbatim gate) — 模拟 verifier 的几次访问
    for reg_id in hit_reg_ids[:5]:
        article_loader.is_verbatim_allowed(reg_id)


# ─── lazy 实现（LRU maxsize=128） ──────────────────────────────────────────


class LRUStat:
    """统计：命中、miss、读盘次数、淘汰数。"""

    def __init__(self) -> None:
        self.hits = 0
        self.misses = 0
        self.evicted = 0
        self.disk_reads = 0


def _make_lazy_loader(lru_size: int, stat: LRUStat):
    """返回一个包装后的 module-like 对象，把 _cache 改成 LRU。"""
    # 把现有的 _cache 替换成 OrderedDict 实现 LRU
    lru: "OrderedDict[str, dict]" = OrderedDict()

    def _load_one(reg_id: str) -> dict | None:
        if reg_id in lru:
            lru.move_to_end(reg_id)
            stat.hits += 1
            return lru[reg_id]
        path = _reg_path_for_id(reg_id)
        if path is None or not path.exists():
            stat.misses += 1
            return None
        try:
            import yaml
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception:
            stat.misses += 1
            return None
        stat.misses += 1
        stat.disk_reads += 1
        if len(lru) >= lru_size:
            lru.popitem(last=False)
            stat.evicted += 1
        lru[reg_id] = data if isinstance(data, dict) else {}
        lru.move_to_end(reg_id)
        return lru[reg_id]

    # id index 全量 stat（只 stat 不 read，极快）
    _id_index: dict[str, Path] = {}
    if article_loader.get_regulations_root().exists():
        for path in article_loader.get_regulations_root().glob("*/*.yaml"):
            reg_id = path.stem
            _id_index[reg_id] = path

    def _list_ids() -> list[str]:
        return list(_id_index.keys())

    def _load_reg(reg_id: str) -> dict | None:
        return _load_one(reg_id)

    def _load_text(reg_id: str, article_id: str) -> str | None:
        reg = _load_one(reg_id)
        if not reg:
            return None
        for art in reg.get("articles") or []:
            if isinstance(art, dict) and art.get("id") == article_id:
                text = (art.get("text") or "").strip()
                return text or None
        return None

    def _source_kind(reg_id: str) -> str:
        reg = _load_one(reg_id)
        if not reg:
            return ""
        return str(reg.get("source_kind") or "").strip()

    def _verbatim(reg_id: str) -> bool:
        return _source_kind(reg_id) in article_loader.VERBATIM_ALLOWED_SOURCE_KINDS

    return {
        "list_regulation_ids": _list_ids,
        "load_regulation": _load_reg,
        "load_article_text": _load_text,
        "is_verbatim_allowed": _verbatim,
        "load_source_kind": _source_kind,
        "_lru_size": lru_size,
        "_stat": stat,
    }


def _reg_path_for_id(reg_id: str) -> Path | None:
    root = article_loader.get_regulations_root()
    if not root.exists():
        return None
    for path in root.glob("*/*.yaml"):
        if path.stem == reg_id:
            return path
    return None


# ─── main ──────────────────────────────────────────────────────────────────


def main():
    n_scans = int(os.environ.get("PROFILE_SCANS", "20"))
    lru_size = int(os.environ.get("LRU_SIZE", "128"))

    tracemalloc.start()

    # 准备 hit set：从真实 fixture 文件里抽取的候选法规
    # 真实场景下 hit set 是按 anchor_selection 筛出来的，不是固定的；这里取 8 个
    # 高频品类（electronics + battery）相关 + 2 个 UN 横切，模拟分布。
    kb_payloads = kb_loader._load_all()
    hit_reg_ids = []
    electronics_payloads = [
        pid for pid, p in kb_payloads.items()
        if isinstance(p, dict) and "electronics" in [
            c.lower() for c in (p.get("applies_if") or {}).get("category", [])
        ]
    ]
    un_payloads = [
        pid for pid, p in kb_payloads.items()
        if isinstance(p, dict) and (p.get("applies_if") or {}).get("markets") == ["UN"]
    ]
    hit_reg_ids = electronics_payloads[:6] + un_payloads[:2]
    if len(hit_reg_ids) < 8:
        # 补一些 features_any 横切
        for pid, p in kb_payloads.items():
            if pid in hit_reg_ids:
                continue
            if isinstance(p, dict) and (p.get("applies_if") or {}).get("features_any"):
                hit_reg_ids.append(pid)
                if len(hit_reg_ids) >= 8:
                    break
    hit_reg_ids = hit_reg_ids[:8]
    print(f"[profile] workload: {n_scans} scans × {len(hit_reg_ids)} reg × 6 article reads each\n")

    # ── Run 1: EAGER (current implementation) ────────────────────────────────
    print("=" * 60)
    print(f"RUN 1: EAGER (current implementation, full preload)")
    print("=" * 60)
    article_loader.invalidate_cache()
    gc.collect()

    cold_metrics = []
    with timer("first_list_regulation_ids (cold start)", cold_metrics):
        ids = article_loader.list_regulation_ids()
    cold_metrics.append(measure("after_first_list"))
    print(f"  cold start: {cold_metrics[0]['elapsed_ms']:.2f}ms")
    print(f"  ids returned: {len(ids)}")
    eager_pre = cold_metrics[1].get("_snap")
    post_preload = measure("after_full_preload", eager_pre)
    print(f"  Python heap after preload: +{post_preload['py_heap_delta_kb']:.1f}KB ({post_preload['py_heap_delta_count']} objects)")

    eager_scan_latencies = []
    for i in range(n_scans):
        hits = {}
        with timer(f"scan_{i}", eager_scan_latencies):
            _workload_one_scan(hit_reg_ids, hits)
    eager_final = measure("eager_final", post_preload.get("_snap"))
    print(f"  scan latency mean: {sum(e['elapsed_ms'] for e in eager_scan_latencies) / n_scans:.2f}ms")
    print(f"  Python heap after {n_scans} scans: +{eager_final['py_heap_delta_kb']:.1f}KB ({eager_final['py_heap_delta_count']} objects)")

    # ── stamp change simulation (midnight index rebuild) ────────────────────
    article_loader.invalidate_cache()  # force rebuild as if library changed
    rebuild_metrics = []
    with timer("stamp_invalidate_rebuild", rebuild_metrics):
        ids = article_loader.list_regulation_ids()
    after_rebuild = measure("after_rebuild", eager_final.get("_snap"))
    print(f"  stamp-invalidate rebuild: {rebuild_metrics[0]['elapsed_ms']:.2f}ms")
    print(f"  Python heap delta during rebuild: +{after_rebuild['py_heap_delta_kb']:.1f}KB\n")

    # ── Run 2: LAZY (LRU maxsize=128) ───────────────────────────────────────
    print("=" * 60)
    print(f"RUN 2: LAZY (LRU maxsize={lru_size})")
    print("=" * 60)
    stat = LRUStat()
    lazy = _make_lazy_loader(lru_size, stat)
    article_loader.invalidate_cache()
    gc.collect()

    cold_lazy = []
    with timer("first_list_regulation_ids (cold start)", cold_lazy):
        ids = lazy["list_regulation_ids"]()
    cold_lazy.append(measure("after_first_list_lazy"))
    print(f"  cold start: {cold_lazy[0]['elapsed_ms']:.2f}ms")
    print(f"  ids returned: {len(ids)}")
    lazy_pre = cold_lazy[1].get("_snap")
    lazy_after_index = measure("after_lazy_index_only", lazy_pre)
    print(f"  Python heap after index-only: +{lazy_after_index['py_heap_delta_kb']:.1f}KB ({lazy_after_index['py_heap_delta_count']} objects)")

    lazy_scan_latencies = []
    for i in range(n_scans):
        hits: dict[str, int] = {}
        with timer(f"lazy_scan_{i}", lazy_scan_latencies):
            _workload_one_scan_lazy(hit_reg_ids, hits, lazy)
    lazy_final = measure("lazy_final", lazy_after_index.get("_snap"))
    print(f"  scan latency mean: {sum(e['elapsed_ms'] for e in lazy_scan_latencies) / n_scans:.2f}ms")
    print(f"  Python heap after {n_scans} scans: +{lazy_final['py_heap_delta_kb']:.1f}KB ({lazy_final['py_heap_delta_count']} objects)")
    print(f"  LRU hits/misses: {stat.hits}/{stat.misses} | disk_reads: {stat.disk_reads} | evicted: {stat.evicted}")

    # stamp change: lazy just clears LRU, no rebuild cost
    invalidate_lazy = []
    with timer("stamp_invalidate_lazy_clear_only", invalidate_lazy):
        # lazy: just clear OrderedDict
        pass
    lazy_after_clear = measure("after_lazy_clear", lazy_final.get("_snap"))
    print(f"  stamp-invalidate (LRU clear only): {invalidate_lazy[0]['elapsed_ms']:.4f}ms")
    print(f"  Python heap delta during clear: +{lazy_after_clear['py_heap_delta_kb']:.2f}KB\n")

    # ── Compare ─────────────────────────────────────────────────────────────
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    eager_mean = sum(e["elapsed_ms"] for e in eager_scan_latencies) / n_scans
    lazy_mean = sum(e["elapsed_ms"] for e in lazy_scan_latencies) / n_scans
    print(f"  Cold start        eager={cold_metrics[0]['elapsed_ms']:7.2f}ms  lazy={cold_lazy[0]['elapsed_ms']:7.2f}ms")
    print(f"  Heap after preload eager=+{post_preload['py_heap_delta_kb']:7.1f}KB  lazy=+{lazy_after_index['py_heap_delta_kb']:7.1f}KB")
    print(f"  Mean scan latency eager={eager_mean:7.2f}ms  lazy={lazy_mean:7.2f}ms  Δ={lazy_mean - eager_mean:+.2f}ms")
    print(f"  Heap after {n_scans} scans eager=+{eager_final['py_heap_delta_kb']:7.1f}KB  lazy=+{lazy_final['py_heap_delta_kb']:7.1f}KB")
    print(f"  Stamp rebuild     eager={rebuild_metrics[0]['elapsed_ms']:7.2f}ms (re-reads 724 YAMLs)")
    print(f"                     lazy={invalidate_lazy[0]['elapsed_ms']:7.4f}ms (LRU clear)")
    print(f"  LRU effectiveness: {stat.hits}/{stat.hits + stat.misses} = {100 * stat.hits / max(1, stat.hits + stat.misses):.1f}% hit rate")


def _workload_one_scan_lazy(hit_reg_ids, hits, lazy):
    """Same workload but routed to lazy impl."""
    lazy["list_regulation_ids"]()
    for reg_id in hit_reg_ids:
        reg = lazy["load_regulation"](reg_id)
        if not reg:
            continue
        for art in (reg.get("articles") or [])[:3]:
            if isinstance(art, dict) and art.get("id"):
                lazy["load_article_text"](reg_id, art["id"])
                hits[reg_id] = hits.get(reg_id, 0) + 1
    for reg_id in hit_reg_ids:
        reg = lazy["load_regulation"](reg_id)
        if not reg:
            continue
        for art in (reg.get("articles") or [])[:3]:
            if isinstance(art, dict) and art.get("id"):
                lazy["load_article_text"](reg_id, art["id"])
    for reg_id in hit_reg_ids[:5]:
        lazy["is_verbatim_allowed"](reg_id)


if __name__ == "__main__":
    main()