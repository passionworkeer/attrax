# 官方法规数据源与覆盖说明（2026-05-27）

> ⚠️ **SUPERSEDED — 2026-05-27 历史覆盖率快照**。当前覆盖率通过 [`scripts/report_regulation_coverage.py`](../scripts/report_regulation_coverage.py) 重新生成，并配合 [`scripts/eval_grounding.py`](../scripts/eval_grounding.py) 做定位评测。

本文档说明当前已经采集的产品合规、消费者保护、市场准入、产品安全、标签、化学限制、无线/电信、环保与可持续相关官方原件来源，供后续人工 review、embedding 与入库使用。

## 采集原则

- 只优先收官方或准官方来源：政府官网、官方法规库、官方标准化/监管机构、官方翻译门户、官方公报、法院/国会/法务部门法律数据库。
- 优先保存原件格式：PDF、DOCX/Word、XML、XHTML、RDF；没有公开原件下载时，保存官方 HTML 页面。
- 所有新采集文件保持 raw supplement 隔离，不直接写入 `data/corpus/processed` 或 `data/faiss`。
- “全覆盖”按 best-effort 处理：公开法规、官方指南、技术法规、产品认证/市场准入入口优先；收费标准正文、受版权或站点访问限制的国家标准正文，在限制说明里单独标注。

## 当前批次

| 批次 | 路径 | 条目 | Raw 文件 | 覆盖市场 | 状态 |
|---|---|---:|---:|---|---|
| 初始官方补充 | `data/regulation_supplements/2026-05-25_official_sources` | 14 | 18 | CN, EU, UK, US | 已采集，早期部分元数据未完全结构化 |
| 全球官方补充 | `data/regulation_supplements/2026-05-26_global_official_sources` | 55 | 63 | AU, BR, CA, EU, GCC, IN, JP, KR, MX, SG, UK, US | raw 完整，0 失败 |
| Registry 官方补充 | `data/regulation_supplements/2026-05-26_registry_official_sources` | 25 | 33 | CA, EU, NZ, UK, US | raw 完整，0 失败 |
| 深扩官方原件 | `data/regulation_supplements/2026-05-27_more_official_sources` | 95 | 143 | AU, CA, CN, EU, UK, US | raw 完整，0 失败 |
| 缺口市场补齐 | `data/regulation_supplements/2026-05-27_coverage_gap_official_sources` | 40 | 76 | BR, GCC, IN, JP, KR, MX, NZ, SG | raw 完整，0 失败 |
| 额外全球补齐 | `data/regulation_supplements/2026-05-27_extra_global_official_sources` | 30 | 36 | AE, AR, CL, ID, MY, PH, SA, TH, TR, VN, ZA | raw 完整，0 失败 |

当前 supplement 合计：259 条 regulation entries，369 个 raw source files。当前新增批次尚未 ingest 到 processed corpus，也未重建 FAISS。

## 本轮新增重点

本轮新增 `2026-05-27_extra_global_official_sources`，重点补 ASEAN、中东、非洲、拉美和土耳其：

| 市场 | 新增条目 | 新增文件 | 主要新增场景 |
|---|---:|---:|---|
| SA | 6 | 6 | SASO 技术法规入口、低压电器、Saudi RoHS、纺织品、PPE、防护服、GCC 儿童玩具技术法规 |
| PH | 4 | 7 | BPS 产品认证、强制认证清单、Consumer Act、NTC type approval/equipment conformity certificate 表单 |
| ZA | 4 | 4 | ICASA type approval、labelling、radio spectrum regulations |
| TR | 4 | 4 | Law No. 7223 产品安全与技术法规、实施法规、市场监管/产品安全、官方公报 PDF |
| ID | 3 | 3 | 消费者保护法、消费者保护监督条例、标准化与合格评定法 |
| AE | 3 | 3 | MOIAT ECAS 合格证书、法律法规入口、Manaa 产品安全/召回平台 |
| MY | 2 | 3 | Suruhanjaya Tenaga 电气设备批准指南 PDF、能效/MEPS 页面 |
| VN | 1 | 1 | MIC 电信与 IT 终端设备电气安全技术法规页面 |
| TH | 1 | 1 | TISI Industrial Product Standards Act 官方 PDF |
| AR | 1 | 2 | InfoLeg 消费者防卫法 metadata 与法条正文 |
| CL | 1 | 2 | Ley Chile 消费者权益保护法 HTML 与 PDF |

## 官网来源清单

| 市场/区域 | 官方来源 | 官网/入口 | 当前保存类型 |
|---|---|---|---|
| EU | Publications Office of the EU / EUR-Lex | https://publications.europa.eu/ ，https://eur-lex.europa.eu/ | RDF, XHTML/HTML |
| US | eCFR API, GovInfo | https://www.ecfr.gov/ ，https://www.govinfo.gov/ | XML, PDF |
| UK | legislation.gov.uk, GOV.UK/OPSS/HSE | https://www.legislation.gov.uk/ ，https://www.gov.uk/ | PDF, XML, HTML |
| CA | Justice Laws Website | https://laws-lois.justice.gc.ca/ | XML |
| AU | Federal Register of Legislation | https://www.legislation.gov.au/ | PDF, DOCX |
| CN | gov.cn, SAMR, MIIT, CNCA | https://www.gov.cn/ ，https://www.samr.gov.cn/ ，https://www.miit.gov.cn/ ，https://www.cnca.gov.cn/ | HTML, PDF |
| JP | Japanese Law Translation, Ministry of Justice | https://www.japaneselawtranslation.go.jp/ | HTML, PDF, DOCX, XML |
| KR | Korean Law Translation Center / KLRI | https://elaw.klri.re.kr/ | HTML |
| SG | CPSO, SSO, NEA, CCCS | https://www.consumerproductsafety.gov.sg/ ，https://sso.agc.gov.sg/ ，https://www.nea.gov.sg/ | HTML, PDF |
| IN | BIS, CPCB, CDSCO, MoEF | https://www.bis.gov.in/ ，https://cpcb.nic.in/ ，https://cdsco.gov.in/ ，https://moef.gov.in/ | HTML, PDF |
| MX | PLATIICA / Secretaria de Economia, DOF references | https://platiica.economia.gob.mx/ ，https://www.dof.gob.mx/ | HTML, PDF |
| BR | Planalto, Inmetro, Anvisa, Anatel | https://www.planalto.gov.br/ ，https://www.gov.br/inmetro/ ，https://www.gov.br/anvisa/ ，https://www.gov.br/anatel/ | HTML |
| GCC | Gulf Cooperation Council Standardization Organization | https://www.gso.org.sa/ | HTML, PDF |
| SA | Saudi Standards, Metrology and Quality Organization | https://www.saso.gov.sa/ | HTML, PDF |
| AE | Ministry of Industry and Advanced Technology | https://moiat.gov.ae/ | HTML |
| ZA | Independent Communications Authority of South Africa | https://www.icasa.org.za/ | HTML |
| MY | Energy Commission / Suruhanjaya Tenaga | https://www.st.gov.my/ | HTML, PDF |
| PH | Bureau of Philippine Standards / DTI, Supreme Court E-Library, NTC | https://bps.dti.gov.ph/ ，https://elibrary.judiciary.gov.ph/ ，https://ntc.gov.ph/ | HTML, PDF |
| ID | JDIH BPK | https://peraturan.bpk.go.id/ | PDF |
| VN | Ministry of Information and Communications | https://mic.gov.vn/ | HTML |
| TH | Thai Industrial Standards Institute | https://www.tisi.go.th/ | PDF |
| TR | Ministry of Trade, Official Gazette | https://urunkurallari.ticaret.gov.tr/ ，https://ticaret.gov.tr/ ，https://www.resmigazete.gov.tr/ | HTML, PDF |
| AR | InfoLeg, Ministry of Justice | https://servicios.infoleg.gob.ar/ | HTML |
| CL | Ley Chile, Biblioteca del Congreso Nacional | https://www.leychile.cl/ | HTML, PDF |
| NZ | Product Safety New Zealand | https://www.productsafety.govt.nz/ | HTML |

## 当前覆盖统计

### 按市场

| 市场 | 条目数 |
|---|---:|
| US | 53 |
| EU | 37 |
| UK | 30 |
| CN | 18 |
| CA | 18 |
| KR | 12 |
| JP | 11 |
| AU | 9 |
| SG | 9 |
| MX | 8 |
| NZ | 7 |
| IN | 6 |
| BR | 6 |
| SA | 6 |
| GCC | 5 |
| PH | 4 |
| ZA | 4 |
| TR | 4 |
| ID | 3 |
| AE | 3 |
| MY | 2 |
| VN | 1 |
| TH | 1 |
| AR | 1 |
| CL | 1 |

### 按品类/场景

| 品类 | 条目数 |
|---|---:|
| electronics | 97 |
| general_consumer_products | 79 |
| children_products | 68 |
| industrial_products | 32 |
| electrical_equipment | 32 |
| toys | 31 |
| packaging | 27 |
| textiles | 26 |
| chemicals | 25 |
| home_appliances | 21 |
| apparel | 20 |
| furniture | 19 |
| home_goods | 17 |
| cosmetics | 16 |
| radio | 15 |
| telecommunications | 12 |
| food_contact | 8 |
| kitchenware | 8 |
| machinery | 5 |
| raw_materials | 5 |
| batteries | 5 |
| controlled_goods | 5 |
| waste_electrical | 4 |
| plastics | 3 |
| ppe | 3 |

另有 `unknown=14`，来自早期补充批次中尚未补齐 `product_categories` 元数据的条目；原始文件和来源仍可追溯。

### 按监管类型

| 监管类型 | 条目数 |
|---|---:|
| product_safety | 129 |
| conformity | 84 |
| labelling | 72 |
| chemical | 49 |
| market_surveillance | 45 |
| documentation | 34 |
| testing | 32 |
| mechanical | 29 |
| sustainability | 22 |
| technical_standard | 19 |
| radio | 15 |
| packaging | 13 |
| scope_classification | 13 |
| flammability | 11 |
| emc | 10 |
| waste | 8 |
| food_contact | 5 |
| recall | 1 |

## 文件类型

| 类型 | 文件数 |
|---|---:|
| HTML | 102 |
| XML | 96 |
| PDF | 85 |
| RDF | 37 |
| XHTML | 37 |
| DOCX | 12 |

## 后续解析建议

- XML/XHTML/RDF：优先结构化解析，保留条款层级、CELEX/eCFR/Justice Laws 等标识。
- PDF：用于法规原件、技术法规、官方指南；embedding 前建议抽取文本并保留页码。
- DOCX：日本法令翻译和澳大利亚注册文件可作为 PDF/OCR 的交叉校验文本。
- HTML：官方网页或官方翻译门户文本；embedding 前建议抽正文、去导航，并保留 `source_url` 与采集批次。

## 已知限制

- 部分国家标准正文受版权或收费限制，当前保留官方目录页、监管说明页或公开技术法规 PDF。
- 个别官方网站会拦截自动化下载或对 TLS/地区访问敏感；本批次只把成功下载并校验非空的文件写入 manifest。
- HK/TW/IL 等来源已做过候选检索，但本地环境对部分官方站点 TLS 或 403 限制较多，暂未纳入本轮 manifest，避免引入不完整文件。
- KLRI 英文法令页面属于官方翻译门户来源，但页面本身提示译文仅供参考；入库时应保留该来源说明。
- 新批次仍是 raw-only，尚未进入 `data/corpus/processed`，也未重建 FAISS；下一步可先人工 spot check，再统一 embedding 入库。
