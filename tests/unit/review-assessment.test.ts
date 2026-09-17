import {describe,it,expect} from "vitest";
import {applyReviewAssessment, assessReview, factRiskDetail, factRiskLevel} from "@/lib/result/review-assessment";
import {buildReview} from "@/lib/result/review-model";
import type {ComplianceReportResult} from "@/lib/types";

function fixture(statuses:string[], ids=statuses.map((_,i)=>`check.${i}`)) {
  return {scoringEligible:true,vm:{checks:ids.map(checkId=>({checkId}))},claims:statuses.map((status,i)=>({checkId:ids[i],status,verificationIssues:[]}))} as unknown as ReturnType<typeof buildReview>;
}
describe("evidence-gated review score",()=>{
  it("keeps recognized identity out of unresolved legal checks without awarding points",()=>{
    const review=fixture(["unknown"],["common.brand_model.visible"]);
    review.vm.checks[0].observations=[{visibility:"present_readable",observedText:"LEGO 76429"}] as typeof review.vm.checks[0]["observations"];
    review.claims[0].verificationIssues=["legal_quote_unverified"];
    const result=assessReview(review);
    expect(result.rows[0].factRecorded).toBe(true);
    expect(result.pending).toHaveLength(0);
    expect(result.regulatory).toHaveLength(0);
    expect(result.scored).toBe(0);
    expect(result.score).toBeNull();
  });
  it("does not hide unreadable identity as successfully recognized",()=>{
    const result=assessReview(fixture(["unknown"],["common.brand_model.visible"]));
    expect(result.rows[0].factRecorded).toBe(false);
    expect(result.pending).toHaveLength(1);
  });
  it("does not mistake one supported check for overall 100",()=>{
    expect(assessReview(fixture(["supported","unknown","unknown","unknown"])).score).toBe(25);
  });
  it("excludes unresolved and inapplicable items and shows blocking items",()=>{
    const result=assessReview(fixture(["supported","supported","blocked","not_applicable","unknown"]));
    expect(result.score).toBe(50);expect(result.decided).toHaveLength(4);expect(result.blocked).toBe(1);
    expect(result.attention).toHaveLength(2);
  });
  it("lists blocked and unresolved checks together for the issue dropdown",()=>{
    const result=assessReview(fixture(["supported","supported","supported","supported","supported","blocked","unknown","unknown"]));
    expect(result.blocked).toBe(1);
    expect(result.unresolved).toHaveLength(2);
    expect(result.attention.map(row=>row.claim?.status)).toEqual(["blocked","unknown","unknown"]);
  });
  it("withholds score when critical safety evidence is unresolved",()=>{
    expect(assessReview(fixture(["supported","supported","supported","unknown"],["a","b","c","electronics.safety.electrical_test"])).score).toBe(75);
  });
  it("never scores claims with verification failures",()=>{
    const review=fixture(["supported","supported","supported"]);
    review.claims[0].verificationIssues=["legal_quote_unverified"];
    expect(assessReview(review).score).toBe(66);
  });
  it("uses a conservative whole-number score instead of rounding evidence support up",()=>{
    const result=assessReview(fixture(["supported","supported",...Array(10).fill("unknown")]));
    expect(result.score).toBe(16);
  });
  it("only produces a single score when all applicable checks are resolved",()=>{
    const result=assessReview(fixture(["supported","supported","blocked","not_applicable"]));
    expect(result.score).toBe(66);
  });
  it("keeps citation errors unresolved instead of treating them as product failures",()=>{
    const review=fixture(["supported","supported","supported"]);
    review.claims[0].verificationIssues=["legal_quote_unverified"];
    const result=assessReview(review);
    expect(result.blocked).toBe(0);expect(result.systemIssues).toHaveLength(1);
    expect(result.score).toBe(66);
  });
  it("does not score demo or fallback reports",()=>{
    const review=fixture(["supported","supported","supported"]);
    review.scoringEligible=false;
    expect(assessReview(review).score).toBeNull();
  });
  it("records visible-scope absence as a product fact without creating an unknown",()=>{
    const review=fixture(["supported"],["common.defects.visible"]);
    review.vm.checks[0].observations=[{visibility:"absent_in_visible_scope",description:"本次可见范围未发现明显外观缺陷"}] as typeof review.vm.checks[0]["observations"];
    const result=assessReview(review);
    expect(result.rows[0].factRecorded).toBe(true);
    expect(result.pending).toHaveLength(0);
    expect(result.regulatory).toHaveLength(0);
  });
  it("locks the LEGO case to eight facts, eight decided checks and 62 of 100",()=>{
    const factIds=["toy.age_range.label","common.product.overview","common.nameplate.readability","common.certification_marks.visible","common.brand_model.visible","common.warning_text.language","common.packaging.info","common.defects.visible"];
    const regulatoryIds=["toy.warnings.text","toy.small_parts.visible","toy.magnets_cords.visible","toy.battery_compartment.closure","toy.sharp_edges.visible","toy.mechanical_physical.test","toy.chemical_migration.test","common.batch_traceability.fields"];
    const review=fixture([...Array(8).fill("supported"),...Array(5).fill("supported"),...Array(3).fill("blocked")],[...factIds,...regulatoryIds]);
    review.vm.checks.forEach((check,index)=>{check.observations=[{visibility:index===7?"absent_in_visible_scope":"present_readable",description:`事实 ${index+1}`}] as typeof check.observations;});
    const result=assessReview(review);
    expect(result.rows.filter(row=>row.factRecorded)).toHaveLength(8);
    expect(result.regulatory).toHaveLength(8);
    expect(result.decided).toHaveLength(8);
    expect(result.supported).toBe(5);
    expect(result.blocked).toBe(3);
    expect(result.score).toBe(62);
  });
  it("marks visible edge checks as limited visual screening",()=>{
    const result=assessReview(fixture(["supported","blocked"],["toy.sharp_edges.visible","toy.mechanical_physical.test"]));
    expect(result.rows[0].limitedVisual).toBe(true);
    expect(result.rows[1].limitedVisual).toBe(false);
  });
  it("derives low, medium and high fact badges from related check evidence",()=>{
    const ids=["common.nameplate.readability","common.warning_text.language","common.product.overview","common.batch_traceability.fields","toy.warnings.text","toy.small_parts.visible"];
    const review=fixture(["supported","supported","supported","blocked","supported","supported"],ids);
    review.vm.checks.slice(0,3).forEach(check=>{check.observations=[{visibility:"present_readable",description:"已识别"}] as typeof check.observations;});
    const assessment=assessReview(review);
    const row=(id:string)=>assessment.rows.find(item=>item.check.checkId===id)!;
    expect(factRiskLevel(row("common.nameplate.readability"),assessment)).toBe("high");
    expect(factRiskLevel(row("common.product.overview"),assessment)).toBe("medium");
    expect(factRiskLevel(row("common.warning_text.language"),assessment)).toBe("low");
  });
  it("explains the related check state behind each fact badge",()=>{
    const ids=["common.nameplate.readability","common.product.overview","common.warning_text.language","common.batch_traceability.fields","toy.warnings.text","toy.small_parts.visible"];
    const review=fixture(["supported","supported","supported","blocked","supported","supported"],ids);
    review.vm.checks.slice(0,3).forEach(check=>{check.observations=[{visibility:"present_readable",description:"已识别"}] as typeof check.observations;});
    const assessment=assessReview(review);
    const row=(id:string)=>assessment.rows.find(item=>item.check.checkId===id)!;
    expect(factRiskDetail(row("common.nameplate.readability"),assessment)).toEqual({level:"high",reason:"blocked",relatedCheckIds:["common.batch_traceability.fields"]});
    expect(factRiskDetail(row("common.product.overview"),assessment).reason).toBe("limited_visual");
    expect(factRiskDetail(row("common.warning_text.language"),assessment)).toMatchObject({level:"low",reason:"none"});
  });
  it("copies the review score into the shared PDF and DOCX report model",()=>{
    const assessment=assessReview(fixture(["supported","supported","supported","supported","supported","blocked","blocked","blocked"]));
    const report={complianceScore:35,scoreGrade:"D"} as ComplianceReportResult;
    const updated=applyReviewAssessment(report,assessment);
    expect(updated).not.toBe(report);
    expect(updated.complianceScore).toBe(62);
    expect(updated.scoreGrade).toBe("C");
  });
});
