import {describe,it,expect,vi,afterEach} from "vitest";
import {loadProductSample,PRODUCT_SAMPLES} from "@/lib/upload/product-samples";

afterEach(()=>vi.unstubAllGlobals());
describe("sample evidence loading",()=>{
  it("loads official evidence with the three images when requested",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:true,blob:async()=>new Blob(["content"],{type:url.endsWith("pdf")?"application/pdf":url.endsWith("txt")?"text/plain":"image/jpeg"})})));
    for(const id of ["lego-76429","xiaomi-kettle"]){
      const sample=PRODUCT_SAMPLES.find(s=>s.id===id)!;
      const result=await loadProductSample(sample,true);
      expect(result.images).toHaveLength(3);
      expect(result.documents).toHaveLength(id==="lego-76429"?3:2);
      expect(result.documents[1].type).toBe("application/pdf");
      if(id==="lego-76429")expect(result.documents[2].type).toBe("application/pdf");
      expect((await loadProductSample(sample,false)).documents).toHaveLength(0);
    }
  });
  it("does not fabricate an official certificate for the Anker example",()=>{
    expect(PRODUCT_SAMPLES.find(s=>s.id==="anker-a2332")?.evidenceDocuments).toEqual([]);
  });
});
