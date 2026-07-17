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
  return toCompliPilotValue(getBlazeCopy(locale));
}
