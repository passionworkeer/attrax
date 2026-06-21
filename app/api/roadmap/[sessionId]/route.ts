import { getSession } from "@/lib/pipeline/session-store";
import { serverT } from "@/lib/server-i18n";
import { ok, fail } from "@/lib/api-response";
import { requireSessionAccess } from "@/app/api/session-access";
import { SessionIdSchema } from "@/lib/schemas";
import { englishText } from "@/lib/report-localization";
import type { ReportPackage } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;

  if (!SessionIdSchema.safeParse(sessionId).success) {
    return fail(
      { code: "NOT_FOUND", message: serverT("errors.sessionNotFound", "zh") },
      { status: 404 }
    );
  }

  const session = getSession(sessionId);
  if (!session) {
    return fail(
      { code: "NOT_FOUND", message: serverT("errors.sessionNotFound", "zh") },
      { status: 404 }
    );
  }

  const denied = requireSessionAccess(request, session);
  if (denied) return denied;

  const result = session.result;
  if (!result) {
    return fail(
      { code: "NOT_READY", message: serverT("errors.resultNotReady", "zh") },
      { status: 404 }
    );
  }

  // Extract product and market info
  const product = (result as { productName?: string; product?: string }).productName
    || (result as { product?: string }).product
    || "产品";
  const productEn = englishText(
    (result as { productNameEn?: string; product_name_en?: string; product?: string }).productNameEn
      || (result as { product_name_en?: string }).product_name_en
      || product,
    "this product"
  );
  const targetMarkets = (result as { targetMarkets?: string[] }).targetMarkets || ["EU"];
  const complianceScore = (result as { complianceScore?: number }).complianceScore || 85;

  // Determine compliance status and generate roadmap items
  const complianceStatus = (result as { complianceStatus?: string }).complianceStatus || "UNKNOWN";
  const packagedRoadmap = _getReportPackage(result)?.roadmap;

  if (packagedRoadmap?.items?.length) {
    return ok({
      sessionId,
      product,
      productEn,
      markets: targetMarkets,
      complianceScore,
      complianceStatus,
      totalDays: packagedRoadmap.totalDays ?? packagedRoadmap.total_days ?? (complianceScore >= 80 ? 42 : complianceScore >= 60 ? 56 : 70),
      progress: packagedRoadmap.progress ?? Math.round((complianceScore / 100) * 100),
      totalCost: packagedRoadmap.totalCost ?? packagedRoadmap.total_cost ?? _estimateTotalCost(complianceScore, targetMarkets),
      items: _normalizeRoadmapItems(packagedRoadmap.items),
    });
  }

  // Generate timeline based on compliance score
  const totalDays = complianceScore >= 80 ? 42 : complianceScore >= 60 ? 56 : 70;
  const progress = Math.round((complianceScore / 100) * 100);

  // Generate roadmap steps based on product and markets
  const roadmapItems = _generateRoadmapItems(product, productEn, targetMarkets, complianceScore);

  // Calculate total cost based on compliance needs
  const totalCost = _estimateTotalCost(complianceScore, targetMarkets);

  return ok({
    sessionId,
    product,
    productEn,
    markets: targetMarkets,
    complianceScore,
    complianceStatus,
    totalDays,
    progress,
    totalCost,
    items: roadmapItems,
  });
}

function _generateRoadmapItems(
  product: string,
  productEn: string,
  markets: string[],
  score: number
) {
  const now = new Date();

  const items = [
    {
      id: "1",
      date: now.toISOString().split("T")[0],
      title: "合规评估完成",
      titleEn: "Compliance Assessment Complete",
      description: "AI 系统完成初步合规评估，生成风险报告和改进建议",
      descriptionEn: "AI system completes initial compliance assessment",
      type: "complete" as const,
      status: "completed" as const,
      estimatedDays: 0,
    },
    {
      id: "2",
      date: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      title: "准备申请材料",
      titleEn: "Prepare Application Materials",
      description: `收集 ${product} 的产品规格、技术文档、测试报告等申请所需材料`,
      descriptionEn: `Gather product specifications and technical documents for ${productEn}`,
      type: "apply" as const,
      status: score >= 70 ? "pending" : "in-progress" as const,
      estimatedDays: 7,
      documents: ["产品规格书", "电路原理图", "BOM清单", "说明书"],
      documentsEn: ["Product Specs", "Circuit Schematics", "BOM", "User Manual"],
    },
    {
      id: "3",
      date: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      title: "选择认证机构",
      titleEn: "Select Certification Body",
      description: `根据目标市场 ${markets.join(", ")} 选择合适的认证机构`,
      descriptionEn: `Select appropriate certification body based on target markets`,
      type: "certify" as const,
      status: "pending" as const,
      estimatedDays: 7,
      cost: "¥5,000-15,000",
    },
    {
      id: "4",
      date: new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      title: "产品检测",
      titleEn: "Product Testing",
      description: `在认证机构实验室进行安全、EMC、环境等测试`,
      descriptionEn: "Conduct safety, EMC, and environmental tests",
      type: "test" as const,
      status: "pending" as const,
      estimatedDays: 21,
      cost: score >= 80 ? "¥10,000-20,000" : "¥20,000-40,000",
    },
    {
      id: "5",
      date: new Date(now.getTime() + 49 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      title: "获取认证证书",
      titleEn: "Obtain Certification",
      description: `测试通过后，获得 ${markets.join(", ")} 市场认证证书`,
      descriptionEn: "Receive certification after passing tests",
      type: "certify" as const,
      status: "pending" as const,
      estimatedDays: 7,
    },
    {
      id: "6",
      date: new Date(now.getTime() + 63 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      title: "合规上市销售",
      titleEn: "Compliant Market Launch",
      description: "完成所有合规要求，产品可以在目标市场合法销售",
      descriptionEn: "Complete all compliance requirements, product ready for sale",
      type: "complete" as const,
      status: "pending" as const,
    },
  ];

  return items;
}

function _estimateTotalCost(score: number, markets: string[]): string {
  const marketCount = markets.length;
  let baseCost = 15000;

  if (score < 60) {
    baseCost += 25000; // 需要更多整改
  } else if (score < 80) {
    baseCost += 10000; // 中等整改
  }

  baseCost += marketCount * 3000; // 每个市场增加认证费

  if (markets.includes("EU")) baseCost += 5000;
  if (markets.includes("US")) baseCost += 4000;
  if (markets.includes("CN")) baseCost += 3000;

  return `¥${(baseCost / 1000).toFixed(0)}K+`;
}

function _normalizeRoadmapItems(items: unknown[]) {
  const validTypes = new Set(["apply", "test", "certify", "complete"]);
  const validStatuses = new Set(["pending", "in-progress", "completed"]);

  return items.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null).map((item, index) => ({
    id: String(item.id ?? index + 1),
    date: typeof item.date === "string" ? item.date : new Date().toISOString().split("T")[0],
    title: typeof item.title === "string" ? item.title : `Step ${index + 1}`,
    titleEn: typeof item.titleEn === "string" ? item.titleEn : typeof item.title_en === "string" ? item.title_en : `Step ${index + 1}`,
    description: typeof item.description === "string" ? item.description : "",
    descriptionEn: typeof item.descriptionEn === "string" ? item.descriptionEn : typeof item.description_en === "string" ? item.description_en : "",
    type: validTypes.has(String(item.type)) ? item.type : "apply",
    status: validStatuses.has(String(item.status)) ? item.status : "pending",
    estimatedDays: typeof item.estimatedDays === "number" ? item.estimatedDays : typeof item.estimated_days === "number" ? item.estimated_days : undefined,
    cost: typeof item.cost === "string" ? item.cost : undefined,
    documents: Array.isArray(item.documents) ? item.documents.map(String) : undefined,
    documentsEn: Array.isArray(item.documentsEn)
      ? item.documentsEn.map(String)
      : Array.isArray(item.documents_en)
      ? item.documents_en.map(String)
      : undefined,
  }));
}

function _getReportPackage(result: unknown): ReportPackage | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as { reportPackage?: ReportPackage; report_package?: ReportPackage };
  return record.reportPackage ?? record.report_package;
}
