/**
 * Shared mock roadmap dataset. Consumed by:
 *   - app/roadmap/page.tsx   (fallback when /api/roadmap/[sessionId] has no items)
 *   - components/trace/ComplianceTimeline.tsx (default items)
 *
 * Keeping this in one place prevents drift between the page-level fallback
 * and the component-level default timeline. Locale is resolved at render
 * time by reading each item's title/titleEn pair.
 */

export interface RoadmapItem {
  id: string;
  date: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  type: "apply" | "test" | "certify" | "complete";
  status: "pending" | "in-progress" | "completed";
  estimatedDays?: number;
  cost?: string;
  documents?: string[];
  documentsEn?: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateOffset(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * MS_PER_DAY)
    .toISOString()
    .split("T")[0];
}

/**
 * Default 7-step compliance roadmap. Dates are derived from "now" so the
 * timeline always points into the future; this is demo data only — real
 * sessions are fetched via /api/roadmap/[sessionId].
 */
export function getDefaultRoadmapItems(): RoadmapItem[] {
  return [
    {
      id: "1",
      date: dateOffset(0),
      title: "合规评估完成",
      titleEn: "Compliance Assessment Complete",
      description:
        "AI 系统完成初步合规评估，生成风险报告和改进建议",
      descriptionEn:
        "AI system completes initial compliance assessment and generates risk report",
      type: "complete",
      status: "completed",
    },
    {
      id: "2",
      date: dateOffset(7),
      title: "准备申请材料",
      titleEn: "Prepare Application Materials",
      description: "收集产品规格、技术文档、测试报告等申请所需材料",
      descriptionEn:
        "Gather product specifications, technical documents, test reports",
      type: "apply",
      status: "pending",
      estimatedDays: 7,
      documents: ["产品规格书", "电路原理图", "BOM清单", "说明书"],
      documentsEn: ["Product Specs", "Circuit Schematics", "BOM", "User Manual"],
    },
    {
      id: "3",
      date: dateOffset(14),
      title: "选择认证机构",
      titleEn: "Select Certification Body",
      description: "根据目标市场选择合适的认证机构（如 SGS、TUV、BV 等）",
      descriptionEn:
        "Select appropriate certification body based on target market",
      type: "certify",
      status: "pending",
      estimatedDays: 7,
      cost: "¥5,000-10,000",
    },
    {
      id: "4",
      date: dateOffset(21),
      title: "提交认证申请",
      titleEn: "Submit Certification Application",
      description: "向认证机构提交申请材料，等待审核通过",
      descriptionEn:
        "Submit application to certification body, await approval",
      type: "apply",
      status: "pending",
      estimatedDays: 3,
    },
    {
      id: "5",
      date: dateOffset(35),
      title: "产品检测",
      titleEn: "Product Testing",
      description: "在认证机构实验室进行安全、EMC、环境等测试",
      descriptionEn:
        "Conduct safety, EMC, and environmental tests at certification lab",
      type: "test",
      status: "pending",
      estimatedDays: 21,
      cost: "¥15,000-30,000",
    },
    {
      id: "6",
      date: dateOffset(56),
      title: "获取认证证书",
      titleEn: "Obtain Certification",
      description: "测试通过后，获得认证证书（如 CE、FCC、CCC 等）",
      descriptionEn:
        "Receive certification certificate after passing tests",
      type: "certify",
      status: "pending",
      estimatedDays: 7,
    },
    {
      id: "7",
      date: dateOffset(63),
      title: "合规上市销售",
      titleEn: "Compliant Market Launch",
      description: "完成所有合规要求，产品可以在目标市场合法销售",
      descriptionEn:
        "Complete all compliance requirements, product ready for legal sale",
      type: "complete",
      status: "pending",
    },
  ];
}
