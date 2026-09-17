import type { CitationVM } from "@/lib/result/inspection-view-model";

type Locale = "zh" | "en";

export type FactRiskContext = {
  summary: string;
  explanation: string;
  evidenceToVerify: string;
  citations: CitationVM[];
};

type LocalizedContext = {
  zh: Omit<FactRiskContext, "citations">;
  en: Omit<FactRiskContext, "citations">;
  citations: CitationVM[];
};

function citation(
  docId: string,
  articleId: string,
  officialCitation: string,
  quote: string,
): CitationVM {
  return {
    key: `fact-context:${docId}#${articleId}`,
    docId,
    articleId,
    officialCitation,
    quote,
    quoteProvenance: "canonical_article_excerpt",
    quoteSpan: null,
    matchStatus: "matched",
    duplicates: 1,
  };
}

const AGE_SCOPE = citation(
  "US-16-CFR-1200",
  "section-1200-2-a",
  "16 CFR § 1200.2(a)",
  "A children's product means a consumer product designed or intended primarily for children 12 years of age or younger. Whether a product is primarily intended for children 12 years of age or younger is determined by considering four factors: a reasonable statement by the manufacturer about intended use; representations in packaging, display, promotion, or advertising; common consumer recognition; and the Commission's Age Determination Guidelines.",
);
const AGE_LABEL = citation(
  "US-16-CFR-1200",
  "section-1200-2-c1",
  "16 CFR § 1200.2(c)(1)",
  "A manufacturer's statement about the product's intended use, including the product's label, should be reasonably consistent with expected use patterns. A statement that the product is not intended for children does not preclude it from being regulated as a children's product if its primary appeal is to children 12 years of age or younger. The manufacturer's label, in and of itself, is not determinative.",
);
const AGE_PRESENTATION = citation(
  "US-16-CFR-1200",
  "section-1200-2-c2-c4",
  "16 CFR § 1200.2(c)(2)-(4)",
  "Product representations may be express or implied and may appear in packaging, text, illustrations, photographs, instructions, assembly manuals, or advertising. Consumer perception and reasonably foreseeable use are evaluated, and the product's appeal to different age groups may be considered under the Commission's Age Determination Guidelines.",
);
const TOY_STANDARD = citation(
  "US-16-CFR-1250",
  "section-1250-2-a",
  "16 CFR § 1250.2(a)",
  "Each toy must comply with all applicable provisions of ASTM F963-23; the applicable edition depends on the manufacture date.",
);
const CPC = citation(
  "US-CPSIA",
  "section-2063-a2",
  "15 USC § 2063(a)(2)",
  "A manufacturer or private labeler shall issue either a separate certificate for each children’s product safety rule applicable to a product or a combined certificate that certifies compliance with all applicable children’s product safety rules, in which case each such rule shall be specified.",
);
const TRACKING = citation(
  "US-CPSIA",
  "section-2063-a5",
  "15 USC § 2063(a)(5)(A)",
  "Effective 1 year after August 14, 2008, the manufacturer of a children’s product shall place permanent, distinguishing marks on the product and its packaging, to the extent practicable, that will enable— (i) the manufacturer to ascertain the location and date of production of the product, cohort information (including the batch, run number, or other identifying characteristic), and any other information determined by the manufacturer to facilitate ascertaining the specific source of the product by reference to those marks; and (ii) the ultimate purchaser to ascertain the manufacturer or private labeler, location and date of production of the product, and cohort information (including the batch, run number, or other identifying characteristic).",
);
const BUTTON_WARNING = citation(
  "US-16-CFR-1263",
  "guidance-product-requirements",
  "16 CFR § 1263.3 · CPSC product guidance",
  "Per ANSI/UL 4200A-2023, the requirements for consumer products containing or designed to use button cell or coin batteries are as follows: Battery compartments containing replaceable button cell or coin batteries must be secured such that they require the use of a tool or at least two independent and simultaneous hand movements to open. Button cell or coin battery compartments must not allow such batteries to be accessed or liberated as a result of use and abuse testing. The packaging for the overall product must bear a warning. The product itself must bear a warning, if practicable. Accompanying instructions and manuals must include all of the applicable warnings.",
);

const US_CONTEXTS: Record<string, LocalizedContext> = {
  "toy.age_range.label": {
    zh: {
      summary: "18+只是年龄定位证据之一；儿童产品适用范围仍未闭环。",
      explanation: "照片确认包装标有18+，但美国规则不允许仅凭这一标签排除儿童产品要求。该积木产品仍需结合包装与广告呈现、消费者通常认知、合理可预见用途及CPSC年龄指南，判断其主要面向成人收藏还是12岁及以下儿童。现有材料没有覆盖完整的市场定位证据，因此保持关联中风险。",
      evidenceToVerify: "官网商品页与广告受众、零售分类和陈列、包装正反面完整信息、年龄分级评估记录。",
    },
    en: {
      summary: "The 18+ mark is one age-grading input; children's-product scope remains unresolved.",
      explanation: "The photo confirms an 18+ label, but U.S. rules do not let that label alone exclude children's-product requirements. Packaging and advertising, consumer recognition, foreseeable use, and CPSC age guidance must be assessed together.",
      evidenceToVerify: "Official listing and target audience, retail classification, complete packaging, and an age-determination record.",
    },
    citations: [AGE_SCOPE, AGE_LABEL],
  },
  "common.product.overview": {
    zh: {
      summary: "积木造型与玩耍价值会影响年龄适用判断，单张外观图不足以定性。",
      explanation: "棕色巫师帽积木造型能确认产品身份，但主题、拼搭玩法和儿童吸引力也是CPSC判断产品主要使用人群时会考虑的事实。当前照片无法证明该产品在市场上主要作为成人收藏品销售，也不能反向证明其主要供儿童玩耍，因此保持关联中风险。",
      evidenceToVerify: "商品页受众表述、包装人物与场景、销售渠道、说明书定位及消费者通常认知材料。",
    },
    en: {
      summary: "Construction-play features affect age classification; an overview photo cannot resolve scope.",
      explanation: "The overview identifies the product, while theme, play value, marketing and foreseeable use also affect whether it is primarily a children's product or an adult collectible.",
      evidenceToVerify: "Audience claims, packaging imagery, retail channel, instructions and consumer-perception evidence.",
    },
    citations: [AGE_PRESENTATION],
  },
  "common.nameplate.readability": {
    zh: {
      summary: "型号文字可读，但缺少把实物对应到生产批次的追溯字段。",
      explanation: "照片能读出LEGO 76429等产品信息，却没有显示生产地点、生产日期或可对应证书的批次/队列标识。若该产品被认定为儿童产品，产品与包装在可行范围内都应提供可追溯标识；当前关联的“批次与追溯信息”检查已被判为需补证，因此标为关联高风险。",
      evidenceToVerify: "产品本体和包装上的永久追溯码、生产地点与日期、批次/运行号，以及这些字段与证书和测试报告的对应关系。",
    },
    en: {
      summary: "The model text is readable, but batch-level traceability is not visible.",
      explanation: "The image identifies LEGO 76429 but does not show production place/date or a cohort mark linking the unit to its certificate. The related traceability check is blocked.",
      evidenceToVerify: "Permanent product/package code, production place/date, batch or run number, and linkage to certificates and reports.",
    },
    citations: [TRACKING],
  },
  "common.certification_marks.visible": {
    zh: {
      summary: "可见警告三角形不是CPC，也不能证明ASTM F963测试覆盖当前批次。",
      explanation: "照片中的警告三角形属于危险提示符号，不是儿童产品证书或实验室测试通过标志。若适用儿童玩具规则，必须确认适用的ASTM F963版本，并由CPSC认可实验室测试支持CPC。当前机械物理和化学测试报告均未闭环，因此标为关联高风险。",
      evidenceToVerify: "当前批次的CPC、CPSC认可实验室信息、完整机械物理与化学测试报告、生产日期及适用ASTM版本。",
    },
    en: {
      summary: "A warning triangle is not a CPC and does not prove ASTM F963 coverage for this batch.",
      explanation: "The visible symbol is a hazard warning, not evidence of certification. Applicable toy-standard testing and the CPC remain unsupported for the current batch.",
      evidenceToVerify: "Batch-specific CPC, accepted-lab details, complete mechanical/chemical reports, manufacture date and applicable ASTM edition.",
    },
    citations: [TOY_STANDARD, CPC],
  },
  "common.brand_model.visible": {
    zh: {
      summary: "品牌型号能确认产品身份，但不能把本件实物追溯到证书批次。",
      explanation: "LEGO 76429清晰可读，只能确认品牌和型号；同一型号可能跨越不同生产地点、日期或批次。当前照片没有足以把实物与Mar 2024证书批次对应的永久追溯信息，关联检查已被判为需补证，因此标为关联高风险。",
      evidenceToVerify: "产品和包装追溯码、生产日期与地点、批次号，以及证书中型号/批次范围与实物的一致性。",
    },
    en: {
      summary: "Brand and model identify the product family but not the certificate batch.",
      explanation: "LEGO 76429 is readable, but the image lacks permanent cohort information linking this unit to the March 2024 certificate batch.",
      evidenceToVerify: "Product/package tracking code, production date/place, batch number and certificate-to-unit linkage.",
    },
    citations: [TRACKING, CPC],
  },
  "common.warning_text.language": {
    zh: {
      summary: "英文警示已入镜，相关警示检查有证据支持；仍需核对完整内容与版式。",
      explanation: "照片显示英文WARNING及纽扣电池吞咽危险信息，与美国纽扣电池规则要求的警示方向一致，因此当前未发现关联阻断项，标为关联低风险。但低风险不等于整项合规：照片仍不能完整验证文字内容、字号/对比度、永久性，以及产品本体和说明书是否同步警示。",
      evidenceToVerify: "包装完整警示版式、产品本体警示、说明书警示和标签耐久性资料。",
    },
    en: {
      summary: "An English battery warning is visible and supports the related check; full content and format still need review.",
      explanation: "The visible WARNING and ingestion-hazard text align with the applicable warning purpose, so no related blocker is currently identified. This is not full clearance.",
      evidenceToVerify: "Complete package layout, product warning, instructions and label permanence.",
    },
    citations: [BUTTON_WARNING],
  },
  "common.packaging.info": {
    zh: {
      summary: "包装描述可读，但批次追溯和纽扣电池警示覆盖仍未全部闭环。",
      explanation: "多语言产品描述可以确认包装信息存在，但当前画面没有显示足以追溯生产地点、日期和批次的标识，也不能确认纽扣电池警示是否覆盖包装、产品及说明书全部要求。批次追溯检查已被判为需补证，因此标为关联高风险。",
      evidenceToVerify: "包装六面高清图、追溯标识、纽扣电池警示完整版式、产品本体与说明书警示。",
    },
    en: {
      summary: "Package copy is readable, while batch traceability and battery-warning coverage remain incomplete.",
      explanation: "The visible multilingual description confirms packaging content but not required cohort data or complete warning coverage. The related traceability check is blocked.",
      evidenceToVerify: "All package panels, tracking marks, full battery-warning layout, product and instruction warnings.",
    },
    citations: [TRACKING, BUTTON_WARNING],
  },
  "common.defects.visible": {
    zh: {
      summary: "照片未见明显外观异常，但视觉筛查不能代替玩具机械物理测试。",
      explanation: "现有照片未发现裂损、变形或明显锐边，这是有限范围内的有利证据；但16 CFR 1250.2纳入的玩具安全要求需要相应测试来验证机械强度、小零件、锐边等风险。当前机械物理测试报告尚未闭环，因此保持关联中风险，而不是低风险或通过。",
      evidenceToVerify: "当前批次机械物理报告、跌落/拉力/小零件与锐边测试记录，以及必要的样品复核。",
    },
    en: {
      summary: "No obvious visible defect is seen, but visual screening cannot replace toy mechanical testing.",
      explanation: "The photos provide favorable visible-scope evidence, while mandatory toy-safety testing is still needed for mechanical strength, small parts and sharp-edge risks.",
      evidenceToVerify: "Batch-specific mechanical report, drop/tension/small-parts/sharp-edge records and sample review.",
    },
    citations: [TOY_STANDARD],
  },
};

export function factRiskContext(checkId: string, market: string, locale: Locale): FactRiskContext {
  const context = market === "US" ? US_CONTEXTS[checkId] : undefined;
  if (!context) {
    return locale === "zh"
      ? { summary: "关联检查状态用于确定处理优先级。", explanation: "该标识来自相关适用检查的证据状态，不把产品事实本身直接判为合规或不合规。", evidenceToVerify: "核对关联检查所列的产品证据、文件与适用法条。", citations: [] }
      : { summary: "Related-check status determines review priority.", explanation: "The label reflects evidence state and is not a direct conformity verdict on the product fact.", evidenceToVerify: "Review the evidence, documents and legal basis listed by the related checks.", citations: [] };
  }
  return { ...context[locale], citations: context.citations };
}
