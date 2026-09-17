import { redirect } from "next/navigation";
import { PROFIT_FEATURE_ENABLED } from "@/lib/product-scope";
import ProfitPageContent from "./profit-page-content";
export default async function ProfitPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!PROFIT_FEATURE_ENABLED) redirect(sessionId === "demo" ? "/upload" : `/result/${encodeURIComponent(sessionId)}`);
  return <ProfitPageContent />;
}
