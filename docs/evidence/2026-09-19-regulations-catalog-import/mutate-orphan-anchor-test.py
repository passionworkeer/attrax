# 变异验证：证明 test_regulations_without_an_anchor_are_metadata_only 的断言真的会失败。
# 做法：临时把法规库根指向一个合成目录，里面放
#   - KB-A：有锚点的法规（对照组）
#   - KB-ORPHAN：articles 非空但没有任何锚点指向它（应被断言抓住）
# 然后直接跑该测试函数，期望 AssertionError 且消息里点名 KB-ORPHAN。

import sys
import tempfile
from pathlib import Path

# 从仓库根导入 rag_service（本文件在 docs/evidence/<批次>/ 下，往上三级是仓库根）。
REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

import yaml

from rag_service.retrieval import article_loader, kb_loader
from rag_service.tests.test_kb_loader import TestKbFileInventory

REG = """
id: {reg_id}
region: EU
license: public
source_kind: unverified
articles: {articles}
"""

with tempfile.TemporaryDirectory() as tmp:
    regs = Path(tmp) / "regulations" / "eu"
    regs.mkdir(parents=True)
    (regs / "KB-A.yaml").write_text(
        REG.format(reg_id="KB-A", articles="[{id: art-1, text: hello}]"), encoding="utf-8"
    )
    (regs / "KB-ORPHAN.yaml").write_text(
        REG.format(reg_id="KB-ORPHAN", articles="[{id: art-1, text: orphan body}]"),
        encoding="utf-8",
    )
    anchors = Path(tmp) / "anchors"
    anchors.mkdir()
    (anchors / "a.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "KB-electronics-EU-KB-A",
                "regulation_id": "KB-A",
                "doc_name": "A",
                "applies_if": {"category": ["electronics"], "markets": ["EU"]},
                "key_articles": ["art-1"],
                "key_points": ["占位"],
                "schema_version": 1,
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )

    article_loader.set_regulations_root(Path(tmp) / "regulations")
    kb_loader.set_anchors_dir(anchors)

    case = TestKbFileInventory()
    try:
        case.test_regulations_without_an_anchor_are_metadata_only()
    except AssertionError as exc:
        assert "KB-ORPHAN" in str(exc), f"断言触发了但没点名孤儿法规: {exc}"
        print("变异验证通过：孤儿法规被断言抓住 ->", str(exc).splitlines()[-1])
    else:
        raise SystemExit("变异验证失败：articles 非空的无锚点法规没有被断言抓住")
    finally:
        article_loader.set_regulations_root(article_loader._DEFAULT_REGULATIONS_ROOT)
        article_loader.invalidate_cache()
