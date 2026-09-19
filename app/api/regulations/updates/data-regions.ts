import type { RegulationUpdate } from "./types";

// 区域补充卡片（2026-09-19 attrax-docs 法规目录导入）。
//
// 编辑部示例集（./data.ts 的 reg-001…reg-030）覆盖 EU / US / CN / UK / CA / JP /
// KR / AU / IN / BR / SA / AE 的消费电子类产品合规；越南、印尼、马来西亚、
// 泰国、新加坡、海湾国家在这些卡片里是空白。这里按《出海合规法律法规政策
// 清单》《法规分类表》与研究报告（attrax-docs/all法规）里的事实补齐，
// 日期取法规自身公布/生效日，均可回溯到条目 sourceUrl。
//
// 与 STATIC_DEMO 一样是人工整理内容，不由 watchdog 抓取；统一由 routes 合并
// 后标注 dataset（static-demo / live+demo）。
export const REGIONAL_UPDATES: RegulationUpdate[] = [
  {
    id: "reg-101",
    market: "VN",
    title: "越南第 13 号个人数据保护法令生效",
    titleEn: "Vietnam Decree 13/2023 on Personal Data Protection",
    publishDate: "2023-04-17",
    effectiveDate: "2023-07-01",
    affectedCategories: ["跨境服务", "消费电子", "电商发货", "智能家居"],
    affectedCategoriesEn: ["Cross-border Services", "Consumer Electronics", "E-commerce Fulfilment", "Smart Home"],
    summary:
      "越南《第13号个人数据保护法令》建立个人数据处理的同意、告知与跨境传输规则，并明确域外效力：在境外处理越南公民数据的企业同样受管。数据主体享有撤回同意、反对处理等 11 项权利，企业须在收到请求后 72 小时内响应，并指定数据保护官（DPO）。",
    summaryEn:
      "Vietnam's Decree 13/2023 establishes consent, notice and cross-border transfer rules for personal data, with extraterritorial effect on processing of Vietnamese citizens' data abroad. Data subjects hold eleven rights including withdrawal of consent and objection to processing; requests must be handled within 72 hours and a Data Protection Officer appointed.",
    sourceAgency: "越南公安部网络安全与高技术犯罪预防局 A05",
    sourceAgencyEn: "Vietnam Ministry of Public Security (A05)",
    sourceUrl: "https://english.luatvietnam.vn/decree-no-13-2023-nd-cp-dated-april-17-2023-of-the-government-on-personal-data-protection-249791-doc1.html",
    riskLevel: "high",
    changeType: "new",
    status: "已发布",
    statusEn: "Published",
    businessImpact:
      "面向越南用户的 App、SaaS 与电商业务需要补齐隐私政策、同意弹窗和请求响应流程；缺少 DPO 与本地联系人会直接影响响应时效。",
    businessImpactEn:
      "Apps, SaaS and e-commerce serving Vietnamese users need updated privacy notices, consent flows and a request-handling process; a missing DPO or local contact delays responses.",
    requirements: ["指定数据保护官或本地联系人", "建立 72 小时数据主体请求流程", "跨境传输数据前完成影响评估"],
    requirementsEn: [
      "Appoint a DPO or local contact",
      "Build a 72-hour data subject request process",
      "Complete a transfer impact assessment before cross-border transfer",
    ],
    recommendedActions: ["梳理越南用户数据流与存储位置", "把同意记录与请求日志纳入证据库", "更新隐私政策与客服话术"],
    recommendedActionsEn: [
      "Map Vietnamese user data flows and storage locations",
      "Add consent records and request logs to the evidence library",
      "Refresh privacy notices and support scripts",
    ],
    lastVerifiedAt: "2026-09-19",
  },
  {
    id: "reg-102",
    market: "VN",
    title: "越南第 53 号法令实施数据本地化",
    titleEn: "Vietnam Decree 53/2022 Data Localisation Regime",
    publishDate: "2022-08-15",
    effectiveDate: "2022-10-01",
    affectedCategories: ["跨境服务", "电商发货", "云服务", "游戏与内容"],
    affectedCategoriesEn: ["Cross-border Services", "E-commerce Fulfilment", "Cloud Services", "Games & Content"],
    summary:
      "Decree 53/2022 细化《网络安全法》的本地化要求：电信、云存储、域名、电商、在线支付、社交网络、网络游戏等十类服务的外国企业，在被书面要求配合而未能合规时，须在越南存储用户数据并设立分支或代表机构。数据本地化与设点须在收到决定后 12 个月内完成，数据最短保存 24 个月。",
    summaryEn:
      "Decree 53/2022 details the Cybersecurity Law's localisation regime: foreign providers in ten sectors (telecom, cloud storage, domains, e-commerce, online payment, social networks, online games and more) must store user data in Vietnam and establish a branch or representative office once notified in writing of non-compliance. Localisation and establishment must be completed within 12 months of the decision, with data retained at least 24 months.",
    sourceAgency: "越南公安部 A05",
    sourceAgencyEn: "Vietnam Ministry of Public Security (A05)",
    sourceUrl: "https://english.luatvietnam.vn/",
    riskLevel: "high",
    changeType: "new",
    status: "持续有效",
    statusEn: "In force",
    businessImpact:
      "依赖区域统一架构的云服务、跨境支付与内容平台需要预留越南节点与本地实体方案，否则在被点名后面临 12 个月的强制改造窗口。",
    businessImpactEn:
      "Cloud, cross-border payment and content platforms running one regional architecture need a Vietnam node and local entity plan, or face a forced 12-month rebuild once named.",
    requirements: ["确认业务是否属于十类受管服务", "准备越南境内存储与备份方案", "评估设立代表机构的人员与成本"],
    requirementsEn: [
      "Confirm whether the service falls in the ten regulated sectors",
      "Prepare in-country storage and backup options",
      "Assess cost and staffing of a representative office",
    ],
    recommendedActions: ["完成越南数据映射与合规差距评估", "与本地数据中心/云商建立备选方案", "把 12 个月整改窗口写入项目排期"],
    recommendedActionsEn: [
      "Run a Vietnam data mapping and gap assessment",
      "Line up local data centre or cloud options",
      "Put the 12-month remediation window into the project plan",
    ],
    lastVerifiedAt: "2026-09-19",
  },
  {
    id: "reg-103",
    market: "ID",
    title: "印尼个人数据保护法过渡期届满",
    titleEn: "Indonesia PDP Law Transition Period Ends",
    publishDate: "2022-10-17",
    effectiveDate: "2024-10-17",
    affectedCategories: ["跨境服务", "消费电子", "电商发货", "金融科技"],
    affectedCategoriesEn: ["Cross-border Services", "Consumer Electronics", "E-commerce Fulfilment", "Fintech"],
    summary:
      "印尼《第27号个人数据保护法》两年过渡期于 2024 年 10 月 17 日结束，违规处罚全面适用。法律要求处理个人数据须有合法依据、履行告知义务，并对跨境传输、数据主体权利响应与数据泄露通报设定明确责任。",
    summaryEn:
      "The two-year transition under Indonesia's Law No. 27 of 2022 closed on 17 October 2024, bringing the penalty regime fully into force. The law requires a lawful basis for processing, notice duties, and clear obligations for cross-border transfer, data subject requests and breach notification.",
    sourceAgency: "印尼通信与数字部 / 个人数据保护机构",
    sourceAgencyEn: "Indonesia Ministry of Communication and Digital Affairs",
    sourceUrl: "https://jdih.setneg.go.id/",
    riskLevel: "high",
    changeType: "enforcement",
    status: "执法窗口临近",
    statusEn: "Enforcement window approaching",
    businessImpact:
      "在印尼有用户数据的跨境业务需要把同意、告知、删除请求与泄露通报流程落成可查记录；过渡期结束后不再以整改期为由豁免。",
    businessImpactEn:
      "Businesses holding Indonesian user data need auditable consent, notice, deletion and breach-notification processes; the grace period can no longer be cited.",
    requirements: ["记录数据处理合法性依据", "提供印尼语隐私告知", "建立数据泄露通报与响应流程"],
    requirementsEn: [
      "Record the lawful basis for each processing activity",
      "Provide Indonesian-language privacy notices",
      "Establish breach notification and response procedures",
    ],
    recommendedActions: ["对印尼用户数据做一次合规盘点", "补齐印尼语隐私政策与同意记录", "演练一次泄露响应流程"],
    recommendedActionsEn: [
      "Run a compliance inventory of Indonesian user data",
      "Complete Indonesian-language notices and consent records",
      "Rehearse a breach response workflow",
    ],
    lastVerifiedAt: "2026-09-19",
  },
  {
    id: "reg-104",
    market: "ID",
    title: "印尼音视频产品强制 SNI 认证落地",
    titleEn: "Indonesia Mandatory SNI Certification for Audio-Video Products",
    publishDate: "2024-11-13",
    effectiveDate: "2025-06-02",
    affectedCategories: ["音视频产品", "电视", "音箱", "机顶盒", "车载音响"],
    affectedCategoriesEn: ["Audio-Video Products", "Televisions", "Speakers", "Set-top Boxes", "Car Head Units"],
    summary:
      "印尼工业部第 75/2024 号法规自 2025 年 6 月 2 日起强制实施 SNI IEC 62368-1:2014，覆盖 55 英寸及以下 LCD/CRT 电视、DVD/蓝光播放器、车载音响主机、有源音箱与电视机顶盒。常规认证为 Type 5（有效期 5 年），需完成产线审核并落实 ISO 9001 或 IATF 16949；小微企业可按批次申请 Type 1n。",
    summaryEn:
      "Indonesia's Minister of Industry Regulation 75/2024 makes SNI IEC 62368-1:2014 mandatory from 2 June 2025 for LCD/CRT televisions up to 55 inches, DVD/Blu-ray players, car head units, powered speakers and set-top boxes. Regular certification uses Type 5 (five-year validity) with a factory audit and ISO 9001 or IATF 16949 in place; small enterprises may use lot-based Type 1n.",
    sourceAgency: "印尼工业部",
    sourceAgencyEn: "Indonesia Ministry of Industry",
    sourceUrl: "https://jdih.setneg.go.id/",
    riskLevel: "high",
    changeType: "new",
    status: "已发布",
    statusEn: "Published",
    businessImpact:
      "音视频类目出口印尼需要提前排产线与样品测试；清关与平台提交都会核验 SNI 证书与 SPPT-SNI，缺证的批次面临扣留与处罚。",
    businessImpactEn:
      "Audio-video exports to Indonesia need factory audit and sample testing scheduled ahead; customs and marketplaces check the SNI certificate and SPPT-SNI, and uncertified lots face holds and penalties.",
    requirements: ["取得 SNI IEC 62368-1:2014 证书与 SPPT-SNI", "产线具备 ISO 9001 或 IATF 16949", "产品与包装标注 SNI 标志"],
    requirementsEn: [
      "Obtain the SNI IEC 62368-1:2014 certificate and SPPT-SNI",
      "Hold ISO 9001 or IATF 16949 at the factory",
      "Mark products and packaging with the SNI mark",
    ],
    recommendedActions: ["按 HS 编码确认产品是否在强制范围", "预留 3-6 个月认证周期", "把证书编号写入 listing 与清关资料"],
    recommendedActionsEn: [
      "Check the HS code against the mandatory scope",
      "Allow three to six months for certification",
      "Put certificate numbers on listings and customs documents",
    ],
    lastVerifiedAt: "2026-09-19",
  },
  {
    id: "reg-105",
    market: "MY",
    title: "马来西亚发布跨境数据传输指南",
    titleEn: "Malaysia Issues Cross-Border Personal Data Transfer Guidelines",
    publishDate: "2025-04-29",
    effectiveDate: "2025-04-29",
    affectedCategories: ["跨境服务", "电商发货", "云服务", "SaaS"],
    affectedCategoriesEn: ["Cross-border Services", "E-commerce Fulfilment", "Cloud Services", "SaaS"],
    summary:
      "马来西亚个人数据保护专员发布第 3/2025 号《跨境个人数据传输指南》，配合 2025 年 4 月 1 日生效的 PDPA 修订：数据出境需目的国法律实质相似或提供同等保护，并通过传输影响评估（TIA）验证，评估结论有效期不超过 3 年；也可依同意、合同必要、BCR/SCC 等替代依据传输，并保留传输记录。",
    summaryEn:
      "Malaysia's Personal Data Protection Commissioner issued Guidelines No. 3/2025 on cross-border personal data transfer, alongside PDPA amendments in force from 1 April 2025: transfers require a substantially similar law or equivalent protection verified by a Transfer Impact Assessment valid for no more than three years, or another ground such as consent, contractual necessity, BCRs or SCCs, with transfer records maintained.",
    sourceAgency: "马来西亚个人数据保护局 JPDP",
    sourceAgencyEn: "Malaysia Department of Personal Data Protection (JPDP)",
    sourceUrl: "https://www.pdp.gov.my/",
    riskLevel: "medium",
    changeType: "new",
    status: "已发布",
    statusEn: "Published",
    businessImpact: "把马来西亚用户数据回传区域中心或国内系统的链路需要补 TIA 与合同条款，否则属于无依据出境。",
    businessImpactEn:
      "Routes that send Malaysian user data to regional or home-country systems need a TIA and contractual clauses, or the transfer lacks a lawful ground.",
    requirements: ["对主要出境链路完成 TIA", "合同纳入 SCC/BCR 或同等条款", "维护跨境传输记录台账"],
    requirementsEn: [
      "Complete a TIA for each main transfer route",
      "Include SCC/BCR or equivalent clauses in contracts",
      "Maintain a cross-border transfer register",
    ],
    recommendedActions: ["列出马来西亚数据出境清单", "安排 TIA 并设定 3 年复评提醒", "更新供应商数据处理协议"],
    recommendedActionsEn: [
      "List every Malaysian data export route",
      "Run the TIA and set a three-year review reminder",
      "Update supplier data processing agreements",
    ],
    lastVerifiedAt: "2026-09-19",
  },
  {
    id: "reg-106",
    market: "SA",
    title: "沙特个人数据保护法合规宽限期结束",
    titleEn: "Saudi PDPL Compliance Grace Period Ends",
    publishDate: "2021-09-16",
    effectiveDate: "2024-09-14",
    affectedCategories: ["跨境服务", "SaaS", "电商发货", "智能设备"],
    affectedCategoriesEn: ["Cross-border Services", "SaaS", "E-commerce Fulfilment", "Smart Devices"],
    summary:
      "沙特《个人数据保护法》（皇家法令 M/19）2023 年 9 月 14 日生效，一年合规宽限期于 2024 年 9 月 14 日结束。法律对处理沙特境内个人数据（含境外主体处理在沙特居民数据）设域外效力，要求明确同意、泄露通报，并对跨境传输设条件；配套的云优先政策要求政府数据留在境内。",
    summaryEn:
      "Saudi Arabia's Personal Data Protection Law (Royal Decree M/19) took effect on 14 September 2023; the one-year compliance grace period ended on 14 September 2024. It applies extraterritorially to processing of residents' data, requires clear consent and breach notification, conditions cross-border transfers, and pairs with a Cloud First policy keeping government data in country.",
    sourceAgency: "沙特数据与人工智能管理局 SDAIA",
    sourceAgencyEn: "Saudi Data & AI Authority (SDAIA)",
    sourceUrl: "https://sdaia.gov.sa/en/sdaia/about/pages/regulationsandpolicies.aspx",
    riskLevel: "high",
    changeType: "enforcement",
    status: "执法窗口临近",
    statusEn: "Enforcement window approaching",
    businessImpact: "面向沙特市场的 SaaS 与智能硬件需要补齐同意、泄露通报与跨境传输评估；政府类客户还会要求数据驻留境内。",
    businessImpactEn:
      "SaaS and connected hardware sold into Saudi Arabia need consent, breach notification and transfer assessments; government-linked customers additionally require in-country data residency.",
    requirements: ["建立同意与隐私告知记录", "评估跨境传输的合法依据", "准备数据泄露通报流程"],
    requirementsEn: [
      "Keep consent and privacy notice records",
      "Assess the lawful basis for cross-border transfer",
      "Prepare a breach notification process",
    ],
    recommendedActions: ["对沙特用户数据做分类分级", "与本地云或数据中心确认驻留方案", "更新阿拉伯语隐私政策"],
    recommendedActionsEn: [
      "Classify and grade Saudi user data",
      "Confirm residency options with a local cloud or data centre",
      "Refresh the Arabic privacy notice",
    ],
    lastVerifiedAt: "2026-09-19",
  },
  {
    id: "reg-107",
    market: "CN",
    title: "两用物项出口管制条例正式施行",
    titleEn: "China's Dual-Use Items Export Control Regulations Take Effect",
    publishDate: "2024-10-19",
    effectiveDate: "2024-12-01",
    affectedCategories: ["电子元器件", "机械设备", "锂电与材料", "传感器", "技术授权"],
    affectedCategoriesEn: ["Electronic Components", "Machinery", "Batteries & Materials", "Sensors", "Technology Licensing"],
    summary:
      "国务院令第 792 号《两用物项出口管制条例》2024 年 12 月 1 日施行，整合此前分散的核、导弹、生物、化学品等出口管制规定。条例落地全面管辖（catch-all）与再出口管辖，设立关注名单与管控名单，并要求第三方服务商履行报告义务。",
    summaryEn:
      "State Council Decree No. 792, the Dual-Use Items Export Control Regulations, took effect on 1 December 2024, consolidating previously scattered nuclear, missile, biological and chemical export controls. They introduce catch-all and re-export jurisdiction, watchlists and control lists, and reporting duties for third-party service providers.",
    sourceAgency: "商务部",
    sourceAgencyEn: "Ministry of Commerce",
    sourceUrl: "https://www.gov.cn/zhengce/content/202410/content_6981399.htm",
    riskLevel: "critical",
    changeType: "new",
    status: "已发布",
    statusEn: "Published",
    businessImpact:
      "涉及受控物项、技术资料或境外再出口的订单需要前置许可评估；平台、货代与金融机构也被纳入报告义务范围。",
    businessImpactEn:
      "Orders involving controlled items, technical data or re-export need upfront licence assessment; platforms, freight forwarders and financial institutions also carry reporting duties.",
    requirements: ["建立物项分类与清单比对记录", "收集最终用户/最终用途证明", "特殊物项出口前取得许可证"],
    requirementsEn: [
      "Keep item classification and list-screening records",
      "Collect end-user and end-use evidence",
      "Obtain a licence before shipping controlled items",
    ],
    recommendedActions: ["把出口管制筛查前移到报价与合同阶段", "对受控技术资料做访问与传输管控", "培训销售与客服的识别口径"],
    recommendedActionsEn: [
      "Move export-control screening to quotation and contracting",
      "Control access and transfer of controlled technical data",
      "Train sales and support on screening red flags",
    ],
    lastVerifiedAt: "2026-09-19",
  },
  {
    id: "reg-108",
    market: "CN",
    title: "禁止出口限制出口技术目录调整（锂电与镓提取）",
    titleEn: "China Adjusts the Catalogue of Technologies Prohibited or Restricted from Export",
    publishDate: "2025-07-15",
    effectiveDate: "2025-07-15",
    affectedCategories: ["锂电与材料", "动力电池", "有色金属", "技术授权"],
    affectedCategoriesEn: ["Batteries & Materials", "EV Batteries", "Non-ferrous Metals", "Technology Licensing"],
    summary:
      "商务部、科技部公告 2025 年第 28 号调整《中国禁止出口限制出口技术目录》，自公布之日起实施：新增电池正极材料制备技术（磷酸铁锂、磷酸锰铁锂等控制要点），在有色金属冶金技术项下新增锂辉石提锂、金属锂制备、卤水提锂等控制要点，并修改从氧化铝母液提取金属镓的工艺要求。",
    summaryEn:
      "MOFCOM and MOST Announcement No. 28 of 2025 amends the Catalogue of Technologies Prohibited or Restricted from Export with immediate effect: adding battery cathode material preparation technology (LFP, LMFP control points), new lithium-extraction and lithium-metal control points under non-ferrous metallurgy, and revised requirements for extracting gallium from alumina mother liquor.",
    sourceAgency: "商务部 / 科技部",
    sourceAgencyEn: "Ministry of Commerce / Ministry of Science and Technology",
    sourceUrl: "https://www.mofcom.gov.cn/zcfb/zgdwjjmywg/art/2025/art_67e2a41850ec428eb1b7be6ec2f2bded.html",
    riskLevel: "critical",
    changeType: "revision",
    status: "已发布",
    statusEn: "Published",
    businessImpact:
      "涉及锂电正极材料、提锂工艺与镓提取技术的对外技术授权、产线输出与合作研发需要办理出口许可，未经许可不得出口。",
    businessImpactEn:
      "Outbound licensing, production-line export and joint R&D involving cathode materials, lithium extraction and gallium processes now require an export licence.",
    requirements: ["比对目录条目确认技术是否受限", "技术出口合同办理许可或登记", "对技术资料的对外提供做审批留痕"],
    requirementsEn: [
      "Check the catalogue entries against the technology being exported",
      "File a licence or registration for technology export contracts",
      "Keep approval records for sharing technical data abroad",
    ],
    recommendedActions: ["梳理在谈的海外技术合作项目", "把目录比对加入合同评审清单", "对外发送技术资料前做许可确认"],
    recommendedActionsEn: [
      "Review overseas technology cooperation in the pipeline",
      "Add catalogue screening to contract review",
      "Confirm licensing before sending technical data abroad",
    ],
    lastVerifiedAt: "2026-09-19",
  },
  {
    id: "reg-109",
    market: "CN",
    title: "GB 44495-2024 整车信息安全强制标准实施在即",
    titleEn: "GB 44495-2024 Vehicle Cybersecurity Standard Nears Application",
    publishDate: "2024-08-23",
    effectiveDate: "2026-01-01",
    affectedCategories: ["智能网联车", "车载电子", "汽车零部件", "软件升级"],
    affectedCategoriesEn: ["Connected Vehicles", "Automotive Electronics", "Auto Parts", "Software Updates"],
    summary:
      "GB 44495-2024《汽车整车信息安全技术要求》于 2024 年 8 月 23 日批准发布，新申请型式批准的车型自 2026 年 1 月 1 日起执行，已获批准的车型自 2028 年 1 月 1 日起执行。标准与 UN R155/R156 协调，覆盖外部连接安全、通信安全、软件升级安全、数据安全与远程控制等要求。",
    summaryEn:
      "GB 44495-2024 Technical requirements for vehicle cybersecurity was approved on 23 August 2024; it applies to newly type-approved models from 1 January 2026 and to already-approved models from 1 January 2028. Aligned with UN R155/R156, it covers external connection, communication, software update, data and remote-control security.",
    sourceAgency: "工业和信息化部 / 国家标准化管理委员会",
    sourceAgencyEn: "Ministry of Industry and Information Technology / SAC",
    sourceUrl: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=2DB552CAA58F589705C3DC7AD47AC2AB",
    riskLevel: "high",
    changeType: "new",
    status: "过渡期",
    statusEn: "Transition period",
    businessImpact:
      "出口与国内在售车型都要面对双轨审核：既要满足 GB 44495，又要满足 UN R155/R156，主机厂需向下穿透供应商的合规证据。",
    businessImpactEn:
      "Both export and domestic models face dual-track review — GB 44495 plus UN R155/R156 — and OEMs must cascade evidence requirements to suppliers.",
    requirements: ["建立信息安全管理体系与 TARA", "软件升级（含 OTA）安全设计与记录", "供应商合规证据链路"],
    requirementsEn: [
      "Establish a cybersecurity management system and TARA",
      "Design and record secure software updates including OTA",
      "Cascade compliance evidence through suppliers",
    ],
    recommendedActions: ["按新申请/已批准两个时间点倒排认证计划", "与 UN R155 认证证据复用", "对关键 ECU 供应商补充安全条款"],
    recommendedActionsEn: [
      "Plan certification against the two application dates",
      "Reuse evidence from UN R155 certification",
      "Add security clauses for key ECU suppliers",
    ],
    lastVerifiedAt: "2026-09-19",
  },
  {
    id: "reg-110",
    market: "EU",
    title: "欧盟人工智能法分阶段适用",
    titleEn: "EU AI Act Enters Into Application in Stages",
    publishDate: "2024-07-12",
    effectiveDate: "2024-08-01",
    affectedCategories: ["跨境服务", "SaaS", "智能设备", "游戏与内容"],
    affectedCategoriesEn: ["Cross-border Services", "SaaS", "Smart Devices", "Games & Content"],
    summary:
      "《欧盟人工智能法》（Regulation (EU) 2024/1689）2024 年 8 月 1 日生效并分阶段适用：禁止性条款自 2025 年 2 月起适用，通用人工智能模型义务自 2025 年 8 月起适用，高风险系统主要义务自 2026 年 8 月起适用。面向欧盟提供含 AI 功能的产品需要按角色（提供者/部署者）履行透明、风险评估与技术文档义务。",
    summaryEn:
      "The EU AI Act (Regulation (EU) 2024/1689) entered into force on 1 August 2024 and applies in stages: prohibitions from February 2025, general-purpose AI model duties from August 2025, and the main high-risk obligations from August 2026. Products with AI features placed on the EU market must meet transparency, risk assessment and technical documentation duties according to their provider or deployer role.",
    sourceAgency: "欧盟委员会",
    sourceAgencyEn: "European Commission",
    sourceUrl: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
    riskLevel: "high",
    changeType: "new",
    status: "分阶段实施",
    statusEn: "Phased application",
    businessImpact:
      "带 AI 功能的硬件与 App 需要先做角色与风险分级，再补齐技术文档、透明告知与人工监督设计；高风险场景还会牵动 CE 与技术文档审查。",
    businessImpactEn:
      "AI-enabled hardware and apps need a role and risk classification first, then technical documentation, transparency notices and human-oversight design; high-risk uses also trigger CE and documentation review.",
    requirements: ["确认 AI 角色与风险等级", "准备技术文档与透明告知", "落实人工监督与日志留存"],
    requirementsEn: [
      "Determine the AI role and risk tier",
      "Prepare technical documentation and transparency notices",
      "Implement human oversight and log retention",
    ],
    recommendedActions: ["盘点产品中的 AI 功能清单", "按 2026 年 8 月节点排期高风险项", "把 AI 条款纳入供应商合同"],
    recommendedActionsEn: [
      "Inventory AI features across the product line",
      "Schedule high-risk items against the August 2026 deadline",
      "Add AI clauses to supplier contracts",
    ],
    lastVerifiedAt: "2026-09-19",
  },
  {
    id: "reg-111",
    market: "US",
    title: "INFORM 消费者法案平台核验义务生效",
    titleEn: "INFORM Consumers Act Marketplace Verification Duties",
    publishDate: "2022-12-29",
    effectiveDate: "2023-06-27",
    affectedCategories: ["电商发货", "消费品", "家居用品", "消费电子"],
    affectedCategoriesEn: ["E-commerce Fulfilment", "Consumer Goods", "Home Goods", "Consumer Electronics"],
    summary:
      "美国《INFORM 消费者法案》要求在线交易平台对高销量第三方卖家收集、核验并披露身份与联系信息（含银行账户、税务标识）。平台未履行义务将面临按次民事罚款；卖家侧则需保持主体信息、银行账户与联系方式的一致性，否则可能被暂停销售。",
    summaryEn:
      "The INFORM Consumers Act requires online marketplaces to collect, verify and disclose identity and contact information — including bank account and tax identifiers — for high-volume third-party sellers. Non-compliance exposes marketplaces to per-violation civil penalties, while sellers must keep entity, bank and contact details consistent or risk suspension.",
    sourceAgency: "美国联邦贸易委员会 FTC",
    sourceAgencyEn: "U.S. Federal Trade Commission (FTC)",
    sourceUrl: "https://www.ftc.gov/business-guidance/resources/INFORMAct",
    riskLevel: "medium",
    changeType: "enforcement",
    status: "执法窗口临近",
    statusEn: "Enforcement window approaching",
    businessImpact: "多店铺、多主体的卖家若资料不一致或长期不回应平台核验，可能被暂停销售甚至冻结款项。",
    businessImpactEn:
      "Sellers running multiple stores or entities with inconsistent records — or ignoring marketplace verification requests — risk suspension or frozen payouts.",
    requirements: ["主体信息与银行账户保持一致", "及时响应平台年度核验", "在店铺页面披露要求的联系信息"],
    requirementsEn: [
      "Keep entity information aligned with the bank account",
      "Respond to annual marketplace verification",
      "Display required contact details on the storefront",
    ],
    recommendedActions: ["建立店铺-主体-账户对照表", "指定核验响应责任人", "变更主体时同步更新平台资料"],
    recommendedActionsEn: [
      "Maintain a store-to-entity-to-account mapping",
      "Assign an owner for verification responses",
      "Update marketplace records whenever the entity changes",
    ],
    lastVerifiedAt: "2026-09-19",
  },
  {
    id: "reg-112",
    market: "UN",
    title: "UN R155/R156 在欧盟全面适用",
    titleEn: "UN R155/R156 Fully Apply in the EU",
    publishDate: "2021-01-22",
    effectiveDate: "2024-07-07",
    affectedCategories: ["智能网联车", "车载电子", "软件升级", "汽车零部件"],
    affectedCategoriesEn: ["Connected Vehicles", "Automotive Electronics", "Software Updates", "Auto Parts"],
    summary:
      "联合国 WP.29 的 UN R155（网络安全管理体系 CSMS）与 UN R156（软件升级管理体系 SUMS）2021 年 1 月 22 日生效；欧盟自 2022 年 7 月起适用于新车型式批准，自 2024 年 7 月 7 日起适用于所有新注册车辆。主机厂须取得 CSMS/SUMS 证书并按车型取得型式批准，OTA 更新若改变安全要素需重新认证。",
    summaryEn:
      "UNECE WP.29's UN R155 (cyber security management system) and UN R156 (software update management system) entered into force on 22 January 2021; the EU applied them to new type approvals from July 2022 and to all newly registered vehicles from 7 July 2024. Manufacturers need CSMS/SUMS certificates plus per-type approval, and OTA updates changing safety elements require re-certification.",
    sourceAgency: "联合国欧洲经济委员会 UNECE WP.29",
    sourceAgencyEn: "UNECE World Forum WP.29",
    sourceUrl: "https://www.vehicle-certification-agency.gov.uk/connected-and-automated-vehicles/cyber-security-and-software-updating/",
    riskLevel: "critical",
    changeType: "enforcement",
    status: "持续有效",
    statusEn: "In force",
    businessImpact:
      "整车出口欧盟必须持有 CSMS/SUMS 证书；供应商需要按主机厂要求提供渗透测试、威胁分析与软件版本标识（RXSWIN）等证据。",
    businessImpactEn:
      "Vehicle exports to the EU require CSMS/SUMS certificates; suppliers must provide penetration tests, threat analysis and software identification (RXSWIN) evidence to OEMs.",
    requirements: ["取得 CSMS 与 SUMS 证书", "按车型完成型式批准", "OTA 变更安全要素时重新认证"],
    requirementsEn: [
      "Obtain CSMS and SUMS certificates",
      "Complete type approval per vehicle type",
      "Re-certify when OTA changes safety elements",
    ],
    recommendedActions: ["把 CSMS/SUMS 证据要求写进供应商合同", "建立软件版本与更新记录台账", "对关键供应商做年度审计"],
    recommendedActionsEn: [
      "Write CSMS/SUMS evidence requirements into supplier contracts",
      "Keep software version and update records",
      "Run annual audits of critical suppliers",
    ],
    lastVerifiedAt: "2026-09-19",
  },
];
