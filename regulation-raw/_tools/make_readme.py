#!/usr/bin/env python3
"""Generate README.md for regulation-raw from _manifest.json + _SKIPPED.md.

Run after download.py so the README always matches what is actually on disk.

    python3 _tools/make_readme.py
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MARKET_NAMES = {
    "eu": "欧盟 EU", "us": "美国 US", "uk": "英国 UK", "cn": "中国 CN",
    "de": "德国 DE", "fr": "法国 FR", "jp": "日本 JP", "kr": "韩国 KR",
    "sg": "新加坡 SG", "au": "澳大利亚 AU", "nz": "新西兰 NZ", "ca": "加拿大 CA",
    "br": "巴西 BR", "in": "印度 IN", "mx": "墨西哥 MX", "ae": "阿联酋 AE",
    "sa": "沙特 SA", "gcc": "海合会 GCC", "my": "马来西亚 MY", "th": "泰国 TH",
    "vn": "越南 VN", "id": "印尼 ID", "ru": "俄罗斯 RU", "tr": "土耳其 TR",
    "za": "南非 ZA", "intl": "国际组织 INTL",
    # round 3-4 additions
    "es": "西班牙 ES", "it": "意大利 IT", "nl": "荷兰 NL", "be": "比利时 BE",
    "lu": "卢森堡 LU", "ie": "爱尔兰 IE", "ch": "瑞士 CH", "pl": "波兰 PL",
    "se": "瑞典 SE", "no": "挪威 NO", "dk": "丹麦 DK", "fi": "芬兰 FI",
    "pt": "葡萄牙 PT", "gr": "希腊 GR", "hr": "克罗地亚 HR", "si": "斯洛文尼亚 SI",
    "rs": "塞尔维亚 RS", "sk": "斯洛伐克 SK", "lv": "拉脱维亚 LV", "ee": "爱沙尼亚 EE",
    "mt": "马耳他 MT", "cy": "塞浦路斯 CY",
    "tw": "台湾 TW", "hk": "香港 HK", "ph": "菲律宾 PH", "kh": "柬埔寨 KH",
    "la": "老挝 LA", "mm": "缅甸 MM", "bn": "文莱 BN", "pk": "巴基斯坦 PK",
    "bd": "孟加拉 BD", "lk": "斯里兰卡 LK", "np": "尼泊尔 NP", "mn": "蒙古 MN",
    "kz": "哈萨克斯坦 KZ",
    "il": "以色列 IL", "eg": "埃及 EG", "ma": "摩洛哥 MA", "ng": "尼日利亚 NG",
    "ke": "肯尼亚 KE", "gh": "加纳 GH", "tz": "坦桑尼亚 TZ", "qa": "卡塔尔 QA",
    "kw": "科威特 KW", "om": "阿曼 OM", "bh": "巴林 BH", "jo": "约旦 JO",
    "lb": "黎巴嫩 LB",
    "cl": "智利 CL", "ar": "阿根廷 AR", "co": "哥伦比亚 CO", "pe": "秘鲁 PE",
    "uy": "乌拉圭 UY", "py": "巴拉圭 PY", "bo": "玻利维亚 BO", "cr": "哥斯达黎加 CR",
    "pa": "巴拿马 PA", "ec": "厄瓜多尔 EC",
}

CHANNELS = {
    "eu": "Publications Office Cellar（内容协商取 PDF / XHTML）",
    "us": "govinfo.gov（CFR 分卷、US Code、公法、联邦公报）、Federal Register API、openFDA、SaferProducts",
    "ca": "Department of Justice Canada（官方 XML + HTML）",
    "de": "gesetze-im-internet.de（官方 PDF + XML 包）",
    "jp": "e-Gov 法令 API v1（全文 XML）",
    "cn": "openstd.samr.gov.cn 国家标准、npc.gov.cn、gov.cn、mofcom、miit",
    "uk": "GOV.UK 指南页（legislation.gov.uk 被 WAF 拦截）",
    "sg": "Singapore Statutes Online (sso.agc.gov.sg)、HSA、EnterpriseSG",
    "au": "legislation.gov.au、ACMA、Product Safety Australia",
    "nz": "Product Safety NZ、legislation.govt.nz",
    "br": "gov.br / INMETRO / ANVISA / Planalto",
    "in": "BIS、Legal Metrology、India Code、MeitY",
    "intl": "ETSI 免费标准 PDF、WIPO、Codex、WTO、UN Treaty、WHO/FAO/ITU/UPU/ICC、NIST",
    "es": "BOE 开放数据 API（全量合并法规 XML，可分页枚举）",
    "ie": "electronic Irish Statute Book（全文 PDF + 打印版 HTML）",
    "nl": "wetten.overheid.nl（BWBR 编号）",
    "ch": "Fedlex（ELI 寻址）",
    "tw": "全国法规资料库 law.moj.gov.tw",
    "ph": "LawPhil 法律库",
    "pl": "ISAP 立法库 / Dziennik Ustaw",
    "se": "Riksdagen / Konsumentverket",
    "no": "Lovdata",
    "dk": "Retsinformation",
    "fi": "Finlex",
    "it": "Normattiva / Gazzetta Ufficiale",
    "be": "eJustice 法规库",
    "fr": "service-public.fr（Legifrance 被 WAF 拦截）",
    "vn": "vanban.chinhphu.vn / congbao.chinhphu.vn",
    "my": "总检察署 AGC",
    "qa": "Al Meezan 法律门户",
    "cl": "BCN LeyChile",
}



def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n} B"


def main() -> int:
    mpath = ROOT / "_manifest.json"
    if not mpath.exists():
        raise SystemExit("run download.py first — _manifest.json missing")
    m = json.loads(mpath.read_text(encoding="utf-8"))
    rows = m["results"]

    failed_by_market: dict[str, int] = defaultdict(int)
    for r in rows:
        if r["status"] != "ok":
            failed_by_market[r["market"]] += 1

    # On-disk is the source of truth for the per-market table, because the
    # discovery pass writes files that never appear in _manifest.json.
    # parsed/ is the derived layer and must NOT be counted as raw captures.
    disk = [p for p in ROOT.rglob("*")
            if p.is_file() and not p.name.startswith("_")
            and "_tools" not in p.parts and "parsed" not in p.parts]
    disk_bytes_total = sum(p.stat().st_size for p in disk)
    ext_totals: dict[str, int] = defaultdict(int)
    for p in disk:
        ext_totals[p.suffix.lstrip(".") or "bin"] += 1

    per_market: dict[str, dict] = defaultdict(lambda: {"ok": 0, "bytes": 0, "exts": defaultdict(int)})
    for p in disk:
        rel = p.relative_to(ROOT)
        if len(rel.parts) < 2:  # top-level files (README.md) are not a market
            continue
        mk = rel.parts[0]
        b = per_market[mk]
        b["ok"] += 1
        b["bytes"] += p.stat().st_size
        b["exts"][p.suffix.lstrip(".") or "bin"] += 1

    disc = ROOT / "_manifest_discovery.json"
    disc_rows = json.loads(disc.read_text(encoding="utf-8")) if disc.exists() else []

    # on-disk truth (recomputed above as `disk` / `disk_bytes_total`)
    files = disk
    disk_bytes = disk_bytes_total

    lines: list[str] = []
    A = lines.append
    A("# regulation-raw · 各国法规原文抓取库")
    A("")
    A("> 两层结构：根目录是**原文抓取层**（各国官方原件，不做任何改写），")
    A("> `parsed/` 是**解析层**（同一批原文切成条文级 Markdown + JSON）。")
    A("")
    A(f"- 抓取时间：`{m['generated_at']}`")
    A(f"- 成功下载：**{len(files)} 个文件**，共 **{human(disk_bytes)}**")
    A(f"- 覆盖市场：**{len(per_market)} 个**")
    fmt_str = "、".join(f"{k}×{v}" for k, v in sorted(ext_totals.items(), key=lambda x: -x[1]))
    A(f"- 抓取层格式：{fmt_str}")

    pidx0 = ROOT / "parsed" / "_index.json"
    if pidx0.exists():
        p0 = json.loads(pidx0.read_text(encoding="utf-8"))["results"]
        p0ok = [r for r in p0 if r.get("status") == "ok"]
        A(f"- 解析层：`parsed/` 下 **{len(p0ok):,} 篇** · "
          f"**{sum(r.get('articles',0) for r in p0ok):,} 条条文** · "
          f"**{sum(r.get('text_chars',0) for r in p0ok)/1e6:,.1f} 百万字符**")
    A("")
    A("---")
    A("")
    A("## 一、目录结构")
    A("")
    A("按市场建立子目录，文件名以 `法规编号_英文名` 命名，便于检索：")
    A("")
    A("```")
    A("regulation-raw/")
    A("├── eu/            欧盟法规原文（PDF + XHTML 双格式）")
    A("├── us/            美国 CFR / U.S. Code / 公法 / 召回数据")
    A("├── ca/  de/  jp/  加拿大 / 德国 / 日本（官方 XML 通道）")
    A("├── cn/            中国法律法规与国家标准")
    A("├── uk/ sg/ au/ nz/ br/ in/ 各国官方页面")
    A("├── ae/ sa/ gcc/ my/ th/ vn/ id/ 中东与东南亚")
    A("├── intl/          WIPO / Codex / WTO / UNECE 等国际规则")
    A("├── parsed/        解析层：<市场>/<文件名>.md + .json（条文级）")
    A("├── _tools/        抓取脚本（fetch.py 引擎、catalog.py 目录、download.py 运行器）")
    A("│   ├── parse/     解析器（model.py 数据模型、extractors.py 各源抽取、run.py 调度）")
    A("│   └── .venv/     解析依赖（pypdf / beautifulsoup4 / lxml）")
    A("├── _manifest.json 抓取清单（含每个 URL 的状态、哈希、大小）")
    A("├── _manifest.csv  同上，表格版")
    A("└── _SKIPPED.md    未能直接下载的链接清单（供人工打开）")
    A("```")
    A("")
    A("## 二、各市场抓取结果")
    A("")
    A("| 市场 | 文件数 | 体积 | 主要格式 | 抓取通道 | 未直连 |")
    A("|:---|:---:|---:|:---|:---|:---:|")
    for mk in sorted(per_market, key=lambda k: -per_market[k]["ok"]):
        b = per_market[mk]
        if b["ok"] == 0:
            continue
        exts = "、".join(f"{k}" for k, _ in sorted(b["exts"].items(), key=lambda x: -x[1])[:4])
        nf = failed_by_market.get(mk, 0)
        A(f"| {MARKET_NAMES.get(mk, mk)} | {b['ok']} | {human(b['bytes'])} | {exts or '—'} | {CHANNELS.get(mk, '官方门户')} | {nf or '—'} |")
    A("")
    A(f"> 「未直连」列 = `_manifest.json` 中该市场抓取失败（WAF/403/404/JS 空壳）的条目数，")
    A(f"> 完整链接见 [`_SKIPPED.md`](_SKIPPED.md)。")
    A("")

    if disc_rows:
        dok = [r for r in disc_rows if r["status"] == "ok"]
        A("### 发现式抓取（列表页 → 逐条下钻）")
        A("")
        A(f"- 通过解析列表页额外抓到 **{len(dok)}** 条，明细见 `_manifest_discovery.json`。")
        A(f"- 中国国家标准：`cn/国家标准/` 目录，按 GB 号检索结果逐条抓取详情页。")
        A(f"- 澳大利亚立法：`au/` 目录，legislation.gov.au 的 `/latest/text` 全文页。")
        A("")

    A("## 三、解析层（parsed/）")
    A("")
    pidx = ROOT / "parsed" / "_index.json"
    if pidx.exists():
        pdata = json.loads(pidx.read_text(encoding="utf-8"))
        prows = [r for r in pdata["results"] if r.get("status") == "ok"]
        tot_art = sum(r.get("articles", 0) for r in prows)
        tot_chr = sum(r.get("text_chars", 0) for r in prows)
        byp: dict[str, list[dict]] = defaultdict(list)
        for r in prows:
            byp[r.get("parser", "?")].append(r)
        A(f"每个源文件解析为 `parsed/<市场>/<文件名>.md`（人读）与 `.json`（结构化）。")
        A(f"共 **{len(prows)} 篇**、**{tot_art:,} 条条文**、**{tot_chr:,} 字符**。")
        A("")
        A("| 解析器 | 文件数 | 平均条文 | 平均字符 | 说明 |")
        A("|:---|---:|---:|---:|:---|")
        NOTES = {
            "eu_xhtml": "OJ CONVEX XHTML，按 `p.oj-ti-art` 切 Article",
            "eu_pdf": "官方公报 PDF，正则切 `Article N`",
            "us_cfr_xml": "govinfo CFR 颗粒，按 `<SECTION>` 切 §",
            "us_pdf": "CFR / 公法 PDF，切 `§ N.N` 或 `SEC. N`",
            "ca_xml": "司法部 XML，按 `<Section><Label>` 切条（标题取 MarginalNote）",
            "jp_xml": "e-Gov API XML，按 `<Article>` 切条并保留編/章/節层级",
            "de_zip": "gesetze-im-internet XML，一个 `<norm>` 一个 §（enbez 为条号）",
            "de_pdf": "德国法律 PDF，切 `§ N`",
            "cn_gb_html": "国标著录页，抽标准号/中英文名/状态/ICS/发布单位（无正文，版权所限）",
            "es_boe_xml": "BOE 开放数据 XML，按 `<texto>/<bloque>` 切条（preámbulo/artículo/disposición）",
            "fedreg_xml": "联邦公报每日全文 XML，按 `<DOCUMENT>` 切每条规则/通告",
            "generic_html": "通用网页正文抽取（剥 nav/footer/cookie）",
            "generic_pdf": "其它 PDF（WIPO/WTO 等），保留全文并尝试切条",
            "json_doc": "召回数据，逐条记录展开",
        }
        for p, rows in sorted(byp.items(), key=lambda kv: -len(kv[1])):
            avg_a = sum(r.get("articles", 0) for r in rows) / len(rows)
            avg_c = sum(r.get("text_chars", 0) for r in rows) / len(rows)
            A(f"| `{p}` | {len(rows)} | {avg_a:.1f} | {avg_c:,.0f} | {NOTES.get(p,'')} |")
        A("")
        A("质量报告见 [`parsed/_REPORT.md`](parsed/_REPORT.md)，逐文档索引见 `parsed/_index.json`。")
    else:
        A("尚未运行解析。执行 `_tools/.venv/bin/python _tools/parse/run.py` 生成。")
    A("")
    A("## 四、复现与增量抓取")
    A("")
    A("```bash")
    A("cd regulation-raw")
    A("")
    A("# 全量抓取（会跳过已存在文件的重复判定，按 manifest 覆盖）")
    A("python3 _tools/download.py")
    A("")
    A("# 只抓某个市场")
    A("python3 _tools/download.py --market eu us")
    A("")
    A("# 名称过滤")
    A("python3 _tools/download.py --only EU-2023")
    A("")
    A("# 发现式抓取（国标 / 澳洲立法）")
    A("python3 _tools/discover.py")
    A("")
    A("# 解析全部原文 -> parsed/（需要 _tools/.venv）")
    A("_tools/.venv/bin/python _tools/parse/run.py")
    A("")
    A("# 重新生成这份 README")
    A("python3 _tools/make_readme.py")
    A("```")
    A("")
    A("`fetch.py` 的判定逻辑：HTTP ≥ 400 → `http_<code>`；返回 202/203 且体积很小、")
    A("或正文命中 AWS WAF / Cloudflare 挑战特征 → `waf`；正文 < 256 字节 → `empty`；")
    A("其余写入磁盘并记录 SHA-256。")
    A("")
    A("## 五、已知抓不到的源")
    A("")
    A("以下站点在本机网络下实测有硬性拦截，链接已完整记录在 [`_SKIPPED.md`](_SKIPPED.md)，")
    A("可在浏览器中手动打开，或换网络/加代理后重试：")
    A("")
    A("| 站点 | 现象 | 替代通道 |")
    A("|:---|:---|:---|")
    A("| `eur-lex.europa.eu` 网页/PDF | AWS WAF 202 挑战 | 已改用 Cellar 内容协商，抓到 PDF+XHTML |")
    A("| `legislation.gov.uk` | AWS WAF 202 挑战 | 暂无；英方条文改抓 GOV.UK 指南页 |")
    A("| `www.ecfr.gov` | Cloudflare，API 返回 406 | 已改用 govinfo.gov 的 CFR 分卷 XML/PDF |")
    A("| `www.cpsc.gov` | 403 数据中心 IP 封禁 | 已改用 SaferProducts.gov REST |")
    A("| `unece.org`、`iso.org`、`iec.ch` | 403 / 付费墙 | 仅保留目录页链接 |")
    A("| `www.gov.cn` 部分栏目、`flk.npc.gov.cn` | 403 / JS 空壳 | 已改用 npc.gov.cn、mofcom 等可抓栏目 |")
    A("| `workspace.fao.org` Codex PDF | SharePoint 登录墙 + Cloudflare | 仅保留 Codex 列表页 |")
    A("| `accc.gov.au`、`tga.gov.au` | 403 / 连接超时 | 已改用 legislation.gov.au |")
    A("")
    A("## 六、说明")
    A("")
    A("- 根目录**只做抓取与存放**；所有解析产物隔离在 `parsed/`，可随时删除重建。")
    A("- 所有文件版权归各自发布机构所有；本目录仅作合规研究用途的本地存档。")
    A("- 部分国家标准（GB/GB-T）正文受版权保护，官方公开系统仅提供著录信息，")
    A("  因此 `cn/国家标准/` 抓取的是官方著录页而非标准全文。")
    A("")

    (ROOT / "README.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"README.md written: {len(files)} files, {human(disk_bytes)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
