const SERVER_TRANSLATIONS = {
  zh: {
    "errors.invalidRequest": "请求格式不正确，请检查上传内容后重试。",
    "errors.sessionNotFound": "未找到扫描会话，请重新上传。",
    "errors.resultNotReady": "扫描结果尚未生成，请稍后再试。",
    "errors.uploadAtLeastOne": "请至少上传 1 张产品图片。",
    "errors.tooManyDocuments": "最多只能上传 5 份文档。",
    "errors.tooManyImages": "图片数量超出上限，最多上传 8 张。",
    "errors.imageTooLarge": "图片文件过大，请压缩后重新上传。",
    "errors.documentTooLarge": "文档文件过大，请压缩后重新上传。",
    "errors.unsupportedImageType": "不支持的图片格式，请使用 JPG/PNG/WebP。",
    "errors.unsupportedDocumentType": "不支持的文档格式，请使用 PDF/DOCX/TXT。",
    "errors.invalidFileSignature": "文件内容与声明类型不符，请检查后重传。",
    "errors.rateLimited": "操作过于频繁，请稍后再试。",
    "errors.dailyLimitReached": "今日免费扫描次数已用完，请明天再试。",
    "categories.electronics": "电子产品",
    "categories.appliance": "家电",
    "categories.appliances": "家电",
    "categories.3c": "3C 数码",
    "categories.digital": "3C 数码",
    "categories.toy": "玩具",
    "categories.toys": "玩具",
    "categories.home": "家居",
    "categories.other": "其他",
    "scanStages.analyzingImages": "分析上传图片",
    "scanStages.planningStrategy": "规划检索策略",
    "scanStages.retrievingRegulations": "检索合规法规库",
    "scanStages.generatingReport": "生成合规报告",
    "scanStages.reportComplete": "报告生成完成",
    "scanStages.backendTimeout": "⚠️ 后端服务响应超时，降级到演示模式…",
    "scanStages.backendUnavailable": "⚠️ 后端服务不可用，降级到演示模式…",
    "scanStages.demoResultGenerated": "✅ 演示结果已生成（离线模式）",
    "scanStages.scanPassed": "✅ 合规扫描通过",
    "scanStages.scanWarning": "⚠️ 合规警告，请查看报告",
    "scanStages.scanRisk": "🔴 合规风险，需关注",
  },
  en: {
    "errors.invalidRequest": "Invalid request. Please check your uploads and try again.",
    "errors.sessionNotFound": "Scan session not found. Please upload again.",
    "errors.resultNotReady": "The scan result is not ready yet. Please try again later.",
    "errors.uploadAtLeastOne": "Please upload at least one product image.",
    "errors.tooManyDocuments": "You can upload up to 5 documents.",
    "errors.tooManyImages": "Too many images. The limit is 8.",
    "errors.imageTooLarge": "Image file too large. Please compress and re-upload.",
    "errors.documentTooLarge": "Document file too large. Please compress and re-upload.",
    "errors.unsupportedImageType": "Unsupported image format. Please use JPG/PNG/WebP.",
    "errors.unsupportedDocumentType": "Unsupported document format. Please use PDF/DOCX/TXT.",
    "errors.invalidFileSignature": "File content does not match its declared type.",
    "errors.rateLimited": "Too many requests. Please slow down and try again.",
    "errors.dailyLimitReached": "Daily free scan limit reached. Please try again tomorrow.",
    "categories.electronics": "Electronics",
    "categories.appliance": "Home Appliances",
    "categories.appliances": "Home Appliances",
    "categories.3c": "3C Digital",
    "categories.digital": "3C Digital",
    "categories.toy": "Toys",
    "categories.toys": "Toys",
    "categories.home": "Home & Living",
    "categories.other": "Other",
    "scanStages.analyzingImages": "Analyzing uploaded images",
    "scanStages.planningStrategy": "Planning retrieval strategy",
    "scanStages.retrievingRegulations": "Retrieving compliance regulation database",
    "scanStages.generatingReport": "Generating compliance report",
    "scanStages.reportComplete": "Report generation complete",
    "scanStages.backendTimeout": "⚠️ Backend service timed out, falling back to demo mode…",
    "scanStages.backendUnavailable": "⚠️ Backend service unavailable, falling back to demo mode…",
    "scanStages.demoResultGenerated": "✅ Demo result generated (offline mode)",
    "scanStages.scanPassed": "✅ Compliance scan passed",
    "scanStages.scanWarning": "⚠️ Compliance warning, please review the report",
    "scanStages.scanRisk": "🔴 Compliance risk, attention required",
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
