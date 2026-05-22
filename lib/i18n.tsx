"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Locale = "zh" | "en";

const translations = {
  zh: {
    common: {
      loading: "加载中...",
      error: "错误",
      retry: "重试",
      submit: "提交",
      cancel: "取消",
      save: "保存",
      delete: "删除",
      edit: "编辑",
      search: "搜索",
      filter: "筛选",
      language: "语言",
      home: "首页",
    },
    language: {
      zh: "中文",
      en: "English",
    },
    home: {
      title: "火鹰合规",
      subtitle: "想出海？先烧毁！",
      description: "AI驱动的跨境电商合规风险智能扫描平台",
      startScanning: "开始扫描",
      features: {
        title: "核心功能",
        multiMarket: "多市场覆盖",
        multiMarketDesc: "覆盖欧盟、美国、英国、中国、澳大利亚、沙特、阿联酋等16+市场",
        fastAnalysis: "快速分析",
        fastAnalysisDesc: "5分钟内获得完整合规报告",
        preciseCitations: "精确条款引用",
        preciseCitationsDesc: "附带法规编号和页码的精确引用",
        actionableAdvice: "可执行建议",
        actionableAdviceDesc: "包含预估费用的具体整改步骤",
      },
      stats: {
        markets: "市场",
        regulations: "法规",
        users: "用户",
      },
      regulations: {
        title: "法规更新",
        recentUpdates: "最新更新",
        viewAll: "查看全部",
        noUpdates: "暂无更新",
      },
    },

    // 上传表单
    upload: {
      title: "上传产品资料",
      description: "支持上传图片（最多 8 张）和产品文档（PDF / DOCX / HTML，最多 5 份）。",
      productImages: "产品图片",
      productDocs: "产品文档",
      productImagesCount: "{count}/8 张",
      productDocsCount: "{count}/5 份",
      clearAllImages: "清除全部图片",
      clearAllDocs: "清除全部文档",
      targetMarket: "目标市场",
      productCategory: "产品分类",
      submitAndScan: "提交并开始扫描",
      selectAtLeastOneImage: "请上传至少 1 张图片",
      selectedFiles: "已选择 {imageCount} 张图片，{docCount} 份文档",
      optional: "可选",
      supportedFormats: "支持文档",
      notSupportedImageFormat: "部分文件不是支持的图片格式，已跳过 {count} 个。",
      notSupportedDocFormat: "部分文件不是支持的文档格式（PDF / DOCX / HTML），已跳过 {count} 个。",
      selectAtLeastOneImageError: "请先选择至少 1 张图片。",
    },

    // 市场名称
    markets: {
      EU: "欧盟",
      US: "美国",
      UK: "英国",
      CN: "中国",
      AU: "澳大利亚",
      SA: "沙特",
      AE: "阿联酋",
      UAE: "阿联酋",
      all: "全部市场",
    },

    // 产品分类
    categories: {
      electronics: "电子产品",
      appliance: "家电",
      appliances: "家电",
      "3c": "3C 数码",
      digital: "3C 数码",
      toy: "玩具",
      toys: "玩具",
      home: "家居",
      other: "其他",
    },

    // 合规状态
    complianceStatus: {
      passed: "通过",
      warning: "警告",
      rejected: "拒绝",
      unknown: "未知",
      passedDesc: "合规扫描通过",
      warningDesc: "合规警告，请查看报告",
      riskDesc: "合规风险，需关注",
    },

    // 扫描阶段
    scanStages: {
      preparing: "准备中",
      analyzingImages: "分析上传图片",
      planningStrategy: "规划检索策略",
      retrievingRegulations: "检索合规法规库",
      generatingReport: "生成合规报告",
      reportComplete: "报告生成完成",
      identifyingLabels: "识别铭牌与认证标识",
      matchingRegulations: "匹配欧美法规库",
      backendTimeout: "⚠️ 后端服务响应超时，降级到演示模式…",
      backendUnavailable: "⚠️ 后端服务不可用，降级到演示模式…",
      demoResultGenerated: "✅ 演示结果已生成（离线模式）",
      scanPassed: "✅ 合规扫描通过",
      scanWarning: "⚠️ 合规警告，请查看报告",
      scanRisk: "🔴 合规风险，需关注",
    },

    // Burning 页面
    burning: {
      scanComplete: "扫描完成！",
      eagleReady: "雄鹰已准备就绪！",
      eagleAnalyzing: "雄鹰正在分析你的产品",
      waitingForTask: "等待任务启动…",
      scanFailed: "扫描失败。",
      reupload: "重新上传",
      viewDemo: "查看 Demo",
    },

    // 结果页面
    result: {
      scanResult: "扫描结果",
      complianceReport: "合规分析报告",
      costProfitReport: "成本利润分析报告",
      overallScore: "综合评分",
      grade: "等级",
      category: "品类",
      market: "市场",
      retrievalRounds: "检索轮次",
      uploadedDocs: "已上传文档",
      documentCount: "共 {count} 份文档",
      loading: "正在加载扫描结果",
      restored: "已从会话缓存恢复结果",
      notFound: "未找到对应扫描结果",
      loaded: "结果已从接口载入",
      failed: "扫描失败",
      processing: "扫描仍在处理中",
      demoResult: "Demo 扫描结果",
      demoLoaded: "已载入 Demo 数据",
      aiDecision: "AI 决策过程",
      complianceRoadmap: "合规路线图",
      reupload: "重新上传",
      viewDemo: "查看 Demo",
    },

    // 法规页面
    regulations: {
      title: "法规更新",
      subtitle: "追踪目标市场的最新法规变化",
      recentUpdates: "最新更新",
      viewAll: "查看全部",
      noUpdates: "暂无更新",
      search: "搜索法规...",
      allMarkets: "全部市场",
      published: "发布",
      effective: "生效",
      viewDetails: "查看详情",
      collapse: "收起",
      comingSoon: "即将生效",
      daysLeft: "还有 {days} 天生效",
      viewSource: "查看官方来源",
      noResults: "未找到相关法规",
      showing: "显示 1-{to} 条，共 {total} 条",
      total: "法规总数",
      affectedCategories: "影响类别",
    },

    // 追踪页面
    trace: {
      title: "AI 决策过程",
      subtitle: "查看 Agent 如何分析产品合规性并生成报告",
      executionTime: "执行时间",
      executionSteps: "执行步骤",
      targetMarkets: "扫描市场",
      realtime: "实时分析",
      multiMarket: "多市场覆盖",
      actionableAdvice: "可执行建议",
      analysisComplete: "分析完成",
      vectorSearch: "向量检索",
      aiReasoning: "AI 推理过程",
      regulations: "条法规",
      riskPoints: "项风险点",
      firstInspection: "初检",
      reInspection: "复检",
      regulationHit: "命中 {count} 条法规",
      confidence: "置信度 {score}",
      regulationsHit: "命中法规",
      remaining: "还有 {count} 项…",
      regulationsCount: "条法规",
      score: "评分",
      maxMatch: "最高匹配",
      effective: "生效",
      suggestedAction: "建议行动",
      estimatedTimeline: "预计时间线",
      productImage: "图片上传",
      portableBluetoothSpeaker: "便携式蓝牙音箱",
      batteryPowered: "电池供电",
      bluetooth: "蓝牙连接",
      ledScreen: "LED显示屏",
      queryStrategy: "根据产品特征智能生成多市场合规查询策略",
      loading: "加载中...",
      backToResult: "返回扫描结果",
      realtimeDesc: "观看 AI Agent 实时分析您的产品，从图片上传到合规报告",
      multiMarketDesc: "同时扫描欧盟、美国、中国及10+市场的法规",
      actionableAdviceDesc: "获取带有截止日期、成本和预期结果的就绪行动项目",
    },

    // 路线图页面
    roadmap: {
      title: "合规路线图",
      subtitle: "从评估到产品上市的全流程时间规划",
      totalDays: "总工期",
      estimatedCost: "预估总费用",
      stepsCount: "步骤数",
      progress: "完成度",
      loading: "加载中...",
      backToResult: "返回扫描结果",
      roadmap: "路线",
      startToday: "今天",
      estimated: "预计",
      days: "天",
      completed: "已完成",
      inProgress: "进行中",
      pending: "待完成",
      materials: "所需材料",
      cost: "预估费用",
      startNow: "立即开始",
      remaining: "还有",
      suggestStartNow: "建议现在就开始准备",
      requiredDocs: "所需文件",
      readyToStart: "准备好开始了吗",
      stepTypes: {
        apply: "申请",
        test: "检测",
        certify: "认证",
        complete: "完成",
      },
      timeline: {
        assessment: "合规评估完成",
        prepareMaterials: "准备申请材料",
        selectAgency: "选择认证机构",
        submitApplication: "提交认证申请",
        productTesting: "产品检测",
        getCertificate: "获取认证证书",
        goToMarket: "合规上市销售",
      },
      descriptions: {
        assessment: "完成产品合规性初步评估",
        prepareMaterials: "收集产品规格、技术文档、测试报告等申请所需材料",
        selectAgency: "根据目标市场选择合适的认证机构",
        submitApplication: "向认证机构提交认证申请和相关材料",
        productTesting: "在认证机构实验室进行安全、EMC、环境等测试",
        getCertificate: "测试通过后，获得认证证书（如 CE、FCC、CCC 等）",
        goToMarket: "完成所有合规要求后，产品可在目标市场上市销售",
      },
    },

    // 错误消息
    errors: {
      sessionNotFound: "未找到对应扫描会话。",
      resultNotReady: "扫描结果未就绪。",
      sessionExpired: "会话已失效",
      invalidRequest: "无效的请求格式",
      uploadAtLeastOneImage: "请至少上传 1 张图片，并确认 category / markets 合法。",
      uploadAtLeastOne: "请至少上传 1 张图片。",
      tooManyDocuments: "文档数量不能超过 5 个。",
      scanFailed: "扫描失败。",
      backendTimeout: "后端服务响应超时，降级到演示模式…",
      backendUnavailable: "后端服务不可用，降级到演示模式…",
      demoMode: "演示结果已生成（离线模式）",
      uploadFailed: "提交失败，请稍后重试。",
      invalidSessionId: "接口未返回有效的 sessionId。",
    },

    // 报告导出
    report: {
      title: "火鹰合规 · 合规扫描报告",
      profitTitle: "火鹰合规 · 合规成本与利润分析报告",
      sessionId: "会话 ID",
      generatedAt: "生成时间",
      brand: "火鹰合规 Blaze Hawks",
      footer: "火鹰合规报告",
      comprehensiveScore: "综合评分",
      costComparison: "一、成本对比明细",
      revenueComparison: "二、收益对比",
      riskAdjustedRevenue: "三、风险调整后净收益对比",
      breakEvenAnalysis: "四、盈亏平衡分析",
      keyConclusions: "五、关键结论",
      regulationCitations: "六、法规引用",
      columns: {
        costItem: "成本项",
        difference: "差值",
        bomCost: "BOM材料成本",
        packaging: "包装与印刷",
        certAmortization: "认证费摊销",
        eprFee: "EPR运营费",
        afterSales: "售后",
        warranty: "保修预留",
        logistics: "物流与渠道",
        totalDirectCost: "总直接成本",
        revenue: "收益项",
        avgPrice: "平均售价",
        grossProfit: "毛利润",
        grossMargin: "毛利率",
        avgPriceAsp: "平均售价（ASP）",
        grossProfitGp: "毛利润（GP）",
      },
      cards: {
        grossProfit: "毛利润",
        riskExposure: "风险敞口",
        breakevenUnits: "盈亏平衡台数",
        pricingAdvice: "定价策略建议",
        salePrice: "售价",
        totalCost: "总成本",
        barebone: "裸奔",
        compliant: "合规",
        costComparison: "成本对比明细",
        riskAdjusted: "风险调整后净收益对比",
        analysisReport: "分析报告",
      },
      labels: {
        noCompliance: "裸奔模式",
        withCompliance: "合规模式",
        productGrade: "等级",
        productCategory: "品类",
        productMarket: "市场",
        complianceStatus: "合规状态",
        product: "产品",
        market: "市场",
        date: "日期",
      },
      filenames: {
        report: "合规报告_{sessionId}_{status}.pdf",
        profitReport: "成本利润分析报告_{sessionId}.pdf",
      },
    },

    // Mock 数据中的产品信息
    mock: {
      productName: "USB 智能加湿器",
      certDoc: "CE认证证书.docx",
      specDoc: "产品规格书.pdf",
      riskTitle1: "缺少 CE 标识",
      riskTitle2: "警示标签可疑",
      regulationName: "CE 标识通用要求",
      category: "CE 认证 / 欧盟市场",
      materials: {
        spec: "产品规格书",
        nameplate: "铭牌版式",
        supplier: "供应商信息",
        packaging: "包装图稿",
        warnings: "警示语清单",
      },
    },

    // 动画文字
    animation: {
      eagleReady: "雄鹰已准备就绪！",
      eagleAnalyzing: "雄鹰正在分析你的产品",
      scanComplete: "雄鹰已准备就绪！",
      reportComplete: "报告生成完成",
      waitingForTask: "等待任务启动…",
      currentSession: "当前会话：",
    },
  },

  en: {
    common: {
      loading: "Loading...",
      error: "Error",
      retry: "Retry",
      submit: "Submit",
      cancel: "Cancel",
      save: "Save",
      delete: "Delete",
      edit: "Edit",
      search: "Search",
      filter: "Filter",
      language: "Language",
      home: "Home",
    },
    language: {
      zh: "中文",
      en: "English",
    },
    home: {
      title: "Blaze Hawks",
      subtitle: "Think Before You Expand",
      description: "AI-powered compliance risk scanning for cross-border e-commerce",
      startScanning: "Start Scanning",
      features: {
        title: "Key Features",
        multiMarket: "Multi-Market Coverage",
        multiMarketDesc: "Covering 16+ markets including EU, US, UK, CN, AU, SA, AE",
        fastAnalysis: "Fast Analysis",
        fastAnalysisDesc: "Get complete compliance report in 5 minutes",
        preciseCitations: "Precise Citations",
        preciseCitationsDesc: "Legal references with Article No. and page numbers",
        actionableAdvice: "Actionable Advice",
        actionableAdviceDesc: "Specific remediation steps with estimated costs",
      },
      stats: {
        markets: "Markets",
        regulations: "Regulations",
        users: "Users",
      },
      regulations: {
        title: "Regulation Updates",
        recentUpdates: "Recent Updates",
        viewAll: "View All",
        noUpdates: "No recent updates",
      },
    },

    // Upload form
    upload: {
      title: "Upload Product Materials",
      description: "Upload up to 8 product images and 5 documents (PDF / DOCX / HTML).",
      productImages: "Product Images",
      productDocs: "Product Documents",
      productImagesCount: "{count}/8 images",
      productDocsCount: "{count}/5 files",
      clearAllImages: "Clear all images",
      clearAllDocs: "Clear all documents",
      targetMarket: "Target Market",
      productCategory: "Product Category",
      submitAndScan: "Submit & Start Scan",
      selectAtLeastOneImage: "Please upload at least 1 image",
      selectedFiles: "{imageCount} images and {docCount} documents selected",
      optional: "optional",
      supportedFormats: "Supported formats",
      notSupportedImageFormat: "{count} file(s) were skipped as they are not supported image formats.",
      notSupportedDocFormat: "{count} file(s) were skipped as they are not supported document formats (PDF / DOCX / HTML).",
      selectAtLeastOneImageError: "Please select at least 1 image first.",
    },

    // Market names
    markets: {
      EU: "European Union",
      US: "United States",
      UK: "United Kingdom",
      CN: "China",
      AU: "Australia",
      SA: "Saudi Arabia",
      AE: "UAE",
      UAE: "UAE",
      all: "All Markets",
    },

    // Product categories
    categories: {
      electronics: "Electronics",
      appliance: "Home Appliances",
      appliances: "Home Appliances",
      "3c": "3C Digital",
      digital: "3C Digital",
      toy: "Toys",
      toys: "Toys",
      home: "Home & Living",
      other: "Other",
    },

    // Compliance status
    complianceStatus: {
      passed: "Passed",
      warning: "Warning",
      rejected: "Rejected",
      unknown: "Unknown",
      passedDesc: "Compliance scan passed",
      warningDesc: "Compliance warnings, please review the report",
      riskDesc: "Compliance risk, attention required",
    },

    // Scan stages
    scanStages: {
      preparing: "Preparing",
      analyzingImages: "Analyzing uploaded images",
      planningStrategy: "Planning retrieval strategy",
      retrievingRegulations: "Retrieving compliance regulation database",
      generatingReport: "Generating compliance report",
      reportComplete: "Report generation complete",
      identifyingLabels: "Identifying nameplates and certification marks",
      matchingRegulations: "Matching EU/US regulation database",
      backendTimeout: "⚠️ Backend service timed out, falling back to demo mode…",
      backendUnavailable: "⚠️ Backend service unavailable, falling back to demo mode…",
      demoResultGenerated: "✅ Demo result generated (offline mode)",
      scanPassed: "✅ Compliance scan passed",
      scanWarning: "⚠️ Compliance warning, please review the report",
      scanRisk: "🔴 Compliance risk, attention required",
    },

    // Burning page
    burning: {
      scanComplete: "Scan complete!",
      eagleReady: "The eagle is ready!",
      eagleAnalyzing: "The eagle is analyzing your product",
      waitingForTask: "Waiting for task to start…",
      scanFailed: "Scan failed.",
      reupload: "Re-upload",
      viewDemo: "View Demo",
    },

    // Agent trace
    agentTrace: {
      executionLink: "Execution Link",
      initialReview: "Initial Review",
      reviewRound: "Review",
      hitCount: "{count} regulation(s) matched",
      confidence: "Confidence {score}",
      hitRegulations: "Matched Regulations",
      moreItems: "{count} more...",
    },

    // Result page
    result: {
      scanResult: "Scan Result",
      complianceReport: "Compliance Analysis Report",
      costProfitReport: "Cost & Profit Report",
      overallScore: "Overall Score",
      grade: "Grade",
      category: "Category",
      market: "Market",
      retrievalRounds: "Retrieval Rounds",
      uploadedDocs: "Uploaded Documents",
      documentCount: "{count} document(s)",
      loading: "Loading scan results",
      restored: "Results restored from session cache",
      notFound: "Scan results not found",
      loaded: "Results loaded from API",
      failed: "Scan failed",
      processing: "Scan still in progress",
      demoResult: "Demo Scan Result",
      demoLoaded: "Demo data loaded",
      aiDecision: "AI Decision Process",
      complianceRoadmap: "Compliance Roadmap",
      reupload: "Re-upload",
      viewDemo: "View Demo",
    },

    // Regulations page
    regulations: {
      title: "Regulation Updates",
      subtitle: "Track the latest regulatory changes in target markets",
      recentUpdates: "Recent Updates",
      viewAll: "View All",
      noUpdates: "No updates available",
      search: "Search regulations...",
      allMarkets: "All Markets",
      published: "Published",
      effective: "Effective",
      viewDetails: "View Details",
      collapse: "Collapse",
      comingSoon: "Coming Soon",
      daysLeft: "{days} days until effective",
      viewSource: "View official source",
      noResults: "No relevant regulations found",
      showing: "Showing 1-{to} of {total}",
      total: "Total regulations tracked",
      affectedCategories: "Affected Categories",
    },

    // Trace page
    trace: {
      title: "AI Decision Process",
      subtitle: "See how the Agent analyzes product compliance and generates reports",
      executionTime: "Execution Time",
      executionSteps: "Execution Steps",
      targetMarkets: "Target Markets",
      realtime: "Real-time Analysis",
      multiMarket: "Multi-Market Coverage",
      actionableAdvice: "Actionable Advice",
      analysisComplete: "Analysis Complete",
      vectorSearch: "Vector Search",
      aiReasoning: "AI Reasoning Process",
      regulations: "regulations",
      riskPoints: "risk points",
      firstInspection: "First Inspection",
      reInspection: "Re-Inspection",
      regulationHit: "{count} regulation(s) hit",
      confidence: "Confidence {score}",
      regulationsHit: "Regulations Hit",
      remaining: "{count} more...",
      regulationsCount: "regulations",
      score: "Score",
      maxMatch: "Top Match",
      effective: "Effective",
      suggestedAction: "Suggested Action",
      estimatedTimeline: "Estimated Timeline",
      productImage: "Image Upload",
      portableBluetoothSpeaker: "Portable Bluetooth Speaker",
      batteryPowered: "Battery Powered",
      bluetooth: "Bluetooth Connectivity",
      ledScreen: "LED Display",
      queryStrategy: "Intelligent multi-market compliance query strategy based on product features",
      loading: "Loading...",
      backToResult: "Back to Results",
      realtimeDesc: "Watch the AI agent analyze your product in real-time",
      multiMarketDesc: "Simultaneously scan regulations from EU, US, China and 10+ markets",
      actionableAdviceDesc: "Get prioritized action items with deadlines and expected outcomes",
    },

    // Roadmap page
    roadmap: {
      title: "Compliance Roadmap",
      subtitle: "End-to-end timeline from assessment to market launch",
      totalDays: "Total Days",
      estimatedCost: "Estimated Total Cost",
      stepsCount: "Steps",
      progress: "Progress",
      loading: "Loading...",
      backToResult: "Back to Results",
      roadmap: "Roadmap",
      startToday: "Today",
      estimated: "Estimated",
      days: "days",
      completed: "Completed",
      inProgress: "In Progress",
      pending: "Pending",
      materials: "Required Materials",
      cost: "Estimated Cost",
      startNow: "Start Now",
      remaining: "remaining",
      suggestStartNow: "Recommended to start preparation now",
      requiredDocs: "Required Documents",
      readyToStart: "Ready to get started",
      stepTypes: {
        apply: "Apply",
        test: "Test",
        certify: "Certify",
        complete: "Complete",
      },
      timeline: {
        assessment: "Compliance Assessment Complete",
        prepareMaterials: "Prepare Application Materials",
        selectAgency: "Select Certification Body",
        submitApplication: "Submit Certification Application",
        productTesting: "Product Testing",
        getCertificate: "Obtain Certification Certificate",
        goToMarket: "Launch Compliantly",
      },
      descriptions: {
        assessment: "Complete initial product compliance assessment",
        prepareMaterials: "Collect application materials including product specs, technical documents, and test reports",
        selectAgency: "Select an appropriate certification body based on target market",
        submitApplication: "Submit certification application and supporting documents to the certification body",
        productTesting: "Conduct safety, EMC, and environmental tests in the certification laboratory",
        getCertificate: "Obtain certification certificate (CE, FCC, CCC, etc.) upon passing tests",
        goToMarket: "Product can be sold in the target market after completing all compliance requirements",
      },
    },

    // Error messages
    errors: {
      sessionNotFound: "Scan session not found.",
      resultNotReady: "Scan result is not ready.",
      sessionExpired: "Session expired",
      invalidRequest: "Invalid request format",
      uploadAtLeastOneImage: "Please upload at least 1 image, and ensure category / markets are valid.",
      uploadAtLeastOne: "Please upload at least 1 image.",
      tooManyDocuments: "Document count cannot exceed 5.",
      scanFailed: "Scan failed.",
      backendTimeout: "Backend service timed out, falling back to demo mode…",
      backendUnavailable: "Backend service unavailable, falling back to demo mode…",
      demoMode: "Demo result generated (offline mode)",
      uploadFailed: "Upload failed, please try again.",
      invalidSessionId: "API did not return a valid sessionId.",
    },

    // Report export
    report: {
      title: "Blaze Hawks · Compliance Scan Report",
      profitTitle: "Blaze Hawks · Compliance Cost & Profit Analysis Report",
      sessionId: "Session ID",
      generatedAt: "Generated at",
      brand: "Blaze Hawks",
      footer: "Blaze Hawks Compliance Report",
      comprehensiveScore: "Comprehensive Score",
      costComparison: "I. Cost Comparison Details",
      revenueComparison: "II. Revenue Comparison",
      riskAdjustedRevenue: "III. Risk-Adjusted Net Revenue Comparison",
      breakEvenAnalysis: "IV. Break-Even Analysis",
      keyConclusions: "V. Key Conclusions",
      regulationCitations: "VI. Regulation Citations",
      columns: {
        costItem: "Cost Item",
        difference: "Difference",
        bomCost: "BOM Material Cost",
        packaging: "Packaging & Printing",
        certAmortization: "Certification Fee Amortization",
        eprFee: "EPR Operation Fee",
        afterSales: "After-Sales",
        warranty: "Warranty Reserve",
        logistics: "Logistics & Channel",
        totalDirectCost: "Total Direct Cost",
        revenue: "Revenue Items",
        avgPrice: "Average Selling Price",
        grossProfit: "Gross Profit",
        grossMargin: "Gross Margin",
        avgPriceAsp: "Average Selling Price (ASP)",
        grossProfitGp: "Gross Profit (GP)",
      },
      cards: {
        grossProfit: "Gross Profit",
        riskExposure: "Risk Exposure",
        breakevenUnits: "Break-Even Units",
        pricingAdvice: "Pricing Strategy Advice",
        salePrice: "Sale Price",
        totalCost: "Total Cost",
        barebone: "Barebone",
        compliant: "Compliant",
        costComparison: "Cost Comparison Details",
        riskAdjusted: "Risk-Adjusted Net Revenue",
        analysisReport: "Analysis Report",
      },
      labels: {
        noCompliance: "No Compliance",
        withCompliance: "With Compliance",
        productGrade: "Grade",
        productCategory: "Category",
        productMarket: "Market",
        complianceStatus: "Compliance Status",
        product: "Product",
        market: "Market",
        date: "Date",
      },
      filenames: {
        report: "ComplianceReport_{sessionId}_{status}.pdf",
        profitReport: "CostProfitAnalysisReport_{sessionId}.pdf",
      },
    },

    // Mock data product info
    mock: {
      productName: "USB Smart Humidifier",
      certDoc: "CE Certificate.docx",
      specDoc: "Product Specification.pdf",
      riskTitle1: "Missing CE Mark",
      riskTitle2: "Suspicious Warning Labels",
      regulationName: "General CE Marking Requirements",
      category: "CE Certification / EU Market",
      materials: {
        spec: "Product Specification",
        nameplate: "Nameplate Layout",
        supplier: "Supplier Information",
        packaging: "Packaging Design",
        warnings: "Warning Statement List",
      },
    },

    // Animation text
    animation: {
      eagleReady: "The eagle is ready!",
      eagleAnalyzing: "The eagle is analyzing your product",
      scanComplete: "The eagle is ready!",
      reportComplete: "Report generation complete",
      waitingForTask: "Waiting for task to start…",
      currentSession: "Current session:",
    },
  },
};

interface TranslationContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const TranslationContext = createContext<TranslationContextType | null>(null);

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "zh";

  const stored = localStorage.getItem("locale") as Locale | null;
  if (stored && ["zh", "en"].includes(stored)) return stored;

  return navigator.language.toLowerCase().startsWith("en") ? "en" : "zh";
}

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("zh");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLocale(detectInitialLocale());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const handleSetLocale = (newLocale: Locale) => {
    setLocale(newLocale);
    localStorage.setItem("locale", newLocale);
  };

  const t = (key: string, params?: Record<string, string | number>): string => {
    const keys = key.split(".");
    let value: unknown = translations[locale];

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        return key;
      }
    }

    let result = typeof value === "string" ? value : key;
    if (params) {
      for (const [pKey, pVal] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{${pKey}\\}`, "g"), String(pVal));
      }
    }
    return result;
  };

  return (
    <TranslationContext.Provider value={{ locale, setLocale: handleSetLocale, t }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error("useTranslation must be used within a TranslationProvider");
  }
  return context;
}

/** Non-React translation lookup — usable in Node.js / server-side utilities. */
export function getTranslations(locale: Locale = "zh") {
  return translations[locale];
}

/** Lookup a translation key from a locale string (for server-side use). */
export function t(key: string, locale: Locale = "zh", params?: Record<string, string | number>): string {
  const keys = key.split(".");
  let value: unknown = translations[locale];
  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }
  let result = typeof value === "string" ? value : key;
  if (params) {
    for (const [pKey, pVal] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${pKey}\\}`, "g"), String(pVal));
    }
  }
  return result;
}
