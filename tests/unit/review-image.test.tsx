import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it } from "vitest";
import { ReviewImage } from "@/components/result/review-image";
import type { LocatedAnchorVM } from "@/lib/result/inspection-view-model";

it("keeps boxes with their image and provides zoom/reset without precise box clicks",()=>{
 const anchor={observationId:"o1",checkId:"common.brand_model",imageId:"a",shortTitle:"Model",bbox:{x:.2,y:.3,w:.3,h:.2}} as LocatedAnchorVM;
 render(<ReviewImage locale="zh" images={[{imageId:"a",url:"/a.jpg",fileName:"a"},{imageId:"b",url:"/b.jpg",fileName:"b"}]} anchors={{a:[anchor]}}/>);
 expect(screen.getByRole("button",{name:"定位 Model",exact:true})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"放大图片"}));expect(screen.getByText("150%")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"恢复全图"}));expect(screen.getByText("100%")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:/产品照片 2/}));expect(screen.queryByRole("button",{name:"定位 Model",exact:true})).toBeNull();
});
