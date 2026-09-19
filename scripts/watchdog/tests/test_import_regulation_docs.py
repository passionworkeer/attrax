#!/usr/bin/env python3
"""attrax-docs 法规目录导入脚本的回归测试。

覆盖 2026-09-19 对抗性审查发现并修掉的四类问题：
  - 清单字段带首尾空白时校验放行、执行崩在 run()（未捕获 KeyError）
  - docs 路径可用 `../` 越出原件目录
  - 同区域原件重名被静默互相覆盖
  - YAML 已存在时 --copy-docs 完全不复制原件（文档承诺的恢复流程失效）

以及清单缺 source_root 时报 CatalogError 而不是 KeyError。
"""
import json

import pytest
import yaml

import scripts.watchdog.auto_ingest as ai
from scripts import import_regulation_docs as ird


@pytest.fixture
def library(tmp_path, monkeypatch):
    """把法规库根指向 tmp，避免碰到真实 data/regulations/。"""
    regs = tmp_path / "regulations"
    for sub in ird._REGION_DIRS.values():
        (regs / sub).mkdir(parents=True)
    docs_root = tmp_path / "source"
    docs_root.mkdir()
    monkeypatch.setattr(ird, "REGULATIONS_ROOT", regs)
    monkeypatch.setattr(ird, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(ai, "REGULATIONS_ROOT", regs)
    monkeypatch.setattr(ai, "INDEX_PATH", regs / "regulations_index.json")
    return regs, docs_root


def _entry(**overrides):
    entry = {
        "id": "EU-TEST-1",
        "region": "EU",
        "domain": "产品认证",
        "official_citation": "Test Regulation",
        "short_name": "测试法规",
        "language": "en",
        "source_url": "https://example.eu/",
        "docs": [],
    }
    entry.update(overrides)
    return entry


def _write_catalog(tmp_path, entries, source_root="__default__"):
    payload = {"manifest_version": 1, "entries": entries}
    if source_root == "__default__":
        source_root = str(tmp_path / "source")
    if source_root is not None:
        payload["source_root"] = source_root
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def _doc(docs_root, name, body="x"):
    path = docs_root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return name


class TestCatalogLoading:
    def test_missing_source_root_raises_catalog_error(self, tmp_path):
        path = _write_catalog(tmp_path, [_entry()], source_root=None)
        with pytest.raises(ird.CatalogError, match="source_root"):
            ird.load_catalog(path)

    def test_empty_entries_raises_catalog_error(self, tmp_path):
        path = _write_catalog(tmp_path, [])
        with pytest.raises(ird.CatalogError, match="entries"):
            ird.load_catalog(path)


class TestValidateNormalisation:
    def test_whitespace_field_is_stripped_before_run(self, library):
        _, docs_root = library
        entry = _entry(**{"region": " us ", "id": " US-TEST-1 "})
        normalised = ird.validate({"entries": [entry]}, docs_root)
        assert normalised[0]["region"] == "US"
        assert normalised[0]["id"] == "US-TEST-1"
        # 规范化后的 region 必须能在 _REGION_DIRS 里查到——run() 直接用它做查表。
        assert ird._REGION_DIRS[normalised[0]["region"]] == "us"

    def test_region_outside_directory_map_is_rejected(self, library):
        _, docs_root = library
        with pytest.raises(ird.CatalogError, match="不在库目录映射里"):
            ird.validate({"entries": [_entry(region="ZZ", id="ZZ-TEST-1")]}, docs_root)

    def test_id_prefix_mismatch_is_rejected(self, library):
        _, docs_root = library
        with pytest.raises(ird.CatalogError, match="id 前缀与 region"):
            ird.validate({"entries": [_entry(id="US-TEST-1")]}, docs_root)

    def test_lowercase_region_is_accepted(self, library):
        _, docs_root = library
        normalised = ird.validate({"entries": [_entry(region="cn", id="CN-TEST-1")]}, docs_root)
        assert normalised[0]["region"] == "CN"


class TestValidateDocPaths:
    def test_path_escaping_docs_root_is_rejected(self, library, tmp_path):
        _, docs_root = library
        outside = tmp_path / "outside.html"
        outside.write_text("secret", encoding="utf-8")
        entry = _entry(docs=["../outside.html"])
        with pytest.raises(ird.CatalogError, match="越出原件目录"):
            ird.validate({"entries": [entry]}, docs_root)

    def test_missing_doc_is_reported(self, library):
        _, docs_root = library
        with pytest.raises(ird.CatalogError, match="原件缺失"):
            ird.validate({"entries": [_entry(docs=["nope.html"])]}, docs_root)

    def test_duplicate_basenames_within_a_region_are_rejected(self, library):
        _, docs_root = library
        first = _doc(docs_root, "a/同名.html")
        second = _doc(docs_root, "b/同名.html", body="y")
        entry = _entry(docs=[first, second])
        with pytest.raises(ird.CatalogError, match="原件重名"):
            ird.validate({"entries": [entry]}, docs_root)


class TestRun:
    def test_copy_docs_restores_originals_for_existing_yaml(self, library, tmp_path):
        """YAML 已存在时 --copy-docs 仍要补原件，且不改写 YAML。"""
        regs, docs_root = library
        catalog = _write_catalog(
            tmp_path, [_entry(docs=[_doc(docs_root, "原件.html")])]
        )
        assert ird.run(catalog, docs_root, True, False, False) == 0

        target = regs / "eu" / "EU-TEST-1.yaml"
        before = target.read_text(encoding="utf-8")
        # 模拟 raw/ 被删（该目录不入版本控制）
        (regs / "eu" / "raw" / "原件.html").unlink()
        assert not (regs / "eu" / "raw" / "原件.html").exists()

        # 第二次不带 --force：YAML 走「跳过」分支，原件必须照样补齐。
        assert ird.run(catalog, docs_root, True, False, False) == 0
        assert (regs / "eu" / "raw" / "原件.html").read_text(encoding="utf-8") == "x"
        assert target.read_text(encoding="utf-8") == before

    def test_force_rewrites_yaml_and_rebuilds_index(self, library, tmp_path):
        regs, docs_root = library
        catalog = _write_catalog(tmp_path, [_entry()])
        ird.run(catalog, docs_root, False, False, False)
        target = regs / "eu" / "EU-TEST-1.yaml"
        payload = yaml.safe_load(target.read_text(encoding="utf-8"))
        payload["notes"] = "人工补充"
        target.write_text(yaml.safe_dump(payload, allow_unicode=True), encoding="utf-8")

        ird.run(catalog, docs_root, False, True, False)

        rewritten = yaml.safe_load(target.read_text(encoding="utf-8"))
        assert "人工补充" not in (rewritten.get("notes") or "")
        index = json.loads((regs / "regulations_index.json").read_text(encoding="utf-8"))
        assert index["count"] == 1

    def test_dry_run_writes_nothing(self, library, tmp_path):
        regs, docs_root = library
        catalog = _write_catalog(tmp_path, [_entry(docs=[_doc(docs_root, "原件.html")])])
        assert ird.run(catalog, docs_root, True, False, True) == 0
        assert not (regs / "eu" / "EU-TEST-1.yaml").exists()
        assert not (regs / "eu" / "raw").exists()
        assert not (regs / "regulations_index.json").exists()


class TestBuildPayload:
    def test_defaults_to_public_license(self):
        payload = ird.build_payload(_entry(), "eu")
        assert payload["license"] == "public"
        assert payload["purchase_url"] is None
        assert payload["articles"] == []
        assert payload["source_kind"] == "unverified"
        assert payload["doc_files"] == []

    def test_catalog_entry_can_override_license_and_purchase_url(self):
        entry = _entry(license="private_with_summary", purchase_url="https://buy.example/")
        payload = ird.build_payload(entry, "eu")
        assert payload["license"] == "private_with_summary"
        assert payload["purchase_url"] == "https://buy.example/"

    def test_doc_files_are_region_relative(self):
        entry = _entry(docs=["欧盟/原件.pdf"])
        assert ird.build_payload(entry, "eu")["doc_files"] == ["eu/raw/原件.pdf"]
