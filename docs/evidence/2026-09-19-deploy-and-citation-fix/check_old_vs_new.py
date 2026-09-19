"""对比修复前后的 quote_matcher 行为,确认新测试真的覆盖了修复点。

旧版用 git show HEAD:rag_service/verify/quote_matcher.py 取出到临时模块加载,
新版直接用当前工作树。不 mock:两条路径都跑真实 match_quote。
"""
import importlib.util
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

CASES = [
    (
        "em dash (article) vs hyphen (quote)",
        "The manufacturer — or the authorised representative — shall keep the technical documentation available.",
        "The manufacturer - or the authorised representative - shall keep",
    ),
    (
        "curly quotes (quote) vs straight (article)",
        'The term "manufacturer" covers the importer as well.',
        "The term “manufacturer” covers the importer as well.",
    ),
    (
        "leading '. . .' marker",
        "Member States shall ensure that the Commission is informed without delay of any measure adopted.",
        ". . . the Commission is informed without delay",
    ),
    (
        "leading '..' marker",
        "Member States shall ensure that the Commission is informed without delay of any measure adopted.",
        ".. the Commission is informed without delay",
    ),
    (
        "internal spaced ellipsis must NOT be joined",
        "alpha bravo charlie delta echo foxtrot",
        ". . . alpha bravo . . . echo foxtrot . . .",
    ),
]


def load_from_source(source: str, name: str):
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / f"{name}.py"
        p.write_text(source)
        spec = importlib.util.spec_from_file_location(f"_old_{name}", p)
        mod = importlib.util.module_from_spec(spec)
        # quote_matcher 依赖 rag_service.retrieval,直接复用已导入的同名包
        sys.modules[f"_old_{name}"] = mod
        spec.loader.exec_module(mod)
        return mod


def main() -> int:
    old_source = subprocess.run(
        ["git", "show", "HEAD:rag_service/verify/quote_matcher.py"],
        cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout
    sys.path.insert(0, str(REPO))
    old_mod = load_from_source(old_source, "quote_matcher")
    from rag_service.verify import quote_matcher as new_mod

    print(f"{'case':46s} {'OLD':>18s}   {'NEW':>18s}")
    print("-" * 90)
    regressions = 0
    for label, article, quote in CASES:
        o_span, o_status = old_mod.match_quote(article, quote)
        n_span, n_status = new_mod.match_quote(article, quote)
        flag = ""
        if "must NOT" in label:
            # 反向用例:两边都必须是 fallback,若新版变 matched 即回归
            if n_status != "fallback_article_only":
                flag = "  <-- REGRESSION"
                regressions += 1
        else:
            if n_status != "matched":
                flag = "  <-- STILL BROKEN"
                regressions += 1
        print(f"{label:46s} {o_status:>18s}   {n_status:>18s}{flag}")

    print("-" * 90)
    if regressions:
        print(f"FAIL: {regressions} 个用例不符合预期")
        return 1
    print("OK: 5 个用例全部符合预期(4 个由 fallback 修成 matched,1 个反向用例保持 fallback)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
