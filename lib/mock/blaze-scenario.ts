export const blazeReportFiles = [
  {
    name: "ComplianceReport_demo.md",
    label: "合规总报告",
    reportType: "compliance",
    formats: ["pdf", "docx", "md"],
    href: "/mock-fixtures/ComplianceReport_demo.md",
  },
  {
    name: "ComplianceRoadmap_demo.csv",
    label: "合规路线图",
    reportType: "roadmap",
    formats: ["pdf", "docx", "csv"],
    href: "/mock-fixtures/ComplianceRoadmap_demo.csv",
  },
  {
    name: "CostProfitAnalysis_demo.md",
    label: "利润分析说明",
    reportType: "profit",
    formats: ["pdf", "docx", "md"],
    href: "/mock-fixtures/CostProfitAnalysis_demo.md",
  },
] as const;

export const blazeReportPreviewTabs = [
  {
    value: "compliance",
    label: "合规总报告",
    title: "规航AI · 合规扫描报告",
    subtitle: "这份报告适合交给法务、运营或供应商做第一次整改同步。",
    leftMetric: { label: "基础模式", value: "$1", hint: "风险模式 $6800" },
    rightMetric: { label: "合规模式", value: "$7", hint: "风险模式 $6000" },
    bullets: [
      "缺少 CE / UKCA 标识，建议在铭牌或外壳位置补齐。",
      "输入输出规格与协议说明不完整，需同步说明书和 Listing。",
      "包装多语言警示不足，需补齐欧盟和英国市场所需提示。",
    ],
  },
  {
    value: "roadmap",
    label: "路线图报告",
    title: "合规路线图报告",
    subtitle: "按阶段把资料冻结、标签整改、认证和上架复核拉成一条可执行路径。",
    leftMetric: { label: "当前状态", value: "拒绝", hint: "预计工期 35 天" },
    rightMetric: { label: "里程碑数量", value: "5", hint: "覆盖资料到上架" },
    bullets: [
      "第 1-2 天完成 BOM、铭牌、供应商资料整理。",
      "第 3-7 天完成 CE / UKCA、输入输出参数和警示语整改。",
      "第 3-5 周进入实验室与符合性声明流程，再做 Listing 复核。",
    ],
  },
  {
    value: "profit",
    label: "成本利润 & AI 决策",
    title: "成本利润分析报告 / AI 决策报告",
    subtitle: "把基础模式与合规模式放在一起比较，直接说明为什么这批货暂时不适合裸卖。",
    leftMetric: { label: "毛利润", value: "$7.46", hint: "基础模式 $0.71" },
    rightMetric: { label: "决策结论", value: "HIGH", hint: "建议先整改后上架" },
    bullets: [
      "合规后单平台成本增加 23%，但可避免高额罚款与退货。",
      "月度月损失利润约 $6000，先补资料再进入目标市场更稳。",
      "AI 决策结论：证据链未闭环，建议完成 CE、LVD、RoHS 后再开卖。",
    ],
  },
] as const;
