export const blazeNavigation = [
  { label: { zh: "产品方案", en: "Product Solutions" }, href: "/#product" },
  { label: { zh: "Demo演示", en: "Demo" }, href: "/upload" },
  { label: { zh: "赛道匹配", en: "Track Matching" }, href: "/result/demo#report-previews" },
  { label: { zh: "落地规划", en: "Landing Planning" }, href: "/profit/demo" },
  { label: { zh: "合作资源", en: "Partnerships" }, href: "/pricing" },
] as const;

export const blazeFeaturePills = [
  "多角度上传",
  "真实视觉分析",
  "火焰风险定位",
  "利润损益看板",
] as const;

export const blazeMarketOptions = [
  { id: "EU", label: "欧盟", hint: "CE / GPSR / RoHS" },
  { id: "US", label: "美国", hint: "FCC / CPSIA / UL" },
  { id: "UK", label: "英国", hint: "UKCA / WEEE" },
] as const;

export const blazeCategoryOptions = [
  { id: "electronics", label: "3C 电子" },
  { id: "appliance", label: "家电" },
  { id: "toy", label: "玩具" },
  { id: "home", label: "家居" },
  { id: "other", label: "其他" },
] as const;

export const blazeInsightCards = [
  {
    title: "结构识别",
    body: "识别主体、接口、包装与警示位置，建立可追溯的产品视图。",
  },
  {
    title: "热点定价",
    body: "不同风险点会压缩不同幅度的利润空间，先看到再决定要不要出海。",
  },
  {
    title: "利润看板",
    body: "直接给出成本、整改费用和目标市场利润变化，不再只停在法规说明。",
  },
] as const;

export const blazePresetProducts = [
  {
    title: "65W 快充充电器",
    count: "4 个热点",
    summary: "适合拿来演示无 CE、标签缺漏和多市场法规一键联动的风险结果。",
  },
  {
    title: "桌面加湿器",
    count: "3 个热点",
    summary: "适合展示包装、说明书和多语言警示缺失如何影响跨境电商上架。",
  },
  {
    title: "儿童积木玩具",
    count: "5 个热点",
    summary: "适合玩具类产品的 EN71 / CPSIA 合规提示与路线图输出。",
  },
] as const;

export const blazeAnalysisSteps = [
  {
    id: "upload",
    title: "上传产品",
    description: "读取多角度图片并建立产品素材视图。",
  },
  {
    id: "classify",
    title: "智能拆解",
    description: "识别型号、接口、铭牌、包装与警示信息。",
  },
  {
    id: "risk",
    title: "风险识别",
    description: "结合多市场法规库生成风险点与法规引用。",
  },
  {
    id: "report",
    title: "利润测算",
    description: "输出整改成本、时间预估与报告导出项。",
  },
] as const;

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

export const blazeRoadmapRows = [
  {
    phase: "资料冻结",
    time: "第 1-2 天",
    owner: "产品 / 采购",
    output: "铭牌、BOM、供应商资料、适配器说明",
  },
  {
    phase: "标签整改",
    time: "第 3-7 天",
    owner: "设计 / 合规",
    output: "铭牌、包装、多语言警示、说明书",
  },
  {
    phase: "预测复核",
    time: "第 1 周",
    owner: "火鹰合规",
    output: "法规比对、利润回算、风险热区确认",
  },
  {
    phase: "正式认证",
    time: "第 3-5 周",
    owner: "实验室 / 代理",
    output: "CE 技术文件、DoC、RoHS / REACH 报告",
  },
  {
    phase: "上架复核",
    time: "第 5 周",
    owner: "运营 / 法务",
    output: "Listing 文案、主图封面、ERP 备注",
  },
] as const;

export const blazeProfitSummary = {
  before: "¥27",
  after: "¥12",
  complianceCost: "¥15",
  monthlyExposure: "¥12000",
  suggestedRetail: "首单报价 ¥128",
} as const;

export const blazePricingPlans = [
  {
    title: "单次解锁",
    price: "¥99",
    unit: "/ 次",
    badge: "按次交付",
    features: [
      "单个 SKU 完整合规报告",
      "利润测算表导出",
      "风险整改建议",
      "7 天扫描历史保留",
    ],
  },
  {
    title: "月度会员",
    price: "¥299",
    unit: "/ 月",
    badge: "官方推荐",
    features: [
      "每月 10 个 SKU 完整报告",
      "不限次产品扫描",
      "法规更新提醒",
      "认证绿色通道",
    ],
  },
  {
    title: "年度会员",
    price: "¥2399",
    unit: "/ 年",
    badge: "企业常用",
    features: [
      "每年 180 个 SKU 完整报告",
      "专家人工复核 1 次",
      "企业级多人协作",
      "优先体验新功能",
    ],
  },
] as const;

export const blazeArchitectureNotes = [
  "Next.js 16 + React 19 前端体验层，负责上传、扫描流程与报告交付。",
  "FastAPI + LangGraph 负责编排多市场检索、法规引用验证与报告生成。",
  "混合检索管线使用 Dense + BM25 + RRF，保证法规片段召回与条款上下文完整。",
  "Must-Check 规则与 NLI 校验用于降低幻觉，避免错误法规引用直接进入报告。",
] as const;

export const blazeReportPreviewTabs = [
  {
    value: "compliance",
    label: "合规总报告",
    title: "火鹰合规 · 合规扫描报告",
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

export const blazeHeroCopy = {
  eyebrow: "LEC AI 深度驱动 · 英国 48 家集团战略合作",
  titleCn: "想出海？先烧毁！",
  titleEn: "Burn Before You Fly.",
  body:
    "以合规智能为入口，覆盖选品、合规、增长、履约与风控全链路。先上传几张产品图片，把会吞掉利润的风险点直接点亮，再决定要不要真正进入欧洲市场。",
  bodyEn:
    "Using compliance intelligence as the entry point, Blaze Hawks covers sourcing, compliance, growth, fulfillment, and risk control before market entry.",
  productCn: "65W 快充充电器",
  productEn: "65W Fast Charger",
  marketLabel: "欧盟 + 英国市场",
  marketLabelEn: "EU + UK Market",
} as const;
