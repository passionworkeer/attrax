import type { GeneratedRoadmapItem, ScanResult } from "@/lib/types";

export type RemediationStatus = "pending" | "in-progress" | "completed";

export interface RemediationRoadmapRow {
  id: string;
  phase: string;
  task: string;
  status: RemediationStatus;
  time: string;
  cost: string;
  owner: string;
  output: string;
  checkId?: string;
}

export interface RemediationRoadmapModel {
  rows: RemediationRoadmapRow[];
  totalTime: string;
  roleCount: number;
  focusIndex: number;
}

const phaseLabels = {
  zh: { apply: "资料准备", test: "检测验证", certify: "认证办理", complete: "整改收尾" },
  en: { apply: "Documentation", test: "Testing", certify: "Certification", complete: "Closure" },
} as const;

const ownerLabels = {
  zh: { apply: "产品 / 采购", test: "测试 / 合规", certify: "合规 / 法务", complete: "运营 / 法务" },
  en: { apply: "Product / Procurement", test: "Testing / Compliance", certify: "Compliance / Legal", complete: "Operations / Legal" },
} as const;

const itemTypes = Object.keys(phaseLabels.zh) as (keyof typeof phaseLabels.zh)[];

function itemType(item: GeneratedRoadmapItem, index: number): keyof typeof phaseLabels.zh {
  const raw = item.type?.trim().toLowerCase();
  return raw && itemTypes.includes(raw as keyof typeof phaseLabels.zh) ? (raw as keyof typeof phaseLabels.zh) : index === 0 ? "apply" : "complete";
}

function itemStatus(value: string | undefined): RemediationStatus {
  const raw = value?.trim().toLowerCase();
  return raw === "in-progress" || raw === "completed" ? raw : "pending";
}

function localized(value: string | undefined, fallback: string | undefined, locale: "zh" | "en") {
  return locale === "en" ? value?.trim() || fallback?.trim() || "" : fallback?.trim() || value?.trim() || "";
}

const unknownCosts = /^(?:待询价|待确认|tbd|quote pending|unknown|n\/a|—|-)?$/i;

function conciseCost(value: string) {
  const range = value.match(/[¥$]\s*[\d,.]+\s*[kK]?\s*[-–—~至]\s*[\d,.]+\s*[kK]?/);
  if (range) return range[0].replace(/\s+/g, "").replace(/k/g, "K");
  return value
    .replace(/AI\s*(?:估算|estimate)\s*/gi, "")
    .split(/[；;]/, 1)[0]
    .replace(/[（(].*$/, "")
    .trim();
}

function estimatedCost(item: Pick<GeneratedRoadmapItem, "cost" | "title" | "titleEn" | "title_en" | "description" | "descriptionEn" | "description_en" | "type">, locale: "zh" | "en") {
  const supplied = item.cost?.trim() || "";
  if (!unknownCosts.test(supplied)) return conciseCost(supplied);

  const text = [item.title, item.titleEn, item.title_en, item.description, item.descriptionEn, item.description_en]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const range = (() => {
    if (/un\s?38\.3/.test(text)) return locale === "zh" ? "¥3K-8K" : "$400-1.1K";
    if (/emc|fcc|电气安全|electrical safety/.test(text)) return locale === "zh" ? "¥8K-35K" : "$1.1K-4.8K";
    if (/化学|重金属|增塑剂|迁移|chemical|phthalate|heavy metal|mechanical|物理测试/.test(text)) return locale === "zh" ? "¥5K-20K" : "$700-2.8K";
    if (/拍|照片|photo|image|upc|批次/.test(text)) return locale === "zh" ? "¥0-2K" : "$0-300";
    if (/铭牌|标签|标识|包装|说明书|label|packag|manual/.test(text)) return locale === "zh" ? "¥1.5K-5K" : "$200-700";
    if (/ce\b|rohs|认证|certif|注册|registration/.test(text) || item.type === "certify") return locale === "zh" ? "¥8K-30K" : "$1.1K-4.2K";
    if (item.type === "test") return locale === "zh" ? "¥3K-15K" : "$400-2.1K";
    return locale === "zh" ? "¥0-3K" : "$0-400";
  })();
  return range;
}

function explicitRows(result: ScanResult, locale: "zh" | "en"): RemediationRoadmapRow[] {
  const items = result.reportPackage?.roadmap?.items ?? [];
  return items.map((item, index) => {
    const type = itemType(item, index);
    const task = localized(item.titleEn ?? item.title_en, item.title, locale) || (locale === "zh" ? `整改任务 ${index + 1}` : `Remediation task ${index + 1}`);
    const description = localized(item.descriptionEn ?? item.description_en, item.description, locale);
    const documents = locale === "en" ? item.documentsEn ?? item.documents_en ?? item.documents : item.documents;
    const days = item.estimatedDays ?? item.estimated_days;
    const time = days && days > 0
      ? (locale === "zh" ? `预计 ${days} 天` : `Est. ${days} days`)
      : item.date?.trim() || (locale === "zh" ? "待评估" : "TBD");
    const cost = estimatedCost(item, locale);
    return {
      id: item.id?.trim() || `roadmap-${index + 1}`,
      phase: phaseLabels[locale][type],
      task,
      status: itemStatus(item.status),
      time,
      cost,
      owner: ownerLabels[locale][type],
      output: [description, documents?.length ? documents.join(locale === "zh" ? "、" : ", ") : ""].filter(Boolean).join(locale === "zh" ? "；" : "; ") || task,
    };
  });
}

function checklistRows(result: ScanResult, locale: "zh" | "en"): RemediationRoadmapRow[] {
  const rows: RemediationRoadmapRow[] = (result.checklist ?? []).map((item, index) => {
    const phase = locale === "en" ? item.categoryEn ?? item.category : item.category;
    const task = locale === "en" ? item.titleEn ?? item.title : item.title;
    const materials = locale === "en" ? item.requiredMaterialsEn ?? item.requiredMaterials : item.requiredMaterials;
    return {
      id: item.itemId || `checklist-${index + 1}`,
      phase,
      task,
      status: "pending" as const,
      time: locale === "en" ? item.estimatedTimeEn ?? item.estimatedTime ?? "TBD" : item.estimatedTime ?? "待评估",
      cost: estimatedCost({ cost: item.estimatedCost, title: item.title, titleEn: item.titleEn }, locale),
      owner: index === 0 ? ownerLabels[locale].apply : ownerLabels[locale].certify,
      output: materials.length ? materials.join(locale === "zh" ? "、" : ", ") : task,
      checkId: item.itemId,
    };
  });

  rows.push({
    id: "listing-review",
    phase: locale === "zh" ? "上架复核" : "Listing review",
    task: locale === "zh" ? "确认整改与证据闭环" : "Confirm remediation and evidence closure",
    status: "pending",
    time: locale === "zh" ? "整改完成后" : "After remediation",
    cost: locale === "zh" ? "¥0-3K" : "$0-400",
    owner: ownerLabels[locale].complete,
    output: locale === "zh"
      ? `确认 ${(result.targetMarkets ?? []).join(" / ")} 市场风险、证据与报告均已闭环`
      : `Confirm ${(result.targetMarkets ?? []).join(" / ")} market risks, evidence and reports are closed`,
  });
  return rows;
}

export function buildRemediationRoadmap(result: ScanResult, locale: "zh" | "en"): RemediationRoadmapModel {
  const explicit = explicitRows(result, locale);
  const rows = explicit.length ? explicit : checklistRows(result, locale);
  const totalDays = result.reportPackage?.roadmap?.totalDays ?? result.reportPackage?.roadmap?.total_days;
  const totalTime = totalDays && totalDays > 0
    ? (locale === "zh" ? `预计 ${totalDays} 天` : `Est. ${totalDays} days`)
    : (locale === "zh" ? "待评估" : "TBD");
  const roleCount = new Set(rows.flatMap((row) => row.owner.split("/").map((owner) => owner.trim())).filter(Boolean)).size;
  const activeIndex = rows.findIndex((row) => row.status === "in-progress");
  const pendingIndex = rows.findIndex((row) => row.status === "pending");
  return { rows, totalTime, roleCount, focusIndex: activeIndex >= 0 ? activeIndex : Math.max(pendingIndex, 0) };
}
