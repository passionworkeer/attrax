"""Import the two reviewed EUR-Lex snapshots used by the product cases.

No network requests. Requires the downloaded 2026-05-30 consolidated HTML
snapshots; preserves source headings instead of assigning guessed titles.
"""
from pathlib import Path
import hashlib
import re
import yaml
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]


def import_directive(short: str, number: str, required: list[int]):
    source = ROOT / f"data/regulation_sources/{short}-20260530.html"
    document = ROOT / f"data/regulations/eu/EU-2014-{number}.yaml"
    soup = BeautifulSoup(source.read_text(encoding="utf-8"), "html.parser")
    existing = yaml.safe_load(document.read_text(encoding="utf-8"))
    articles = []
    ids = list(dict.fromkeys([a["id"] for a in existing["articles"]] + [f"art-{n}" for n in required]))
    romans = {"1": "I", "2": "II", "3": "III", "4": "IV"}
    for article_id in ids:
        if article_id.startswith("art-"):
            target = "art_" + article_id[4:]
        else:
            suffix = article_id.removeprefix("annex-")
            target = "anx_" + romans.get(suffix, suffix.upper())
        node = soup.find(id=target)
        if node is None:
            raise ValueError(f"Missing official section {target}")
        heading = node.select_one(".stitle-article-norm")
        title = heading.get_text(" ", strip=True) if heading else node.get_text(" ", strip=True)[:100]
        for marker in node.select(".modref"):
            marker.decompose()
        text = re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()
        if len(text) < 50:
            raise ValueError(f"Empty official section {target}")
        articles.append({"id": article_id, "title": title, "text": text})
    existing.update(articles=articles, source_kind="official_verbatim", last_verified="2026-09-16",
        last_verified_by="EUR-Lex-snapshot-import", raw_file=str(source.relative_to(ROOT)).replace("\\", "/"),
        checksum_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
        source_url=f"https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02014L00{number}-20260530",
        notes="Selected sections from EUR-Lex consolidated text of 2026-05-30. Whitespace normalized. Consolidated text is a documentation tool; authentic legal acts are in the Official Journal linked by EUR-Lex. Replaces unverified repeated summaries and incorrect section titles.")
    document.write_text(yaml.safe_dump(existing, allow_unicode=True, sort_keys=False, width=120), encoding="utf-8")
    print(document.name, [(a["id"], len(a["text"])) for a in articles])


if __name__ == "__main__":
    import_directive("lvd", "35", [1, 3, 6, 8, 15, 17, 24])
    import_directive("red", "53", [1, 3, 10, 12, 17, 18, 20])
