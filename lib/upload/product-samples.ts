import type { Market, ProductCategory } from "@/lib/types";

export interface ProductSample {
  id: string;
  title: string;
  titleEn: string;
  category: ProductCategory;
  markets: Market[];
  previewImage: string;
  images: string[];
  document: string;
  evidenceDocuments?: string[];
}

export const PRODUCT_SAMPLES: ProductSample[] = [
  { id: "anker-a2332", title: "Anker A2332 充电器", titleEn: "Anker A2332 charger", category: "electronics", markets: ["EU"] },
  { id: "xiaomi-kettle", title: "小米智能电热水壶 2 Pro", titleEn: "Xiaomi Smart Kettle 2 Pro", category: "appliance", markets: ["EU"] },
  { id: "lego-76429", title: "LEGO 76429 分院帽（18+）", titleEn: "LEGO 76429 Sorting Hat (18+)", category: "toy", markets: ["US"] },
].map((sample) => ({
  ...sample,
  category: sample.category as ProductCategory,
  markets: sample.markets as Market[],
  previewImage: `/product-samples/${sample.id}/01.jpg`,
  images: [1, 2, 3].map((index) => `/product-samples/${sample.id}/0${index}.jpg`),
  document: `/product-samples/${sample.id}/spec.txt`,
  evidenceDocuments: sample.id === "lego-76429" ? [
    "/product-samples/lego-76429/product-certificate.pdf",
    "/product-samples/lego-76429/official-instructions-battery-pages.pdf",
  ] : sample.id === "xiaomi-kettle" ? ["/product-samples/xiaomi-kettle/declaration.pdf"] : [],
}));

/** Fetch all assets before changing the form, so a failed load preserves user input. */
export async function loadProductSample(sample: ProductSample, includeDocument: boolean) {
  async function file(url: string, type: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Sample asset unavailable: ${response.status}`);
    const blob = await response.blob();
    if (!blob.size || (blob.type && !blob.type.startsWith(type.split("/")[0] + "/"))) {
      throw new Error("Invalid sample asset");
    }
    return new File([blob], `${sample.id}-${url.split("/").pop()}`, { type });
  }
  const [images, documents] = await Promise.all([
    Promise.all(sample.images.map((url) => file(url, "image/jpeg"))),
    includeDocument ? Promise.all([file(sample.document, "text/plain"), ...(sample.evidenceDocuments || []).map(url=>file(url,"application/pdf"))]) : Promise.resolve([]),
  ]);
  return { images, documents };
}
