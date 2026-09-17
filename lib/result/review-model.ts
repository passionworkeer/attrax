import type { ScanResult } from "@/lib/types";
import { assessReview } from "./review-assessment";
import { buildInspectionResultViewModel, type CheckResultVM, type CitationVM } from "./inspection-view-model";
import {actionLabel, checkLabel} from "./check-labels";

export const reviewGroups = [
  { id: "radio", zh: "无线与电磁兼容", en: "Radio & EMC", match: /wireless|radio|emc|bluetooth|wifi/ },
  { id: "identity", zh: "铭牌与产品追溯", en: "Identity & traceability", match: /brand|model|nameplate|batch|trace|packaging/ },
  { id: "safety", zh: "安全与功能", en: "Safety & function", match: /safety|voltage|power|plug|adapter|cable|functional|ip_rating|anomal|battery|mechanical|small_parts|magnets_cords|sharp_edges|defects/ },
  { id: "material", zh: "材料与接触安全", en: "Materials & contact safety", match: /material|chemical|food|contact|ingredient|textile/ },
  { id: "label", zh: "标识、警示与文件", en: "Markings & documentation", match: /./ },
] as const;

export function groupForCheck(id: string) { return reviewGroups.find(group => group.match.test(id))!; }
export function citationMarket(citation: CitationVM): string | null {
  const prefix = citation.docId.split("-")[0];
  return ["EU", "US", "UK", "CN", "JP", "AU"].includes(prefix) ? prefix : null;
}
export function directCitations(check: CheckResultVM, citations: CitationVM[], market: string) {
  const refs = new Set(check.findings.flatMap(f => f.citationIds));
  return citations.filter(c => (citationMarket(c) === null || citationMarket(c) === market) &&
    [c.key, `${c.docId}#${c.articleId}`, `${c.docId}::${c.articleId}`].some(ref => refs.has(ref)));
}
export function buildReview(result: ScanResult, market: string) {
  const vm = buildInspectionResultViewModel({result, sessionId: result.sessionId});
  const citations = vm.citations.filter(c => citationMarket(c) === market || citationMarket(c) === null);
  const risks = result.riskPoints.filter(r => r.regulations.some(ref => ref.market === market));
  // A legacy aggregate verdict cannot be silently promoted to a market-specific clearance.
  const claims = (result.reportPackage?.reviewClaims || []).filter(c=>c.market===market && c.verificationVersion==="review-links/v1");
  const blocked = risks.some(r => r.severity === "critical") || claims.some(c=>c.status==="blocked" && !c.verificationIssues.length);
  const supportedChecks = new Set(claims.filter(c=>["supported","not_applicable"].includes(c.status) && !c.verificationIssues.length).map(c=>c.checkId));
  const unresolvedChecks = vm.checks.filter(c=>!supportedChecks.has(c.checkId));
  const applicable = result.reportPackage?.anchorApplicability?.filter(a=>a.market===market) || [];
  const scopeReady = applicable.length>0 && applicable.every(a=>a.state!=="needs_confirmation");
  const complete = vm.checks.length>0 && !unresolvedChecks.length && scopeReady && !risks.length &&
    !["invalid","fallback"].includes(result.reportPackage?.auditMetadata?.validationStatus||"") && result.source!=="demo";
  const status: "blocked"|"unknown"|"supported" = blocked?"blocked":complete?"supported":"unknown";
  return {vm, citations, risks, claims, status, unresolvedChecks,
    scoringEligible: result.source === "real" && !["invalid","fallback"].includes(result.reportPackage?.auditMetadata?.validationStatus||""),
    groups: reviewGroups.map(group => ({...group, checks: vm.checks.filter(c => groupForCheck(c.checkId).id === group.id)})).filter(g => g.checks.length),
  };
}

export function reviewStatusLabel(status:"blocked"|"unknown"|"supported",locale:"zh"|"en") {
  return locale==="zh"?({blocked:"暂不可进入",unknown:"待确认",supported:"可进入下一步审核"}[status]):({blocked:"Hold entry",unknown:"Unconfirmed",supported:"Ready for next review"}[status]);
}

export function claimIssueLabel(issue:string,locale:"zh"|"en") {
  const labels:Record<string,string>={scope_only_legal_basis:"仅引用了法规适用范围，尚缺具体要求依据",invalid_or_out_of_market_citation:"法条未收录或不属于当前市场",invalid_observation:"部分图片观察未能对应本检查项",invalid_document_excerpt:"文件引文未在实际输入中找到",legal_quote_unverified:"法条引文尚未通过逐字核对",product_evidence_missing:"缺少可追溯的产品证据",document_evidence_required:"该项需要文件证据，照片不足以判断",reason_missing:"判断或适用理由不完整"};
  return locale==="zh"?(labels[issue]||"关联依据需进一步核对"):issue.replaceAll("_"," ");
}

export function reviewSummary(review:ReturnType<typeof buildReview>,locale:"zh"|"en") {
  if(review.status==="supported")return locale==="zh"?"当前报告覆盖的检查已有对应依据，可进入下一步审核。此结论限于本次检查范围，不是市场准入许可。":"Evidence supports the checks covered by this report. Proceed to the next review; this is not market authorization.";
  if(review.status==="blocked")return locale==="zh"?"该市场存在需要先处理的风险，查看分项原因、产品证据及适用法条。":"This market has risks to address first. Review the reasons, product evidence and applicable provisions.";
  const observed=review.vm.checks.filter(c=>c.coverage==="observed").length;
  const documented=review.claims.filter(c=>c.documentEvidence.length>0).length;
  return locale==="zh"?`已识别 ${observed} 项图片信息，${documented} 项检查已关联文件证据。仍需核对下方列出的证据缺口与法规适用性，当前不能直接确认市场准入。`:`${observed} photo checks recorded; ${documented} checks link to document evidence. Review the remaining evidence gaps and applicability before a market-entry decision.`;
}

export function assessmentConclusion(options:{
  title:string;
  market:string;
  factCount:number;
  assessment:ReturnType<typeof assessReview>;
  locale:"zh"|"en";
}) {
  const {title,market,factCount,assessment,locale}=options;
  const blockedNames=assessment.regulatory
    .filter(row=>row.decided && row.claim?.status==="blocked")
    .map(row=>checkLabel(row.check.checkId,locale,row.check.title));
  if(locale==="zh") {
    const coverage=assessment.decided.length===assessment.regulatory.length
      ? `面向 ${market} 市场的 ${assessment.regulatory.length} 项适用检查已全部完成判断`
      : `面向 ${market} 市场的 ${assessment.regulatory.length} 项适用检查已完成 ${assessment.decided.length} 项判断`;
    const unresolved=assessment.unresolved.length
      ? `，另有 ${assessment.unresolved.length} 项适用判断尚未闭环`
      : "";
    const gate=blockedNames.length
      ? `需优先闭环的项目为${blockedNames.join("、")}。`
      : "当前未发现必须先处理的证据阻断项，可进入下一步专业审核；本预检仍不等于认证或市场准入许可。";
    return `本次识别对象为 ${title}。基于 ${factCount} 项可核对产品事实，${coverage}：${assessment.supported} 项现有证据支持，${assessment.blocked} 项需补证或整改${unresolved}。${gate}`;
  }
  const coverage=assessment.decided.length===assessment.regulatory.length
    ? `all ${assessment.regulatory.length} applicable checks for ${market} have a recorded decision`
    : `${assessment.decided.length} of ${assessment.regulatory.length} applicable checks for ${market} have a recorded decision`;
  const unresolved=assessment.unresolved.length
    ? `, with ${assessment.unresolved.length} still unresolved`
    : "";
  const gate=blockedNames.length
    ? `Priority closure is required for ${blockedNames.join(", ")}. Do not use this precheck as formal compliance clearance until the batch-level evidence is completed and verified.`
    : "No evidence-blocking item was identified. The product may proceed to professional review; this precheck is not certification or market authorization.";
  return `The identified product is ${title}. Based on ${factCount} reviewable product facts, ${coverage}: ${assessment.supported} are evidence-supported and ${assessment.blocked} require evidence or remediation${unresolved}. ${gate}`;
}

export function groupSummary(group:ReturnType<typeof buildReview>["groups"][number],review:ReturnType<typeof buildReview>,locale:"zh"|"en") {
  const claims=review.claims.filter(c=>group.checks.some(check=>check.checkId===c.checkId));
  const ranked=[...claims].sort((a,b)=>({blocked:0,unknown:1,supported:2,not_applicable:3}[a.status])-({blocked:0,unknown:1,supported:2,not_applicable:3}[b.status]));
  const status=ranked.some(c=>c.status==="blocked")?"blocked":group.checks.every(check=>claims.some(c=>c.checkId===check.checkId && ["supported","not_applicable"].includes(c.status)))?"supported":"unknown";
  const action=group.checks.flatMap(c=>c.findings).find(f=>f.suggestedAction)?.suggestedAction;
  const provisional=ranked[0]?.verificationIssues.length?locale==="zh"?"AI意见待核验：":"AI opinion, unverified: ":"";
  const observed=group.checks.filter(c=>c.coverage==="observed").length;
  const documented=claims.filter(c=>c.documentEvidence.length>0).length;
  const supported=claims.filter(c=>["supported","not_applicable"].includes(c.status) && !c.verificationIssues.length).length;
  const pending=Math.max(0,group.checks.length-supported);
  const progress=locale==="zh"?`${observed} 项已识别 · ${documented} 项有文件依据 · ${pending} 项待核对`:`${observed} observed · ${documented} document-backed · ${pending} to review`;
  return {status, progress, text:ranked[0]?.reason?provisional+ranked[0].reason.replace(/\bunknown\b/g,locale==="zh"?"待确认":"unconfirmed"):(action?actionLabel(action,locale):locale==="zh"?"已记录可见产品信息，仍需结合适用法条核验。":"Visible product details recorded; applicable requirements still need verification.")};
}

export function penaltyContext(market: string, citations: CitationVM[]) {
  if(market==="CN" && citations.some(c=>/^CN-GB-/.test(c.docId)))return {
    text:"如实际生产、销售的产品不符合保障人体健康或人身、财产安全的国家、行业标准，《产品质量法》第49条规定可处违法产品货值金额1至3倍罚款，并可停止生产销售、没收产品及违法所得。基数包括已售与未售违法产品，不能按本次上传样品价格计算；缺少检测材料本身不足以认定该违法事实。",
    en:"For production or sale of products failing national or industry health and safety standards, Product Quality Law Article 49 provides a fine of one to three times the value of the offending products, plus possible cessation and confiscation. The base includes sold and unsold offending goods. Missing test evidence alone does not establish this offence.",
    source:"https://scjgj.beijing.gov.cn/cxfw/flfgcxfw/cpzll/202006/t20200618_1928052.html",article:"产品质量法 · 第49条 / 第72条",verifiedAt:"2026-09-16",
  };
  if(market==="UK" && citations.some(c=>/UK.*Appliance/i.test(c.docId)))return {
    text:"如设备及经营行为属于英国电气设备安全法规的适用范围，违反对应义务可能导致限售、撤市或召回；构成违法并被定罪时，可处罚金，严重案件亦可能涉及监禁。英国官方指引未提供可直接套用到本报告的统一罚款金额，由法院按具体案件决定。此处以大不列颠地区为范围，北爱尔兰需单独核对。",
    en:"For equipment and conduct within the Electrical Equipment (Safety) Regulations in Great Britain, enforcement may restrict supply or require withdrawal or recall. Conviction may lead to a fine and, in some cases, imprisonment. The court determines penalties; no uniform monetary estimate is available. Northern Ireland requires separate review.",
    source:"https://www.gov.uk/government/publications/electrical-equipment-safety-regulations-2016/electrical-equipment-safety-regulations-2016-great-britain",article:"Electrical Equipment (Safety) Regulations 2016 · Penalties",verifiedAt:"2026-09-16",
  };
  if (market === "EU" && citations.some(c => c.docId === "EU-2014-35")) return {
    text: "如产品属于低电压指令适用范围，违反成员国转置法律时，处罚按该成员国规定执行；指令第24条未设欧盟统一罚款金额。需结合实际销售国家、责任主体和违法事实核查。缺少报告不等于已违法。",
    en: "For equipment within the Low Voltage Directive, penalties for violations of national implementing law are set by each Member State. Article 24 does not set a uniform EU fine. Missing evidence alone does not establish an infringement.",
    source: "https://eur-lex.europa.eu/eli/dir/2014/35/oj/eng", article: "2014/35/EU · Article 24", verifiedAt: "2026-09-15",
  };
  return {text: "尚未核实与本次问题直接对应的处罚条款，暂不展示金额。需结合销售国家、适用法规及违法事实确认。", en: "No directly applicable penalty provision has been verified for this result. No monetary estimate is shown.", source: "", article: "", verifiedAt: ""};
}

export function reviewAnnex(result: ScanResult, locale: "zh" | "en") {
  const zh = locale === "zh";
  return "\n\n## " + (zh ? "市场结论与证据索引" : "Market conclusions and evidence index") + result.targetMarkets.map(market => {
    const review = buildReview(result, market);
    const assessment = assessReview(review);
    const penalty = penaltyContext(market, review.citations);
    const facts = assessment.rows.filter(row => row.factRecorded);
    const factSection = `\n#### ${zh ? "产品识别结果" : "Product identification results"}\n` +
      (zh ? "以下为图片或上传文件支持的产品事实，不代表法规符合性。\n" : "These are product facts supported by uploaded images or files, not conformity findings.\n") +
      (facts.length ? facts.map(row => `- ${checkLabel(row.check.checkId,locale,row.check.title)}：${row.check.bestObservation?.observedText || row.check.bestObservation?.description || row.claim?.documentEvidence[0]?.quote || (zh ? "已记录" : "Recorded")}\n`).join("") : `- ${zh ? "本次未形成可核对的产品事实。" : "No reviewable product facts were recorded."}\n`);
    const conclusion = assessmentConclusion({title:review.vm.product.title,market,factCount:facts.length,assessment,locale});
    const scoreSection = zh
      ? `\nAI 合规评估：${assessment.score===null?"尚无适用检查可评分":assessment.score+" / 100"}。判断覆盖：${assessment.decided.length} / ${assessment.regulatory.length} 项；有据支持 ${assessment.supported} 项，需处理 ${assessment.blocked} 项。\n总体评价：${conclusion}\n评分规则：有据支持项÷潜在适用项，结果向下取整；纯识别与已确认不适用项排除，需处理和证据未闭环项暂不得分。不代表准入概率。\nAI预检；未将共用检查、有限视觉筛查或汇总结论视为独立市场准入证明。\n`
      : `\nAI assessment: ${assessment.score??"no applicable checks to score"}/100. Assessment coverage: ${assessment.decided.length}/${assessment.regulatory.length}; ${assessment.supported} evidence-supported and ${assessment.blocked} action-required. Overall conclusion: ${conclusion} The whole-number score is rounded down. Identity-only and confirmed inapplicable checks are excluded. This is not an approval probability.\n`;
    const regulatoryGroups = review.groups.map(group => ({...group, rows: assessment.regulatory.filter(row => groupForCheck(row.check.checkId).id === group.id)})).filter(group => group.rows.length);
    const checksSection = `\n#### ${zh ? "全部适用检查" : "All applicable checks"}\n` + regulatoryGroups.map(group => `\n##### ${zh ? group.zh : group.en}\n` + group.rows.map(row => {
      const {check,claim}=row;
      const refs = claim ? review.citations.filter(c=>claim.citationIds.includes(`${c.docId}#${c.articleId}`)) : directCitations(check, review.citations, market);
      const status = claim ? (zh?({supported:"判断完成，有据支持",blocked:"需先补证或处理",unknown:"判断未完成",not_applicable:"已确认不适用"}[claim.status]):claim.status) : (zh?"判断未完成":"Unresolved");
      const action = check.findings.map(f=>actionLabel(f.suggestedAction,locale)).filter(Boolean);
      const fallbackAction = row.limitedVisual
        ? (zh?"如需确认全面符合，仍应核对对应测试材料；本项只覆盖照片可见范围。":"Review the relevant test evidence for full conformity; this check covers visible scope only.")
        : (zh?"保留现有证据，并在产品版本或批次变化后重新核对。":"Retain the evidence and reassess after product or batch changes.");
      return `- ${checkLabel(check.checkId,locale,check.title)} · ${status}\n`+
        (row.limitedVisual?`  - ${zh?"有限视觉筛查：本次结论只描述照片可见范围，不替代测试或全面质检。":"Limited visual screening only; this does not replace testing or full inspection."}\n`:"")+
        `  - ${zh?"判断":"Assessment"}：${claim?.reason || check.bestObservation?.description || (zh?"证据不足":"Insufficient evidence")}\n`+
        (claim?.applicabilityReason?`  - ${zh?"适用理由":"Applicability"}：${claim.applicabilityReason}\n`:"")+
        `  - ${zh?"补证动作":"Evidence action"}：${action.length?action.join("；"):fallbackAction}\n`+
        (claim?.documentEvidence||[]).map(d=>`  - ${zh?"文件证据":"Document evidence"} ${d.name}：${d.quote}\n`).join("")+
        (refs.length ? refs.map(c=>`  - ${zh?"对应法条":"Legal basis"} ${c.docId}#${c.articleId} (${c.matchStatus})：${c.quote}\n    /regulations/${c.docId}#${c.articleId}\n`).join("") : `  - ${zh?"对应法条：当前未建立直接条款链接，不据此认定法律通过。":"Legal basis: no direct article link is established; this is not treated as legal clearance."}\n`);
    }).join("")).join("");
    return `\n\n### ${market} · ${reviewStatusLabel(review.status,locale)}\n` + scoreSection + factSection + checksSection + `\n#### ${zh ? "违规后果与潜在处罚" : "Potential consequences"}\n${zh ? penalty.text : penalty.en}\n${penalty.source}\n`;
  }).join("") + evidenceInputAnnex(result, locale) + revisionAnnex(result, locale);
}

function evidenceInputAnnex(result:ScanResult,locale:"zh"|"en") {
  const zh=locale==="zh";
  const evidence=result.reportPackage?.productEvidence;
  const lines=[`\n\n## ${zh?"本次分析输入记录":"Analysis input record"}`,zh?"输入记录不等于已核实事实。文档节选为用户材料，并非法条或系统结论。":"Input records are not verified facts. Excerpts are user materials, not legal sources or system conclusions."];
  for(const doc of evidence?.documents||[]) {
    lines.push(`\n### ${doc.name}`);
    lines.push(doc.includedText!==undefined?(zh?`已送入分析 ${doc.includedCharacters??doc.includedText.length} 字符；${doc.promptTruncated?"仅文档节选":"已包含提取文本"}`:`${doc.includedCharacters??doc.includedText.length} characters supplied${doc.promptTruncated?"; excerpt only":""}`):(zh?"旧报告未保存实际输入节选。":"Legacy input excerpt unavailable."));
    if(doc.includedText)lines.push(doc.includedText.split("\n").map(line=>`> ${line}`).join("\n"));
  }
  for(const [field,value] of Object.entries(evidence?.declarations||{}))lines.push(`- ${field}: ${value}`);
  return lines.join("\n");
}

function revisionAnnex(result:ScanResult,locale:"zh"|"en") {
  const change=result.revisionComparison;
  if(!change)return "";
  const zh=locale==="zh";
  return `\n\n## ${zh?"版本变化":"Revision changes"}\n${zh?"对比版本":"Compared with revision"} ${change.previousRevision}\n`+
    (["added","removed","changed"] as const).map((key,index)=>change[key].map(id=>`- ${zh?["新增","移出待办","判断变化"][index]:key}: ${checkLabel(id,locale,id)}`).join("\n")).join("\n")+
    (change.marketChanges||[]).map(c=>`\n### ${c.market} · ${checkLabel(c.checkId,locale,c.checkId)}\n${zh?"上版意见":"Previous"}: ${c.beforeReason||"—"}\n${zh?"本版意见":"Current"}: ${c.afterReason||"—"}\n`).join("")+
    `\n${zh?"仍需查看":"Remaining findings"}: ${change.remaining}\n${zh?"移出待办不等于合规通过。":"Removal from the worklist does not establish compliance."}`;
}
