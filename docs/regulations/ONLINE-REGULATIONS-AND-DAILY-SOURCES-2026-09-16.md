# 火鹰合规 (Attrax) 线上法规文档与每日更新监控源清单

> 生成时间：2026-09-16  
> 配套数据源：
> - 线上法规索引：[`data/regulations/regulations_index.json`](file:///Users/wangjianjun/me/attrax/data/regulations/regulations_index.json)
> - 线上知识库锚点：[`data/kb/anchors/`](file:///Users/wangjianjun/me/attrax/data/kb/anchors/)
> - 每日监控注册表：[`data/regulation_sources/official_sources.json`](file:///Users/wangjianjun/me/attrax/data/regulation_sources/official_sources.json)
> - 守护进程配置：[`scripts/ecosystem.config.cjs`](file:///Users/wangjianjun/me/attrax/scripts/ecosystem.config.cjs) (`regwatch`)

---

## 一、线上系统当前使用的法规文档（共 44 篇）

### 1.1 运行机制说明
线上扫描引擎（RAG 服务）当前运行在 **知识锚定架构 (Knowledge-Anchored Generation)** 下：
- **触发规则**：根据用户选择的 **目标市场（16国/区）** 与视觉识别的 **10 大品类**（`electronics`, `appliance`, `3c`, `toy`, `textile`, `cosmetic`, `food_contact`, `battery`, `home`, `other`），结合 **4 大硬件特征**（`battery` 电池、`wireless` 无线射频、`mains` 交流市电、`children` 儿童适用性），通过 [`rag_service/retrieval/kb_loader.py`](file:///Users/wangjianjun/me/attrax/rag_service/retrieval/kb_loader.py) 动态激活对应的法规锚点。
- **条文校验**：LLM 输出的每一条法规引用，均由 [`rag_service/verify/quote_matcher.py`](file:///Users/wangjianjun/me/attrax/rag_service/verify/quote_matcher.py) 与底层法规条文库执行反向确定性比对，杜绝幻觉引用。
- **授权类型**：
  - **`public` (33篇)**：政府公开法律法规指令，包含逐条法条全文/官方结构化条款。
  - **`private_with_summary` (11篇)**：属于行业标准或国家版权标准（如中国 GB 标准、美国 UL、ASTM 标准），系统内置权威 KB 提炼摘要，附官方购买或标准信息公开系统查阅链接。

---

### 1.2 44 篇线上法规完整清单

#### 1. 欧盟 (EU) — 13 篇
| 编号 ID | 简称 / 名称 | 官方代号 | 适用品类 / 触发特征 | 条款数 | 授权性质 | 人类可访问 / 官方链接 |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `EU-2023-988` | **GPSR 通用产品安全法规** | Regulation (EU) 2023/988 | `home` (通用消费品) | 5 | public | [EUR-Lex GPSR 官方全文](https://eur-lex.europa.eu/eli/reg/2023/988/oj) |
| `EU-2009-48` | **玩具安全指令** | Directive 2009/48/EC | `toy` (儿童玩具) | 6 | public | [EUR-Lex 2009/48/EC](https://eur-lex.europa.eu/eli/dir/2009/48/oj) |
| `EU-2011-65` | **RoHS 有害物质限制指令** | Directive 2011/65/EU | `3c` / `electronics` | 4 | public | [EUR-Lex 2011/65/EU](https://eur-lex.europa.eu/eli/dir/2011/65/oj) |
| `EU-2014-53` | **RED 无线电设备指令** | Directive 2014/53/EU | `3c` / `wireless` (含无线设备) | 8 | public | [EUR-Lex 2014/53/EU](https://eur-lex.europa.eu/eli/dir/2014/53/oj) |
| `EU-2014-30` | **EMC 电磁兼容指令** | Directive 2014/30/EU | `3c` / `electronics` | 4 | public | [EUR-Lex 2014/30/EU](https://eur-lex.europa.eu/eli/dir/2014/30/oj) |
| `EU-2014-35` | **LVD 低电压电器安全指令** | Directive 2014/35/EU | `appliance` (家用电器/市电设备) | 5 | public | [EUR-Lex 2014/35/EU](https://eur-lex.europa.eu/eli/dir/2014/35/oj) |
| `EU-2023-1542` | **EU 电池新规** | Regulation (EU) 2023/1542 | `battery` (含电池产品) | 5 | public | [EUR-Lex 2023/1542](https://eur-lex.europa.eu/eli/reg/2023/1542/oj) |
| `EU-1907-2006` | **REACH 化学品注册/限制** | Regulation (EC) No 1907/2006 | `home` (消费品材质/化学物质) | 5 | public | [EUR-Lex 1907/2006](https://eur-lex.europa.eu/eli/reg/2006/1907/oj) |
| `EU-1223-2009` | **EU 化妆品法规** | Regulation (EC) No 1223/2009 | `cosmetic` (化妆品) | 9 | public | [EUR-Lex 1223/2009](https://eur-lex.europa.eu/eli/reg/2009/1223/oj) |
| `EU-1935-2004` | **FCM 食品接触材料框架法规** | Regulation (EC) No 1935/2004 | `food_contact` (食品接触通用) | 4 | public | [EUR-Lex 1935/2004](https://eur-lex.europa.eu/eli/reg/2004/1935/oj) |
| `EU-10-2011` | **塑料食品接触材料法规** | Regulation (EU) No 10/2011 | `food_contact` (塑料材质) | 10 | public | [EUR-Lex 10/2011](https://eur-lex.europa.eu/eli/reg/2011/10/oj) |
| `EU-1007-2011` | **纺织品纤维名称与标签法规** | Regulation (EU) No 1007/2011 | `textile` (纺织服装) | 5 | public | [EUR-Lex 1007/2011](https://eur-lex.europa.eu/eli/reg/2011/10/oj) |
| `EU-2009-125` | **ErP 能效与生态设计指令** | Directive 2009/125/EC | `appliance` (耗能电器) | 4 | public | [EUR-Lex 2009/125/EC](https://eur-lex.europa.eu/eli/dir/2009/125/oj) |

---

#### 2. 美国 (US) — 12 篇
| 编号 ID | 简称 / 名称 | 官方代号 | 适用品类 / 触发特征 | 条款数 | 授权性质 | 人类可访问 / 官方链接 |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `US-CPSIA` | **儿童产品安全改进法案** | 15 USC §2056a (Pub.L. 110-314) | `toy` (儿童用品/玩具) | 3 | public | [CPSC CPSIA 官方入口](https://www.cpsc.gov/Regulations-Laws--Standards/Statues/Childrens-Products) |
| `US-CPSC-General` | **消费品安全法 (CPSA)** | 15 USC §2051 et seq. | `home` (通用消费品) | 2 | public | [CPSC Statutes 入口](https://www.cpsc.gov/Regulations-Laws--Standards/Statues) |
| `US-ASTM-F963` | **ASTM 玩具安全标准** | ASTM F963-23 | `toy` (玩具物理/化学安全) | 0 | private | [ASTM F963 官方页面](https://www.astm.org/f0963-23.html) |
| `US-CA-Prop-65` | **加州 65 号提案** | Cal. Health & Safety Code §25249.5 | `electronics` / `home` | 2 | public | [OEHHA Prop 65 官网](https://oehha.ca.gov/proposition-65) |
| `US-FCC-15` | **FCC Part 15 射频设备法规** | 47 CFR Part 15 | `electronics` / `wireless` | 4 | public | [eCFR Title 47 Part 15](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-A/part-15) |
| `US-FCC-15-18` | **FCC Part 15/18 通信与ISM** | 47 CFR Parts 15 & 18 | `3c` / `electronics` | 3 | public | [eCFR Title 47 Subchapter A](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-A) |
| `US-21-CFR-174` | **FDA 食品接触材料与添加剂** | 21 CFR Parts 174-190 | `food_contact` (食品接触) | 12 | public | [eCFR Title 21 Part 174](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-174) |
| `US-MoCRA` | **化妆品法规现代化法案** | 21 USC §364 (Pub.L. 117-9) | `cosmetic` (化妆品) | 2 | public | [FDA MoCRA 官网指南](https://www.fda.gov/cosmetics/cosmetics-laws-regulations/modernization-cosmetics-regulation-act-2022-mocra) |
| `US-49-CFR-173-185` | **DOT 危险货物运输-锂电池** | 49 CFR §173.185 | `battery` (锂电池包装运输) | 1 | public | [eCFR Title 49 §173.185](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-I/subchapter-C/part-173/subpart-E/section-173.185) |
| `US-TFPIA` | **纺织纤维产品识别法案** | 15 USC §70 et seq. | `textile` (纺织品标签) | 2 | public | [FTC TFPIA 官方页面](https://www.ftc.gov/enforcement/statutes/textile-fiber-products-identification-act) |
| `US-UL-60335` | **UL 家用电器安全标准** | UL 60335-1 / 60335-2 系列 | `appliance` (家电) | 0 | private | [UL Standards 60335](https://www.shopulstandards.com/ProductDetail.aspx?UniqueKey=36741) |
| `US-UL-ETL` | **UL / ETL 列名认证** | 第三方实验室认证准入 | `mains` (市电插电类) | 0 | private | [UL Certification 官网](https://www.ul.com/services/certification/ul-listing-and-classification) |

---

#### 3. 中国 (CN) — 12 篇
| 编号 ID | 简称 / 名称 | 官方代号 | 适用品类 / 触发特征 | 条款数 | 授权性质 | 人类可访问 / 官方链接 |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `CN-CCC` | **CCC 强制性产品认证** | CNCA 实施规则 | `electronics` (强制目录产品) | 1 | public | [认监委 CNCA 官网](https://www.samr.gov.cn/cnca/) |
| `CN-CCC-IT` | **CCC 认证 (信息技术设备)** | CNCA-C09-01 | `3c` (计算机/显示器/电源等) | 1 | public | [认监委 CNCA 官网](https://www.samr.gov.cn/cnca/) |
| `CN-CSAR` | **化妆品监督管理条例** | 国务院令第 727 号 | `cosmetic` (化妆品) | 4 | public | [中国政府网 国令第727号](https://www.gov.cn/zhengce/content/2020-06/29/content_5524019.htm) |
| `CN-SRRC` | **无线电发射设备型号核准** | 工信部《无线电发射设备管理规定》 | `wireless` (无线电产品) | 1 | public | [工信部 MIIT 官网](https://www.miit.gov.cn/) |
| `CN-GB-6675` | **国家玩具安全技术规范** | GB 6675.1~.4-2014 | `toy` (玩具安全) | 0 | private | [国家标准全文公开系统](https://openstd.samr.gov.cn/) |
| `CN-GB-18401` | **国家纺织产品基本安全技术规范** | GB 18401-2010 | `textile` (纺织品) | 0 | private | [国家标准全文公开系统](https://openstd.samr.gov.cn/) |
| `CN-GB-4706` | **家用和类似用途电器的安全** | GB 4706.1 + 专项系列 | `appliance` (家用电器) | 0 | private | [国家标准全文公开系统](https://openstd.samr.gov.cn/) |
| `CN-GB-4806` | **食品安全国家标准 食品接触材料** | GB 4806.1~.16 系列 | `food_contact` (食品接触材料) | 0 | private | [国家标准全文公开系统](https://openstd.samr.gov.cn/) |
| `CN-GB-4943-1` | **音视频、信息技术设备安全规范** | GB 4943.1-2022 | `electronics` / `3c` | 0 | private | [GB 4943.1-2022 标准公开页](https://openstd.samr.gov.cn/bzgk/std/lookup?bid=GB%204943.1-2022) |
| `CN-GB-31241` | **便携式电子产品用锂离子电池安全** | GB 31241-2022 | `battery` (锂电池) | 0 | private | [国家标准全文公开系统](https://openstd.samr.gov.cn/) |
| `CN-GB-5296` | **消费品使用说明 总则** | GB 5296.1-2012 | `home` (说明书与标识) | 0 | private | [国家标准全文公开系统](https://openstd.samr.gov.cn/) |
| `CN-GB-5296-4` | **消费品使用说明 纺织品和服装** | GB 5296.4-2012 | `textile` (服装洗标标签) | 0 | private | [国家标准全文公开系统](https://openstd.samr.gov.cn/) |

---

#### 4. 英国 (UK) — 5 篇
| 编号 ID | 简称 / 名称 | 官方代号 | 适用品类 / 触发特征 | 条款数 | 授权性质 | 人类可访问 / 官方链接 |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `UK-UKCA-General` | **UKCA 标志通用准入要求** | UK Conformity Assessed | `electronics` (英国通用准入) | 1 | public | [GOV.UK UKCA Marking 指南](https://www.gov.uk/guidance/using-the-ukca-marking) |
| `UK-UKCA-Appliance` | **UK 电气与家电安全法规** | Electrical Equipment (Safety) Regs 2016 | `appliance` (家电设备) | 1 | public | [GOV.UK 家电法规指南](https://www.gov.uk/government/publications/appliances-regulations-2016) |
| `UK-UKCA-Radio` | **UK 无线电设备法规 2017** | S.I. 2017/1206 | `wireless` / `3c` | 1 | public | [UK Legislation S.I. 2017/1206](https://www.legislation.gov.uk/uksi/2017/1206/contents) |
| `UK-Batteries` | **UK 电池与蓄电池法规** | S.I. 2008/2164 (Retained) | `battery` (电池类) | 1 | public | [UK Legislation S.I. 2008/2164](https://www.legislation.gov.uk/uksi/2008/2164/contents) |
| `UK-Cosmetics` | **UK 化妆品安全执行条例** | S.I. 2013/1478 (Retained) | `cosmetic` (化妆品) | 1 | public | [UK Legislation S.I. 2013/1478](https://www.legislation.gov.uk/uksi/2013/1478/contents) |

---

#### 5. 澳大利亚与新西兰 (AU) — 1 篇
| 编号 ID | 简称 / 名称 | 官方代号 | 适用品类 / 触发特征 | 条款数 | 授权性质 | 人类可访问 / 官方链接 |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `AU-RCM` | **RCM 澳新法规符合性标志** | ACMA RCM Marking Requirements | `electronics` (电气/射频/EMC) | 1 | public | [ACMA RCM 官方指引](https://www.acma.gov.au/standards/regulatory-compliance-mark-rcm) |

---

#### 6. 联合国 / 国际运输规则 (UN) — 1 篇
| 编号 ID | 简称 / 名称 | 官方代号 | 适用品类 / 触发特征 | 条款数 | 授权性质 | 人类可访问 / 官方链接 |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `UN-38-3` | **UN 38.3 锂电池运输试验** | UN Manual of Tests and Criteria §38.3 | `battery` (全球通用运输规则) | 1 | public | [UNECE 联合国危险货物运输手册](https://unece.org/transport/dangerous-goods/un-manual-tests-and-criteria) |

---

## 二、每日定时更新爬取的法规官方源清单（共 35 个，确保人类可直接打开）

### 2.1 每日爬虫运行说明
- **托管服务**：运行在腾讯云首尔生产机 PM2 的 [`regwatch`](file:///Users/wangjianjun/me/attrax/scripts/ecosystem.config.cjs) 守护进程中。
- **调度频次**：每天服务器本地时间 **03:00**（Asia/Shanghai 时区）自动启动全量巡检。
- **爬取与解析机制**：
  - **后端爬取端点**：为保证数据结构化和权威性，机器爬取层走专用的开放数据通道（如 Cellar RDF/XML、Federal Register API、Canada Justice XML 等）。
  - **人类访问端点**：所有 35 个源均配备了 **`human_view_url`**，支持直接在 Chrome/Edge/Safari 等现代浏览器中正常点击查阅。

---

### 2.2 35 个每日监控源详细清单（人类可直接打开）

#### 1. 欧盟 (EU) — 9 个监控源
| 序号 | 监控源 ID | 监管机构 / 监控法规 | 人类可直接打开的官方链接 | 访问状态 | 说明与通道 |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 1 | `eu-2023-988-general-product-safety` | 欧盟 GPSR 通用产品安全法规 | [https://eur-lex.europa.eu/eli/reg/2023/988/oj](https://eur-lex.europa.eu/eli/reg/2023/988/oj) | 可打开 | EUR-Lex 官方公报 HTML（后台走 Cellar RDF 抓取） |
| 2 | `eu-2009-48-toy-safety` | 欧盟玩具安全指令 | [https://eur-lex.europa.eu/eli/dir/2009/48/oj](https://eur-lex.europa.eu/eli/dir/2009/48/oj) | 可打开 | EUR-Lex 官方公报 HTML |
| 3 | `eu-2011-65-rohs` | 欧盟 RoHS 有害物质限制指令 | [https://eur-lex.europa.eu/eli/dir/2011/65/oj](https://eur-lex.europa.eu/eli/dir/2011/65/oj) | 可打开 | EUR-Lex 官方公报 HTML |
| 4 | `eu-2012-19-weee` | 欧盟 WEEE 电子废弃物指令 | [https://eur-lex.europa.eu/eli/dir/2012/19/oj](https://eur-lex.europa.eu/eli/dir/2012/19/oj) | 可打开 | EUR-Lex 官方公报 HTML |
| 5 | `eu-2014-53-radio-equipment` | 欧盟 RED 无线电设备指令 | [https://eur-lex.europa.eu/eli/dir/2014/53/oj](https://eur-lex.europa.eu/eli/dir/2014/53/oj) | 可打开 | EUR-Lex 官方公报 HTML |
| 6 | `eu-2014-30-emc` | 欧盟 EMC 电磁兼容指令 | [https://eur-lex.europa.eu/eli/dir/2014/30/oj](https://eur-lex.europa.eu/eli/dir/2014/30/oj) | 可打开 | EUR-Lex 官方公报 HTML |
| 7 | `eu-2014-35-low-voltage` | 欧盟 LVD 低电压电器指令 | [https://eur-lex.europa.eu/eli/dir/2014/35/oj](https://eur-lex.europa.eu/eli/dir/2014/35/oj) | 可打开 | EUR-Lex 官方公报 HTML |
| 8 | `eu-2019-1020-market-surveillance` | 欧盟市场监管与产品合规条例 | [https://eur-lex.europa.eu/eli/reg/2019/1020/oj](https://eur-lex.europa.eu/eli/reg/2019/1020/oj) | 可打开 | 跨境电商欧代与海关抽查核心依据 |
| 9 | `eu-safety-gate-alerts` | 欧盟 Safety Gate (RAPEX) 召回预警 | [https://ec.europa.eu/safety-gate/](https://ec.europa.eu/safety-gate/) | 可打开 | 欧盟非食用危险产品每周通报流 |

---

#### 2. 美国 (US) — 6 个监控源
| 序号 | 监控源 ID | 监管机构 / 监控法规 | 人类可直接打开的官方链接 | 访问状态 | 说明与通道 |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 10 | `us-16-cfr-1307-phthalates` | 儿童玩具与护理品中邻苯二甲酸盐限制 | [https://www.ecfr.gov/current/title-16/part-1307](https://www.ecfr.gov/current/title-16/part-1307) | 浏览器正常打开 | eCFR 官方网页（后台走 Federal Register API 绕过机器反爬） |
| 11 | `us-16-cfr-1630-carpets-rugs` | 地毯与垫子表面阻燃标准 | [https://www.ecfr.gov/current/title-16/part-1630](https://www.ecfr.gov/current/title-16/part-1630) | 浏览器正常打开 | 纺织品阻燃强制标准 |
| 12 | `us-16-cfr-1631-small-carpets-rugs` | 小型地毯表面阻燃标准 | [https://www.ecfr.gov/current/title-16/part-1631](https://www.ecfr.gov/current/title-16/part-1631) | 浏览器正常打开 | 纺织品阻燃强制标准 |
| 13 | `us-16-cfr-1633-mattresses-open-flame` | 床垫类产品明火阻燃标准 | [https://www.ecfr.gov/current/title-16/part-1633](https://www.ecfr.gov/current/title-16/part-1633) | 浏览器正常打开 | 家居纺织品阻燃强制标准 |
| 14 | `us-16-cfr-1700-poison-prevention-packaging` | 防儿童误食安全包装法规 (PPPA) | [https://www.ecfr.gov/current/title-16/part-1700](https://www.ecfr.gov/current/title-16/part-1700) | 浏览器正常打开 | 消费品/化学品包装安全标准 |
| 15 | `us-cpsc-recalls-rss` | CPSC 美国消费品安全委员会召回流 | [https://www.cpsc.gov/Recalls](https://www.cpsc.gov/Recalls) | 可打开 | CPSC 官方公开召回清单（后台走 RSS Feed 同步） |

---

#### 3. 加拿大 (CA) — 6 个监控源
| 序号 | 监控源 ID | 监管机构 / 监控法规 | 人类可直接打开的官方链接 | 访问状态 | 说明与通道 |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 16 | `ca-consumer-chemicals-containers-regulations-2001` | 消费类化学品与容器包装法规 | [https://laws-lois.justice.gc.ca/eng/regulations/SOR-2001-269/](https://laws-lois.justice.gc.ca/eng/regulations/SOR-2001-269/) | 可打开 | 加拿大司法部官方法规 HTML（后台走 XML 同步） |
| 17 | `ca-surface-coating-materials-regulations` | 表面涂层材料法规 (铅/重金属) | [https://laws-lois.justice.gc.ca/eng/regulations/SOR-2016-193/](https://laws-lois.justice.gc.ca/eng/regulations/SOR-2016-193/) | 可打开 | 玩具与家具涂料强制安全法规 |
| 18 | `ca-phthalates-regulations` | 邻苯二甲酸盐增塑剂限制法规 | [https://laws-lois.justice.gc.ca/eng/regulations/SOR-2016-188/](https://laws-lois.justice.gc.ca/eng/regulations/SOR-2016-188/) | 可打开 | 儿童玩具与护理用品化学限制 |
| 19 | `ca-childrens-sleepwear-regulations` | 儿童睡衣阻燃法规 | [https://laws-lois.justice.gc.ca/eng/regulations/SOR-2016-169/](https://laws-lois.justice.gc.ca/eng/regulations/SOR-2016-169/) | 可打开 | 加拿大高风险纺织品重点法规 |
| 20 | `ca-consumer-products-containing-lead-regulations` | 消费品含铅量限制法规 | [https://laws-lois.justice.gc.ca/eng/regulations/SOR-2018-83/](https://laws-lois.justice.gc.ca/eng/regulations/SOR-2018-83/) | 可打开 | 接触人体或儿童消费品限铅要求 |
| 21 | `ca-corded-window-coverings-regulations` | 有绳窗帘拉绳安全法规 | [https://laws-lois.justice.gc.ca/eng/regulations/SOR-2019-97/](https://laws-lois.justice.gc.ca/eng/regulations/SOR-2019-97/) | 可打开 | 防儿童缠绕窒息安全强制要求 |

---

#### 4. 英国 (UK) — 4 个监控源
| 序号 | 监控源 ID | 监管机构 / 监控法规 | 人类可直接打开的官方链接 | 访问状态 | 说明与通道 |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 22 | `uk-weee-regulations-guidance` | 英国 WEEE 电子废弃物法规指南 | [https://www.gov.uk/guidance/regulations-waste-electrical-and-electronic-equipment](https://www.gov.uk/guidance/regulations-waste-electrical-and-electronic-equipment) | 可打开 | GOV.UK 官方执行指南页面 |
| 23 | `uk-packaging-epr-who-is-affected` | 英国 EPR 包装延伸生产者责任指南 | [https://www.gov.uk/guidance/extended-producer-responsibility-for-packaging-who-is-affected-and-what-to-do](https://www.gov.uk/guidance/extended-producer-responsibility-for-packaging-who-is-affected-and-what-to-do) | 可打开 | 跨境电商环保合规重点 |
| 24 | `uk-reach-compliance-guidance` | 英国 UK-REACH 化学品合规指南 | [https://www.gov.uk/guidance/how-to-comply-with-reach-chemical-regulations](https://www.gov.uk/guidance/how-to-comply-with-reach-chemical-regulations) | 可打开 | 英国脱欧后化工合规指南 |
| 25 | `uk-hse-svhc-overview` | 英国 HSE 高度关注物质 (SVHC) 清单 | [https://www.hse.gov.uk/REACH/svhc-overview.htm](https://www.hse.gov.uk/REACH/svhc-overview.htm) | 可打开 | 英国健康安全执行署官方清单 |

---

#### 5. 新西兰 (NZ) — 2 个监控源
| 序号 | 监控源 ID | 监管机构 / 监控法规 | 人类可直接打开的官方链接 | 访问状态 | 说明与通道 |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 26 | `nz-product-safety-standards-2005` | 新西兰强制性玩具安全标准 | [https://www.productsafety.govt.nz/for-businesses/making-sure-products-are-safe/mandatory-product-safety-standards/childrens-toy-standard/](https://www.productsafety.govt.nz/for-businesses/making-sure-products-are-safe/mandatory-product-safety-standards/childrens-toy-standard/) | 可打开 | Product Safety NZ 官方指导 |
| 27 | `nz-product-safety-standards-household-cots-2016` | 新西兰家用婴儿床安全标准 | [https://www.productsafety.govt.nz/for-businesses/making-sure-products-are-safe/mandatory-product-safety-standards/household-cot-standard](https://www.productsafety.govt.nz/for-businesses/making-sure-products-are-safe/mandatory-product-safety-standards/household-cot-standard) | 可打开 | Product Safety NZ 官方指导 |

---

#### 6. 中国 (CN) — 2 个监控源
| 序号 | 监控源 ID | 监管机构 / 监控法规 | 人类可直接打开的官方链接 | 访问状态 | 说明与通道 |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 28 | `cn-samr-product-recall` | 国家市场监督管理总局 缺陷产品召回 | [https://www.samr.gov.cn/](https://www.samr.gov.cn/) | 浏览器正常打开 | SAMR 官方网站与召回公告栏目 |
| 29 | `cn-cnca-ccc-updates` | 中国国家认监委 CCC 目录与规则动态 | [https://www.cnca.gov.cn/](https://www.cnca.gov.cn/) | 浏览器正常打开 | 强制性产品认证目录调整动态 |

---

#### 7. 亚太及中东主要市场 (JP / KR / AE / SA) — 4 个监控源
| 序号 | 监控源 ID | 国家 | 监管机构 / 监控法规 | 人类可直接打开的官方链接 | 访问状态 |
| :---: | :--- | :---: | :--- | :--- | :---: |
| 30 | `jp-meti-pse-list` | 日本 (JP) | 经济产业省 (METI) 电安法 PSE 适用范围与公告 | [https://www.meti.go.jp/policy/consumer_appliance/pse/index.html](https://www.meti.go.jp/policy/consumer_appliance/pse/index.html) | 可打开 |
| 31 | `kr-motie-kc-safety` | 韩国 (KR) | 产业通商资源部 (MOTIE) KC 安全确认公告 | [https://www.motie.go.kr/](https://www.motie.go.kr/) | 可打开 |
| 32 | `ae-moiat-ecas` | 阿联酋 (AE) | 工业与先进技术部 (MoIAT) ECAS 合格评定计划 | [https://moiat.gov.ae/](https://moiat.gov.ae/) | 可打开 |
| 33 | `sa-saso-news` | 沙特 (SA) | 沙特标准局 (SASO) 与 SABER 技术法规公告 | [https://www.saso.gov.sa/](https://www.saso.gov.sa/) | 可打开 |

---

#### 8. 拉美及南亚新兴市场 (BR / IN) — 2 个监控源
| 序号 | 监控源 ID | 国家 | 监管机构 / 监控法规 | 人类可直接打开的官方链接 | 访问状态 |
| :---: | :--- | :---: | :--- | :--- | :---: |
| 34 | `br-inmetro-novidades` | 巴西 (BR) | 国家计量、标准化和工业质量协会 (INMETRO) 公告 | [https://www.gov.br/inmetro/](https://www.gov.br/inmetro/) | 可打开 |
| 35 | `in-bis-crs` | 印度 (IN) | 印度标准局 (BIS) 强制注册计划 (CRS) 公告 | [https://www.bis.gov.in/](https://www.bis.gov.in/) | 可打开 |

---

## 三、数据目录索引与技术文件对照

| 资产类型 | 存放路径 | 核心文件 / 模块 | 作用与责任 |
| :--- | :--- | :--- | :--- |
| **线上法规库条目** | `data/regulations/{region}/*.yaml` | `regulations_index.json` (44篇) | 生产只读法规条款正文及元数据 |
| **知识库锚点 (KB)** | `data/kb/anchors/*.yaml` | 44 个分类与特征 YAML | 定义品类、特征、法条要点与检查清单 |
| **每日更新注册表** | `data/regulation_sources/` | `official_sources.json` (35源) | 爬虫巡检的唯一事实源 (含 human_view_url) |
| **爬虫抓取临时存证** | `data/regulation_supplements/` | `auto-{date}/` 每日快照 | 抓取到的官方原件 (RDF/XML/HTML) 与变更 Diff |
| **守护巡检主脚本** | `scripts/watchdog/` | `orchestrator.py` + `collectors/` | 调度引擎、WAF UA 轮换、HTML 正文清洗与自动入库 |
