# 审查项 3：regulations_index.json 与 YAML 全量对账
import glob
import json
import os

import yaml

BASE = "/Users/wangjianjun/me/attrax/data/regulations"

with open(os.path.join(BASE, "regulations_index.json"), encoding="utf-8") as fh:
    idx = json.load(fh)

regs = idx["regulations"]
print(f"index_count_field={idx['count']} len_regulations={len(regs)}")

# YAML 侧全量
yaml_by_id = {}
for entry in sorted(os.listdir(BASE)):
    p = os.path.join(BASE, entry)
    if not os.path.isdir(p) or entry in ("_imports", "schema"):
        continue
    for f in sorted(glob.glob(os.path.join(p, "*.yaml"))):
        with open(f, encoding="utf-8") as fh:
            doc = yaml.safe_load(fh)
        yaml_by_id[doc["id"]] = (f, doc)

print(f"yaml_total={len(yaml_by_id)}")

# id 集合差异
idx_ids = {r["id"] for r in regs}
yaml_ids = set(yaml_by_id)
print(f"only_in_index={sorted(idx_ids - yaml_ids)}")
print(f"only_in_yaml={sorted(yaml_ids - idx_ids)}")

# 全量 source_url 对账 + region 对账
mismatch = []
for r in regs:
    rid = r["id"]
    if rid not in yaml_by_id:
        continue
    _, doc = yaml_by_id[rid]
    if r.get("source_url") != doc.get("source_url"):
        mismatch.append((rid, r.get("source_url"), doc.get("source_url")))
    if r.get("region") != doc.get("region"):
        mismatch.append((rid, f"region index={r.get('region')}", f"yaml={doc.get('region')}"))

print(f"url_or_region_mismatch={len(mismatch)}")
for m in mismatch[:20]:
    print("MISMATCH", m)

# 重复 id 检查
from collections import Counter

dup = [i for i, c in Counter(r["id"] for r in regs).items() if c > 1]
print(f"duplicate_index_ids={dup}")

# KR 专项
kr = [r for r in regs if r["id"] == "KR-KLRI-ELAW"]
print(f"KR-KLRI-ELAW_in_index={len(kr) == 1} source_url={kr[0]['source_url'] if kr else None}")
old_kr = [r for r in regs if r["id"] in ("KR-KR_-_-_KLRI", "KR-KR_-_KLRI_")]
print(f"old_kr_ids_in_index={len(old_kr)}")
