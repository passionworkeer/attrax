import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

catalog_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])
entries = json.loads(catalog_path.read_text(encoding="utf-8"))["entries"]


def probe(entry):
    url = entry["source_url"]
    command = [
        "curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}", "-L",
        "--max-time", "30", "-A", UA, url,
    ]
    try:
        code = subprocess.run(command, capture_output=True, text=True, timeout=45).stdout.strip()
    except subprocess.TimeoutExpired:
        code = "TIMEOUT"
    return entry["id"], code, url


with ThreadPoolExecutor(max_workers=10) as pool:
    results = list(pool.map(probe, entries))

lines = ["# 63 条目录条目 source_url 实测（curl -L，浏览器 UA，2026-09-19）", ""]
ok = 0
for entry_id, code, url in results:
    good = code in {"200", "202", "203"}
    ok += 1 if good else 0
    lines.append(f"{'OK ' if good else '!! '}{code}\t{entry_id}\t{url}")
lines.append("")
lines.append(f"合计 {len(results)} 条，通过 {ok} 条")
out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"total {len(results)} ok {ok}")
for entry_id, code, url in results:
    if code not in {"200", "202", "203"}:
        print(f"  {code}\t{entry_id}\t{url}")
