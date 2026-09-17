# Scan Latency Optimization Design

> ⚠️ **SUPERSEDED — 2026-07-18 历史优化设计 spec**。当前扫描延迟优化已并入 [`docs/plans/2026-09-14-judge-review-and-optimization-plan.md`](../../plans/2026-09-14-judge-review-and-optimization-plan.md)；该 spec 中提出的 LangGraph Send fan-out + HyDE refine 已随去 RAG 塌缩（2026-09-11 §7.7）移除。

Date: 2026-07-18
Status: Approved direction, pending implementation
Scope: RAG scan orchestration only

## Problem

Production scans currently take 68.5-140.3 seconds across the 11 successful
sessions inspected on 2026-07-18. Median end-to-end latency is 83.6 seconds.
Report generation accounts for a median 79.5 seconds.

Every inspected scan performs three sequential MiniMax report generations.
The first generation takes a median 25.9 seconds; the two corrective
generations add a median 50.7 seconds and as much as 111.7 seconds.

The corrective generations do not improve the verification outcome. The
production verifier runs in `text_overlap` mode because no NLI model is
loaded. That fallback cannot reliably tokenize Chinese claims and does not
recognize all citation forms emitted by the generator, including numeric
markers and document/section markers. All inspected verification rounds
therefore ended with attribution score 0 and status `REJECTED`.

## Decision

Corrective regeneration will be enabled only when the verifier is operating
in full `nli` mode. When verification is unavailable or degraded to
`text_overlap`, the graph will retain the verification result and disclosure
in the trace but end after the first generation.

This is a routing change, not a relaxation of the verification verdict. The
system must not turn a degraded or rejected verdict into `PASS`. It only stops
using a weak verifier to trigger expensive retries that have no demonstrated
ability to improve the result.

## Behavior

The verifier node will expose its verification mode in graph state. Routing
after verification will follow these rules:

1. A supported result ends immediately, as today.
2. A non-supported result in `nli` mode may enter the existing refinement
   loop until `max_attempts` is exhausted.
3. A result in `text_overlap` or `unavailable` mode ends immediately.
4. The final report, verification status, attribution score, and trace remain
   available to clients. No API schema or frontend contract changes.

Stage timing will remain visible through the existing agent trace. A concise
log entry will record the reason when regeneration is skipped, allowing
production checks without exposing prompts, uploaded content, or secrets.

## Expected Result

For the current production configuration, scans should make one report-model
call instead of three. Based on the inspected sessions, normal end-to-end
latency is expected to fall from 68-140 seconds to roughly 25-45 seconds.

The performance acceptance target is:

- one `generate` trace entry when verification mode is `text_overlap`;
- no regression in returned report content or API response shape;
- a representative production scan completes within 60 seconds, unless the
  single upstream model call itself exceeds that threshold;
- NLI-mode tests still demonstrate the existing bounded refinement behavior.

## Testing

Implementation will follow a red-green cycle:

1. Add a routing regression test proving that a rejected `text_overlap`
   result ends without refinement. Confirm it fails before the code change.
2. Add or extend a test proving that a rejected `nli` result still refines
   below `max_attempts` and ends at the cap.
3. Run targeted orchestrator and graph tests, then the full RAG test suite.
4. Verify that the generated OpenAPI/client contract is unchanged.

## Deployment

Production is `/opt/attrax` and is not a Git checkout. Deployment will:

1. create a timestamped backup of each replaced Python file;
2. transfer only the reviewed RAG source changes;
3. restart only `rag-service` through the `admin` PM2 home;
4. wait for startup pre-warming and health checks;
5. run a real scan and capture total latency, generation count, verification
   mode, final status, and service memory;
6. restore the backed-up files and restart `rag-service` if health or response
   compatibility fails.

No Next.js build, dependency installation, secret modification, or server-side
Git operation is part of this change.

## Deferred Work

Citation-format unification, Chinese-aware fallback verification, and loading
an NLI model are separate correctness improvements. They should be evaluated
against report quality and the server's 1.6 GiB memory limit before enabling
corrective regeneration in production.
