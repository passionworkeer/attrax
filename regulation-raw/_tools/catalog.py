"""URL catalog for regulation-raw.

Every entry is a dict accepted by fetch.fetch_one():
    market, name, url, accept, lang, filename, force_ext, note

`filename` is optional; when omitted a slug is derived from `name`.
This module only *lists* sources -- no fetching happens here.
"""

from __future__ import annotations

# --------------------------------------------------------------------------
# EU -- Publications Office Cellar.  eur-lex.europa.eu HTML/PDF is behind an
# AWS WAF challenge from this network, but Cellar serves the same act as PDF
# and XHTML via content negotiation on the CELEX resource URI.
# --------------------------------------------------------------------------
CELLAR = "https://publications.europa.eu/resource/celex/{celex}?language=eng"

EU_ACTS = [
    # (CELEX, short id, English short title)
    ("32023R0988", "EU-2023-988", "General Product Safety Regulation GPSR"),
    ("32009L0048", "EU-2009-48", "Toy Safety Directive"),
    ("32011L0065", "EU-2011-65", "RoHS Restriction of Hazardous Substances"),
    ("32012L0019", "EU-2012-19", "WEEE Waste Electrical and Electronic Equipment"),
    ("32014L0053", "EU-2014-53", "Radio Equipment Directive RED"),
    ("32014L0030", "EU-2014-30", "Electromagnetic Compatibility Directive EMC"),
    ("32014L0035", "EU-2014-35", "Low Voltage Directive LVD"),
    ("32019R1020", "EU-2019-1020", "Market Surveillance and Product Compliance"),
    ("32023R1542", "EU-2023-1542", "Batteries Regulation"),
    ("32006R1907", "EU-1907-2006", "REACH Chemicals"),
    ("32009R1223", "EU-1223-2009", "Cosmetics Regulation"),
    ("32004R1935", "EU-1935-2004", "Food Contact Materials Framework"),
    ("32011R0010", "EU-10-2011", "Plastic Food Contact Materials"),
    ("32011R1007", "EU-1007-2011", "Textile Fibre Names"),
    ("32009L0125", "EU-2009-125", "Ecodesign ErP Directive"),
    ("32017R1369", "EU-2017-1369", "Energy Labelling Regulation"),
    ("32023L1791", "EU-2023-1791", "Energy Efficiency Directive"),
    ("32024R1781", "EU-2024-1781", "Ecodesign for Sustainable Products ESPR"),
    ("32005L0029", "EU-2005-29", "Unfair Commercial Practices Directive"),
    ("32011L0083", "EU-2011-83", "Consumer Rights Directive"),
    ("32019L2161", "EU-2019-2161", "Omnibus Directive"),
    ("32003L0088", "EU-2003-88", "Working Time Directive"),
    ("32016R0679", "EU-2016-679", "GDPR General Data Protection Regulation"),
    ("32002L0058", "EU-2002-58", "ePrivacy Directive"),
    ("32022R2065", "EU-2022-2065", "Digital Services Act DSA"),
    ("32022R1925", "EU-2022-1925", "Digital Markets Act DMA"),
    ("32024R1689", "EU-2024-1689", "AI Act"),
    ("32022L2555", "EU-2022-2555", "NIS2 Cybersecurity Directive"),
    ("32023R2854", "EU-2023-2854", "Data Act"),
    ("32024R2847", "EU-2024-2847", "Cyber Resilience Act"),
    ("32022R0868", "EU-2022-868", "Data Governance Act"),
    ("32019R0452", "EU-2019-452", "FDI Screening Regulation"),
    ("32021R0821", "EU-2021-821", "FDI Screening Framework Amendment"),
    ("31985L0374", "EU-85-374", "Product Liability Directive 1985"),
    ("32024L2853", "EU-2024-2853", "New Product Liability Directive"),
    ("32008R0765", "EU-765-2008", "Accreditation and Market Surveillance"),
    ("32008D0768", "EU-768-2008", "Common Framework for Marketing of Products"),
    ("32019R2144", "EU-2019-2144", "General Safety Regulation vehicles"),
    ("32017R0745", "EU-2017-745", "Medical Devices Regulation MDR"),
    ("32017R0746", "EU-2017-746", "In Vitro Diagnostic MDR IVDR"),
    ("32016R0425", "EU-2016-425", "Personal Protective Equipment Regulation"),
    ("32014L0068", "EU-2014-68", "Pressure Equipment Directive"),
    ("32014L0034", "EU-2014-34", "ATEX Explosive Atmospheres Directive"),
    ("32014L0032", "EU-2014-32", "Measuring Instruments Directive"),
    ("32014L0031", "EU-2014-31", "Non-Automatic Weighing Instruments"),
    ("32016R0426", "EU-2016-426", "Gas Appliances Regulation"),
    ("32013L0029", "EU-2013-29", "Pyrotechnic Articles Directive"),
    ("32014L0090", "EU-2014-90", "Marine Equipment Directive"),
    ("32023R1115", "EU-2023-1115", "EU Deforestation Regulation EUDR"),
    ("32023R0956", "EU-2023-956", "Carbon Border Adjustment Mechanism CBAM"),
    ("32022L2464", "EU-2022-2464", "Corporate Sustainability Reporting CSRD"),
    ("32024L1760", "EU-2024-1760", "Corporate Sustainability Due Diligence CSDDD"),
    ("32020R0852", "EU-2020-852", "EU Taxonomy Regulation"),
    ("32023R1230", "EU-2023-1230", "Machinery Regulation"),
    ("32025R0040", "EU-2025-40", "Packaging and Packaging Waste Regulation"),
    ("32024R0573", "EU-2024-573", "Fluorinated Greenhouse Gases F-gas"),
    ("32015R0758", "EU-2015-758", "Organic Production Regulation"),
    ("32022R0612", "EU-2022-612", "Foreign Subsidies Regulation"),
]


def _eu_entries() -> list[dict]:
    out = []
    for celex, sid, title in EU_ACTS:
        url = CELLAR.format(celex=celex)
        out.append(dict(
            market="eu", name=f"{sid} {title}",
            url=url, accept="application/pdf", lang="eng",
            filename=f"{sid}_{title.replace(' ', '_')}.pdf",
            note=f"EUR-Lex CELEX {celex} via Cellar PDF",
        ))
        out.append(dict(
            market="eu", name=f"{sid} {title} [xhtml]",
            url=url, accept="application/xhtml+xml", lang="eng",
            filename=f"{sid}_{title.replace(' ', '_')}.xhtml",
            note=f"EUR-Lex CELEX {celex} via Cellar XHTML",
        ))
    return out


# --------------------------------------------------------------------------
# US -- govinfo.gov carries the CFR as XML and PDF, the U.S. Code as PDF via
# its /link/uscode endpoint, and public laws as PDF. eCFR itself is
# Cloudflare-fronted and returns 406, so govinfo is the working channel.
# --------------------------------------------------------------------------
CFR_PARTS = {
    16: [1101, 1102, 1112, 1115, 1116, 1118, 1200, 1201, 1203, 1205,
         1207, 1209, 1210, 1211, 1213, 1219, 1220, 1221, 1224, 1240,
         1250, 1263, 1301, 1303, 1304, 1306, 1307, 1401, 1402, 1500,
         1501, 1502, 1505, 1508, 1511, 1512, 1513, 1610, 1615, 1616,
         1630, 1631, 1632, 1633, 1700],
    21: [1, 101, 110, 111, 117, 170, 171, 172, 173, 174, 175, 176,
         177, 178, 179, 180, 181, 182, 184, 186, 189, 190, 700, 701,
         710, 720, 730, 740],
    47: [2, 15, 18, 68],
    49: [171, 172, 173, 178],
    19: [102, 134, 145],
    40: [82, 98],
}

US_CODE = [
    ("15", 2051, "Consumer Product Safety Act s.1"),
    ("15", 2056, "CPSA children's products"),
    ("15", 2056, "CPSIA definitions"),
    ("15", 2063, "Substantial product hazard reporting"),
    ("15", 2076, "CPSC enforcement"),
    ("15", 1261, "Federal Hazardous Substances Act"),
    ("15", 1274, "FHSA banned hazardous substances"),
    ("15", 70, "Textile Fiber Products Identification Act"),
    ("15", 70, "TFPIA"),
    ("15", 45, "FTC unfair or deceptive acts"),
    ("15", 6501, "COPPA"),
    ("15", 6502, "COPPA unfair acts"),
    ("15", 6505, "COPPA enforcement"),
    ("21", 331, "Federal Food Drug and Cosmetic Act definitions"),
    ("21", 393, "FDA authority"),
    ("47", 301, "Communications Act general authority"),
    ("47", 302, "FCC device authorization"),
    ("49", 5101, "Hazardous materials transportation"),
    ("19", 1304, "Country of origin marking"),
    ("42", 1261, "Clean Air Act"),
]

US_PLAW = [
    ("PLAW-117publ169", "Inflation Reduction Act of 2022"),
    ("PLAW-110publ314", "Consumer Product Safety Improvement Act 2008"),
    ("PLAW-117publ9", "Modernization of Cosmetics Regulation Act 2022"),
    ("PLAW-115publ232", "FIRRMA (NDAA FY2019)"),
    ("PLAW-117publ328", "Consolidated Appropriations Act 2023 (INFORM Act)"),
    ("PLAW-114publ125", "Trade Facilitation and Trade Enforcement Act 2015"),
    ("PLAW-109publ347", "Energy Policy Act 2005"),
]


def _us_entries() -> list[dict]:
    """govinfo CFR part-level files; volume is resolved at run time.

    Special url scheme `govinfo-cfr:{title}:{part}` is expanded by
    download.py after probing which volume the part lives in.
    """
    out = []
    for title, parts in CFR_PARTS.items():
        for part in parts:
            for fmt in ("xml", "pdf"):
                out.append(dict(
                    market="us", name=f"US {title} CFR Part {part}",
                    url=f"govinfo-cfr:{title}:{part}:{fmt}", accept="*/*",
                    filename=f"US-CFR-title{title}-part{part}.{fmt}",
                    note="govinfo.gov CFR part-level bulk",
                ))
    for title, sec, label in US_CODE:
        out.append(dict(
            market="us", name=f"US {title} USC s.{sec} {label}",
            url=f"https://www.govinfo.gov/link/uscode/{title}/{sec}",
            accept="application/pdf",
            filename=f"US-title{title}-USC-{sec}_{label.replace(' ', '_')}.pdf",
            note="govinfo US Code PDF",
        ))
    for plaw, label in US_PLAW:
        out.append(dict(
            market="us", name=f"US {plaw} {label}",
            url=f"https://www.govinfo.gov/content/pkg/{plaw}/pdf/{plaw}.pdf",
            accept="application/pdf",
            filename=f"{plaw}_{label.replace(' ', '_')}.pdf",
            note="govinfo public law PDF",
        ))
    return out


US_DYNAMIC = [
    dict(market="us", name="US Federal Register API (latest documents)",
         url="https://www.federalregister.gov/api/v1/documents.json?per_page=100&order=newest",
         accept="application/json", filename="US_federalregister_latest.json",
         note="Federal Register open API"),
    dict(market="us", name="US Federal Register API (agency CPSC)",
         url="https://www.federalregister.gov/api/v1/documents.json?per_page=100&conditions%5Bagencies%5D%5B%5D=consumer-product-safety-commission",
         accept="application/json", filename="US_federalregister_CPSC.json",
         note="Federal Register open API, CPSC filter"),
    dict(market="us", name="US FDA openFDA food enforcement recalls",
         url="https://api.fda.gov/food/enforcement.json?limit=100&sort=recall_initiation_date:desc",
         accept="application/json", filename="US_openfda_food_enforcement.json",
         note="openFDA food enforcement"),
    dict(market="us", name="US FDA openFDA device recalls",
         url="https://api.fda.gov/device/recall.json?limit=100&sort=event_date_initiated:desc",
         accept="application/json", filename="US_openfda_device_recall.json",
         note="openFDA device recall"),
    dict(market="us", name="US FDA openFDA drug enforcement recalls",
         url="https://api.fda.gov/drug/enforcement.json?limit=100&sort=recall_initiation_date:desc",
         accept="application/json", filename="US_openfda_drug_enforcement.json",
         note="openFDA drug enforcement"),
    dict(market="us", name="US CPSC recalls via SaferProducts API",
         url="https://www.saferproducts.gov/RestWebServices/Recall?format=json",
         accept="application/json", filename="US_cpsc_recalls.json",
         note="SaferProducts.gov REST"),
    dict(market="us", name="US CA AB2273 Age-Appropriate Design Code Act",
         url="https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202120220AB2273",
         accept="text/html", filename="US-CA-AB2273_ADCA.html",
         note="California Legislative Information"),
    dict(market="us", name="US CA SB 1223 neural data amendment",
         url="https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240SB1223",
         accept="text/html", filename="US-CA-SB1223.html",
         note="California Legislative Information"),
    dict(market="us", name="US OEHHA Proposition 65",
         url="https://oehha.ca.gov/proposition-65",
         accept="text/html", filename="US-CA-Prop65_OEHHA.html",
         note="OEHHA"),
    dict(market="us", name="US FTC COPPA Rule 16 CFR Part 312",
         url="https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa",
         accept="text/html", filename="US-FTC_COPPA_rule.html",
         note="FTC"),
    dict(market="us", name="US FTC Textile Fiber Products Identification Act",
         url="https://www.ftc.gov/enforcement/statutes/textile-fiber-products-identification-act",
         accept="text/html", filename="US-FTC_TFPIA.html",
         note="FTC"),
    dict(market="us", name="US FTC INFORM Consumers Act guidance",
         url="https://www.ftc.gov/legal-library/browse/statutes/inform-consumers-act",
         accept="text/html", filename="US-FTC_INFORM_Act.html",
         note="FTC"),
    dict(market="us", name="US FDA MoCRA cosmetics law page",
         url="https://www.fda.gov/cosmetics/cosmetics-laws-regulations/modernization-cosmetics-regulation-act-2022-mocra",
         accept="text/html", filename="US-FDA_MoCRA.html",
         note="FDA"),
    dict(market="us", name="US FDA Food Contact Substances",
         url="https://www.fda.gov/food/food-ingredients-packaging/food-contact-substances-fcs",
         accept="text/html", filename="US-FDA_food_contact.html",
         note="FDA"),
]

# --------------------------------------------------------------------------
# Canada -- Department of Justice publishes every regulation and act as XML
# as well as HTML; both channels are open from this network.
# --------------------------------------------------------------------------
CA_REGULATIONS = [
    ("SOR-2001-269", "Consumer Chemicals and Containers Regulations 2001"),
    ("SOR-2016-169", "Children's Sleepwear Regulations"),
    ("SOR-2016-188", "Phthalates Regulations"),
    ("SOR-2016-193", "Surface Coating Materials Regulations"),
    ("SOR-2018-83", "Consumer Products Containing Lead Regulations"),
    ("SOR-2019-97", "Corded Window Coverings Regulations"),
]
CA_ACTS = [
    ("C-1.68", "Canada Consumer Product Safety Act"),
    ("F-27", "Food and Drugs Act"),
    ("P-8.6", "PIPEDA"),
    ("C-34", "Competition Act"),
    ("T-10", "Textile Labelling Act"),
    ("H-3", "Hazardous Products Act"),
    ("C-38", "Consumer Packaging and Labelling Act"),
    ("W-6.5", "Weights and Measures Act"),
    ("E-15.2", "Electricity and Gas Inspection Act"),
]


def _ca_entries() -> list[dict]:
    out = []
    for code, label in CA_REGULATIONS:
        out.append(dict(
            market="ca", name=f"CA {code} {label}", accept="text/xml",
            url=f"https://laws-lois.justice.gc.ca/eng/XML/{code}.xml",
            filename=f"CA-{code}_{label.replace(' ', '_')}.xml",
            note="Department of Justice Canada XML",
        ))
        out.append(dict(
            market="ca", name=f"CA {code} {label} [html]", accept="text/html",
            url=f"https://laws-lois.justice.gc.ca/eng/regulations/{code}/",
            filename=f"CA-{code}_{label.replace(' ', '_')}.html",
            note="Department of Justice Canada HTML",
        ))
    for code, label in CA_ACTS:
        out.append(dict(
            market="ca", name=f"CA {code} {label}", accept="text/xml",
            url=f"https://laws-lois.justice.gc.ca/eng/XML/{code}.xml",
            filename=f"CA-act-{code}_{label.replace(' ', '_')}.xml",
            note="Department of Justice Canada XML (act)",
        ))
        out.append(dict(
            market="ca", name=f"CA {code} {label} [html]", accept="text/html",
            url=f"https://laws-lois.justice.gc.ca/eng/acts/{code}/",
            filename=f"CA-act-{code}_{label.replace(' ', '_')}.html",
            note="Department of Justice Canada HTML (act)",
        ))
    return out


# --------------------------------------------------------------------------
# Germany -- gesetze-im-internet.de serves every federal statute as PDF and
# as a small XML zip. Slugs are the site's own folder names (verified).
# --------------------------------------------------------------------------
DE_LAWS = [
    ("prodhaftg", "ProdHaftG", "Produkthaftungsgesetz"),
    ("prodsg_2021", "ProdSG", "Produktsicherheitsgesetz"),
    ("elektrog_2015", "ElektroG", "Elektro- und Elektronikgeraetegesetz"),
    ("battdg", "BattDG", "Batterierecht Durchfuehrungsgesetz"),
    ("verpackdg", "VerpackDG", "Verpackungsdurchfuehrungsgesetz"),
    ("chemg", "ChemG", "Chemikaliengesetz"),
    ("lfgb", "LFGB", "Lebensmittel- und Futtermittelgesetzbuch"),
    ("bdsg_2018", "BDSG", "Bundesdatenschutzgesetz 2018"),
    ("tkg_2021", "TKG", "Telekommunikationsgesetz"),
    ("enwg_2005", "EnWG", "Energiewirtschaftsgesetz"),
    ("uwg_2004", "UWG", "Gesetz gegen den unlauteren Wettbewerb"),
    ("textilkennzg_2016", "TextilKennzG", "Textilkennzeichnungsgesetz"),
    ("markeng", "MarkenG", "Markengesetz"),
    ("patg", "PatG", "Patentgesetz"),
    ("urhg", "UrhG", "Urheberrechtsgesetz"),
    ("bgb", "BGB", "Buergerliches Gesetzbuch"),
]


def _de_entries() -> list[dict]:
    out = []
    for slug, abbr, label in DE_LAWS:
        out.append(dict(
            market="de", name=f"DE {abbr} {label}",
            url=f"https://www.gesetze-im-internet.de/{slug}/{abbr}.pdf",
            accept="application/pdf",
            filename=f"DE-{abbr}_{label.replace(' ', '_')}.pdf",
            note="gesetze-im-internet.de official PDF",
        ))
        out.append(dict(
            market="de", name=f"DE {abbr} {label} [xml]",
            url=f"https://www.gesetze-im-internet.de/{slug}/xml.zip",
            accept="application/zip",
            filename=f"DE-{abbr}_{label.replace(' ', '_')}.xml.zip",
            note="gesetze-im-internet.de XML package",
        ))
    return out


# --------------------------------------------------------------------------
# Japan -- e-Gov Law API v1 returns the full act as XML (lawid format:
# <era><year>AC0000000<number>, Showa=3, Heisei=4, Reiwa=5).
# --------------------------------------------------------------------------
JP_LAWS = [
    ("415AC0000000057", "JP-APPI", "Act on the Protection of Personal Information"),
    ("336AC0000000234", "JP-DENANHO", "Electrical Appliance and Material Safety Act"),
    ("412AC0000000061", "JP-CONSUMER-CONTRACT", "Consumer Contract Act"),
    ("337AC0000000134", "JP-KEIHYO", "Act against Unjustifiable Premiums and Misleading Representations"),
    ("335AC0000000145", "JP-PHARMACEUTICAL", "Pharmaceutical and Medical Device Act"),
    ("337AC0000000104", "JP-HOUSEHOLD-GOODS", "Household Goods Quality Labelling Act"),
    ("351AC0000000057", "JP-COMMERCE", "Act on Specified Commercial Transactions"),
    ("419AC0000000048", "JP-PRODUCT-SAFETY", "Consumer Product Safety Act"),
]


def _jp_entries() -> list[dict]:
    return [
        dict(market="jp", name=f"{sid} {label}", accept="text/xml",
             url=f"https://laws.e-gov.go.jp/api/1/lawdata/{lawid}",
             filename=f"{sid}_{label.replace(' ', '_')}.xml",
             note=f"e-Gov Law API v1 lawid={lawid}")
        for lawid, sid, label in JP_LAWS
    ]


# --------------------------------------------------------------------------
# Remaining jurisdictions -- mostly official HTML pages; JS shells and WAF
# blocks get recorded in _SKIPPED.md for manual retrieval.
# --------------------------------------------------------------------------
OTHER = [
    # --- China ---
    ("cn", "CN-PIPL 个人信息保护法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html"),
    ("cn", "CN-DSL 数据安全法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/202106/t20210610_311888.html"),
    ("cn", "CN-CSL 网络安全法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/201611/t20161107_2001289.html"),
    ("cn", "CN-ECL 出口管制法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/202010/t20201017_308086.html"),
    ("cn", "CN-CSAR 化妆品监督管理条例 (gov.cn)",
     "https://www.gov.cn/zhengce/content/2020-06/29/content_5524019.htm"),
    ("cn", "CN-DUAL-USE 两用物项出口管制条例 (gov.cn)",
     "https://www.gov.cn/zhengce/content/202410/content_6981399.htm"),
    ("cn", "CN-ODI-NDRC 企业境外投资管理办法 (gov.cn)",
     "https://www.gov.cn/zhengce/2021-12/01/content_5713252.htm"),
    ("cn", "CN-TECH-EXPORT-CATALOG 禁止出口限制出口技术目录 (mofcom)",
     "https://www.mofcom.gov.cn/zcfb/zgdwjjmywg/art/2025/art_67e2a41850ec428eb1b7be6ec2f2bded.html"),
    ("cn", "CN-GB-44495 汽车整车信息安全技术要求 (openstd)",
     "https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=2DB552CAA58F589705C3DC7AD47AC2AB"),
    ("cn", "CN-GB search GB 6675 玩具安全 (openstd)",
     "https://openstd.samr.gov.cn/bzgk/gb/std_list?p.p1=0&p.p90=circulation_date&p.p91=desc&p.p2=GB%206675"),
    ("cn", "CN-GB search GB 4706 家用电器安全 (openstd)",
     "https://openstd.samr.gov.cn/bzgk/gb/std_list?p.p1=0&p.p90=circulation_date&p.p91=desc&p.p2=GB%204706"),
    ("cn", "CN-GB search GB 4806 食品接触材料 (openstd)",
     "https://openstd.samr.gov.cn/bzgk/gb/std_list?p.p1=0&p.p90=circulation_date&p.p91=desc&p.p2=GB%204806"),
    ("cn", "CN-GB search GB 4943 音视频信息技术设备 (openstd)",
     "https://openstd.samr.gov.cn/bzgk/gb/std_list?p.p1=0&p.p90=circulation_date&p.p91=desc&p.p2=GB%204943"),
    ("cn", "CN-GB search GB 18401 纺织产品安全 (openstd)",
     "https://openstd.samr.gov.cn/bzgk/gb/std_list?p.p1=0&p.p90=circulation_date&p.p91=desc&p.p2=GB%2018401"),
    ("cn", "CN-GB search GB 31241 锂电池安全 (openstd)",
     "https://openstd.samr.gov.cn/bzgk/gb/std_list?p.p1=0&p.p90=circulation_date&p.p91=desc&p.p2=GB%2031241"),
    ("cn", "CN-GB search GB 5296 使用说明 (openstd)",
     "https://openstd.samr.gov.cn/bzgk/gb/std_list?p.p1=0&p.p90=circulation_date&p.p91=desc&p.p2=GB%205296"),
    ("cn", "CN-SAMR 市场监管总局 新闻 (samr.gov.cn)",
     "https://www.samr.gov.cn/xw/zj/"),
    ("cn", "CN-MIIT 工信部 文件发布 (miit.gov.cn)",
     "https://www.miit.gov.cn/zwgk/zcwj/wjfb/index.html"),
    ("cn", "CN-MIIT 无线电管理 (miit.gov.cn)",
     "https://www.miit.gov.cn/jgsj/wdz/dzxx/index.html"),
    ("cn", "CN-FLK 国家法律法规数据库 (flk.npc.gov.cn)",
     "https://flk.npc.gov.cn/"),
    # --- UK (legislation.gov.uk is WAF-blocked; gov.uk guidance is open) ---
    ("uk", "UK-UKCA 通用准入要求 (gov.uk)",
     "https://www.gov.uk/guidance/using-the-ukca-marking"),
    ("uk", "UK 家电法规 2016 (gov.uk)",
     "https://www.gov.uk/government/publications/appliances-regulations-2016"),
    ("uk", "UK WEEE 法规指南 (gov.uk)",
     "https://www.gov.uk/guidance/regulations-waste-electrical-and-electronic-equipment"),
    ("uk", "UK EPR 包装生产者责任 (gov.uk)",
     "https://www.gov.uk/guidance/extended-producer-responsibility-for-packaging-who-is-affected-and-what-to-do"),
    ("uk", "UK REACH 合规指南 (gov.uk)",
     "https://www.gov.uk/guidance/how-to-comply-with-reach-chemical-regulations"),
    ("uk", "UK HSE SVHC 清单 (hse.gov.uk)",
     "https://www.hse.gov.uk/reach/svhc-overview.htm"),
    ("uk", "UK 产品安全与计量法案指引 (gov.uk)",
     "https://www.gov.uk/guidance/product-safety-and-metrology-bill"),
    ("uk", "UK Battery Regulations SI 2008/2164 (legislation.gov.uk)",
     "https://www.legislation.gov.uk/uksi/2008/2164/contents"),
    ("uk", "UK Radio Equipment Regulations SI 2017/1206 (legislation.gov.uk)",
     "https://www.legislation.gov.uk/uksi/2017/1206/contents"),
    ("uk", "UK Cosmetics Regulations SI 2013/1478 (legislation.gov.uk)",
     "https://www.legislation.gov.uk/uksi/2013/1478/contents"),
    ("uk", "UK NSI Act 2021 (legislation.gov.uk)",
     "https://www.legislation.gov.uk/ukpga/2021/25/contents"),
    # --- Singapore ---
    ("sg", "SG-PDPA 2012 Personal Data Protection Act (SSO)",
     "https://sso.agc.gov.sg/Act/PDPA2012"),
    ("sg", "SG-PSA 2019 Payment Services Act (SSO)",
     "https://sso.agc.gov.sg/Act/PSA2019"),
    ("sg", "SG Consumer Protection (Fair Trading) Act (SSO)",
     "https://sso.agc.gov.sg/Act/CPFTA2003"),
    ("sg", "SG Sale of Goods Act (SSO)",
     "https://sso.agc.gov.sg/Act/SGA1979"),
    ("sg", "SG PDPC advisory guidelines (pdpc.gov.sg)",
     "https://www.pdpc.gov.sg/guidelines-and-consultation/guidelines/overview-of-pdpa/the-legislation"),
    # --- Australia ---
    ("au", "AU ACL Australian Consumer Law (legislation.gov.au)",
     "https://www.legislation.gov.au/C2010A00103/latest/text"),
    ("au", "AU RCM compliance mark (ACMA)",
     "https://www.acma.gov.au/regulatory-compliance-mark-rcm"),
    ("au", "AU Electrical Equipment Safety System (EESS)",
     "https://www.eess.gov.au/"),
    ("au", "AU Product Safety Australia mandatory standards (ACCC)",
     "https://www.productsafety.gov.au/businesses/mandatory-standards"),
    ("au", "AU Therapeutic Goods Act 1989 (legislation.gov.au)",
     "https://www.legislation.gov.au/C2004A03937/latest/text"),
    # --- New Zealand ---
    ("nz", "NZ Children's Toys Product Safety Standard",
     "https://www.productsafety.govt.nz/for-businesses/making-sure-products-are-safe/mandatory-product-safety-standards/childrens-toy-standard/"),
    ("nz", "NZ Household Cots Product Safety Standard",
     "https://www.productsafety.govt.nz/for-businesses/making-sure-products-are-safe/mandatory-product-safety-standards/household-cot-standard"),
    ("nz", "NZ Fair Trading Act 1986 (legislation.govt.nz)",
     "https://www.legislation.govt.nz/act/public/1986/0121/latest/DLM96439.html"),
    ("nz", "NZ Consumer Guarantees Act 1993 (legislation.govt.nz)",
     "https://www.legislation.govt.nz/act/public/1993/0091/latest/DLM311093.html"),
    # --- Brazil ---
    ("br", "BR-INMETRO 合格评定 (gov.br)",
     "https://www.gov.br/inmetro/pt-br"),
    ("br", "BR LGPD Lei 13.709/2018 (planalto)",
     "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm"),
    ("br", "BR Código de Defesa do Consumidor Lei 8.078/1990 (planalto)",
     "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm"),
    ("br", "BR ANVISA 食品接触材料 (gov.br)",
     "https://www.gov.br/anvisa/pt-br"),
    # --- India ---
    ("in", "IN BIS CRS 强制注册计划 (bis.gov.in)",
     "https://www.bis.gov.in/index.php/standards-changes-orders/"),
    ("in", "IN Legal Metrology 包装与标签 (legalmetrology.gov.in)",
     "https://www.legalmetrology.gov.in/"),
    ("in", "IN Consumer Protection Act 2019 (indiacode)",
     "https://www.indiacode.nic.in/handle/123456789/15256"),
    ("in", "IN DPDP Act 2023 (meity)",
     "https://www.meity.gov.in/data-protection-framework"),
    # --- Mexico ---
    ("mx", "MX Ley Federal de Protección al Consumidor (diputados)",
     "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf"),
    ("mx", "MX Ley Federal de Protección de Datos Personales (diputados)",
     "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf"),
    ("mx", "MX NOM 标准目录 (gob.mx)",
     "https://www.gob.mx/se/acciones-y-programas/normas-oficiales-mexicanas"),
    # --- UAE / Saudi / GCC ---
    ("ae", "AE MoIAT ECAS 合格评定 (moiat.gov.ae)",
     "https://www.moiat.gov.ae/en"),
    ("ae", "AE UAE 立法门户 (u.ae)",
     "https://u.ae/en/information-and-services"),
    ("sa", "SA SASO 技术法规 (saso.gov.sa)",
     "https://www.saso.gov.sa/en/Pages/default.aspx"),
    ("sa", "SA SABER 产品安全平台 (saber.sa)",
     "https://saber.sa/"),
    ("sa", "SA SDAIA 个人数据保护法 (sdaia.gov.sa)",
     "https://sdaia.gov.sa/en/SDAIA/about/Pages/RegulationsAndPolicies.aspx"),
    ("gcc", "GCC GSO 标准化组织 (gso.org.sa)",
     "https://www.gso.org.sa/"),
    # --- Southeast Asia ---
    ("th", "TH PDPA 2019 个人数据保护法 (mdes.go.th)",
     "https://www.mdes.go.th/"),
    ("th", "TH TISI 泰国工业标准院",
     "https://www.tisi.go.th/"),
    ("vn", "VN 法律数据库 (vanban.chinhphu.vn)",
     "https://vanban.chinhphu.vn/"),
    ("vn", "VN 第13号个人数据保护法令 (luatvietnam)",
     "https://english.luatvietnam.vn/decree-no-13-2023-nd-cp-dated-april-17-2023-of-the-government-on-personal-data-protection-249791-doc1.html"),
    ("my", "MY PDPA 2010 Act 709 (pdp.gov.my)",
     "https://www.pdp.gov.my/jpdpv2/laws-of-malaysia/?lang=en"),
    ("my", "MY 标准局 STANDARDS MALAYSIA",
     "https://www.jsm.gov.my/"),
    ("id", "ID JDIH 法规数据库 (jdih.setneg.go.id)",
     "https://jdih.setneg.go.id/"),
    ("id", "ID PDP Law 27/2022 说明 (gov.id)",
     "https://www.kominfo.go.id/"),
    # --- Other markets ---
    ("za", "ZA Consumer Protection Act (gov.za)",
     "https://www.gov.za/documents/consumer-protection-act"),
    ("za", "ZA POPIA 个人信息保护法 (gov.za)",
     "https://www.gov.za/documents/protection-personal-information-act"),
    ("tr", "TR 6502 消费者保护法 (mevzuat.gov.tr)",
     "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6502"),
    ("tr", "TR KVKK 个人数据保护法 (kvkk.gov.tr)",
     "https://www.kvkk.gov.tr/"),
    ("ru", "RU 消费者权益保护法 (pravo.gov.ru)",
     "http://pravo.gov.ru/"),
    # --- International ---
    ("intl", "INTL Codex Alimentarius standards list (FAO/WHO)",
     "https://www.fao.org/fao-who-codexalimentarius/codex-texts/list-standards/en/"),
    ("intl", "INTL Codex 食品接触材料通用标准 (FAO/WHO)",
     "https://www.fao.org/fao-who-codexalimentarius/codex-texts/list-standards/en/"),
    ("intl", "INTL WTO legal texts",
     "https://www.wto.org/english/docs_e/legal_e/legal_e.htm"),
    ("intl", "INTL WTO TBT Agreement",
     "https://www.wto.org/english/docs_e/legal_e/17-tbt_e.htm"),
    ("intl", "INTL WTO SPS Agreement",
     "https://www.wto.org/english/docs_e/legal_e/15-sps.pdf"),
    ("intl", "INTL WIPO Lex 知识产权法规数据库",
     "https://www.wipo.int/wipolex/en/"),
    ("intl", "INTL WIPO PCT 专利合作条约",
     "https://www.wipo.int/pct/en/texts/"),
    ("intl", "INTL WIPO Madrid 商标国际注册",
     "https://www.wipo.int/madrid/en/legal_texts/"),
    ("intl", "INTL UNECE UN R155 车辆网络安全法规",
     "https://unece.org/transport/dangerous-goods/un-manual-tests-and-criteria"),
    ("intl", "INTL UN 危险货物运输示范规章 (UNECE)",
     "https://unece.org/transport/standards/transport/dangerous-goods"),
    ("intl", "INTL OECD 消费者政策",
     "https://www.oecd.org/sti/consumer/"),
    ("intl", "INTL IEC 国际电工委员会标准目录",
     "https://www.iec.ch/"),
    ("intl", "INTL ISO 国际标准化组织标准目录",
     "https://www.iso.org/standards.html"),
    ("intl", "INTL Basel Convention 巴塞尔公约",
     "https://www.basel.int/"),
    ("intl", "INTL Rotterdam Convention 鹿特丹公约",
     "https://www.pic.int/"),
    ("intl", "INTL Stockholm Convention 斯德哥尔摩公约",
     "https://www.pops.int/"),
    ("intl", "INTL Montreal Protocol 蒙特利尔议定书",
     "https://ozone.unep.org/treaties/montreal-protocol"),
    ("intl", "INTL UNCTAD 贸易与消费者政策",
     "https://unctad.org/topic/competition-and-consumer-protection"),
]

# --------------------------------------------------------------------------
# Round 2 -- additional sources verified reachable after the first pass, plus
# extra law pages on portals that answered 200. Same tuple shape as OTHER.
# --------------------------------------------------------------------------
OTHER_EXTRA = [
    # --- China (portals that actually respond; gov.cn 政策库 and mofcom work) ---
    ("cn", "CN 国务院政策文件库 (gov.cn)",
     "https://www.gov.cn/zhengce/xxgk/"),
    ("cn", "CN 商务部政策发布 (mofcom.gov.cn)",
     "https://www.mofcom.gov.cn/zcfb/index.html"),
    ("cn", "CN 商务部 法规 (mofcom.gov.cn)",
     "https://www.mofcom.gov.cn/zcfb/zgdwjjmywg/"),
    ("cn", "CN 市场监管总局 法规 (samr.gov.cn)",
     "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fldj/"),
    ("cn", "CN 全国人大 法律 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/"),
    ("cn", "CN 民法典 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c30834/202006/75ba6483b8344591abd07917e1d25cc8.shtml"),
    ("cn", "CN 消费者权益保护法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/201905/t20190521_296479.html"),
    ("cn", "CN 产品质量法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/201905/t20190521_296480.html"),
    ("cn", "CN 食品安全法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/201905/t20190521_296481.html"),
    ("cn", "CN 电子商务法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/201808/t20180831_272122.html"),
    ("cn", "CN 广告法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/201905/t20190521_296492.html"),
    ("cn", "CN 反不正当竞争法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/201905/t20190521_296483.html"),
    ("cn", "CN 商标法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/201905/t20190521_296487.html"),
    ("cn", "CN 专利法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/202010/t20201017_308087.html"),
    ("cn", "CN 标准化法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/201711/t20171104_200146.html"),
    ("cn", "CN 劳动合同法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/201905/t20190521_296486.html"),
    ("cn", "CN 公司法 2023 修订 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/202312/t20231229_434258.html"),
    ("cn", "CN 药品管理法 (npc.gov.cn)",
     "http://www.npc.gov.cn/npc/c2/c30834/201905/t20190521_296484.html"),
    # --- Germany (statute index pages, useful as a browsable catalogue) ---
    ("de", "DE 联邦法规索引 A-K (gesetze-im-internet.de)",
     "https://www.gesetze-im-internet.de/Teilliste_A.html"),
    ("de", "DE 联邦法规索引 L-Z (gesetze-im-internet.de)",
     "https://www.gesetze-im-internet.de/Teilliste_L.html"),
    ("de", "DE 英文翻译法规索引 (gesetze-im-internet.de)",
     "https://www.gesetze-im-internet.de/Teilliste_translations.html"),
    # --- Japan ---
    ("jp", "JP 消费者厅 CAA (caa.go.jp)",
     "https://www.caa.go.jp/"),
    ("jp", "JP 财务省 关税 (customs.go.jp)",
     "https://www.customs.go.jp/"),
    ("jp", "JP 厚生劳动省 (mhlw.go.jp)",
     "https://www.mhlw.go.jp/"),
    ("jp", "JP e-Gov 法令检索门户",
     "https://elaws.e-gov.go.jp/"),
    # --- Korea (law.go.kr and KLRI English are the only open channels) ---
    ("kr", "KR 国家法令信息中心 英文 (KLRI)",
     "https://elaw.klri.re.kr/eng_service/main.do"),
    ("kr", "KR 法令信息中心 (law.go.kr)",
     "https://www.law.go.kr/"),
    # --- Singapore ---
    ("sg", "SG HSA 卫生科学局",
     "https://www.hsa.gov.sg/"),
    ("sg", "SG Enterprise Singapore 标准与认证",
     "https://www.enterprisesg.gov.sg/"),
    ("sg", "SG SSO 法规数据库",
     "https://sso.agc.gov.sg/"),
    # --- Australia / New Zealand ---
    ("au", "AU legislation.gov.au 联邦立法门户",
     "https://www.legislation.gov.au/"),
    ("nz", "NZ legislation.govt.nz",
     "https://www.legislation.govt.nz/"),
    # --- Turkey ---
    ("tr", "TR 法规门户 (mevzuat.gov.tr)",
     "https://www.mevzuat.gov.tr/"),
    # --- International ---
    ("intl", "INTL WIPO Madrid Agreement and Protocol (pub 292)",
     "https://www.wipo.int/edocs/pubdocs/en/wipo_pub_292.pdf"),
    ("intl", "INTL WIPO 条约与文本",
     "https://www.wipo.int/treaties/en/"),
    ("intl", "INTL WIPO Lex 法律文本检索",
     "https://www.wipo.int/wipolex/en/legislation/"),
    ("intl", "INTL Codex 商品标准列表",
     "https://www.fao.org/fao-who-codexalimentarius/codex-texts/list-standards/en/"),
    ("intl", "INTL Codex 操作规范列表",
     "https://www.fao.org/fao-who-codexalimentarius/codex-texts/codes-of-practice/en/"),
    ("intl", "INTL Codex 农药残留限量",
     "https://www.fao.org/fao-who-codexalimentarius/codex-texts/maximum-residue-limits/en/"),
    # --- US state level ---
    ("us", "US CA 民法典 CCPA/CPRA 正文 (leginfo)",
     "https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=CIV&division=3.&title=1.81.5.&part=4.&chapter=&article="),
    ("us", "US CA 总检察长 CCPA 页面 (oag.ca.gov)",
     "https://oag.ca.gov/privacy/ccpa"),
    ("us", "US CA 州法规库 (leginfo)",
     "https://leginfo.legislature.ca.gov/faces/codes.xhtml"),
]


def _other_entries() -> list[dict]:
    out = []
    for market, name, url in OTHER + OTHER_EXTRA:
        accept = "application/pdf" if url.lower().endswith(".pdf") else "text/html"
        out.append(dict(market=market, name=name, url=url, accept=accept,
                        note="official page"))
    # round 3: new markets + specific document pages (catalog_more.py)
    import catalog_more as _more
    for market, name, url in _more.MORE_PORTALS:
        accept = "application/pdf" if url.lower().endswith(".pdf") else "text/html"
        out.append(dict(market=market, name=name, url=url, accept=accept,
                        note="official portal"))
    for entry in _more.SPECIFIC_DOCS:
        market, name, url, accept = entry
        out.append(dict(market=market, name=name, url=url, accept=accept,
                        note="specific document"))
    # round 4: verified per-document URLs in the newly opened markets
    import catalog_expand2 as _more2
    for market, name, url, accept in _more2.EXTRA_DOCS:
        out.append(dict(market=market, name=name, url=url, accept=accept,
                        note="specific document (round 4)"))
    return out


def all_entries() -> list[dict]:
    # The catalogue ships without the `note` key going into fetch_one, which
    # only accepts a fixed kwarg set -- strip it into a side channel.
    entries = (
        _eu_entries()
        + _us_entries()
        + US_DYNAMIC
        + _ca_entries()
        + _de_entries()
        + _jp_entries()
        + _other_entries()
    )
    cleaned = []
    for e in entries:
        e = dict(e)
        e.pop("note", None)
        cleaned.append(e)
    return cleaned


def notes() -> dict[str, str]:
    entries = (
        _eu_entries() + _us_entries() + US_DYNAMIC + _ca_entries()
        + _de_entries() + _jp_entries() + _other_entries()
    )
    return {f"{e['market']}|{e['name']}": e.get("note", "") for e in entries}
