import { PROFIT_FEATURE_ENABLED } from "@/lib/product-scope";
import type { BlazeLocale } from "@/components/blaze-hawks/locale";
import { getBlazeCopy } from "@/lib/mock/blaze-copy";

const replacements: Array<[RegExp, string]> = [
  [/Blaze Hawks/g, "CompliPilot"],
  [/火鹰合规/g, "规航AI"],
  [/想出海？先烧毁！/g, "先合规，再出海"],
  [/开始烧毁/g, "开始检测"],
  [/烧毁完成/g, "扫描完成"],
  [/烧毁/g, "扫描"],
  [/智能拆解/g, "智能识别"],
  [/火焰热点/g, "风险坐标"],
  [/火焰等级/g, "风险等级"],
  [/火焰可视化/g, "风险可视化"],
  [/火焰风险/g, "合规风险"],
  [/火焰/g, "风险"],
  [/利润结果/g, "成本影响"],
  [/利润测算/g, "成本测算"],
  [/利润看板/g, "成本看板"],
  [/利润分析/g, "成本分析"],
  [/利润恢复/g, "成本优化"],
  [/吞掉利润/g, "放大损失"],
  [/Start Burn/g, "Start Scan"],
  [/Burn Before You Fly\./g, "Comply Before You Expand."],
  [/Burn it Down first!/g, "Comply before you expand!"],
  [/Fire hotspots/g, "Risk coordinates"],
  [/Flame Hotspots/g, "Risk Coordinates"],
  [/flame level/gi, "risk level"],
  [/Burning/g, "Scanning"],
];

export function toCompliPilotText(value: string) {
  return replacements.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value
  );
}

export function toCompliPilotValue<T>(value: T): T {
  return JSON.parse(toCompliPilotText(JSON.stringify(value))) as T;
}

export function getCompliPilotCopy(locale: BlazeLocale) {
  const copy = toCompliPilotValue(getBlazeCopy(locale));
  if (!PROFIT_FEATURE_ENABLED) {
    const t = (zh: string, en: string) => locale === "zh" ? zh : en;
    copy.burning.body = t("分析产品照片中的标识与警示，匹配法规依据并整理证据缺口。", "Review product labels and warnings, match regulatory evidence and identify missing information.");
    copy.burning.autoJump = t("正在整理图像证据与合规报告，完成后自动进入结果页。", "Preparing visual evidence and the compliance report. Results will open when ready.");
    copy.burning.insightCards = [
      { title: t("产品识别", "Product recognition"), body: t("识别产品主体、铭牌与包装。", "Identify the product, label and packaging.") },
      { title: t("法规依据", "Regulatory evidence"), body: t("将检查项与可追溯的法规来源关联。", "Link inspection items to traceable regulatory sources.") },
      { title: t("整改建议", "Remediation guidance"), body: t("明确缺少哪些照片、文件或标识。", "Identify missing photos, documents and labels.") },
    ];
    copy.burning.analysisSteps = copy.burning.analysisSteps.map(step => ({ ...step, description: /成本|cost/i.test(step.description) ? t("整理检查结果与可下载报告。", "Prepare inspection results and downloadable reports.") : step.description }));
    copy.result.interactive = t("图像证据与标识定位", "Visual evidence and label locations");
    copy.result.summary = t("已整理图像观察、法规依据与整改建议，请逐项核对证据。", "Visual observations, regulatory sources and suggested actions are ready for review.");
    copy.result.sessionBriefBody = t("先看结论，再核对证据，最后按清单补充资料或整改。", "Review the findings, check the evidence, then complete the requested information or remediation.");
    copy.result.sessionBrief = t("风险、证据与整改建议", "Risks, evidence and remediation");
    copy.result.interactiveBody = t("在产品原图上核对风险位置、标识与法规依据。", "Review risk locations, labels and regulatory evidence on the original photos.");
    copy.result.exportBody = t("导出合规报告与整改路线图，便于复核及后续执行。", "Export the compliance report and remediation roadmap for review and follow-up.");
  }
  return copy;
}
