import type { ProductCategory } from "@/lib/types";

/**
 * J17（计划 §5.4）—— 上传向导按品类变化。
 *
 * 每个品类定义：
 *   - photoSlots          首次建议的拍摄槽（标题/提示按品类给出）
 *   - conditionalQuestions 关键条件问题（提交前可答，也可以跳过）
 *   - documentHints       建议随图上传的资料类型
 *   - notPhotoAssertable  不能仅凭照片断言的结论（诚实边界）
 *
 * 数据与 docs/plans/2026-09-14-judge-review-and-optimization-plan.md §5.4
 * 的品类表保持一致；槽位数量可以不同（上限仍由页面的 MAX_UPLOAD_FILES=8 约束）。
 */

export interface CategoryPhotoSlot {
  /** 视角标识，供调试/后续与后端 requiredViews 对齐使用 */
  view: string;
  label: string;
  labelEn: string;
  hint: string;
  hintEn: string;
}

export interface CategoryConditionalQuestion {
  id: string;
  question: string;
  questionEn: string;
  options: string[];
  /** 选项的英文展示（与 options 一一对应，可省略） */
  optionsEn?: string[];
}

export interface CategoryManifest {
  id: ProductCategory;
  label: string;
  labelEn: string;
  photoSlots: CategoryPhotoSlot[];
  conditionalQuestions: CategoryConditionalQuestion[];
  /** 建议补充的文档类型（展示为提示，不强制） */
  documentHints: string[];
  documentHintsEn: string[];
  /** 该品类的诚实边界：不能仅凭照片断言的结论 */
  notPhotoAssertable: string;
  notPhotoAssertableEn: string;
  /** 支持市场的补充说明（可选） */
  supportedMarketsNote?: string;
  supportedMarketsNoteEn?: string;
}

const YES_NO = ["是", "否", "不确定"];
const YES_NO_EN = ["Yes", "No", "Not sure"];

export const CATEGORY_MANIFESTS: Record<ProductCategory, CategoryManifest> = {
  "3c": {
    id: "3c",
    label: "数码配件",
    labelEn: "Digital accessories",
    photoSlots: [
      {
        view: "front_back",
        label: "正 / 反面整体",
        labelEn: "Front / back overall",
        hint: "完整机身、品牌与外观轮廓",
        hintEn: "Full body, brand, and outline",
      },
      {
        view: "nameplate",
        label: "铭牌 / 标签近照",
        labelEn: "Nameplate / label close-up",
        hint: "型号、输入输出电压、制造商信息",
        hintEn: "Model, input/output voltage, manufacturer",
      },
      {
        view: "ports_packaging",
        label: "接口与包装",
        labelEn: "Ports and packaging",
        hint: "插头端口、包装标识与警示语",
        hintEn: "Plug, ports, package marks, and warnings",
      },
    ],
    conditionalQuestions: [
      {
        id: "builtin_battery",
        question: "是否内置电池？",
        questionEn: "Does it contain a built-in battery?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
      {
        id: "wireless",
        question: "是否含无线功能（蓝牙 / Wi-Fi）？",
        questionEn: "Does it include wireless features (Bluetooth / Wi-Fi)?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
      {
        id: "input_voltage",
        question: "输入电压是多少？",
        questionEn: "What is the input voltage?",
        options: ["100-240V 宽压", "220V 单压", "5V USB 供电", "其他 / 不确定"],
        optionsEn: ["100-240V wide range", "220V only", "5V USB powered", "Other / not sure"],
      },
      {
        id: "adapter_included",
        question: "是否随附电源适配器？",
        questionEn: "Is a power adapter included?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
    ],
    documentHints: ["产品规格书", "适配器规格（如适用）", "已有测试报告（如有）"],
    documentHintsEn: ["Product spec sheet", "Adapter spec (if any)", "Existing test reports (if any)"],
    notPhotoAssertable:
      "EMC、电气安全与材料限值是否通过，需要测试报告或认证证明，不能仅凭照片断言。",
    notPhotoAssertableEn:
      "EMC, electrical-safety, and material-limit compliance needs test reports or certificates — photos alone cannot assert this.",
  },
  electronics: {
    id: "electronics",
    label: "3C 电子",
    labelEn: "3C electronics",
    photoSlots: [
      {
        view: "front_back",
        label: "正 / 反面整体",
        labelEn: "Front / back overall",
        hint: "完整机身、品牌与外观轮廓",
        hintEn: "Full body, brand, and outline",
      },
      {
        view: "nameplate",
        label: "铭牌 / 标签近照",
        labelEn: "Nameplate / label close-up",
        hint: "型号、输入输出电压、制造商信息",
        hintEn: "Model, input/output voltage, manufacturer",
      },
      {
        view: "ports_packaging",
        label: "接口与包装",
        labelEn: "Ports and packaging",
        hint: "插头端口、包装标识与警示语",
        hintEn: "Plug, ports, package marks, and warnings",
      },
    ],
    conditionalQuestions: [
      {
        id: "builtin_battery",
        question: "是否内置电池？",
        questionEn: "Does it contain a built-in battery?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
      {
        id: "wireless",
        question: "是否含无线功能（蓝牙 / Wi-Fi）？",
        questionEn: "Does it include wireless features (Bluetooth / Wi-Fi)?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
      {
        id: "input_voltage",
        question: "输入电压是多少？",
        questionEn: "What is the input voltage?",
        options: ["100-240V 宽压", "220V 单压", "5V USB 供电", "其他 / 不确定"],
        optionsEn: ["100-240V wide range", "220V only", "5V USB powered", "Other / not sure"],
      },
      {
        id: "adapter_included",
        question: "是否随附电源适配器？",
        questionEn: "Is a power adapter included?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
    ],
    documentHints: ["产品规格书", "适配器规格（如适用）", "已有测试报告（如有）"],
    documentHintsEn: ["Product spec sheet", "Adapter spec (if any)", "Existing test reports (if any)"],
    notPhotoAssertable:
      "EMC、电气安全与材料限值是否通过，需要测试报告或认证证明，不能仅凭照片断言。",
    notPhotoAssertableEn:
      "EMC, electrical-safety, and material-limit compliance needs test reports or certificates — photos alone cannot assert this.",
  },
  appliance: {
    id: "appliance",
    label: "家电",
    labelEn: "Home appliance",
    photoSlots: [
      {
        view: "overall",
        label: "整机整体照",
        labelEn: "Whole-unit photo",
        hint: "完整产品形态与主体结构",
        hintEn: "Complete product form and main structure",
      },
      {
        view: "nameplate",
        label: "铭牌 / 铭标近照",
        labelEn: "Nameplate close-up",
        hint: "额定电压功率、型号、制造商信息",
        hintEn: "Rated voltage/power, model, manufacturer",
      },
      {
        view: "plug_warnings",
        label: "插头与操作警告",
        labelEn: "Plug and operating warnings",
        hint: "插头类型、机身警示语与说明书摘录",
        hintEn: "Plug type, on-body warnings, manual excerpt",
      },
    ],
    conditionalQuestions: [
      {
        id: "mains_powered",
        question: "是否为市电（AC 供电）产品？",
        questionEn: "Is it mains-powered (AC)?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
      {
        id: "heating_or_motor",
        question: "是否包含加热或电机部件？",
        questionEn: "Does it include heating or motor parts?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
      {
        id: "usage_scenario",
        question: "主要用途是家用还是特殊用途？",
        questionEn: "Is it for household or special-purpose use?",
        options: ["家用", "专业 / 商用", "不确定"],
        optionsEn: ["Household", "Professional / commercial", "Not sure"],
      },
    ],
    documentHints: ["产品规格书 / 说明书", "已有安规或温升测试报告（如有）"],
    documentHintsEn: ["Product spec / manual", "Existing safety or temperature-rise reports (if any)"],
    notPhotoAssertable:
      "安规与温升测试是否通过需要实验室报告；照片只能核对标识与警示，不能替代测试结论。",
    notPhotoAssertableEn:
      "Safety and temperature-rise compliance requires lab reports; photos can only verify marks and warnings, not test results.",
  },
  toy: {
    id: "toy",
    label: "玩具",
    labelEn: "Toys",
    photoSlots: [
      {
        view: "overall",
        label: "产品整体照",
        labelEn: "Overall product photo",
        hint: "完整玩具形态，避免只拍局部",
        hintEn: "Full product view — avoid partial shots",
      },
      {
        view: "package_age_warning",
        label: "包装与年龄警告",
        labelEn: "Packaging and age warnings",
        hint: "包装上的年龄标识、警告语与 Symbols",
        hintEn: "Age grading, warnings, and symbols on the package",
      },
      {
        view: "accessories_flat",
        label: "附件平铺照",
        labelEn: "Accessories flat-lay",
        hint: "所有小附件平铺排列，便于核数量",
        hintEn: "Lay out all small parts for counting",
      },
    ],
    conditionalQuestions: [
      {
        id: "age_grade",
        question: "目标适用年龄是？",
        questionEn: "What is the target age grade?",
        options: ["0-3 岁", "3-6 岁", "6-14 岁", "14 岁以上", "不确定"],
        optionsEn: ["0-3 yrs", "3-6 yrs", "6-14 yrs", "14+ yrs", "Not sure"],
      },
      {
        id: "magnets",
        question: "是否含磁体部件？",
        questionEn: "Does it contain magnets?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
      {
        id: "cords_ropes",
        question: "是否含绳带 / 弹性部件？",
        questionEn: "Does it include cords, ropes, or elastic parts?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
      {
        id: "battery",
        question: "是否含电池（内置或随附）？",
        questionEn: "Does it include batteries (built-in or bundled)?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
    ],
    documentHints: ["年龄分级说明", "材料 / 涂层来源证明", "已有测试报告（如有）"],
    documentHintsEn: ["Age-grading notes", "Material / coating source documents", "Existing test reports (if any)"],
    notPhotoAssertable:
      "小零件量规、拉力、磁通量与迁移限值需要实验室测试；年龄声明也不能替代包装上的年龄标注证据。",
    notPhotoAssertableEn:
      "Small-parts gauge, tension, magnetic-flux, and migration limits require lab testing; an age claim cannot replace on-package age labeling evidence.",
  },
  home: {
    id: "home",
    label: "家居",
    labelEn: "Home goods",
    photoSlots: [
      {
        view: "overall",
        label: "整体照",
        labelEn: "Overall photo",
        hint: "完整产品与使用场景形态",
        hintEn: "Complete product and usage form",
      },
      {
        view: "joints_load_points",
        label: "连接 / 受力处近照",
        labelEn: "Joints / load-bearing points",
        hint: "接口、铰链、承重结构等关键部位",
        hintEn: "Interfaces, hinges, load-bearing structures",
      },
      {
        view: "warning_labels",
        label: "警告标签",
        labelEn: "Warning labels",
        hint: "警示语、承重标识与安装说明",
        hintEn: "Warnings, load rating, and installation notes",
      },
    ],
    conditionalQuestions: [
      {
        id: "child_use",
        question: "是否可能被儿童使用？",
        questionEn: "Could children use it?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
      {
        id: "load_capacity",
        question: "标称承重是多少？",
        questionEn: "What is the rated load capacity?",
        options: ["≤30kg", "30-100kg", ">100kg", "不适用", "不确定"],
        optionsEn: ["≤30kg", "30-100kg", ">100kg", "Not applicable", "Not sure"],
      },
      {
        id: "electrical",
        question: "是否含电气部件？",
        questionEn: "Does it include electrical parts?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
    ],
    documentHints: ["结构 / 材料说明", "安装说明书", "已有测试报告（如有）"],
    documentHintsEn: ["Structure / material notes", "Installation manual", "Existing test reports (if any)"],
    notPhotoAssertable:
      "稳定性、阻燃与承重性能需要测试数据；照片只能核对标识与外观，不能证明结构安全。",
    notPhotoAssertableEn:
      "Stability, flame-retardance, and load performance need test data; photos verify marks and appearance only, not structural safety.",
  },
  battery: {
    id: "battery",
    label: "电池 / 储能",
    labelEn: "Battery / energy storage",
    photoSlots: [
      {
        view: "nameplate",
        label: "铭牌 / 铭标近照",
        labelEn: "Nameplate close-up",
        hint: "型号、化学体系、容量与 Wh 数",
        hintEn: "Model, chemistry, capacity, and Wh rating",
      },
      {
        view: "terminals",
        label: "端子 / 接口近照",
        labelEn: "Terminals / connectors",
        hint: "正负极端子与防短路设计",
        hintEn: "Terminals and short-circuit protection",
      },
      {
        view: "appearance",
        label: "外观整体",
        labelEn: "Overall appearance",
        hint: "外壳完整、无鼓包破损",
        hintEn: "Intact casing — no swelling or damage",
      },
      {
        view: "transport_marks",
        label: "包装运输标识",
        labelEn: "Package transport marks",
        hint: "UN38.3、堆码与锂电池运输标记",
        hintEn: "UN38.3, stacking, and lithium-battery transport marks",
      },
    ],
    conditionalQuestions: [
      {
        id: "battery_chemistry",
        question: "电池类型是？",
        questionEn: "What is the battery chemistry?",
        options: ["锂离子 / 锂聚合物", "镍氢", "碱性干电池", "其他", "不确定"],
        optionsEn: ["Li-ion / Li-Po", "NiMH", "Alkaline", "Other", "Not sure"],
      },
      {
        id: "capacity_wh",
        question: "容量 / Wh 数大约是？",
        questionEn: "Approximate capacity / Wh?",
        options: ["≤100Wh", "100-500Wh", ">500Wh", "不确定"],
        optionsEn: ["≤100Wh", "100-500Wh", ">500Wh", "Not sure"],
      },
      {
        id: "usage",
        question: "主要用途是？",
        questionEn: "What is the primary use?",
        options: ["消费类便携", "设备随附", "工业 / 动力", "不确定"],
        optionsEn: ["Consumer portable", "Bundled with device", "Industrial / power", "Not sure"],
      },
    ],
    documentHints: ["UN38.3 或热安全测试报告（如有）", "规格书与 MSDS"],
    documentHintsEn: ["UN38.3 or thermal-safety report (if any)", "Spec sheet and MSDS"],
    notPhotoAssertable:
      "UN38.3 或热安全测试是否通过必须以报告为准；照片不能证明运输或储能安全。",
    notPhotoAssertableEn:
      "UN38.3 / thermal-safety pass status must come from reports; photos cannot prove transport or storage safety.",
  },
  cosmetic: {
    id: "cosmetic",
    label: "化妆品",
    labelEn: "Cosmetics",
    photoSlots: [
      {
        view: "front_back_labels",
        label: "正 / 背面标签",
        labelEn: "Front / back labels",
        hint: "标签完整、可读的多面照片",
        hintEn: "Complete, readable photos of all labeled sides",
      },
      {
        view: "ingredients",
        label: "成分表近照",
        labelEn: "Ingredient list close-up",
        hint: "成分全表按顺序完整可读",
        hintEn: "Full ingredient list, in order and readable",
      },
      {
        view: "net_content_batch",
        label: "净含量与批次",
        labelEn: "Net content and batch",
        hint: "净含量、批号与限期使用标识",
        hintEn: "Net content, batch code, and PAO/period-after-opening",
      },
    ],
    conditionalQuestions: [
      {
        id: "purpose",
        question: "产品用途是？",
        questionEn: "What is the product's purpose?",
        options: ["普通护肤 / 彩妆", "特殊用途（防晒 / 染发等）", "不确定"],
        optionsEn: ["General skincare / makeup", "Special purpose (sunscreen / hair dye)", "Not sure"],
      },
      {
        id: "target_group",
        question: "目标人群是？",
        questionEn: "Who is the target group?",
        options: ["成人", "儿童 / 婴幼儿", "不确定"],
        optionsEn: ["Adults", "Children / infants", "Not sure"],
      },
      {
        id: "claims",
        question: "是否有功效宣称（如美白 / 抗皱）？",
        questionEn: "Does it carry efficacy claims (e.g. whitening / anti-wrinkle)?",
        options: ["无宣称", "有宣称", "不确定"],
        optionsEn: ["No claims", "Has claims", "Not sure"],
      },
    ],
    documentHints: ["完整成分表（INCI）", "已有安全评估或备案证明（如有）"],
    documentHintsEn: ["Full ingredient list (INCI)", "Existing safety assessment or filing (if any)"],
    notPhotoAssertable:
      "成分安全与市场备案状态需要文件证据；照片只能核对标签呈现，不能证明成分合规。",
    notPhotoAssertableEn:
      "Ingredient safety and market filing status require documents; photos verify label presentation only, not formulation compliance.",
  },
  textile: {
    id: "textile",
    label: "纺织服装",
    labelEn: "Textile & apparel",
    photoSlots: [
      {
        view: "overall",
        label: "整体穿着 / 平铺照",
        labelEn: "Overall worn / flat-lay",
        hint: "完整版型与整体外观",
        hintEn: "Full silhouette and overall look",
      },
      {
        view: "fiber_care_origin",
        label: "成分 / 护理 / 原产地标签",
        labelEn: "Fiber / care / origin label",
        hint: "纤维成分、洗护图标与原产国",
        hintEn: "Fiber content, care symbols, and country of origin",
      },
      {
        view: "drawstrings_details",
        label: "绳带与细节",
        labelEn: "Drawstrings and details",
        hint: "帽绳、腰绳等绳带与关键细节",
        hintEn: "Hood/waist drawstrings and key details",
      },
    ],
    conditionalQuestions: [
      {
        id: "age_group",
        question: "适用人群是？",
        questionEn: "What is the age group?",
        options: ["成人", "儿童", "不确定"],
        optionsEn: ["Adults", "Children", "Not sure"],
      },
      {
        id: "drawstrings",
        question: "是否含绳带（帽绳 / 腰绳）？",
        questionEn: "Does it include drawstrings (hood / waist)?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
      {
        id: "protective_use",
        question: "是否作为防护用途（如阻燃 / 防晒）？",
        questionEn: "Is it for protective use (flame-retardant / UV)?",
        options: ["否", "是", "不确定"],
        optionsEn: ["No", "Yes", "Not sure"],
      },
    ],
    documentHints: ["纤维成分检测 / 供应商声明", "洗护说明文件"],
    documentHintsEn: ["Fiber-content test / supplier declaration", "Care instruction documents"],
    notPhotoAssertable:
      "色牢度与禁用物质是否达标需要检测报告；照片不能证明纤维成分或化学安全。",
    notPhotoAssertableEn:
      "Color-fastness and restricted-substance compliance requires test reports; photos cannot prove fiber content or chemical safety.",
  },
  food_contact: {
    id: "food_contact",
    label: "食品接触",
    labelEn: "Food-contact products",
    photoSlots: [
      {
        view: "overall",
        label: "整体照",
        labelEn: "Overall photo",
        hint: "完整产品形态与使用状态",
        hintEn: "Complete product form and usage state",
      },
      {
        view: "contact_surface",
        label: "接触面近照",
        labelEn: "Contact-surface close-up",
        hint: "与食品直接接触的表面材质",
        hintEn: "Surfaces that directly touch food",
      },
      {
        view: "material_use_label",
        label: "材质与用途标签",
        labelEn: "Material / use labels",
        hint: "材质标识（如玻璃杯 / 杯叉标志）与使用条件",
        hintEn: "Material marks (glass-fork symbol) and use conditions",
      },
    ],
    conditionalQuestions: [
      {
        id: "food_contact",
        question: "是否直接接触食品？",
        questionEn: "Does it directly contact food?",
        options: YES_NO,
        optionsEn: YES_NO_EN,
      },
      {
        id: "temperature",
        question: "接触温度范围是？",
        questionEn: "What is the contact temperature range?",
        options: ["常温", "热饮 / 热食（≤100°C）", "高温（>100°C）", "不确定"],
        optionsEn: ["Room temperature", "Hot food / drink (≤100°C)", "High temp (>100°C)", "Not sure"],
      },
      {
        id: "reuse",
        question: "一次性使用还是重复使用？",
        questionEn: "Single-use or reusable?",
        options: ["一次性", "重复使用", "不确定"],
        optionsEn: ["Single-use", "Reusable", "Not sure"],
      },
    ],
    documentHints: ["材质声明 / 供应商证明", "已有迁移测试报告（如有）"],
    documentHintsEn: ["Material declaration / supplier certificate", "Existing migration test report (if any)"],
    notPhotoAssertable:
      "材质真实成分与迁移测试结果需要检测文件；照片只能核对标识与外观，不能证明食品级安全。",
    notPhotoAssertableEn:
      "True material composition and migration results require lab documents; photos verify marks and appearance only, not food-grade safety.",
  },
  other: {
    id: "other",
    label: "其他",
    labelEn: "Other",
    photoSlots: [
      {
        view: "overall",
        label: "整体照",
        labelEn: "Overall photo",
        hint: "完整产品形态与关键面",
        hintEn: "Complete product form and key faces",
      },
      {
        view: "labels",
        label: "标签 / 标识",
        labelEn: "Labels / marks",
        hint: "标签、标识与认证信息",
        hintEn: "Labels, marks, and certification info",
      },
      {
        view: "usage_notes",
        label: "用途说明",
        labelEn: "Usage notes",
        hint: "说明书、包装或使用场景说明",
        hintEn: "Manual, packaging, or usage scenario notes",
      },
    ],
    conditionalQuestions: [
      {
        id: "subcategory",
        question: "能否进一步确认具体子类？",
        questionEn: "Can you narrow down the specific subcategory?",
        options: ["属于电子 / 电气类", "属于玩具 / 儿童用品类", "属于材料 / 化学品类", "说不清"],
        optionsEn: [
          "Electronics / electrical",
          "Toys / children's products",
          "Materials / chemicals",
          "Hard to say",
        ],
      },
    ],
    documentHints: ["产品用途说明", "规格书或供应商资料"],
    documentHintsEn: ["Product usage notes", "Spec sheet or supplier documents"],
    notPhotoAssertable:
      "「其他」类结论依赖具体子类确认；套用通用品类清单后不能直接作完整合规判断，建议先确认子类。",
    notPhotoAssertableEn:
      "\"Other\" conclusions depend on confirming the specific subcategory; a generic checklist is not a complete compliance verdict — confirm the subcategory first.",
  },
};

export function getCategoryManifest(category: ProductCategory): CategoryManifest {
  return CATEGORY_MANIFESTS[category] ?? CATEGORY_MANIFESTS.other;
}

export const CATEGORY_MANIFEST_IDS = Object.keys(CATEGORY_MANIFESTS) as ProductCategory[];
