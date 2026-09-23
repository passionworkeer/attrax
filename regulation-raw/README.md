# regulation-raw · 各国法规原文抓取库

> 两层结构：根目录是**原文抓取层**（各国官方原件，不做任何改写），
> `parsed/` 是**解析层**（同一批原文切成条文级 Markdown + JSON）。

- 抓取时间：`2026-09-19T13:40:31`
- 成功下载：**1335 个文件**，共 **568.5 MB**
- 覆盖市场：**70 个**
- 抓取层格式：xml×559、html×480、pdf×219、xhtml×54、zip×16、json×6、md×1
- 解析层：`parsed/` 下 **1,334 篇** · **61,931 条条文** · **231.9 百万字符**

---

## 一、目录结构

按市场建立子目录，文件名以 `法规编号_英文名` 命名，便于检索：

```
regulation-raw/
├── eu/            欧盟法规原文（PDF + XHTML 双格式）
├── us/            美国 CFR / U.S. Code / 公法 / 召回数据
├── ca/  de/  jp/  加拿大 / 德国 / 日本（官方 XML 通道）
├── cn/            中国法律法规与国家标准
├── uk/ sg/ au/ nz/ br/ in/ 各国官方页面
├── ae/ sa/ gcc/ my/ th/ vn/ id/ 中东与东南亚
├── intl/          WIPO / Codex / WTO / UNECE 等国际规则
├── parsed/        解析层：<市场>/<文件名>.md + .json（条文级）
├── _tools/        抓取脚本（fetch.py 引擎、catalog.py 目录、download.py 运行器）
│   ├── parse/     解析器（model.py 数据模型、extractors.py 各源抽取、run.py 调度）
│   └── .venv/     解析依赖（pypdf / beautifulsoup4 / lxml）
├── _manifest.json 抓取清单（含每个 URL 的状态、哈希、大小）
├── _manifest.csv  同上，表格版
└── _SKIPPED.md    未能直接下载的链接清单（供人工打开）
```

## 二、各市场抓取结果

| 市场 | 文件数 | 体积 | 主要格式 | 抓取通道 | 未直连 |
|:---|:---:|---:|:---|:---|:---:|
| 西班牙 ES | 454 | 198.5 MB | xml、html | BOE 开放数据 API（全量合并法规 XML，可分页枚举） | 1 |
| 中国 CN | 225 | 6.5 MB | html | openstd.samr.gov.cn 国家标准、npc.gov.cn、gov.cn、mofcom、miit | 2 |
| 美国 US | 218 | 166.3 MB | pdf、xml、html、json | govinfo.gov（CFR 分卷、US Code、公法、联邦公报）、Federal Register API、openFDA、SaferProducts | 14 |
| 欧盟 EU | 85 | 88.7 MB | xhtml、pdf | Publications Office Cellar（内容协商取 PDF / XHTML） | 31 |
| 国际组织 INTL | 76 | 37.4 MB | pdf、html | ETSI 免费标准 PDF、WIPO、Codex、WTO、UN Treaty、WHO/FAO/ITU/UPU/ICC、NIST | 14 |
| 德国 DE | 36 | 9.4 MB | zip、pdf、html | gesetze-im-internet.de（官方 PDF + XML 包） | — |
| 加拿大 CA | 28 | 2.3 MB | html、xml | Department of Justice Canada（官方 XML + HTML） | 2 |
| 爱尔兰 IE | 20 | 17.5 MB | pdf、html | electronic Irish Statute Book（全文 PDF + 打印版 HTML） | 1 |
| 澳大利亚 AU | 12 | 2.3 MB | html | legislation.gov.au、ACMA、Product Safety Australia | 2 |
| 日本 JP | 12 | 3.7 MB | xml、html | e-Gov 法令 API v1（全文 XML） | — |
| 台湾 TW | 9 | 1.0 MB | html | 全国法规资料库 law.moj.gov.tw | — |
| 瑞士 CH | 7 | 767.5 KB | html | Fedlex（ELI 寻址） | — |
| 新加坡 SG | 7 | 1.5 MB | html | Singapore Statutes Online (sso.agc.gov.sg)、HSA、EnterpriseSG | 5 |
| 菲律宾 PH | 7 | 1.7 MB | html | LawPhil 法律库 | — |
| 越南 VN | 6 | 1.3 MB | html | vanban.chinhphu.vn / congbao.chinhphu.vn | — |
| 荷兰 NL | 6 | 3.9 MB | html | wetten.overheid.nl（BWBR 编号） | 2 |
| 巴西 BR | 6 | 1.8 MB | html | gov.br / INMETRO / ANVISA / Planalto | — |
| 新西兰 NZ | 5 | 1.8 MB | html | Product Safety NZ、legislation.govt.nz | — |
| 英国 UK | 5 | 505.1 KB | html | GOV.UK 指南页（legislation.gov.uk 被 WAF 拦截） | 6 |
| 马来西亚 MY | 5 | 600.0 KB | html | 总检察署 AGC | — |
| 波兰 PL | 4 | 166.2 KB | html | ISAP 立法库 / Dziennik Ustaw | — |
| 比利时 BE | 4 | 194.5 KB | html | eJustice 法规库 | — |
| 南非 ZA | 4 | 541.8 KB | html、pdf | 官方门户 | 1 |
| 孟加拉 BD | 3 | 160.4 KB | html | 官方门户 | — |
| 印度 IN | 3 | 1015.5 KB | html | BIS、Legal Metrology、India Code、MeitY | 2 |
| 约旦 JO | 3 | 901.2 KB | html | 官方门户 | — |
| 意大利 IT | 3 | 133.5 KB | html | Normattiva / Gazzetta Ufficiale | 1 |
| 卡塔尔 QA | 3 | 1.6 MB | html | Al Meezan 法律门户 | — |
| 韩国 KR | 3 | 324.0 KB | html | 官方门户 | — |
| 克罗地亚 HR | 3 | 378.7 KB | html | 官方门户 | — |
| 印尼 ID | 3 | 7.2 MB | html | 官方门户 | 1 |
| 智利 CL | 3 | 28.1 KB | html | BCN LeyChile | 1 |
| 坦桑尼亚 TZ | 3 | 1.9 MB | html | 官方门户 | — |
| 泰国 TH | 3 | 10.3 KB | html | 官方门户 | — |
| 土耳其 TR | 3 | 712.2 KB | html | 官方门户 | — |
| 斯洛伐克 SK | 2 | 2.6 KB | html | 官方门户 | — |
| 马耳他 MT | 2 | 59.9 KB | html | 官方门户 | — |
| 加纳 GH | 2 | 350.6 KB | html | 官方门户 | — |
| 挪威 NO | 2 | 55.5 KB | html | Lovdata | — |
| 希腊 GR | 2 | 400.4 KB | html | 官方门户 | — |
| 蒙古 MN | 2 | 238.5 KB | html | 官方门户 | — |
| 阿联酋 AE | 2 | 1.6 MB | html | 官方门户 | — |
| 爱沙尼亚 EE | 2 | 101.8 KB | html | 官方门户 | — |
| 拉脱维亚 LV | 2 | 86.8 KB | html | 官方门户 | — |
| 哥伦比亚 CO | 2 | 9.3 KB | html | 官方门户 | — |
| 阿曼 OM | 2 | 13.6 KB | html | 官方门户 | — |
| 塞尔维亚 RS | 2 | 25.4 KB | html | 官方门户 | — |
| 沙特 SA | 2 | 408.5 KB | html | 官方门户 | 1 |
| 葡萄牙 PT | 2 | 4.6 KB | html | 官方门户 | — |
| 斯洛文尼亚 SI | 2 | 23.1 KB | html | 官方门户 | — |
| 阿根廷 AR | 2 | 133.8 KB | html | 官方门户 | 1 |
| 柬埔寨 KH | 2 | 108.1 KB | html | 官方门户 | — |
| 丹麦 DK | 2 | 9.5 KB | html | Retsinformation | — |
| 芬兰 FI | 2 | 367.3 KB | html | Finlex | — |
| 卢森堡 LU | 2 | 4.9 KB | html | 官方门户 | — |
| 塞浦路斯 CY | 2 | 19.7 KB | html | 官方门户 | — |
| 老挝 LA | 2 | 704.5 KB | html | 官方门户 | — |
| 瑞典 SE | 1 | 220.2 KB | html | Riksdagen / Konsumentverket | 2 |
| 巴基斯坦 PK | 1 | 112.3 KB | html | 官方门户 | — |
| 香港 HK | 1 | 7.4 KB | html | 官方门户 | — |
| 尼日利亚 NG | 1 | 5.4 KB | html | 官方门户 | 1 |
| 黎巴嫩 LB | 1 | 146.6 KB | html | 官方门户 | — |
| 俄罗斯 RU | 1 | 95.1 KB | html | 官方门户 | — |
| 海合会 GCC | 1 | 170.4 KB | html | 官方门户 | — |
| 巴拿马 PA | 1 | 848 B | html | 官方门户 | — |
| 哈萨克斯坦 KZ | 1 | 2.7 KB | html | 官方门户 | — |
| 文莱 BN | 1 | 202.0 KB | html | 官方门户 | — |
| 尼泊尔 NP | 1 | 240.2 KB | html | 官方门户 | 1 |
| 墨西哥 MX | 1 | 1.9 KB | html | 官方门户 | 6 |
| 法国 FR | 1 | 52.1 KB | html | service-public.fr（Legifrance 被 WAF 拦截） | 2 |

> 「未直连」列 = `_manifest.json` 中该市场抓取失败（WAF/403/404/JS 空壳）的条目数，
> 完整链接见 [`_SKIPPED.md`](_SKIPPED.md)。

### 发现式抓取（列表页 → 逐条下钻）

- 通过解析列表页额外抓到 **205** 条，明细见 `_manifest_discovery.json`。
- 中国国家标准：`cn/国家标准/` 目录，按 GB 号检索结果逐条抓取详情页。
- 澳大利亚立法：`au/` 目录，legislation.gov.au 的 `/latest/text` 全文页。

## 三、解析层（parsed/）

每个源文件解析为 `parsed/<市场>/<文件名>.md`（人读）与 `.json`（结构化）。
共 **1334 篇**、**61,931 条条文**、**231,852,556 字符**。

| 解析器 | 文件数 | 平均条文 | 平均字符 | 说明 |
|:---|---:|---:|---:|:---|
| `es_boe_xml` | 451 | 86.5 | 263,490 | BOE 开放数据 XML，按 `<texto>/<bloque>` 切条（preámbulo/artículo/disposición） |
| `generic_html` | 291 | 0.0 | 76,158 | 通用网页正文抽取（剥 nav/footer/cookie） |
| `cn_gb_html` | 189 | 1.0 | 754 | 国标著录页，抽标准号/中英文名/状态/ICS/发布单位（无正文，版权所限） |
| `us_pdf` | 107 | 62.2 | 212,473 | CFR / 公法 PDF，切 `§ N.N` 或 `SEC. N` |
| `us_cfr_xml` | 81 | 35.7 | 143,302 | govinfo CFR 颗粒，按 `<SECTION>` 切 § |
| `generic_pdf` | 65 | 3.8 | 194,876 | 其它 PDF（WIPO/WTO 等），保留全文并尝试切条 |
| `eu_xhtml` | 54 | 62.3 | 222,105 | OJ CONVEX XHTML，按 `p.oj-ti-art` 切 Article |
| `eu_pdf` | 31 | 44.8 | 251,997 | 官方公报 PDF，正则切 `Article N` |
| `de_pdf` | 16 | 11.5 | 329,817 | 德国法律 PDF，切 `§ N` |
| `de_zip` | 16 | 259.4 | 323,167 | gesetze-im-internet XML，一个 `<norm>` 一个 §（enbez 为条号） |
| `ca_xml` | 14 | 67.0 | 62,794 | 司法部 XML，按 `<Section><Label>` 切条（标题取 MarginalNote） |
| `jp_xml` | 8 | 206.5 | 84,147 | e-Gov API XML，按 `<Article>` 切条并保留編/章/節层级 |
| `json_doc` | 6 | 116.7 | 174,316 | 召回数据，逐条记录展开 |
| `fedreg_xml` | 5 | 112.6 | 2,170,655 | 联邦公报每日全文 XML，按 `<DOCUMENT>` 切每条规则/通告 |

质量报告见 [`parsed/_REPORT.md`](parsed/_REPORT.md)，逐文档索引见 `parsed/_index.json`。

## 四、复现与增量抓取

```bash
cd regulation-raw

# 全量抓取（会跳过已存在文件的重复判定，按 manifest 覆盖）
python3 _tools/download.py

# 只抓某个市场
python3 _tools/download.py --market eu us

# 名称过滤
python3 _tools/download.py --only EU-2023

# 发现式抓取（国标 / 澳洲立法）
python3 _tools/discover.py

# 解析全部原文 -> parsed/（需要 _tools/.venv）
_tools/.venv/bin/python _tools/parse/run.py

# 重新生成这份 README
python3 _tools/make_readme.py
```

`fetch.py` 的判定逻辑：HTTP ≥ 400 → `http_<code>`；返回 202/203 且体积很小、
或正文命中 AWS WAF / Cloudflare 挑战特征 → `waf`；正文 < 256 字节 → `empty`；
其余写入磁盘并记录 SHA-256。

## 五、已知抓不到的源

以下站点在本机网络下实测有硬性拦截，链接已完整记录在 [`_SKIPPED.md`](_SKIPPED.md)，
可在浏览器中手动打开，或换网络/加代理后重试：

| 站点 | 现象 | 替代通道 |
|:---|:---|:---|
| `eur-lex.europa.eu` 网页/PDF | AWS WAF 202 挑战 | 已改用 Cellar 内容协商，抓到 PDF+XHTML |
| `legislation.gov.uk` | AWS WAF 202 挑战 | 暂无；英方条文改抓 GOV.UK 指南页 |
| `www.ecfr.gov` | Cloudflare，API 返回 406 | 已改用 govinfo.gov 的 CFR 分卷 XML/PDF |
| `www.cpsc.gov` | 403 数据中心 IP 封禁 | 已改用 SaferProducts.gov REST |
| `unece.org`、`iso.org`、`iec.ch` | 403 / 付费墙 | 仅保留目录页链接 |
| `www.gov.cn` 部分栏目、`flk.npc.gov.cn` | 403 / JS 空壳 | 已改用 npc.gov.cn、mofcom 等可抓栏目 |
| `workspace.fao.org` Codex PDF | SharePoint 登录墙 + Cloudflare | 仅保留 Codex 列表页 |
| `accc.gov.au`、`tga.gov.au` | 403 / 连接超时 | 已改用 legislation.gov.au |

## 六、说明

- 根目录**只做抓取与存放**；所有解析产物隔离在 `parsed/`，可随时删除重建。
- 所有文件版权归各自发布机构所有；本目录仅作合规研究用途的本地存档。
- 部分国家标准（GB/GB-T）正文受版权保护，官方公开系统仅提供著录信息，
  因此 `cn/国家标准/` 抓取的是官方著录页而非标准全文。
