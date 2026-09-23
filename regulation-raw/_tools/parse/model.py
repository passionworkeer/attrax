"""Document model shared by every regulation-raw extractor."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path


def clean_text(s: str) -> str:
    """Collapse whitespace and drop the page-furniture that PDF/HTML leave behind."""
    if not s:
        return ""
    s = s.replace("\u00ad", "")           # soft hyphen
    s = s.replace("\xa0", " ")            # nbsp
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    s = re.sub(r" *\n *", "\n", s)
    return s.strip()


@dataclass
class Article:
    """One article / section / § of a regulation."""
    id: str                      # stable slug, e.g. "art-7" or "sec-1307.1"
    number: str                  # the citation as printed, e.g. "Article 7", "§ 1307.1"
    title: str = ""              # heading, if the source separates one
    text: str = ""               # body text
    level: str = "article"       # article | section | chapter | appendix | recital

    @property
    def chars(self) -> int:
        return len(self.text)

    @property
    def display_title(self) -> str:
        """The heading, unless it merely restates the number ('Article 1')."""
        t, n = self.title.strip(), self.number.strip()
        if not t:
            return ""
        norm = lambda s: re.sub(r"[\s.．、:：\-—]+", "", s).lower()
        if norm(t) == norm(n):
            return ""
        # '第1条' vs '第一条' -- different scripts, same thing
        if re.search(r"\d+", n):
            digits = re.findall(r"\d+", n)
            if digits and all(d in t for d in digits) and len(t) <= len(n) + 4:
                return ""
        return t


@dataclass
class Doc:
    doc_id: str
    market: str
    title: str
    source_path: str
    source_format: str
    parser: str
    lang: str = "en"
    articles: list[Article] = field(default_factory=list)
    full_text: str = ""
    metadata: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    # ---------------------------------------------------------------- stats
    @property
    def article_count(self) -> int:
        return len(self.articles)

    @property
    def text_chars(self) -> int:
        if self.full_text:
            return len(self.full_text)
        return sum(a.chars for a in self.articles)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["article_count"] = self.article_count
        d["text_chars"] = self.text_chars
        return d

    # ---------------------------------------------------------------- output
    def to_markdown(self) -> str:
        fm = {
            "doc_id": self.doc_id,
            "market": self.market,
            "title": self.title,
            "lang": self.lang,
            "source": self.source_path,
            "source_format": self.source_format,
            "parser": self.parser,
            "articles": self.article_count,
            "text_chars": self.text_chars,
        }
        head = ["---"]
        for k, v in fm.items():
            head.append(f"{k}: {json.dumps(v, ensure_ascii=False)}")
        if self.metadata:
            head.append("metadata:")
            for k, v in self.metadata.items():
                head.append(f"  {k}: {json.dumps(v, ensure_ascii=False)}")
        head.append("---")
        head.append("")
        head.append(f"# {self.title}")
        head.append("")

        if self.articles:
            for a in self.articles:
                num = a.number or a.id
                ttl = a.display_title
                head.append(f"## {num}" + (f" — {ttl}" if ttl else ""))
                head.append("")
                if a.text:
                    head.append(a.text)
                    head.append("")
        else:
            head.append(self.full_text)
            head.append("")
        if self.warnings:
            head.append("<!-- parser warnings: " + "; ".join(self.warnings) + " -->")
        return "\n".join(head)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=1)


def slugify(s: str, maxlen: int = 60) -> str:
    s = re.sub(r"[^\w\-.]+", "-", s, flags=re.UNICODE).strip("-")
    return s[:maxlen] or "x"
