import { describe, expect, it } from "vitest";
import { buildReview, directCitations, groupForCheck, penaltyContext, reviewAnnex } from "@/lib/result/review-model";
import type { ScanResult } from "@/lib/types";
import type { CheckResultVM, CitationVM } from "@/lib/result/inspection-view-model";
import {buildComplianceReport} from "@/lib/reporting";

const base = {sessionId:"test",targetMarkets:["EU","US"],images:[],documents:[],riskPoints:[],checklist:[],productCategory:"electronics",complianceScore:100,scoreGrade:"A",reportPackage:{decisionView:{verdict:"PASS"}}} as unknown as ScanResult;
const citation = {key:"EU-2014-35::art-3",docId:"EU-2014-35",articleId:"art-3",matchStatus:"unverified",quote:"text"} as CitationVM;

describe("review model evidence boundaries",()=>{
  it("does not turn aggregate PASS into market clearance",()=>{expect(buildReview(base,"US").status).toBe("unknown");});
  it("requires full checked scope and resolved applicability before the next review",()=>{
    const packageData={selectedCheckIds:["common.brand_model.visible"],anchorApplicability:[{market:"EU",regulationId:"EU-test",state:"applicable",reason:"scope"}],reviewClaims:[{market:"EU",checkId:"common.brand_model.visible",status:"supported",reason:"evidence",applicabilityReason:"scope",citationIds:[],observationIds:[],documentEvidence:[],verificationIssues:[],verificationVersion:"review-links/v1"}]};
    const report={...base,source:"real",selectedCheckIds:["common.brand_model.visible"],reportPackage:packageData} as ScanResult;
    expect(buildReview(report,"EU").status).toBe("supported");
    expect(buildReview(report,"US").status).toBe("unknown");
    expect(buildReview({...report,selectedCheckIds:["common.brand_model.visible","common.packaging.info"]},"EU").status).toBe("unknown");
  });
  it("does not apply a critical EU risk to US",()=>{
    const result={...base,riskPoints:[{severity:"critical",regulations:[{market:"EU"}]}]} as ScanResult;
    expect(buildReview(result,"EU").status).toBe("blocked");expect(buildReview(result,"US").status).toBe("unknown");
  });
  it("only links explicit references and keeps market scope",()=>{
    const check={findings:[{citationIds:["EU-2014-35#art-3"]}]} as CheckResultVM;
    expect(directCitations(check,[citation],"EU")).toHaveLength(1);
    expect(directCitations(check,[citation],"US")).toHaveLength(0);
    expect(directCitations({findings:[]} as unknown as CheckResultVM,[citation],"EU")).toHaveLength(0);
  });
  it("groups radio and material checks separately",()=>{expect(groupForCheck("common.wireless.radio").id).toBe("radio");expect(groupForCheck("food.contact.material").id).toBe("material");});
  it("includes actual document input and revision changes in the download",()=>{
    const report={...base,reportPackage:{productEvidence:{documents:[{name:"spec.txt",textAvailable:true,promptTruncated:true,includedText:"Model X input excerpt",includedCharacters:21}]}},revisionComparison:{previousRevision:1,added:[],removed:[],changed:["common.brand_model.visible"],remaining:1}} as ScanResult;
    const text=reviewAnnex(report,"zh");
    expect(text).toContain("Model X input excerpt");
    expect(text).toContain("仅文档节选");
    expect(text).toContain("判断变化: 品牌与型号");
  });
  it("does not invent fine amounts and exports all markets",()=>{
    expect(penaltyContext("US",[citation]).source).toBe("");
    expect(penaltyContext("EU",[citation]).article).toContain("24");
    expect(reviewAnnex(base,"zh")).toContain("EU · 待确认");expect(reviewAnnex(base,"zh")).toContain("US · 待确认");
  });
  it("retains the actual model report plus the same annex in Markdown exports",()=>{
    const report={...base,reportPackage:{complianceReport:"Actual model report"}} as ScanResult;
    const md=buildComplianceReport(report,"zh");
    expect(md).toBe("Actual model report"+reviewAnnex(report,"zh"));
  });
  it("puts the overall assessment before product identification and exports only regulatory checks as judgments",()=>{
    const report={...base,targetMarkets:["US"],source:"real",selectedCheckIds:["common.brand_model.visible","toy.small_parts.visible"],inspectionObservations:[
      {observationId:"fact",checkId:"common.brand_model.visible",imageId:"image-0",visibility:"present_readable",observedText:"LEGO 76429",description:"型号可读",region:null},
      {observationId:"small",checkId:"toy.small_parts.visible",imageId:"image-0",visibility:"present_readable",observedText:null,description:"可见小零件",region:null},
    ],reportPackage:{reviewClaims:[
      {market:"US",checkId:"common.brand_model.visible",status:"supported",reason:"型号已识别",applicabilityReason:"产品事实",citationIds:[],observationIds:["fact"],documentEvidence:[],verificationIssues:[],verificationVersion:"review-links/v1"},
      {market:"US",checkId:"toy.small_parts.visible",status:"supported",reason:"有限视觉筛查记录到小零件",applicabilityReason:"检查可见小零件",citationIds:[],observationIds:["small"],documentEvidence:[],verificationIssues:[],verificationVersion:"review-links/v1"},
    ],anchorApplicability:[{market:"US",regulationId:"US-CPSIA",state:"applicable",reason:"玩具"}]}} as unknown as ScanResult;
    const text=reviewAnnex(report,"zh");
    expect(text.indexOf("AI 合规评估")).toBeLessThan(text.indexOf("产品识别结果"));
    expect(text).toContain("总体评价");
    expect(text).toContain("产品事实，不代表法规符合性");
    expect(text).toContain("全部适用检查");
    expect(text).toContain("有限视觉筛查");
  });
});
