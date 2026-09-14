"use client";

/**
 * EvidenceRequestPanel — the supplement-evidence card on the result page
 * (plan 2026-09-14 §5.3, J10).
 *
 * Multiple "补拍铭牌/批次/型号" findings merge into ONE grouped request the
 * user can act on: pick files, submit them against the SAME session
 * (original photos stay), then trigger a revision re-run and land back on
 * the burning page. The card surfaces stored counts per submission.
 */
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { appendEvidence, requestRevision } from "@/lib/rag-client/evidence-api";
import { cn } from "@/lib/utils";

export interface EvidenceRequestPanelProps {
  sessionId: string;
  /** Merged, de-duplicated supplement requests (title + resolves count). */
  requests: Array<{
    id: string;
    title: string;
    explanation?: string;
    resolvesCheckIds: string[];
  }>;
  locale: "zh" | "en";
}

type SubmitState =
  | { phase: "idle" }
  | { phase: "uploading"; count: number }
  | { phase: "done"; storedCount: number; alreadyApplied: boolean }
  | { phase: "error"; message: string };

export function EvidenceRequestPanel({
  sessionId,
  requests,
  locale,
}: EvidenceRequestPanelProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<SubmitState>({ phase: "idle" });
  const [pending, startTransition] = useTransition();

  if (requests.length === 0) return null;

  const zh = locale === "zh";
  const resolvedCount = new Set(
    requests.flatMap((request) => request.resolvesCheckIds),
  ).size;

  const handleSubmit = async (files: File[]) => {
    if (files.length === 0) return;
    setState({ phase: "uploading", count: files.length });
    try {
      const result = await appendEvidence(
        sessionId,
        files.map((file) => ({ file })),
        "supplement",
      );
      setState({
        phase: "done",
        storedCount: result.storedCount,
        alreadyApplied: result.status === "already_applied",
      });
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "UPLOAD_FAILED",
      });
    }
  };

  const handleRevision = () => {
    startTransition(async () => {
      try {
        await requestRevision(sessionId);
        router.push(`/burning/${sessionId}`);
      } catch (error) {
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : "REVISION_FAILED",
        });
      }
    });
  };

  return (
    <section
      id="supplement-evidence"
      className="blaze-panel p-5 sm:p-7"
      aria-label={zh ? "补充证据" : "Supplement evidence"}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/42">
            {zh ? "补充材料" : "SUPPLEMENT"}
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
            {zh ? "补充证据与资料" : "Supplement evidence"}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-white/58">
            {zh
              ? `以下 ${requests.length} 项材料可一次补齐（覆盖 ${resolvedCount} 项检查）。上传后保留本次全部照片，重新生成修订版报告。`
              : `${requests.length} merged requests below cover ${resolvedCount} checks. Original photos are preserved; submitting generates a revised report.`}
          </p>
        </div>
      </div>

      <ul className="mt-5 space-y-3">
        {requests.map((request) => (
          <li
            key={request.id}
            className="rounded-[18px] border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3"
          >
            <p className="text-sm font-semibold text-white">{request.title}</p>
            {request.explanation ? (
              <p className="mt-1 text-xs leading-6 text-white/55">{request.explanation}</p>
            ) : null}
            <p className="mt-1 text-[11px] text-white/40">
              {zh
                ? `可补全 ${request.resolvesCheckIds.length} 项检查`
                : `resolves ${request.resolvesCheckIds.length} checks`}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,.pdf,.docx,.txt"
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            void handleSubmit(files);
            event.target.value = "";
          }}
        />
        <Button
          size="lg"
          className="rounded-full"
          disabled={state.phase === "uploading"}
          onClick={() => inputRef.current?.click()}
        >
          {state.phase === "uploading"
            ? zh
              ? `上传中（${state.count} 个文件）…`
              : `Uploading ${state.count} file(s)…`
            : zh
              ? "上传补充照片 / 文件"
              : "Upload photos / documents"}
        </Button>
        {(state.phase === "done" || state.phase === "idle") && (
          <Button
            size="lg"
            variant="outline"
            className={cn(
              "rounded-full border-white/12 bg-white/4 text-white hover:bg-white/10",
              state.phase === "idle" && "opacity-60",
            )}
            disabled={state.phase === "idle" || pending}
            onClick={handleRevision}
          >
            {pending
              ? zh ? "正在生成修订版…" : "Generating revision…"
              : zh ? "生成修订版报告" : "Run revision"}
          </Button>
        )}
      </div>

      {state.phase === "done" ? (
        <p
          data-testid="evidence-panel-result"
          className="mt-3 text-sm leading-6 text-emerald-300"
        >
          {state.alreadyApplied
            ? zh
              ? "这批文件已提交过，未重复保存。"
              : "This batch was already submitted; nothing re-stored."
            : zh
              ? `已保存 ${state.storedCount} 个文件。点击「生成修订版报告」重新检测。`
              : `${state.storedCount} file(s) stored. Run the revision to re-check.`}
        </p>
      ) : null}
      {state.phase === "error" ? (
        <p
          data-testid="evidence-panel-error"
          className="mt-3 text-sm leading-6 text-rose-300"
        >
          {zh ? "提交失败：" : "Submission failed: "}
          <span className="font-mono">{state.message}</span>
        </p>
      ) : null}
    </section>
  );
}
