# 把 attrax-docs 法规文件目录导入法规库：
#   1. 读清单（data/regulations/_imports/*.json，条目带 id/区域/领域/官方链接/本地文件）
#   2. 逐条写 data/regulations/{region}/{id}.yaml（已存在则跳过，除非 --force）
#   3. --copy-docs 时把原始 PDF/HTML 复制到 data/regulations/{region}/raw/（不入 git）
#   4. 复用 auto_ingest 的 index 重建逻辑刷新 data/regulations/regulations_index.json
#
# 只登记元数据：articles 一律为空，source_kind = unverified，不参与扫描引用。
# 用法：python3 scripts/import_regulation_docs.py --catalog <json> [--copy-docs] [--force] [--dry-run]
#
# YAML 与原件是两条独立的线：{region}/raw/ 不入版本控制，删掉后单跑 --copy-docs 即可恢复
# （YAML 已存在也照样补齐原件，见 run() 里的两步拆分）。

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import date
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.watchdog.auto_ingest import AutoIngestor, _REGION_DIRS  # noqa: E402

REGULATIONS_ROOT = REPO_ROOT / "data" / "regulations"
DEFAULT_CATALOG = REGULATIONS_ROOT / "_imports" / "attrax-docs-2026-09-19.json"
REQUIRED_FIELDS = ("id", "region", "domain", "official_citation", "source_url")
# 清单里 id / region 手写时容易多一个空格；统一在 validate() 里 strip 后回写，
# 否则校验用 strip 过的值、落盘用原值，region 会直接 KeyError（不是 CatalogError）。
STRIPPED_FIELDS = ("id", "region", "domain", "official_citation", "short_name",
                   "source_url", "language", "note")
BASE_NOTE = (
    "目录条目（attrax-docs 法规文件目录，2026-09-19 导入）：登记引用、区域、领域与官方链接，"
    "条款正文尚未整理（articles 为空）。"
)


class CatalogError(Exception):
    pass


def load_catalog(path: Path) -> dict:
    if not path.exists():
        raise CatalogError(f"清单不存在: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries = payload.get("entries")
    if not isinstance(entries, list) or not entries:
        raise CatalogError(f"清单没有 entries: {path}")
    if not str(payload.get("source_root", "")).strip():
        raise CatalogError(f"清单缺 source_root（原件目录）: {path}")
    return payload


def _doc_path(docs_root: Path, doc: str) -> Path:
    """把清单里的原件相对路径解析到 docs_root 之下，越界即拒绝。

    validate() 与 copy_docs() 共用，保证「校验通过的路径」就是「会被复制的路径」——
    清单是人手整理的，`../` 能把 source_root 之外的文件复制进库里。
    """
    resolved = (docs_root / doc).resolve()
    root = docs_root.resolve()
    if root != resolved and root not in resolved.parents:
        raise CatalogError(f"原件路径越出原件目录: {doc}")
    return resolved


def validate(catalog: dict, docs_root: Path) -> list[dict]:
    """校验清单并返回规范化后的条目（字段 strip、region 大写）。"""
    entries = catalog["entries"]
    seen: dict[str, str] = {}
    problems: list[str] = []
    normalised: list[dict] = []

    for entry in entries:
        fixed = dict(entry)
        for field in STRIPPED_FIELDS:
            if field in fixed and isinstance(fixed[field], str):
                fixed[field] = fixed[field].strip()
        entry_id = fixed.get("id", "")
        for field in REQUIRED_FIELDS:
            if not str(fixed.get(field, "")).strip():
                problems.append(f"{entry_id or '<无 id>'}: 缺字段 {field}")
        if entry_id in seen:
            problems.append(f"{entry_id}: id 重复")
        seen[entry_id] = entry_id

        region = str(fixed.get("region", "")).upper()
        if region not in _REGION_DIRS:
            problems.append(f"{entry_id}: region {region} 不在库目录映射里")
        elif not entry_id.startswith(f"{region}-"):
            problems.append(f"{entry_id}: id 前缀与 region {region} 不一致")
        fixed["region"] = region

        targets: dict[str, str] = {}
        for doc in fixed.get("docs", []):
            try:
                source = _doc_path(docs_root, doc)
            except CatalogError as exc:
                problems.append(f"{entry_id}: {exc}")
                continue
            if not source.exists():
                problems.append(f"{entry_id}: 原件缺失 {doc}")
                continue
            # copy_docs() 只取 basename，同一区域里重名会静默互相覆盖。
            name = source.name
            if name in targets:
                problems.append(
                    f"{entry_id}: 原件重名 {name}（{targets[name]} 与 {doc}），复制时会互相覆盖"
                )
            targets[name] = doc

        normalised.append(fixed)

    if problems:
        raise CatalogError("清单校验失败:\n  " + "\n  ".join(problems))
    return normalised


def build_payload(entry: dict, region_dir: str) -> dict:
    docs = entry.get("docs", [])
    raw_files = [f"{region_dir}/raw/{Path(doc).name}" for doc in docs]
    payload = {
        "id": entry["id"],
        "official_citation": entry["official_citation"],
        "short_name": entry.get("short_name", entry["id"]),
        "region": entry["region"].upper(),
        "domain": entry["domain"],
        "license": entry.get("license", "public"),
        "source_url": entry["source_url"],
        "purchase_url": entry.get("purchase_url"),
        "last_verified": date.today().isoformat(),
        "last_verified_by": "manual-create",
        "language": entry.get("language", "en"),
        "source_kind": "unverified",
        "articles": [],
        "doc_files": raw_files,
        "raw_file": None,
        "checksum_sha256": None,
        "schema_version": 1,
        "notes": BASE_NOTE + (f" {entry['note']}" if entry.get("note") else ""),
    }
    return payload


def copy_docs(entry: dict, docs_root: Path, region_dir: str) -> list[str]:
    target_dir = REGULATIONS_ROOT / region_dir / "raw"
    target_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for doc in entry.get("docs", []):
        source = _doc_path(docs_root, doc)
        target = target_dir / source.name
        shutil.copy2(source, target)
        written.append(str(target.relative_to(REGULATIONS_ROOT)))
    return written


def run(catalog_path: Path, docs_root: Path, copy: bool, force: bool, dry_run: bool) -> int:
    catalog = load_catalog(catalog_path)
    entries = validate(catalog, docs_root)

    created, skipped, copied = 0, 0, 0
    for entry in entries:
        region_dir = _REGION_DIRS[entry["region"]]
        target = REGULATIONS_ROOT / region_dir / f"{entry['id']}.yaml"

        # ① YAML：已存在则跳过（除非 --force）。
        if target.exists() and not force:
            skipped += 1
            print(f"跳过（已存在）: {target.relative_to(REPO_ROOT)}")
        else:
            payload = build_payload(entry, region_dir)
            if dry_run:
                print(f"[dry-run] 写入 {target.relative_to(REPO_ROOT)}")
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(
                    yaml.safe_dump(payload, allow_unicode=True, sort_keys=False, width=120),
                    encoding="utf-8",
                )
            created += 1

        # ② 原件：独立于 ① 执行。raw/ 不入版本控制，YAML 已存在时也要能补齐原件，
        #    否则文档承诺的「删掉后重跑同一条命令恢复」根本不成立。
        if copy and entry.get("docs"):
            if dry_run:
                print(f"[dry-run] 复制 {len(entry['docs'])} 份原件 -> {region_dir}/raw/")
            else:
                copied += len(copy_docs(entry, docs_root, region_dir))

    if not dry_run and created:
        AutoIngestor._rebuild_index()
        print(f"已重建 {REGULATIONS_ROOT / 'regulations_index.json'}")
    print(f"新增 {created} 条，跳过 {skipped} 条，复制原件 {copied} 份")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="导入 attrax-docs 法规文件目录")
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--docs-root", type=Path, default=None)
    parser.add_argument("--copy-docs", action="store_true", help="把原件复制到 {region}/raw/")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的 YAML")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        catalog = load_catalog(args.catalog)
        docs_root = args.docs_root or Path(catalog["source_root"])
        if not docs_root.exists():
            print(f"原件目录不存在: {docs_root}", file=sys.stderr)
            return 2
        return run(args.catalog, docs_root, args.copy_docs, args.force, args.dry_run)
    except CatalogError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
