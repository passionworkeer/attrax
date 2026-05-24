const SERVER_TRANSLATIONS = {
  zh: {
    "errors.invalidRequest": "请求格式不正确，请检查上传内容后重试。",
    "errors.sessionNotFound": "未找到扫描会话，请重新上传。",
    "errors.resultNotReady": "扫描结果尚未生成，请稍后再试。",
    "errors.uploadAtLeastOne": "请至少上传 1 张产品图片。",
    "errors.tooManyDocuments": "最多只能上传 5 份文档。",
  },
  en: {
    "errors.invalidRequest": "Invalid request. Please check your uploads and try again.",
    "errors.sessionNotFound": "Scan session not found. Please upload again.",
    "errors.resultNotReady": "The scan result is not ready yet. Please try again later.",
    "errors.uploadAtLeastOne": "Please upload at least one product image.",
    "errors.tooManyDocuments": "You can upload up to 5 documents.",
  },
} as const;

export function serverT(key: string, locale: "zh" | "en" = "zh", params?: Record<string, string | number>): string {
  let value: string = SERVER_TRANSLATIONS[locale][key as keyof typeof SERVER_TRANSLATIONS.zh] ?? key;
  if (params) {
    for (const [param, replacement] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${param}\\}`, "g"), String(replacement));
    }
  }
  return value;
}

export const SCAN_STAGE_TEXT = {
  zh: {
    identifyingLabels: "识别产品标签",
    matchingRegulations: "匹配法规库",
    reportComplete: "报告生成完成",
  },
  en: {
    identifyingLabels: "Identifying product labels",
    matchingRegulations: "Matching regulations",
    reportComplete: "Report complete",
  },
};
