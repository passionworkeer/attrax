"""最终 A/B 基准：旧 eager 实现 vs 新 lazy 实现。

两种实现分别加载为独立模块（旧版从 git HEAD 取出），在真实
data/regulations 库上测同一组指标：
  1. 冷启动：invalidate_cache() 后首次 list_regulation_ids() 耗时
  2. 全库遍历（/health/watchdog 路径）：724 次 load_regulation 耗时
  3. 库变更后重建：模拟 stamp 变化（touch 一个文件）后首次读耗时
  4. 进程 RSS 增量

用法（两个进程各跑一次，保持内存测量干净）:
  python3 tmp/bench_load_impl.py eager
  python3 tmp/bench_load_impl.py lazy
"""
from __future__ import annotations

import importlib.util
import os
import resource
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
IMPL = sys.argv[1] if len(sys.argv) > 1 else "lazy"
assert IMPL in ("eager", "lazy"), "usage: bench_load_impl.py eager|lazy"


def _rss_mb() -> float:
    """macOS: ru_maxrss 是字节；Linux: KB。"""
    raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return raw / 1024 / 1024
    return raw / 1024


def load_module():
    if IMPL == "eager":
        # git HEAD 版本（本次改动尚未提交，HEAD 即旧实现）
        source = subprocess.check_output(
            ["git", "show", "HEAD:rag_service/retrieval/article_loader.py"],
            cwd=REPO_ROOT,
        ).decode()
        tmp_path = REPO_ROOT / "tmp" / "_eager_article_loader.py"
        tmp_path.write_text(source, encoding="utf-8")
        spec = importlib.util.spec_from_file_location("_eager_article_loader", tmp_path)
    else:
        spec = importlib.util.spec_from_file_location(
            "article_loader",
            REPO_ROOT / "rag_service" / "retrieval" / "article_loader.py",
        )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # 从 tmp/ 加载时 parents[2] 会算错，显式指向真实数据目录
    mod._regulations_root = REPO_ROOT / "data" / "regulations"
    return mod


def main() -> None:
    al = load_module()
    sys.path.insert(0, str(REPO_ROOT))

    rss0 = _rss_mb()

    # 1. 冷启动
    al.invalidate_cache()
    t0 = time.perf_counter()
    ids = al.list_regulation_ids()
    cold_ms = (time.perf_counter() - t0) * 1000
    rss_cold = _rss_mb()

    # 2. 全库遍历（/health/watchdog 路径）
    t0 = time.perf_counter()
    for reg_id in ids:
        al.load_regulation(reg_id)
    walk1_ms = (time.perf_counter() - t0) * 1000
    rss_walk = _rss_mb()

    # 3. 第二次遍历（稳态）
    t0 = time.perf_counter()
    for reg_id in ids:
        al.load_regulation(reg_id)
    walk2_ms = (time.perf_counter() - t0) * 1000

    # 4. stamp 变化后首次读（模拟凌晨索引重建）
    sample = REPO_ROOT / "data" / "regulations" / "un" / "UN-R156.yaml"
    st = sample.stat()
    os.utime(sample, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))
    t0 = time.perf_counter()
    al.list_regulation_ids()          # 触发 stamp 对比 + 重建/清空
    al.load_regulation(ids[0])        # 首个读
    stamp_ms = (time.perf_counter() - t0) * 1000
    # 恢复 mtime，避免污染后续运行
    os.utime(sample, ns=(st.st_atime_ns, st.st_mtime_ns))

    print(f"IMPL={IMPL}")
    print(f"  ids={len(ids)}")
    print(f"  cold_start_ms={cold_ms:.1f}")
    print(f"  rss_after_cold_mb={rss_cold - rss0:+.1f} (delta)")
    print(f"  walk1_ms={walk1_ms:.1f}  (first full-library walk)")
    print(f"  rss_after_walk_mb={rss_walk - rss0:+.1f} (delta)")
    print(f"  walk2_ms={walk2_ms:.1f}  (steady-state walk)")
    print(f"  stamp_change_firstread_ms={stamp_ms:.1f}")


if __name__ == "__main__":
    main()
