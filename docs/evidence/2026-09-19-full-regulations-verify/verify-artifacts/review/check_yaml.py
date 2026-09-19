# 审查项 1：全库 YAML 语法 + 修改文件字段完整性
import glob
import os
import sys

import yaml

BASE = "/Users/wangjianjun/me/attrax/data/regulations"

# 收集所有 YAML（排除 raw/ _imports/ schema/）
files = []
for entry in sorted(os.listdir(BASE)):
    p = os.path.join(BASE, entry)
    if not os.path.isdir(p) or entry in ("_imports", "schema"):
        continue
    files.extend(sorted(glob.glob(os.path.join(p, "*.yaml"))))

parse_fail = []
load_ok = 0
for f in files:
    try:
        with open(f, encoding="utf-8") as fh:
            doc = yaml.safe_load(fh)
        if not isinstance(doc, dict):
            parse_fail.append((f, "not a mapping"))
            continue
        load_ok += 1
    except Exception as exc:  # noqa: BLE001
        parse_fail.append((f, str(exc)))

print(f"total_yaml={len(files)} parse_ok={load_ok} parse_fail={len(parse_fail)}")
for f, err in parse_fail:
    print(f"PARSE_FAIL {f}: {err}")

# 修改过的 14 条文件（git status 中的 M + 新增 KR-KLRI-ELAW）
MODIFIED = [
    "ae/AE-MoIAT-ECAS.yaml",
    "au/AU-RCM.yaml",
    "br/BR-INMETRO.yaml",
    "cn/CN-CCC-IT.yaml",
    "cn/CN-CCC.yaml",
    "cn/CN-CSAR.yaml",
    "jp/JP-METI-PSE.yaml",
    "kr/KR-MOTIE-KC.yaml",
    "kr/KR-KLRI-ELAW.yaml",
    "sa/SA-SABER-SASO.yaml",
    "sa/SA-SASO-Saber.yaml",
    "uk/UK-UKCA-Appliance.yaml",
    "un/UN-38-3.yaml",
    "us/US-CPSC-General.yaml",
]

REQUIRED = ["id", "region", "source_url", "notes", "last_verified"]
field_fail = []
for rel in MODIFIED:
    f = os.path.join(BASE, rel)
    if not os.path.exists(f):
        field_fail.append((rel, "FILE MISSING"))
        continue
    with open(f, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    missing = [k for k in REQUIRED if k not in doc or doc[k] is None]
    if missing:
        field_fail.append((rel, f"missing/null: {missing}"))
    if str(doc.get("last_verified")) != "2026-09-19":
        field_fail.append((rel, f"last_verified={doc.get('last_verified')!r}"))

print(f"modified_files_checked={len(MODIFIED)} field_fail={len(field_fail)}")
for rel, err in field_fail:
    print(f"FIELD_FAIL {rel}: {err}")

# KR-KLRI-ELAW 专项：id 与文件名一致 + doc_files raw 存在
kr = os.path.join(BASE, "kr/KR-KLRI-ELAW.yaml")
with open(kr, encoding="utf-8") as fh:
    doc = yaml.safe_load(fh)
print(f"kr_id={doc['id']!r} id_matches_filename={doc['id'] == 'KR-KLRI-ELAW'}")
for df in doc.get("doc_files") or []:
    raw_path = os.path.join(BASE, df)
    print(f"doc_file {df} exists={os.path.exists(raw_path)}")
kr_raws = sorted(os.listdir(os.path.join(BASE, "kr/raw")))
print(f"kr_raw_dir_files={kr_raws}")

sys.exit(1 if (parse_fail or field_fail) else 0)
