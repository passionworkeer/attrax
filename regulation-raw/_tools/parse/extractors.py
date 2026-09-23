"""Per-source extractors.

Each function takes a path and returns a model.Doc. They never raise on bad
input: anything unexpected is recorded in Doc.warnings and whatever text could
be recovered is still returned, so a partial parse is never worse than none.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from bs4 import BeautifulSoup
from lxml import etree

from .model import Article, Doc, clean_text, slugify

# --------------------------------------------------------------------------
# generic helpers
# --------------------------------------------------------------------------

BLOCK_TAGS = {
    "P", "BR", "DIV", "TR", "LI", "DT", "DD", "HD", "HEADING", "TITLE",
    "SECTION", "ARTICLE", "PARAGRAPH", "SENTENCE", "ITEM", "CONTENT",
    "TEXT", "PRE", "TABLE", "ROW", "COLUMN", "SUBPARAGRAPH", "PARA",
}


def xml_text(el) -> str:
    """Flatten an XML element to text, turning block tags into line breaks."""
    parts: list[str] = []

    def walk(node):
        tag = node.tag.split("}")[-1] if isinstance(node.tag, str) else ""
        if tag == "BR":
            parts.append("\n")
        if node.text:
            parts.append(node.text)
        for child in node:
            walk(child)
            if child.tag is not None and isinstance(child.tag, str):
                ct = child.tag.split("}")[-1]
                if ct in BLOCK_TAGS:
                    parts.append("\n")
            if child.tail:
                parts.append(child.tail)

    walk(el)
    return clean_text("".join(parts))


def section_split(text: str, pattern: re.Pattern, min_body: int = 30) -> list[Article]:
    """Cut a flat text into articles wherever `pattern` matches at line start."""
    matches = list(pattern.finditer(text))
    if not matches:
        return []
    out: list[Article] = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        chunk = text[start:end]
        num = m.group(1).strip()
        body = clean_text(chunk)
        if len(body) < min_body:
            continue
        # a title is a short first line that is not the numbering itself
        lines = [ln for ln in body.split("\n") if ln.strip()]
        title = ""
        if lines and len(lines[0]) < 120 and not lines[0].rstrip(".").endswith("."):
            title = lines[0].strip()
        out.append(Article(
            id=f"art-{slugify(num, 24)}",
            number=m.group(0).strip().rstrip(".-"),
            title=title,
            text=body,
        ))
    return out


def pdf_text(path: Path, warnings: list[str]) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        warnings.append("pypdf not installed")
        return ""
    import logging
    logging.getLogger("pypdf").setLevel(logging.ERROR)
    try:
        reader = PdfReader(str(path))
        pages = []
        for p in reader.pages:
            try:
                pages.append(p.extract_text() or "")
            except Exception as e:
                warnings.append(f"page extract failed: {type(e).__name__}")
        return "\n".join(pages)
    except Exception as e:
        warnings.append(f"pdf open failed: {type(e).__name__}: {e}")
        return ""


# --------------------------------------------------------------------------
# EU
# --------------------------------------------------------------------------

EU_ART_RE = re.compile(r"(?m)^\s*Article\s+(\d+[a-z]?)\s*$")
EU_ANNEX_RE = re.compile(r"(?m)^\s*ANNEX\s+([IVXL]+)\s*$")


def eu_xhtml(path: Path) -> Doc:
    """OJ CONVEX XHTML. Articles live in div.eli-subdivision under p.oj-ti-art."""
    warnings: list[str] = []
    doc_id = path.stem
    root = etree.parse(str(path)).getroot()
    hp = {"h": "http://www.w3.org/1999/xhtml"}

    title_el = root.find(".//h:title", hp)
    title = ""
    for cls in ("eli-main-title", "oj-doc-ti"):
        el = root.find(f".//h:*[@class='{cls}']", hp)
        if el is not None:
            title = clean_text(xml_text(el))
            if title:
                break
    if not title and title_el is not None:
        title = clean_text(title_el.text or "")

    articles: list[Article] = []

    # 1. articles: a p.oj-ti-art marks the head of each article block
    for head in root.findall(".//h:p[@class='oj-ti-art']", hp):
        container = head.getparent()
        num_txt = clean_text(xml_text(head))
        m = re.search(r"Article\s+(\d+[a-z]?)", num_txt)
        num = m.group(1) if m else num_txt
        sub = container.find("h:p[@class='oj-sti-art']", hp)
        art_title = clean_text(xml_text(sub)) if sub is not None else ""
        paras = []
        for p in container.findall(".//h:p", hp):
            cls = p.get("class") or ""
            if "oj-ti-art" in cls or "oj-sti-art" in cls:
                continue
            t = clean_text(xml_text(p))
            if t:
                paras.append(t)
        body = "\n\n".join(paras)
        articles.append(Article(
            id=f"art-{slugify(num, 20)}", number=f"Article {num}",
            title=art_title, text=body,
        ))

    # 2. chapter / section headings, kept as structural markers
    for cls, level in (("oj-ti-section-1", "chapter"), ("oj-ti-section-2", "section")):
        for el in root.findall(f".//h:p[@class='{cls}']", hp):
            t = clean_text(xml_text(el))
            if t:
                articles.append(Article(id=f"{level}-{slugify(t,24)}",
                                        number=t, text="", level=level))

    full = clean_text(xml_text(root.find(".//h:body", hp))) if root.find(".//h:body", hp) is not None else ""
    if not articles:
        warnings.append("no Article headings found; fell back to full text")
    return Doc(
        doc_id=doc_id, market="eu", title=title or doc_id,
        source_path=str(path), source_format="xhtml", parser="eu_xhtml",
        articles=articles, full_text=full, warnings=warnings,
        metadata={"eli_title": clean_text(title_el.text or "") if title_el is not None else ""},
    )


ACT_TITLE_RE = re.compile(
    r"(?m)^\s*((?:REGULATION|DIRECTIVE|DECISION|COUNCIL REGULATION|COMMISSION REGULATION|"
    r"COUNCIL DIRECTIVE|COMMISSION DIRECTIVE)\b.{10,300})$"
)


def _eu_pdf_title(txt: str) -> str:
    """The OJ cover page repeats the act type; skip furniture like 'I' or '(Legislative acts)'."""
    lines = [ln.strip() for ln in txt.split("\n") if ln.strip()]
    for i, ln in enumerate(lines[:40]):
        if ACT_TITLE_RE.match(ln):
            # join the immediately following continuation lines
            parts = [ln]
            for nxt in lines[i + 1:i + 4]:
                if ACT_TITLE_RE.match(nxt) or re.match(r"^\d", nxt):
                    break
                if len(nxt) < 140 and not nxt.endswith("."):
                    parts.append(nxt)
                else:
                    break
            return " ".join(parts)[:300]
    for ln in lines[:40]:
        if len(ln) > 25:
            return ln[:200]
    return lines[0][:200] if lines else ""


def eu_pdf(path: Path) -> Doc:
    warnings: list[str] = []
    raw = pdf_text(path, warnings)
    # drop running heads/footers of the Official Journal
    raw = re.sub(r"(?m)^\s*(EN\s*)?Official Journal of the European Union\s*$", "", raw)
    raw = re.sub(r"(?m)^\s*L\s+\d+/\d+\s*$", "", raw)
    raw = re.sub(r"(?m)^\s*\d{1,3}/\d{1,3}\s*$", "", raw)
    txt = clean_text(raw)
    arts = section_split(txt, EU_ART_RE)
    for a in arts:
        a.id = "art-" + slugify(a.number.replace("Article", "").strip(), 20)
    title = _eu_pdf_title(txt) or path.stem
    if not arts:
        warnings.append("no 'Article N' line matches; whole text kept")
    return Doc(doc_id=path.stem, market="eu", title=title,
               source_path=str(path), source_format="pdf", parser="eu_pdf",
               articles=arts, full_text=txt, warnings=warnings)


# --------------------------------------------------------------------------
# United States
# --------------------------------------------------------------------------

def us_cfr_xml(path: Path) -> Doc:
    """govinfo CFR granule: <SECTION> blocks carry SECTNO + SUBJECT + body."""
    warnings: list[str] = []
    root = ET.parse(str(path)).getroot()
    meta: dict = {}
    for tag in ("CFRTITLE", "CFRTITLETEXT", "VOL", "GRANULENUM"):
        el = root.find(f".//{tag}")
        if el is not None and el.text:
            meta[tag.lower()] = el.text.strip()
    part = root.find(".//PART")
    hd = part.find("HD") if part is not None else None
    part_title = clean_text(hd.text or "") if hd is not None else ""

    articles: list[Article] = []
    for sec in root.iter("SECTION"):
        if sec.find("P") is None and len(sec) == 0:
            continue
        no = sec.find("SECTNO")
        subj = sec.find("SUBJECT")
        num = clean_text(no.text or "") if no is not None else ""
        sub = clean_text(subj.text or "") if subj is not None else ""
        body = xml_text(sec)
        if not num and not body:
            continue
        articles.append(Article(
            id="sec-" + slugify(num.lstrip("§ ").strip() or sub, 24),
            number=num or sub, title="" if num else sub, text=body,
        ))
    if not articles:
        warnings.append("no <SECTION> with body found")
    full = xml_text(root.find(".//PART") if part is not None else root)
    return Doc(doc_id=path.stem, market="us", title=part_title or path.stem,
               source_path=str(path), source_format="xml", parser="us_cfr_xml",
               articles=articles, full_text=full, metadata=meta, warnings=warnings)


US_PDF_SEC_RE = re.compile(r"(?m)^\s*§\s*(\d+\.\d+[a-z]?)\s")


def us_pdf(path: Path) -> Doc:
    warnings: list[str] = []
    raw = pdf_text(path, warnings)
    raw = re.sub(r"(?m)^\s*\d+\s*$", "", raw)          # stray page numbers
    txt = clean_text(raw)
    arts = section_split(txt, US_PDF_SEC_RE)
    if not arts:
        # public laws and U.S. Code print "SEC. 101." instead
        arts = section_split(txt, re.compile(r"(?m)^\s*SEC(?:TION)?\.?\s*(\d+[A-Za-z]?)\.?\s"))
    title = txt.split("\n")[0][:200] if txt else path.stem
    if not arts:
        warnings.append("no section markers; whole text kept")
    return Doc(doc_id=path.stem, market="us", title=title or path.stem,
               source_path=str(path), source_format="pdf", parser="us_pdf",
               articles=arts, full_text=txt, warnings=warnings)


# --------------------------------------------------------------------------
# Canada
# --------------------------------------------------------------------------

def ca_xml(path: Path) -> Doc:
    """Justice Canada XML: <Section> with Label / MarginalNote / Text."""
    warnings: list[str] = []
    root = ET.parse(str(path)).getroot()
    ident = root.find(".//Identification/InstrumentNumber")
    title_el = root.find(".//Identification/ShortTitle")
    if title_el is None:
        title_el = root.find(".//Identification/LongTitle")
    title = clean_text(title_el.text or "") if title_el is not None else path.stem

    articles: list[Article] = []
    body_el = root.find(".//Body")
    # Walk <Body> in document order so headings stay where they belong instead
    # of being appended after every section.
    for node in (body_el if body_el is not None else root).iter():
        tag = node.tag.split("}")[-1] if isinstance(node.tag, str) else ""
        if tag == "Heading":
            tt = node.find("TitleText")
            if tt is not None and tt.text:
                t = clean_text(tt.text)
                articles.append(Article(id="hd-" + slugify(t, 24), number=t,
                                        text="", level="heading"))
        elif tag == "Section":
            label = node.find("Label")
            note = node.find("MarginalNote")
            num = clean_text(label.text or "") if label is not None else ""
            sub = clean_text(note.text or "") if note is not None else ""
            # Label/MarginalNote are metadata, not body; keep them out of the
            # text so the body does not start with "Definitions1The following".
            parts = []
            for child in node:
                ct = child.tag.split("}")[-1]
                if ct in ("Label", "MarginalNote"):
                    continue
                t = xml_text(child)
                if t:
                    parts.append(t)
            body = "\n\n".join(parts) or xml_text(node)
            if not body:
                continue
            articles.append(Article(
                id="sec-" + slugify(num or sub, 24),
                number=(f"Section {num}" if num else sub),
                title=sub if num else "", text=body,
            ))
    if not articles:
        warnings.append("no <Section> found")
    meta = {}
    if ident is not None and ident.text:
        meta["instrument_number"] = ident.text.strip()
    return Doc(doc_id=path.stem, market="ca", title=title or path.stem,
               source_path=str(path), source_format="xml", parser="ca_xml",
               articles=articles, full_text=xml_text(root), metadata=meta,
               warnings=warnings)


# --------------------------------------------------------------------------
# Japan
# --------------------------------------------------------------------------

def jp_xml(path: Path) -> Doc:
    """e-Gov lawdata XML: <Law> with Chapter/Section/Article(条)/Paragraph."""
    warnings: list[str] = []
    root = ET.parse(str(path)).getroot()
    law = root.find(".//Law")
    title = ""
    if law is not None:
        t = law.find(".//LawTitle")
        if t is None:
            t = root.find(".//LawTitle")
        if t is not None and t.text:
            title = clean_text(t.text)
    num_el = root.find(".//LawNum")
    meta = {"law_num": clean_text(num_el.text or "") if num_el is not None and num_el.text else ""}

    articles: list[Article] = []
    if law is not None:
        for el in law.iter():
            tag = el.tag.split("}")[-1]
            if tag == "Chapter":
                t = el.find("ChapterTitle")
                if t is not None and t.text:
                    tt = clean_text(t.text)
                    articles.append(Article(id="ch-" + slugify(tt, 24), number=tt,
                                            text="", level="chapter"))
            elif tag == "Section":
                t = el.find("SectionTitle")
                if t is not None and t.text:
                    tt = clean_text(t.text)
                    articles.append(Article(id="sec-" + slugify(tt, 24), number=tt,
                                            text="", level="section"))
            elif tag == "Article":
                num = el.get("Num") or ""
                cap = el.find("ArticleCaption")
                atitle = el.find("ArticleTitle")
                head = clean_text(atitle.text or "") if atitle is not None else ""
                # ArticleTitle is the kanji form of the number ("第一条") when
                # the article has no real heading; don't repeat it.
                if re.fullmatch(r"第[〇一二三四五六七八九十百千]+条", head):
                    head = ""
                cap_t = clean_text(cap.text or "") if cap is not None else ""
                body = xml_text(el)
                if not body:
                    continue
                articles.append(Article(
                    id="art-" + slugify(num or cap_t or head, 20),
                    number=f"第{num}条" if num else (cap_t or head),
                    title=head or cap_t, text=body,
                ))
    # keep only the first Chapter/Section marker per title to avoid duplicates
    seen: set[str] = set()
    deduped: list[Article] = []
    for a in articles:
        if a.level in ("chapter", "section"):
            if a.id in seen:
                continue
            seen.add(a.id)
        deduped.append(a)
    if not deduped:
        warnings.append("no <Article> found")
    return Doc(doc_id=path.stem, market="jp", title=title or path.stem,
               source_path=str(path), source_format="xml", parser="jp_xml",
               articles=deduped, full_text=xml_text(law) if law is not None else "",
               metadata=meta, lang="ja", warnings=warnings)


# --------------------------------------------------------------------------
# Germany
# --------------------------------------------------------------------------

def de_zip(path: Path) -> Doc:
    """gesetze-im-internet XML package: one <norm> per §, enbez is the number."""
    warnings: list[str] = []
    try:
        zf = zipfile.ZipFile(path)
    except Exception as e:
        return Doc(doc_id=path.stem, market="de", title=path.stem,
                   source_path=str(path), source_format="zip", parser="de_zip",
                   warnings=[f"zip open failed: {e}"], lang="de")
    names = [n for n in zf.namelist() if n.lower().endswith(".xml")]
    if not names:
        return Doc(doc_id=path.stem, market="de", title=path.stem,
                   source_path=str(path), source_format="zip", parser="de_zip",
                   warnings=["no xml inside zip"], lang="de")
    try:
        root = etree.parse(io.BytesIO(zf.read(names[0]))).getroot()
    except Exception as e:
        return Doc(doc_id=path.stem, market="de", title=path.stem,
                   source_path=str(path), source_format="zip", parser="de_zip",
                   warnings=[f"xml parse failed: {e}"], lang="de")

    def lt(tag: str):
        return root.findall(f".//{{*}}{tag}")

    meta: dict = {}
    langue = lt("langue")
    jurabk = lt("jurabk")
    ausf = lt("ausfertigung-datum")
    if langue:
        meta["long_title"] = clean_text(langue[0].text or "")
    if jurabk:
        meta["abbreviation"] = clean_text(jurabk[0].text or "")
    if ausf:
        meta["enacted"] = clean_text(ausf[0].text or "")

    articles: list[Article] = []
    for norm in lt("norm"):
        md = norm.find("{*}metadaten") if norm.find("{*}metadaten") is not None else norm.find("metadaten")
        if md is None:
            continue
        enbez = md.find("enbez")
        titel = md.find("titel")
        if enbez is None:
            continue
        num = clean_text(enbez.text or "")
        sub = clean_text(titel.text or "") if titel is not None else ""
        td = norm.find("textdaten")
        body = xml_text(td) if td is not None else ""
        if not num or len(body) < 20:
            continue
        articles.append(Article(id="sec-" + slugify(num, 20), number=num,
                                title=sub, text=body))
    if not articles:
        warnings.append("no <norm> with enbez found")
    title = meta.get("long_title") or path.stem
    return Doc(doc_id=path.stem, market="de", title=title,
               source_path=str(path), source_format="zip", parser="de_zip",
               articles=articles, full_text=xml_text(root), metadata=meta,
               lang="de", warnings=warnings)


DE_PDF_SEC_RE = re.compile(r"(?m)^\s*§\s*(\d+[a-z]?)\s*$")


def de_pdf(path: Path) -> Doc:
    warnings: list[str] = []
    raw = pdf_text(path, warnings)
    raw = re.sub(r"(?m)^\s*Ein Service des Bundesministerium.*$", "", raw)
    raw = re.sub(r"(?m)^\s*Seite \d+ von \d+.*$", "", raw)
    txt = clean_text(raw)
    arts = section_split(txt, DE_PDF_SEC_RE)
    title = txt.split("\n")[0][:200] if txt else path.stem
    if not arts:
        warnings.append("no '§ N' line matches; whole text kept")
    return Doc(doc_id=path.stem, market="de", title=title or path.stem,
               source_path=str(path), source_format="pdf", parser="de_pdf",
               articles=arts, full_text=txt, lang="de", warnings=warnings)


# --------------------------------------------------------------------------
# China national standards (catalogue pages, no full text)
# --------------------------------------------------------------------------

GB_FIELDS = {
    "标准号": "standard_no",
    "中文标准名称": "title_zh",
    "英文标准名称": "title_en",
    "标准状态": "status",
    "中国标准分类号（CCS）": "ccs",
    "国际标准分类号（ICS）": "ics",
    "发布日期": "published",
    "实施日期": "effective",
    "主管部门": "authority",
    "归口部门": "technical_committee",
    "发布单位": "issuer",
    "被代替标准": "replaced",
    "代替标准": "replaces",
}


def cn_gb_html(path: Path) -> Doc:
    warnings: list[str] = []
    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="ignore"), "lxml")
    for bad in soup(["script", "style", "nav", "footer", "header"]):
        bad.decompose()
    text = clean_text(soup.get_text("\n", strip=True))

    meta: dict = {}
    for zh, key in GB_FIELDS.items():
        m = re.search(re.escape(zh) + r"[:：]?\s*\n?\s*([^\n]{1,120})", text)
        if m:
            meta[key] = m.group(1).strip()

    title = meta.get("title_zh") or meta.get("standard_no") or path.stem
    articles: list[Article] = []
    body = clean_text("\n".join(
        f"{k}: {v}" for k, v in meta.items())) or text[:4000]
    if meta.get("standard_no"):
        articles.append(Article(
            id="meta-" + slugify(meta["standard_no"], 24),
            number=meta["standard_no"], title=meta.get("title_zh", ""), text=body,
        ))
    else:
        warnings.append("standard fields not found")
    if "在线预览" in text and "暂不支持" in text:
        meta["full_text_available"] = False
        warnings.append("note: catalogue page only - standard full text is not public")
    return Doc(doc_id=path.stem, market="cn", title=title,
               source_path=str(path), source_format="html", parser="cn_gb_html",
               articles=articles, full_text=text, metadata=meta, lang="zh",
               warnings=warnings)


FR_DOC_TAGS = ("RULE", "PRORULE", "NOTICE", "PRESDOC", "CORRECT")


def fedreg_xml(path: Path) -> Doc:
    """Federal Register daily issue.

    The document container is <RULE>/<PRORULE>/<NOTICE>/<PRESDOC>; <FRDOC> is
    only the filing line at the end of each one. Title comes from <SUBJECT>,
    issuing body from <AGENCY> inside <PREAMB>.
    """
    warnings: list[str] = []
    try:
        root = etree.parse(str(path)).getroot()
    except Exception as e:
        return Doc(doc_id=path.stem, market="us", title=path.stem,
                   source_path=str(path), source_format="xml", parser="fedreg_xml",
                   warnings=[f"xml parse failed: {e}"])
    meta = {}
    date_el = root.find("DATE")
    if date_el is not None and date_el.text:
        meta["issue_date"] = clean_text(date_el.text)

    articles: list[Article] = []
    for el in root.iter():
        tag = el.tag if isinstance(el.tag, str) else ""
        if tag not in FR_DOC_TAGS:
            continue
        premb = el.find("PREAMB")
        subject = agency = cfr = docket = ""
        if premb is not None:
            s = premb.find("SUBJECT")
            a = premb.find("AGENCY")
            c = premb.find("CFR")
            d = premb.find("DEPDOC")
            subject = clean_text(s.text or "") if s is not None and s.text else ""
            agency = clean_text(a.text or "") if a is not None and a.text else ""
            cfr = clean_text(c.text or "") if c is not None and c.text else ""
            docket = clean_text(d.text or "") if d is not None and d.text else ""
        frdoc = el.find("FRDOC")
        fr = clean_text(frdoc.text or "") if frdoc is not None and frdoc.text else ""
        doc_no = ""
        m = re.search(r"FR Doc\.\s*([\w-]+)", fr)
        if m:
            doc_no = m.group(1)
        body = xml_text(el)
        if not (subject or body):
            continue
        label = subject or f"{tag} {doc_no}"
        if cfr:
            label = f"{label} ({cfr})"
        articles.append(Article(
            id="fr-" + slugify(doc_no or subject, 24),
            number=label[:160], title=subject,
            text=(f"[{tag}] {agency}\n{docket}\n\n{body}" if agency else body),
        ))
    if not articles:
        warnings.append("no RULE/PRORULE/NOTICE/PRESDOC containers found")
    issue = meta.get("issue_date", "")
    return Doc(doc_id=path.stem, market="us",
               title=f"Federal Register {issue}".strip() or path.stem,
               source_path=str(path), source_format="xml", parser="fedreg_xml",
               articles=articles, full_text=xml_text(root), metadata=meta,
               warnings=warnings)


# --------------------------------------------------------------------------
# Spain -- BOE open-data API (legislacion-consolidada/id/...)
# --------------------------------------------------------------------------

BOE_META_FIELDS = {
    "identificador": "boe_id", "titulo": "title", "rango": "rank",
    "departamento": "department", "ambito": "scope",
    "fecha_disposicion": "enacted", "fecha_publicacion": "published",
    "diario_numero": "gazette_number", "numero_oficial": "official_number",
    "estado_consolidacion": "consolidation_status",
}


def es_boe_xml(path: Path) -> Doc:
    """BOE consolidated act. <texto>/<bloque> is the unit: one block per
    artículo, disposición, capítulo heading or preamble."""
    warnings: list[str] = []
    try:
        root = etree.parse(str(path)).getroot()
    except Exception as e:
        return Doc(doc_id=path.stem, market="es", title=path.stem,
                   source_path=str(path), source_format="xml", parser="es_boe_xml",
                   lang="es", warnings=[f"xml parse failed: {e}"])

    meta: dict = {}
    md = root.find(".//metadatos")
    if md is not None:
        for child in md:
            tag = child.tag.split("}")[-1]
            key = BOE_META_FIELDS.get(tag)
            if key and child.text:
                meta[key] = clean_text(child.text)
    analisis = root.find(".//analisis/materias")
    if analisis is not None:
        materias = [clean_text(m.text or "") for m in analisis.findall("materia")]
        if materias:
            meta["subjects"] = materias

    articles: list[Article] = []
    for bloque in root.findall(".//texto/bloque"):
        bid = bloque.get("id") or ""
        tipo = bloque.get("tipo") or ""
        paras = [clean_text(p.text or "") for p in bloque.iter("p")]
        paras = [p for p in paras if p]
        if not paras:
            continue
        body = "\n\n".join(paras)
        # `tipo` is BOE's own classification (preambulo / articulo / capitulo ...)
        first = paras[0]
        title = first if len(first) < 120 and not first.endswith(".") else ""
        if tipo in ("encabezado", "preambulo", "nota_inicial", "nota_final"):
            level = tipo
        else:
            level = "article"
        articles.append(Article(
            id=(bid and slugify(bid, 24)) or f"blk-{len(articles)}",
            number=title or bid or tipo, title=(first if title else ""),
            text=body, level=level,
        ))
    if not articles:
        warnings.append("no <texto>/<bloque> found")

    title = meta.get("title") or path.stem
    return Doc(doc_id=meta.get("boe_id") or path.stem, market="es", title=title,
               source_path=str(path), source_format="xml", parser="es_boe_xml",
               articles=articles, full_text=xml_text(root), metadata=meta,
               lang="es", warnings=warnings)


# --------------------------------------------------------------------------
# generic PDF (international sources: WIPO, WTO, ...)
# --------------------------------------------------------------------------

GENERIC_PDF_SEC_RE = re.compile(
    r"(?m)^\s*(?:Article|ARTICLE|Section|SECTION|Rule|RULE|§)\s+(\d+[A-Za-z.\-]*)\b"
)


def generic_pdf(path: Path) -> Doc:
    """Any PDF that is not EU/US/DE statute text. Keeps whole text, tries the
    common article markers, and never fails outright."""
    warnings: list[str] = []
    raw = pdf_text(path, warnings)
    txt = clean_text(raw)
    arts = section_split(txt, GENERIC_PDF_SEC_RE, min_body=80)
    lines = [ln.strip() for ln in txt.split("\n") if ln.strip()]
    title = lines[0][:200] if lines else path.stem
    if not txt:
        warnings.append("no text layer extracted (scanned image?)")
    elif not arts:
        warnings.append("note: no article markers; whole text kept as one document")
    return Doc(doc_id=path.stem, market="", title=title or path.stem,
               source_path=str(path), source_format="pdf", parser="generic_pdf",
               articles=arts, full_text=txt, warnings=warnings)


# --------------------------------------------------------------------------
# generic HTML
# --------------------------------------------------------------------------

CONTENT_SELECTORS = [
    "main", "article", "[role=main]", "#main-content", "#content",
    ".govuk-grid-column-two-thirds", ".content", ".entry-content",
    ".mw-parser-output", ".article-body", "#mw-content-text",
]


def generic_html(path: Path) -> Doc:
    warnings: list[str] = []
    raw = path.read_text(encoding="utf-8", errors="ignore")
    soup = BeautifulSoup(raw, "lxml")
    title = ""
    if soup.title and soup.title.string:
        title = clean_text(soup.title.string)

    for bad in soup(["script", "style", "noscript", "svg", "form"]):
        bad.decompose()

    node = None
    for sel in CONTENT_SELECTORS:
        node = soup.select_one(sel)
        if node and len(node.get_text(strip=True)) > 400:
            break
        node = None
    if node is None:
        node = soup.body or soup
        warnings.append("no content container matched; used <body>")

    for bad in node.select("nav, footer, aside, .cookie, #cookie-banner, "
                           ".govuk-cookie-banner, .breadcrumb, .menu, .sidebar"):
        bad.decompose()

    text = clean_text(node.get_text("\n", strip=True))
    if len(text) < 400:
        warnings.append(f"thin extraction ({len(text)} chars) - JS shell?")
    return Doc(doc_id=path.stem, market="", title=title or path.stem,
               source_path=str(path), source_format="html", parser="generic_html",
               articles=[], full_text=text, warnings=warnings)


# --------------------------------------------------------------------------
# JSON (recall feeds)
# --------------------------------------------------------------------------

def json_doc(path: Path) -> Doc:
    warnings: list[str] = []
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
    except Exception as e:
        return Doc(doc_id=path.stem, market="us", title=path.stem,
                   source_path=str(path), source_format="json", parser="json_doc",
                   warnings=[f"json parse failed: {e}"])
    meta: dict = {}
    articles: list[Article] = []
    rows = data.get("results") if isinstance(data, dict) else (data if isinstance(data, list) else [])
    if isinstance(rows, list):
        meta["records"] = len(rows)
        for i, r in enumerate(rows[:200]):
            if not isinstance(r, dict):
                continue
            label = (r.get("recalling_firm") or r.get("product_description")
                     or r.get("reason_for_recall") or r.get("RecallNumber") or f"record {i}")
            num = str(r.get("recall_number") or r.get("RecallNumber") or i)
            body = "\n".join(f"{k}: {v}" for k, v in list(r.items())[:40])
            articles.append(Article(id="rec-" + slugify(num, 24),
                                    number=str(label)[:80], text=body, level="record"))
    else:
        meta["shape"] = type(data).__name__
    full = json.dumps(data, ensure_ascii=False)[:200000]
    return Doc(doc_id=path.stem, market="us", title=path.stem,
               source_path=str(path), source_format="json", parser="json_doc",
               articles=articles, full_text=full, metadata=meta, warnings=warnings)
