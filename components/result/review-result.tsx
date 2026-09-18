"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import type { ScanResult, ComplianceReportResult } from "@/lib/types";
import { assessmentConclusion, buildReview, directCitations, penaltyContext, reviewAnnex, claimIssueLabel } from "@/lib/result/review-model";
import { applyReviewAssessment, assessReview, factRiskDetail, type FactRiskLevel } from "@/lib/result/review-assessment";
import type { CitationVM } from "@/lib/result/inspection-view-model";
import { actionLabel, checkLabel, declarationLabel } from "@/lib/result/check-labels";
import { factRiskContext } from "@/lib/result/fact-risk-context";
import type { RegulationViewModel } from "@/components/regulation/DocViewer";
import { CompliPilotFlowBackdrop, CompliPilotFlowFooter, CompliPilotFlowHeader } from "@/components/complipilot/flow-shell";
import { EvidenceRequestPanel } from "./EvidenceRequestPanel";
import { ComplianceReportView } from "./ComplianceReportView";
import { DegradedBanner } from "./DegradedBanner";
import { FallbackNotice } from "./FallbackNotice";
import { ReviewImage } from "./review-image";
import { GlassScore } from "./glass-score";
import bright from "@/components/complipilot/bright-flow.module.css";
import upload from "@/app/upload/upload.module.css";
import styles from "./review-result.module.css";

function LegalText({citation, locale}: {citation: CitationVM; locale: "zh" | "en"}) {
  const [doc,setDoc]=useState<RegulationViewModel|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{const controller=new AbortController();fetch(`/api/regulations/${encodeURIComponent(citation.docId)}`,{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(setDoc).catch(()=>{if(!controller.signal.aborted)setFailed(true);});return()=>controller.abort();},[citation.docId]);
  const article=doc?.articles?.find(a=>a.id===citation.articleId);
  const condensed= /condensed|pending verification/i.test((article?.text||"")+(doc?.notes||"")+citation.quote);
  return <div className={styles.law}>
    <h4>{citation.officialCitation || `${citation.docId} · ${citation.articleId}`}</h4>
    <span className={styles.badge}>{locale==="zh" ? (citation.matchStatus==="matched"?"引用已逐字核对":"引用待逐字核验") : citation.matchStatus}</span>
    <p className={styles.hint}>{locale==="zh"?(condensed?"当前库内内容为摘要，并非完整法律原文。":"引用核对不代表产品符合该条款。") : (condensed?"Library summary, not full legal text.":"Citation verification does not establish compliance.")}</p>
    {citation.quoteProvenance === "canonical_article_excerpt" && <p className={styles.hint}>{locale==="zh"?"以下为系统定位的条款内容，用于核对相关要求；不代表产品已经符合。":"Article content located by the system for requirement review; it does not establish product compliance."}</p>}
    <blockquote>{citation.quote || (locale==="zh"?"未提供原文摘录":"No excerpt provided")}</blockquote>
    <details><summary>{locale==="zh"?"展开库内条款内容":"Expand library article"}</summary><p>{article?.text || (failed ? (locale==="zh"?"条款暂时无法加载，请打开来源核对。":"Unable to load. Open the source.") : doc ? (locale==="zh"?"该条款尚未入库。":"Article unavailable.") : (locale==="zh"?"加载中…":"Loading…"))}</p></details>
    <div className={styles.toolbar}><a href={`/regulations/${encodeURIComponent(citation.docId)}#${encodeURIComponent(citation.articleId)}`} target="_blank" rel="noreferrer">{locale==="zh"?"条款定位页":"Article viewer"} <ArrowUpRight size={14}/></a>{doc?.source_url && /^https?:\/\//.test(doc.source_url) && <a href={doc.source_url} target="_blank" rel="noreferrer">{locale==="zh"?"官方来源":"Official source"}<ArrowUpRight size={14}/></a>}</div>
  </div>;
}

function LegalReviewDialog({citation,locale,onClose}:{citation:CitationVM;locale:"zh"|"en";onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow="hidden";dialog.current?.showModal();return()=>{document.body.style.overflow=overflow;previous?.focus({preventScroll:true});};},[]);
  return <dialog ref={dialog} className={styles.lawDialog} onCancel={onClose} aria-label={locale==="zh"?"法条核对":"Legal review"}>
    <div className={styles.toolbar}><h3>{locale==="zh"?"法条核对":"Legal review"}</h3><button onClick={onClose}>{locale==="zh"?"关闭 · 返回当前分项":"Close · back to finding"}</button></div>
    <LegalText citation={citation} locale={locale}/>
  </dialog>;
}

function EvidenceDialog({children,locale,onClose}:{children:React.ReactNode;locale:"zh"|"en";onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow="hidden";dialog.current?.showModal();return()=>{document.body.style.overflow=overflow;previous?.focus({preventScroll:true});};},[]);
  return <dialog ref={dialog} className={styles.evidenceDialog} onCancel={onClose} aria-label={locale==="zh"?"证据与判断核对":"Evidence review"}><div className={styles.toolbar}><h3>{locale==="zh"?"证据与判断核对":"Evidence review"}</h3><button onClick={onClose}>{locale==="zh"?"关闭 · 返回原位置":"Close · return"}</button></div>{children}</dialog>;
}

type AssessmentRow = ReturnType<typeof assessReview>["rows"][number];

function observationSummary(row: AssessmentRow, locale: "zh" | "en") {
  const observation = row.check.bestObservation;
  if (observation?.visibility === "absent_in_visible_scope") {
    if (row.check.checkId === "toy.sharp_edges.visible") return locale === "zh"
      ? "本次可见范围未发现明显尖角、锐边或破损部位；仅为照片筛查，不替代机械物理测试。"
      : "No obvious sharp edges or damaged points were found in the visible scope. Photo screening does not replace mechanical testing.";
    if (row.check.checkId === "common.defects.visible") return locale === "zh"
      ? "本次可见范围未发现裂损、变形、污渍或鼓胀等明显外观异常；不等同于全面质检。"
      : "No obvious cracks, deformation, stains or swelling were found in the visible scope. This is not a full quality inspection.";
    return locale === "zh"
      ? `本次可见范围未发现相关特征。${observation.description}`
      : `The relevant feature was not found in the visible scope. ${observation.description}`;
  }
  return observation?.observedText || observation?.description || row.claim?.documentEvidence[0]?.quote || row.claim?.reason || (locale === "zh" ? "已记录" : "Recorded");
}

function claimStatus(status: string | undefined, locale: "zh" | "en") {
  if (locale === "en") return String(status || "unknown").replaceAll("_", " ");
  return ({supported:"判断完成，有据支持",blocked:"需先补证或处理",unknown:"判断未完成",not_applicable:"已确认不适用"} as Record<string,string>)[String(status)] || "判断未完成";
}

function findingId(checkId:string) {
  return `finding-${checkId.replace(/[^a-z0-9_-]+/gi,"-")}`;
}

function riskLabel(level:FactRiskLevel,locale:"zh"|"en") {
  if(locale==="en") return ({low:"Low risk",medium:"Medium risk",high:"High risk"} as const)[level];
  return ({low:"低风险",medium:"中风险",high:"高风险"} as const)[level];
}

function factRiskBadgeLabel(level: FactRiskLevel, locale: "zh" | "en") {
  return locale === "zh" ? `关联${riskLabel(level, locale)}` : `Related ${riskLabel(level, locale)}`;
}

export function ReviewResult({result, report, locale, onRefresh, degradedReason}: {result:ScanResult; report:ComplianceReportResult; locale:"zh"|"en"; onRefresh:()=>void; degradedReason?:string|null}) {
  const zh=locale==="zh";
  const [market,setMarket]=useState(result.targetMarkets[0] || "EU");
  const [selected,setSelected]=useState<string|null>(null);
  const [focusImage,setFocusImage]=useState<string|undefined>();
  const [focusObservation,setFocusObservation]=useState<string|undefined>();
  const [law,setLaw]=useState<CitationVM|null>(null);
  const [priorityOpen,setPriorityOpen]=useState(false);
  const [scoreRulesOpen,setScoreRulesOpen]=useState(false);
  const review=buildReview(result,market);
  const assessment=assessReview(review);
  const factRows=assessment.rows.filter(row=>row.factRecorded);
  const priorityRows=assessment.attention;
  const active=assessment.rows.find(r=>r.check.checkId===selected);
  const activeFactRisk = active?.factRecorded ? factRiskDetail(active, assessment) : null;
  const activeFactContext = active?.factRecorded ? factRiskContext(active.check.checkId, market, locale) : null;
  const penalty=penaltyContext(market,review.citations);
  const enrichedReport=applyReviewAssessment({...report,reviewAppendix:{zh:reviewAnnex(result,"zh"),en:reviewAnnex(result,"en")}},assessment);
  useEffect(()=>{const sync=()=>{if(["#reports","#compliance-report","#report-previews"].includes(location.hash)){setSelected(null);requestAnimationFrame(()=>{const details=document.getElementById("reports") as HTMLDetailsElement|null;if(details){details.open=true;details.scrollIntoView();}});}};sync();window.addEventListener("hashchange",sync);return()=>window.removeEventListener("hashchange",sync);},[]);
  const title=review.vm.product.title;
  const conclusion=assessmentConclusion({title,market,factCount:factRows.length,assessment,locale});
  const focusPriority=(checkId:string)=>requestAnimationFrame(()=>{
    const target=document.getElementById(findingId(checkId));
    target?.scrollIntoView({behavior:"smooth",block:"center"});
    target?.focus({preventScroll:true});
  });
  return <main className={`${bright.page} ${upload.page} ${styles.page} complipilot-flow`}>
    <CompliPilotFlowBackdrop tone="bright"/>
    <CompliPilotFlowHeader tone="bright" backHref="/upload" backLabel={zh?"返回上传页":"Back to upload"} flowTitle={zh?"产品合规预检报告":"Product compliance precheck"} flowSubtitle={zh?"市场结论 · 产品证据 · 法规依据":"Markets · Evidence · Legal sources"} primaryHref="#reports" primaryLabel={zh?"完整报告":"Full report"}/>
    <div className={styles.content}>
      <DegradedBanner source={result.source} degradedReason={degradedReason||undefined}/><FallbackNotice validationStatus={result.reportPackage?.auditMetadata?.validationStatus}/>
      <header className={`${styles.identity} blaze-panel`}>
        {result.images[0] && <Image src={result.images[0].url} alt="" width={60} height={60} unoptimized/>}
        <div><h1>{title}</h1><p>{zh?`第 ${result.revision||1} 版`:`Revision ${result.revision||1}`} · {result.images.length} {zh?"张图片":"images"} · {result.documents.length} {zh?"份文件":"documents"}</p></div>
      <nav className={styles.markets} aria-label={zh?"目标市场":"Target market"}>{result.targetMarkets.map(m=><button key={m} aria-pressed={market===m} onClick={()=>{setMarket(m);setLaw(null);setPriorityOpen(false);}}>{m}</button>)}</nav>
        <button className={styles.link} onClick={onRefresh}>{zh?"刷新报告":"Refresh"}</button>
      </header>

      <section className={`${styles.scorePanel} blaze-panel`} data-section="assessment-score" aria-label={zh?"AI 合规评估":"AI compliance assessment"}>
        <GlassScore score={assessment.score} supported={assessment.supported} blocked={assessment.blocked} unresolved={assessment.unresolved.length} applicableCount={assessment.applicableCount} locale={locale}/>
        <div><h2>{zh?`${title} · ${market} 市场总体评价`:`${title} · ${market} overall assessment`}</h2><p className={styles.coverageLine}>{zh?`判断覆盖 ${assessment.decided.length} / ${assessment.regulatory.length} 项 · ${assessment.pending.length} 项尚未确定`:`Assessment coverage ${assessment.decided.length} / ${assessment.regulatory.length} · ${assessment.pending.length} unresolved`}</p><p className={styles.conclusion}>{conclusion}</p>
        {priorityRows.length>0&&<div className={styles.priorityArea}><button data-priority-toggle type="button" className={`${styles.critical} ${styles.criticalButton}`} aria-expanded={priorityOpen} aria-controls="priority-issues" onClick={()=>setPriorityOpen(open=>!open)}><span>{assessment.blocked > 0 ? (zh?`${assessment.blocked} 项违规阻断需优先处理${assessment.unresolved.length > 0 ? `（另有 ${assessment.unresolved.length} 项待补证）` : ""}，总分不能抵消这些问题。`:`${assessment.blocked} blocking violation(s) require action${assessment.unresolved.length > 0 ? ` (${assessment.unresolved.length} pending verification)` : ""}.`) : (zh?`${assessment.unresolved.length} 项适用检查待补充证据与核验，暂不得分。`:`${assessment.unresolved.length} applicable check(s) require evidence verification before clearance.`)}</span><strong>{priorityOpen?(zh?"收起清单":"Hide list"):(zh?"查看具体项目":"Show items")}<ChevronDown className={styles.priorityChevron} data-open={priorityOpen} size={15} aria-hidden="true"/></strong></button><div id="priority-issues" className={styles.priorityReveal} data-open={priorityOpen} aria-hidden={!priorityOpen}><div className={styles.priorityRevealInner}><ol className={styles.priorityList}>{priorityRows.map(row=><li key={row.check.checkId}><button tabIndex={priorityOpen?0:-1} type="button" onClick={()=>focusPriority(row.check.checkId)}><span className={styles.priorityCopy}><strong>#{row.number} · {checkLabel(row.check.checkId,locale,row.check.title)}</strong><span>{row.claim?.reason||observationSummary(row,locale)}</span></span><span className={styles.jumpCue}>{zh?"定位检查":"Jump to check"}<ArrowUpRight size={13} aria-hidden="true"/></span></button></li>)}</ol></div></div></div>}
        <p className={styles.coverageLine}>{zh?`有据支持 ${assessment.supported} 项 · 违规阻断 ${assessment.blocked} 项 · 待补证核验 ${assessment.unresolved.length} 项`:`Supported ${assessment.supported} · Blocked ${assessment.blocked} · Evidence needed ${assessment.unresolved.length}`}</p>
        <div className={styles.scoreRules} data-open={scoreRulesOpen}>
          <button type="button" className={styles.scoreRulesToggle} aria-expanded={scoreRulesOpen} aria-controls="score-rules-content" onClick={()=>setScoreRulesOpen(open=>!open)}>
            <span>{zh?"评分范围与计算规则":"Scoring scope and rules"}</span>
            <ChevronDown className={styles.scoreRulesChevron} data-open={scoreRulesOpen} size={15} aria-hidden="true"/>
          </button>
          <div id="score-rules-content" className={styles.scoreRulesReveal} data-open={scoreRulesOpen} aria-hidden={!scoreRulesOpen}>
            <div className={styles.scoreRulesRevealInner}><p>{zh?`按本次适用检查等权计算：证据支持 ${assessment.supported} 项 ÷ 潜在适用 ${assessment.applicableCount} 项 × 100。纯识别项和已确认不适用项不计分；需处理和证据未闭环项目暂不得分，因此补齐证据后分数会变化。`:`Equal weights: ${assessment.supported} evidence-supported checks / ${assessment.applicableCount} potentially applicable checks × 100. Identity-only and confirmed inapplicable checks are excluded; unresolved or action-required checks receive no points until closed.`}</p></div>
          </div>
        </div></div>
      </section>
      <section className={`${styles.evidenceStrip} blaze-panel`} aria-label={zh?"全部产品照片":"All product photos"}>
        {review.vm.images.map((image,index)=><button key={image.imageId} onClick={()=>{setSelected(null);setFocusImage(image.imageId);setFocusObservation(undefined);}}>
          <div className={styles.previewPhoto}><div className={styles.previewCanvas}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={`${zh?"产品照片":"Product photo"} ${index+1}`}/>
            {(review.vm.anchorsByImage[image.imageId]||[]).map(anchor=><i key={anchor.observationId} className={styles.previewMark} style={{left:`${anchor.bbox.x*100}%`,top:`${anchor.bbox.y*100}%`,width:`${anchor.bbox.w*100}%`,height:`${anchor.bbox.h*100}%`}}/>)}
          </div></div>
          <strong>{zh?"图片":"Photo"} {index+1}</strong>
          <span>{assessment.rows.filter(r=>r.check.observations.some(o=>o.imageId===image.imageId && o.bbox)).map(r=>`#${r.number}`).join(" · ")}</span>
        </button>)}
      </section>
      <section className={`${styles.reading} blaze-panel`} data-section="identified-facts" aria-labelledby="identified-facts-title">
        <h2 id="identified-facts-title">{zh?"产品识别结果":"Product identification results"}</h2>
        <p className={styles.hint}>{zh?`共 ${factRows.length} 项产品事实来自图片或上传文件。`:`${factRows.length} product facts were identified from images or uploaded files.`}</p>
        <div className={styles.factGrid}>{factRows.map(row=>{const riskDetail=factRiskDetail(row,assessment);const context=factRiskContext(row.check.checkId,market,locale);const riskClass={low:styles.riskLow,medium:styles.riskMedium,high:styles.riskHigh}[riskDetail.level];const riskHintClass={low:styles.factRiskHintLow,medium:styles.factRiskHintMedium,high:styles.factRiskHintHigh}[riskDetail.level];return <button type="button" className={styles.fact} key={row.check.checkId} onClick={()=>{setSelected(row.check.checkId);setFocusImage(row.check.bestObservation?.imageId||review.vm.images[0]?.imageId);setFocusObservation(row.check.bestObservation?.observationId);}}><div className={styles.factHeader}><strong>#{row.number} · {checkLabel(row.check.checkId,locale,row.check.title)}</strong><em className={`${styles.factRisk} ${riskClass}`} title={context.summary} aria-label={factRiskBadgeLabel(riskDetail.level,locale)}>{factRiskBadgeLabel(riskDetail.level,locale)}</em></div><span>{observationSummary(row,locale)}</span><small className={`${styles.factRiskHint} ${riskHintClass}`}>{context.summary}</small>{context.citations.length>0&&<small className={styles.factLegalBasis}>{zh?"相关依据：":"Basis: "}{context.citations.map(item=>item.officialCitation).join(" · ")}</small>}<small>{zh?"产品事实 · 点击查看原因、原图与法条":"Product fact · inspect reason, source and law"}</small></button>})}</div>
      </section>
      <section className={`${styles.reading} blaze-panel`}><h3>{zh?`全部适用检查 · ${assessment.decided.length} / ${assessment.regulatory.length}`:`All applicable checks · ${assessment.decided.length} / ${assessment.regulatory.length}`}</h3><p className={styles.hint}>{zh?"每项同时列出判断、补证动作和直接法条。有限视觉筛查只描述照片可见范围；没有直接法条链接的项目不视为法律通过。":"Each check shows its assessment, evidence action and direct legal basis. Limited visual screening describes only the visible scope."}</p>
        {[...assessment.regulatory].sort((a,b)=>Number(b.claim?.status==="blocked")-Number(a.claim?.status==="blocked")).map(row=>{const refs=row.claim?review.citations.filter(c=>row.claim!.citationIds.includes(`${c.docId}#${c.articleId}`)):directCitations(row.check,review.citations,market);const actions=row.check.findings.map(f=>actionLabel(f.suggestedAction,locale)).filter(Boolean);return <article id={findingId(row.check.checkId)} tabIndex={-1} data-finding-status={row.claim?.status||"unknown"} key={row.check.checkId} className={styles.findingRow}>
          <span className={styles.rowNumber}>#{row.number}</span><div><div className={styles.findingTitle}><h4>{checkLabel(row.check.checkId,locale,row.check.title)}</h4><span className={styles.badge}>{claimStatus(row.claim?.status,locale)}</span>{row.limitedVisual&&<span className={styles.visualBadge}>{zh?"有限视觉筛查":"Limited visual"}</span>}</div>
          <p><strong>{zh?"判断：":"Assessment: "}</strong>{row.limitedVisual?observationSummary(row,locale):(row.claim?.reason||observationSummary(row,locale))}</p>
          <p><strong>{zh?"补证动作：":"Evidence action: "}</strong>{actions.length?actions.join("；"):row.limitedVisual?(zh?"如需确认全面符合，仍应核对对应测试材料；本项不替代实验室测试。":"Review relevant test evidence for full conformity; this does not replace laboratory testing."):(zh?"保留现有证据；产品版本或批次变化后重新核对。":"Retain current evidence and reassess after product or batch changes.")}</p>
          {!!row.claim?.verificationIssues.length&&<p className={styles.hint}>{row.claim.verificationIssues.map(i=>claimIssueLabel(i,locale)).join("；")}</p>}
          <div className={styles.legalLinks}><strong>{zh?"对应法条：":"Legal basis: "}</strong>{refs.length?refs.map(c=><button key={c.key} onClick={()=>setLaw(c)}>{c.officialCitation||`${c.docId} · ${c.articleId}`}</button>):<span>{zh?"当前未建立直接条款链接，不据此认定法律通过。":"No direct article link; this is not treated as legal clearance."}</span>}</div>
          <div className={styles.sourceLinks}>{row.check.observations.filter((o,i,all)=>o.bbox && all.findIndex(a=>a.bbox && a.imageId===o.imageId)===i).map(o=><button key={o.observationId} onClick={()=>{setSelected(row.check.checkId);setFocusImage(o.imageId);setFocusObservation(o.observationId);}}>{zh?"定位图片":"Locate photo"} {review.vm.images.findIndex(i=>i.imageId===o.imageId)+1}</button>)}<button onClick={()=>{setSelected(row.check.checkId);setFocusImage(row.check.bestObservation?.imageId||review.vm.images[0]?.imageId);setFocusObservation(row.check.bestObservation?.observationId);}}>{zh?"核对判断、文件与法条":"Review evidence & law"}</button></div></div>
        </article>})}
      </section>
      {(focusImage||active)&&<EvidenceDialog onClose={()=>{setFocusImage(undefined);setSelected(null);}} locale={locale}>
        <div className={styles.evidenceDetail}><ReviewImage key={`${focusImage}-${focusObservation}`} images={review.vm.images} anchors={review.vm.anchorsByImage} locale={locale} preferredId={focusImage} preferredObservation={focusObservation} onSelectCheck={setSelected} checkNumbers={Object.fromEntries(assessment.rows.map(r=>[r.check.checkId,r.number]))}/>
        <div>{active?<><h3>#{active.number} · {checkLabel(active.check.checkId,locale,active.check.title)}</h3>{activeFactRisk&&activeFactContext&&<section className={styles.factRiskDetail} aria-label={zh?"风险标识说明":"Risk label explanation"}><h4>{zh?"风险标识说明":"Risk label explanation"}</h4><p><strong>{zh?"当前标识：":"Current label: "}</strong>{factRiskBadgeLabel(activeFactRisk.level,locale)}</p><p>{activeFactContext.explanation}</p><p><strong>{zh?"仍需核对：":"Evidence to verify: "}</strong>{activeFactContext.evidenceToVerify}</p>{activeFactRisk.relatedCheckIds.length>0&&<p><strong>{zh?"关联检查：":"Related checks: "}</strong>{activeFactRisk.relatedCheckIds.map(checkId=>checkLabel(checkId,locale,checkId)).join(zh?"、":", ")}</p>}</section>}<p>{active.claim?.reason||active.check.bestObservation?.description}</p><p>{active.claim?.applicabilityReason}</p>{active.claim?.documentEvidence.map((d,i)=><blockquote key={i}><strong>{d.name}</strong><p>{d.quote}</p></blockquote>)}{activeFactContext?.citations.map(c=><LegalText key={c.key} citation={c} locale={locale}/>)}{(active.claim?review.citations.filter(c=>active.claim!.citationIds.includes(`${c.docId}#${c.articleId}`)):directCitations(active.check,review.citations,market)).map(c=><LegalText key={c.key} citation={c} locale={locale}/>)}{!activeFactContext?.citations.length&&!active.claim?.citationIds.length&&<p>{zh?"该项暂无已建立的直接法条关联。":"No direct legal citation linked."}</p>}</>:<p>{zh?"查看图片标识；返回清单选择具体分项，可同时核对判断与法条。":"Inspect image markings. Choose a finding from the list to compare its assessment and law."}</p>}</div></div>
      </EvidenceDialog>}
      {review.risks.length>0 && <section className={`${styles.reading} blaze-panel`}><h3>{zh?"影响市场结论的风险":"Risks affecting this market"}</h3>{review.risks.map(r=><article className={styles.check} key={r.riskId}><h4>{r.title}</h4><p>{r.description}</p><p>{r.recommendedAction}</p>{r.regulations.filter(ref=>ref.market===market).map(ref=><p key={ref.regId}><strong>{ref.code} · {ref.name}</strong><br/>{ref.summary}<br/>{/^https?:\/\//.test(ref.sourceUrl)&&<a href={ref.sourceUrl} target="_blank" rel="noreferrer">{zh?"核对来源":"Check source"}</a>}</p>)}</article>)}</section>}
      <section className={`${styles.reading} blaze-panel`}><h3>{zh?"本次报告引用 · 按市场筛选":"Report references · current market"}</h3><p className={styles.hint}>{zh?"点击在当前页核对条款；没有直接对应关系的引用不视为分项判断依据。":"Inspect articles without leaving the report. Unlinked references do not substantiate individual findings."}</p><div className={styles.markList}>{review.citations.map(c=><button key={c.key} onClick={()=>{setLaw(c);requestAnimationFrame(()=>document.getElementById("law-review")?.scrollIntoView({block:"nearest"}));}}>{c.officialCitation||`${c.docId} · ${c.articleId}`}</button>)}</div>{!review.citations.length&&<p>{zh?"该市场尚无已关联引用。":"No linked references for this market."}</p>}</section>
      {law&&<LegalReviewDialog key={law.key} citation={law} locale={locale} onClose={()=>setLaw(null)}/>}
      <details className={`${styles.reading} blaze-panel ${styles.collapsiblePanel}`}><summary className={styles.collapsibleSummary}><span className={styles.collapsibleTitle}><ChevronRight className={styles.collapsibleChevron} size={17} aria-hidden="true"/>{zh?"违规后果与潜在处罚":"Potential consequences & penalties"}</span><span className={styles.collapsibleHint}>{zh?"点击展开详情":"Click to expand"}</span></summary><div className={styles.collapsibleBody}><p>{zh?penalty.text:penalty.en}</p>{penalty.source&&<a href={penalty.source} target="_blank" rel="noreferrer">{penalty.article} · {zh?"官方依据":"Official source"}</a>}</div></details>
      <EvidenceInputs result={result} locale={locale}/><RevisionChanges result={result} locale={locale}/>
      {result.sessionId!=="demo"&&<EvidenceRequestPanel sessionId={result.sessionId} locale={locale} requests={review.vm.evidenceRequests}/>}
      <details id="reports" className={`${styles.reading} blaze-panel ${styles.collapsiblePanel}`}><summary className={styles.collapsibleSummary}><span className={styles.collapsibleTitle}><ChevronRight className={styles.collapsibleChevron} size={17} aria-hidden="true"/>{zh?"完整报告与下载 · 全部市场":"Full report & downloads · all markets"}</span><span className={styles.collapsibleHint}>{zh?"展开查看报告正文与 PDF/DOCX 下载":"Expand to view report text & downloads"}</span></summary><div className={styles.collapsibleBody}><ComplianceReportView result={enrichedReport} documentOnly/></div></details>
    </div><CompliPilotFlowFooter sessionId={result.sessionId} tone="bright"/>
  </main>;
}

function EvidenceInputs({result,locale}:{result:ScanResult;locale:"zh"|"en"}) {
  const zh=locale==="zh";
  const evidence=result.reportPackage?.productEvidence;
  return <details className={`${styles.reading} blaze-panel ${styles.collapsiblePanel}`}><summary className={styles.collapsibleSummary}><span className={styles.collapsibleTitle}><ChevronRight className={styles.collapsibleChevron} size={17} aria-hidden="true"/>{zh?"本次分析使用的补充材料":"Supplementary inputs used in this analysis"}</span><span className={styles.collapsibleHint}>{zh?"点击展开补充材料记录":"Click to expand inputs"}</span></summary>
    <div className={styles.collapsibleBody}>
      <p className={styles.hint}>{zh?"以下记录用于核对模型输入。材料进入分析不代表其中声明已被独立验证，也不代表每一段均被采纳为结论依据。":"These records identify model inputs, not independent verification or acceptance of every statement."}</p>
      {(evidence?.documents||[]).map((doc,index)=><article className={styles.check} key={`${doc.name}-${index}`}><h4>{doc.name}</h4><p>{zh?(doc.includedText!==undefined?`已送入分析 ${doc.includedCharacters??doc.includedText.length} 字符${doc.promptTruncated?"；仅包含文档节选":""}`:doc.textAvailable?"已提取文本；旧报告未保存输入节选":"未提取到可用文本"):doc.includedText!==undefined?`${doc.includedCharacters??doc.includedText.length} characters included${doc.promptTruncated?" (excerpt only)":""}`:doc.textAvailable?"Text extracted; legacy input excerpt unavailable":"No usable text extracted"}</p>{doc.includedText&&<details><summary>{zh?"核对实际输入节选":"Inspect input excerpt"}</summary><blockquote style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{doc.includedText}</blockquote></details>}</article>)}
      {!evidence?.documents?.length&&<p>{zh?"本报告没有保存文档输入记录。":"No document input record is available for this report."}</p>}
      <h4>{zh?"补充产品信息（用户声明）":"Product information (user declarations)"}</h4>
      {Object.keys(evidence?.declarations||{}).length?<dl>{Object.entries(evidence!.declarations!).map(([field,value])=><div key={field}><dt>{declarationLabel(field,value,locale).name}</dt><dd>{declarationLabel(field,value,locale).value}</dd></div>)}</dl>:<p>{zh?"本报告未记录用户声明。":"No user declarations recorded."}</p>}
    </div>
  </details>;
}

function RevisionChanges({result,locale}:{result:ScanResult;locale:"zh"|"en"}) {
  const change=result.revisionComparison;
  if((result.revision||1)<2)return null;
  return <section className={`${styles.reading} blaze-panel`}><h3>{locale==="zh"?"本版变化":"Revision changes"}</h3>{change?<><p>{locale==="zh"?`对比第 ${change.previousRevision} 版：新增 ${change.added.length} 项，移出待办 ${change.removed.length} 项，变化 ${change.changed.length} 项；仍有 ${change.remaining} 项发现需查看。移出待办不等于合规通过。`:`Compared with revision ${change.previousRevision}: ${change.added.length} added, ${change.removed.length} removed, ${change.changed.length} changed.`}</p><ul>{change.added.map(id=><li key={`added-${id}`}>{locale==="zh"?"新增：":"Added: "}{checkLabel(id,locale,id)}</li>)}{change.removed.map(id=><li key={`removed-${id}`}>{locale==="zh"?"移出待办：":"Removed: "}{checkLabel(id,locale,id)}</li>)}{change.changed.map(id=><li key={`changed-${id}`}>{locale==="zh"?"判断变化：":"Changed: "}{checkLabel(id,locale,id)}</li>)}</ul>{change.marketChanges?.map(c=><article key={`${c.market}-${c.checkId}`} className={styles.check}><h4>{c.market} · {checkLabel(c.checkId,locale,c.checkId)}</h4><p>{locale==="zh"?"上版意见：":"Previous: "}{c.beforeReason||(locale==="zh"?"未记录":"Not recorded")}</p><p>{locale==="zh"?"本版意见：":"Current: "}{c.afterReason||(locale==="zh"?"未记录，保留待确认":"Not recorded; remains unconfirmed")}</p>{c.evidenceChanged&&<span className={styles.badge}>{locale==="zh"?"关联依据有变化":"Evidence links changed"}</span>}</article>)}</>:<p>{locale==="zh"?"旧版本未保存可比较快照，本版仍可查看现有缺口。":"No comparison snapshot exists for this legacy revision."}</p>}</section>;
}
