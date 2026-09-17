"use client";
import { useParams, useSearchParams } from "next/navigation";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import { getCompliPilotCopy } from "@/lib/complipilot/copy";
import { buildDemoPresetResult, scanResultToComplianceView, scanResultToRealComplianceView } from "@/lib/result-view-helpers";
import { ReviewResult } from "@/components/result/review-result";
import { useResultLoader } from "./use-result-loader";
import { ResultLoadingPanel } from "./result-state-panels";

export default function ResultPage() {
  const params = useParams<{ sessionId: string }>();
  const search = useSearchParams();
  const { locale } = useBlazeLocale();
  const copy = getCompliPilotCopy(locale);
  const sessionId = params.sessionId;
  const isDemoSession = sessionId === "demo";
  const demoResult = isDemoSession ? buildDemoPresetResult(search) : null;
  const {
    result,
    loadState,
    retry,
    degradedReason,
    message,
  } = useResultLoader({
    sessionId,
    isDemoSession,
    locale,
    initialResult: demoResult,
    loadingMessage: copy.result.loadingMessage,
    copy: {
      failed: copy.result.failed,
      loaded: copy.result.loaded,
      notFound: copy.result.notFound,
      processing: copy.result.processing,
      restored: copy.result.restored,
    },
  });
  if (!result) return <ResultLoadingPanel locale={locale} displayMessage={message} failed={loadState === "error"} onRetry={retry}/>;
  const report = isDemoSession ? scanResultToComplianceView(result,locale) : scanResultToRealComplianceView(result);
  return <ReviewResult key={`${sessionId}-${result.revision||1}`} result={result} report={report} locale={locale} onRefresh={retry} degradedReason={degradedReason}/>;
}
