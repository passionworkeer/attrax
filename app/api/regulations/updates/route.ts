import { NextRequest, NextResponse } from "next/server";

// Mock data for regulation updates
const regulationUpdates = [
  {
    id: "reg-001",
    market: "EU",
    title: "REACH 修订案关于 SVHC 清单更新",
    titleEn: "REACH Amendment: SVHC List Update",
    publishDate: "2026-05-10",
    effectiveDate: "2026-07-01",
    affectedCategories: ["Electronics", "Toys", "Furniture"],
    summary: "欧盟化学品管理局(ECHA)宣布在SVHC候选清单中新增3种物质，主要涉及电子产品和玩具制造业。",
    summaryEn: "ECHA announces addition of 3 new substances to SVHC candidate list, primarily affecting electronics and toy manufacturing.",
    sourceUrl: "https://echa.europa.eu/candidate-list-en",
  },
  {
    id: "reg-002",
    market: "US",
    title: "CPSIA 铅含量限值更新",
    titleEn: "CPSIA Lead Content Limit Update",
    publishDate: "2026-05-08",
    effectiveDate: "2026-06-01",
    affectedCategories: ["Toys", "Children's Products"],
    summary: "美国消费品安全委员会(CPSC)更新了儿童产品中铅含量的限值要求，进一步降低允许上限。",
    summaryEn: "CPSC updates lead content limits in children's products, further reducing allowable thresholds.",
    sourceUrl: "https://www.cpsc.gov/Regulations-Laws--Standards/Rulemaking/Final",
  },
  {
    id: "reg-003",
    market: "CN",
    title: "出口管制法实施细则发布",
    titleEn: "Export Control Law Implementation Rules Released",
    publishDate: "2026-05-05",
    effectiveDate: "2026-06-15",
    affectedCategories: ["Electronics", "Machinery", "Dual-use Items"],
    summary: "商务部发布《中华人民共和国出口管制法》实施细则，对管制物项清单和许可程序进行了详细规定。",
    summaryEn: "Ministry of Commerce releases implementation rules for Export Control Law, detailing control list and licensing procedures.",
    sourceUrl: "https://www.mofcom.gov.cn/",
  },
  {
    id: "reg-004",
    market: "EU",
    title: "RoHS 3.0 限制物质清单扩展",
    titleEn: "RoHS 3.0 Restricted Substances List Expanded",
    publishDate: "2026-04-28",
    effectiveDate: "2026-10-01",
    affectedCategories: ["Electronics", "Home Appliances", "Lighting"],
    summary: "欧盟委员会发布RoHS指令修订提案，计划新增4种限制物质并收紧部分现有限值。",
    summaryEn: "EU Commission publishes RoHS directive amendment proposal, planning to add 4 new restricted substances and tighten existing limits.",
    sourceUrl: "https://ec.europa.eu/environment/waste/rohs_eee/index_en.htm",
  },
  {
    id: "reg-005",
    market: "UK",
    title: "UKCA 标志强制执行时间表更新",
    titleEn: "UKCA Marking Enforcement Schedule Updated",
    publishDate: "2026-04-25",
    effectiveDate: "2026-12-31",
    affectedCategories: ["Electronics", "Machinery", "Medical Devices"],
    summary: "英国政府更新了UKCA标志强制执行的时间表，为企业提供更长的过渡期。",
    summaryEn: "UK government updates UKCA marking enforcement schedule, providing longer transition period for businesses.",
    sourceUrl: "https://www.gov.uk/guidance/using-the-ukca-marking",
  },
  {
    id: "reg-006",
    market: "AE",
    title: "阿联酋低电压设备法规更新",
    titleEn: "UAE Low Voltage Equipment Regulation Update",
    publishDate: "2026-04-20",
    effectiveDate: "2026-08-01",
    affectedCategories: ["Electronics", "Home Appliances"],
    summary: "阿联酋标准化与计量局(ESMA)更新了低电压设备的合规要求，增加了能效标签要求。",
    summaryEn: "UAE's ESMA updates compliance requirements for low voltage equipment, adding energy efficiency labeling requirements.",
    sourceUrl: "https://www.esma.gov.ae/",
  },
  {
    id: "reg-007",
    market: "SA",
    title: "沙特SASO认证体系改革",
    titleEn: "Saudi SASO Certification System Reform",
    publishDate: "2026-04-15",
    effectiveDate: "2026-07-01",
    affectedCategories: ["Electronics", "Textiles", "Food Products"],
    summary: "沙特标准、计量与质量组织(SASO)宣布改革认证流程，引入在线电子服务系统。",
    summaryEn: "Saudi SASO announces certification process reform, introducing online electronic service system.",
    sourceUrl: "https://www.saso.gov.sa/",
  },
  {
    id: "reg-008",
    market: "AU",
    title: "澳大利亚产品安全法规现代化",
    titleEn: "Australia Product Safety Regulation Modernization",
    publishDate: "2026-04-10",
    effectiveDate: "2026-09-01",
    affectedCategories: ["Toys", "Consumer Electronics", "Furniture"],
    summary: "澳大利亚竞争与消费者委员会(ACCC)启动产品安全法规现代化计划，加强在线销售产品监管。",
    summaryEn: "ACCC launches product safety regulation modernization, strengthening oversight of online sales products.",
    sourceUrl: "https://www.productsafety.gov.au/",
  },
];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const market = searchParams.get("market");
  const search = searchParams.get("search");
  const limit = parseInt(searchParams.get("limit") || "20");

  let filteredRegulations = regulationUpdates;

  // Filter by market
  if (market && market !== "all") {
    filteredRegulations = filteredRegulations.filter(
      (reg) => reg.market.toLowerCase() === market.toLowerCase()
    );
  }

  // Filter by search query
  if (search) {
    const searchLower = search.toLowerCase();
    filteredRegulations = filteredRegulations.filter(
      (reg) =>
        reg.title.toLowerCase().includes(searchLower) ||
        reg.titleEn.toLowerCase().includes(searchLower) ||
        reg.summary.toLowerCase().includes(searchLower) ||
        reg.summaryEn.toLowerCase().includes(searchLower)
    );
  }

  // Limit results
  filteredRegulations = filteredRegulations.slice(0, limit);

  return NextResponse.json({
    success: true,
    data: filteredRegulations,
    total: regulationUpdates.length,
    filtered: filteredRegulations.length,
  });
}