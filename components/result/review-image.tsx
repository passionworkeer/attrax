"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import type { LocatedAnchorVM } from "@/lib/result/inspection-view-model";
import { checkLabel } from "@/lib/result/check-labels";
import styles from "./review-result.module.css";

export function ReviewImage({images, anchors, locale, preferredId, preferredObservation, checkNumbers, onSelectCheck}: {
  images: {imageId: string; url: string; fileName: string}[];
  anchors: Record<string, LocatedAnchorVM[]>; locale: "zh" | "en"; preferredId?: string; preferredObservation?: string;
  checkNumbers?: Record<string,string>;
  onSelectCheck?: (checkId:string)=>void;
}) {
  const [imageId, setImageId] = useState(preferredId || images[0]?.imageId);
  const [selected, setSelected] = useState<string | null>(preferredObservation || null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({x: 0, y: 0});
  const [all, setAll] = useState(false);
  const drag = useRef<{x: number; y: number; px: number; py: number} | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const image = images.find(i => i.imageId === imageId) || images[0];
  const marks = image ? anchors[image.imageId] || [] : [];
  const active = marks.find(a => a.observationId === selected) || marks[0];
  const reset = () => {setZoom(1); setPan({x:0,y:0});};
  const focus = (anchor: LocatedAnchorVM) => {
    setSelected(anchor.observationId);
    onSelectCheck?.(anchor.checkId);
    const scale = Math.min(3, Math.max(1.4, .65 / Math.max(anchor.bbox.w, anchor.bbox.h)));
    setZoom(scale);
    const canvas = viewport.current?.querySelector<HTMLElement>("[data-image-canvas]");
    setPan({x:(.5-anchor.bbox.x-anchor.bbox.w/2)*(canvas?.offsetWidth || 0)*scale, y:(.5-anchor.bbox.y-anchor.bbox.h/2)*(canvas?.offsetHeight || 0)*scale});
  };
  if (!image) return <p>{locale === "zh" ? "暂无产品图片" : "No product images"}</p>;
  return <div>
    <div className={styles.toolbar}>
      <strong>{locale === "zh" ? "原图与标识" : "Images & markings"}</strong>
      <button onClick={() => setZoom(z => Math.max(1,z-.5))} aria-label={locale === "zh" ? "缩小图片" : "Zoom out"}>−</button>
      <span>{Math.round(zoom*100)}%</span>
      <button onClick={() => setZoom(z => Math.min(4,z+.5))} aria-label={locale === "zh" ? "放大图片" : "Zoom in"}>＋</button>
      <button onClick={reset}>{locale === "zh" ? "恢复全图" : "Reset"}</button>
    </div>
    <div ref={viewport} className={styles.viewport} tabIndex={0} aria-label={locale === "zh" ? "图片查看器，放大后可拖动或用方向键移动" : "Image viewer; drag or use arrow keys to pan"}
      onKeyDown={e => {const delta = {ArrowLeft:[30,0],ArrowRight:[-30,0],ArrowUp:[0,30],ArrowDown:[0,-30]}[e.key]; if(delta && zoom>1){e.preventDefault();setPan(p=>({x:p.x+delta[0],y:p.y+delta[1]}));}}}
      onPointerDown={e => {if(zoom<=1 || (e.target as Element).closest("button")) return; drag.current={x:e.clientX,y:e.clientY,px:pan.x,py:pan.y};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e => {const d=drag.current;if(d)setPan({x:d.px+e.clientX-d.x,y:d.py+e.clientY-d.y});}}
      onPointerUp={() => {drag.current=null;}} onPointerCancel={() => {drag.current=null;}}>
      <div className={styles.imageCanvas} data-image-canvas style={{transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`}}>
        {/* Intrinsic image dimensions and relative overlays share one coordinate plane. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt={image.fileName} draggable={false} onLoad={()=>{if(preferredObservation && active?.observationId===preferredObservation)focus(active);}} />
        {(all ? marks : active ? [active] : []).map((anchor,index)=><button key={anchor.observationId} onClick={()=>focus(anchor)}
          className={styles.box} data-active={anchor.observationId===active?.observationId}
          style={{left:`${anchor.bbox.x*100}%`,top:`${anchor.bbox.y*100}%`,width:`${anchor.bbox.w*100}%`,height:`${anchor.bbox.h*100}%`}}
          aria-label={`${locale === "zh" ? "定位" : "Locate"} ${(anchor.checkId === "common.certification_marks.visible" ? anchor.shortTitle : checkLabel(anchor.checkId,locale,anchor.shortTitle))}`}>
          <span>#{checkNumbers?.[anchor.checkId] || index+1} · {(anchor.checkId === "common.certification_marks.visible" ? anchor.shortTitle : checkLabel(anchor.checkId,locale,anchor.shortTitle))}</span>
        </button>)}
      </div>
    </div>
    <div className={styles.thumbnails}>{images.map((item,index)=><button key={item.imageId} aria-pressed={item.imageId===image.imageId} onClick={()=>{setImageId(item.imageId);setSelected(null);reset();}}><Image unoptimized src={item.url} alt={`${locale === "zh" ? "产品照片" : "Photo"} ${index+1}`} width={72} height={64}/><span>{index+1} · {(anchors[item.imageId]||[]).length} {locale === "zh" ? "处定位" : "marks"}</span></button>)}</div>
    <div className={styles.markList} aria-label={locale === "zh" ? "选择标识定位" : "Choose marking"}>{marks.map(anchor=><button key={anchor.observationId} aria-pressed={anchor.observationId===active?.observationId} onClick={()=>focus(anchor)}>{(anchor.checkId === "common.certification_marks.visible" ? anchor.shortTitle : checkLabel(anchor.checkId,locale,anchor.shortTitle))}</button>)}</div>
    {marks.length>1 && <button className={styles.link} onClick={()=>setAll(!all)}>{locale === "zh" ? (all?"仅显示选中框":"显示全部定位框") : (all?"Show selected":"Show all")}</button>}
    <p className={styles.hint}>{locale === "zh" ? "框选表示识别位置，不代表认证有效。点击标识名称可定位放大；未定位的信息不会生成假框。" : "Boxes locate observations, not valid certifications. Select a marking to zoom."}</p>
  </div>;
}
