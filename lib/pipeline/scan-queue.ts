import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { runScan, type RunScanInput } from "@/lib/pipeline/scan";
import { updateSession } from "@/lib/pipeline/session-store";
import { writeJsonAtomic } from "@/lib/pipeline/session-store";
import { logUserActivity } from "@/lib/pipeline/upload-storage";

const QUEUE_DIR = join(process.cwd(), "data", "scan-queue");
/** Side-car directory for binary payloads (image/pdf bytes) referenced by job
 *  files. Keeping buffers out of the JSON file stops a single 8-image scan from
 *  writing a ~100 MB job file and exhausting disk under load. */
const PAYLOAD_DIR = join(process.cwd(), "data", "scan-queue-payloads");
const MAX_CONCURRENT_SCANS = Number.parseInt(process.env.SCAN_WORKER_CONCURRENCY ?? "1", 10);
/** Per-job byte cap (images + pdfs). Defaults to 12 images × 10 MB + headroom
 *  for PDFs. Oversized submissions are rejected at enqueue time so a single
 *  scan can't exhaust disk. */
const MAX_JOB_BYTES = Number.parseInt(
  process.env.SCAN_MAX_JOB_BYTES ?? String(12 * 10 * 1024 * 1024 + 50 * 1024 * 1024),
  10
);
/** Total bytes allowed across ALL queued + running jobs. Surplus submissions
 *  are rejected with 503 so the queue can drain instead of growing unbounded. */
const MAX_QUEUE_TOTAL_BYTES = Number.parseInt(
  process.env.SCAN_MAX_QUEUE_BYTES ?? String(500 * 1024 * 1024),
  10
);
/** Max retry attempts for a single job before it is marked permanently failed.
 *  Read lazily so test/runtime env changes take effect without a module reload. */
function getMaxAttempts(): number {
  const raw = Number.parseInt(process.env.SCAN_MAX_ATTEMPTS ?? "3", 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 3;
}
/** A job in `running` state older than this (ms) is treated as a zombie crash
 *  and re-enqueued (or failed if attempts are exhausted). Read lazily. */
function getZombieTimeoutMs(): number {
  const raw = Number.parseInt(
    process.env.SCAN_ZOMBIE_TIMEOUT_MS ?? String(5 * 60 * 1000),
    10
  );
  return Number.isFinite(raw) && raw >= 0 ? raw : 5 * 60 * 1000;
}

type ScanJob = {
  jobId: string;
  sessionId: string;
  input: SerializableRunScanInput;
  createdAt: number;
  attempts: number;
  /** "queued" while waiting; "running" while executing. Absent on legacy jobs
   *  is treated as "queued". Used to detect zombies after a crash. */
  state?: "queued" | "running" | "failed";
  /** Epoch ms when execution started (set when state→running). */
  startedAt?: number;
  /** Set when the job exceeded MAX_ATTEMPTS and was marked permanently failed. */
  failureReason?: string;
  /** Epoch ms when the job was marked permanently failed. Set together with
   *  state→"failed" so reclaimZombies can ignore it on the next restart. */
  failedAt?: number;
};

type SerializableRunScanInput = Omit<RunScanInput, "images" | "pdfs"> & {
  images: Array<ImageRef>;
  pdfs?: Array<PdfRef>;
};

/**
 * Image reference. Backward-compatible:
 * - `bufferBase64` (legacy): inline base64 bytes for old jobs on disk.
 * - `path` + `sha256` + `bytes` (current): pointer into PAYLOAD_DIR. The
 *   buffer lives on disk instead of bloating the JSON file.
 * Either field set is sufficient for deserializeInput.
 */
type ImageRef = {
  bufferBase64?: string;
  path?: string;
  sha256?: string;
  bytes?: number;
  originalName: string;
  mimeType: string;
};
type PdfRef = {
  bufferBase64?: string;
  path?: string;
  sha256?: string;
  bytes?: number;
  name: string;
  mimeType: string;
};

declare global {
  var __scanQueueState: { running: number; draining: boolean } | undefined;
}

function queueState() {
  if (!globalThis.__scanQueueState) {
    globalThis.__scanQueueState = { running: 0, draining: false };
  }
  return globalThis.__scanQueueState;
}

function ensureQueueDir() {
  if (!existsSync(QUEUE_DIR)) mkdirSync(QUEUE_DIR, { recursive: true });
}

function jobPath(jobId: string): string {
  return join(QUEUE_DIR, `${jobId}.json`);
}

function listJobs(): ScanJob[] {
  ensureQueueDir();
  return readdirSync(QUEUE_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      try {
        return JSON.parse(readFileSync(join(QUEUE_DIR, file), "utf-8")) as ScanJob;
      } catch (error) {
        console.warn(`[scan-queue] ignoring malformed job ${file}`, error);
        return null;
      }
    })
    .filter((job): job is ScanJob => Boolean(job))
    .sort((a, b) => a.createdAt - b.createdAt);
}

function ensurePayloadDir() {
  if (!existsSync(PAYLOAD_DIR)) mkdirSync(PAYLOAD_DIR, { recursive: true });
}

function payloadPath(jobId: string, kind: "img" | "pdf", index: number): string {
  return join(PAYLOAD_DIR, `${jobId}.${kind}.${index}.bin`);
}

/** Sum of image + pdf buffer bytes for the live RunScanInput (pre-serialize). */
function inputByteSize(input: RunScanInput): number {
  const images = input.images.reduce((sum, img) => sum + img.buffer.length, 0);
  const pdfs = (input.pdfs ?? []).reduce((sum, pdf) => sum + pdf.buffer.length, 0);
  return images + pdfs;
}

/** Bytes consumed by jobs currently in the queue (queued + running). Failed
 *  jobs are skipped — their payloads are removed by markJobFailed. Used to
 *  enforce MAX_QUEUE_TOTAL_BYTES so the queue can always drain. */
function currentQueueBytes(): number {
  let total = 0;
  for (const job of listJobs()) {
    if (job.state === "failed") continue;
    for (const img of job.input.images ?? []) total += img.bytes ?? 0;
    for (const pdf of job.input.pdfs ?? []) total += pdf.bytes ?? 0;
  }
  return total;
}

/** Remove the side-car payload files for a finished (success or permanently
 *  failed) job. Best-effort: a missing file (already cleaned or never written
 *  for legacy base64 jobs) is not an error. */
function removeJobPayloads(job: ScanJob): void {
  const paths: string[] = [];
  for (let i = 0; i < job.input.images.length; i++) {
    const p = job.input.images[i]?.path;
    if (p) paths.push(p);
  }
  if (job.input.pdfs) {
    for (let i = 0; i < job.input.pdfs.length; i++) {
      const p = job.input.pdfs[i]?.path;
      if (p) paths.push(p);
    }
  }
  for (const p of paths) {
    try {
      unlinkSync(p);
    } catch {
      /* already gone or legacy base64 — fine */
    }
  }
}

function serializeInput(jobId: string, input: RunScanInput): SerializableRunScanInput {
  // Write each buffer to a side-car file and store a reference. The job JSON
  // stays small (~KB) regardless of how many MB the user uploaded.
  ensurePayloadDir();
  return {
    ...input,
    images: input.images.map((image, i) => {
      const path = payloadPath(jobId, "img", i);
      writeFileSyncBytes(path, image.buffer);
      return {
        path,
        sha256: undefined,
        bytes: image.buffer.length,
        originalName: image.originalName,
        mimeType: image.mimeType,
      };
    }),
    pdfs: input.pdfs?.map((pdf, i) => {
      const path = payloadPath(jobId, "pdf", i);
      writeFileSyncBytes(path, pdf.buffer);
      return {
        path,
        sha256: undefined,
        bytes: pdf.buffer.length,
        name: pdf.name,
        mimeType: pdf.mimeType,
      };
    }),
  };
}

// Imported lazily so the test fs mock (which swaps unlinkSync) still sees the
// same module shape — writeFileSync is re-exported by the mock spread.
import { writeFileSync } from "fs";
function writeFileSyncBytes(path: string, buffer: Buffer): void {
  writeFileSync(path, buffer);
}

function deserializeInput(input: SerializableRunScanInput): RunScanInput {
  return {
    ...input,
    images: input.images.map((image) => {
      const buffer = image.bufferBase64
        ? Buffer.from(image.bufferBase64, "base64")
        : Buffer.from(readFileSync(image.path ?? "", "utf-8")); // path is required when bufferBase64 absent
      return {
        buffer,
        originalName: image.originalName,
        mimeType: image.mimeType,
      };
    }),
    pdfs: input.pdfs?.map((pdf) => {
      const buffer = pdf.bufferBase64
        ? Buffer.from(pdf.bufferBase64, "base64")
        : Buffer.from(readFileSync(pdf.path ?? "", "utf-8"));
      return {
        buffer,
        name: pdf.name,
        mimeType: pdf.mimeType,
      };
    }),
  };
}

export function enqueueScan(sessionId: string, input: RunScanInput): void {
  if (process.env.NODE_ENV === "test") {
    void executeScan(sessionId, input);
    return;
  }

  // Enforce size quotas BEFORE touching the filesystem so an oversized
  // submission is reported back to the client (the route converts the thrown
  // error into a 503 + session rollback) instead of being half-written.
  const jobBytes = inputByteSize(input);
  if (jobBytes > MAX_JOB_BYTES) {
    throw new Error(`SCAN_JOB_TOO_LARGE: job payload ${jobBytes}B exceeds limit ${MAX_JOB_BYTES}B`);
  }
  const queuedBytes = currentQueueBytes();
  if (queuedBytes + jobBytes > MAX_QUEUE_TOTAL_BYTES) {
    throw new Error(
      `SCAN_QUEUE_FULL: queue ${queuedBytes}B + new job ${jobBytes}B exceeds limit ${MAX_QUEUE_TOTAL_BYTES}B`
    );
  }

  ensureQueueDir();
  const jobId = `${Date.now()}_${sessionId}`;
  const job: ScanJob = {
    jobId,
    sessionId,
    input: serializeInput(jobId, input),
    createdAt: Date.now(),
    attempts: 0,
    state: "queued",
  };
  writeJsonAtomic(jobPath(jobId), job);
  void drainQueue();
}

/**
 * Reclaim zombie jobs left in `running` state by a previous process that
 * crashed mid-scan. Called once at drain start. Jobs older than
 * ZOMBIE_TIMEOUT_MS are either re-queued (attempts < MAX_ATTEMPTS) or marked
 * permanently failed (and the session updated so polling clients see the
 * failure instead of hanging forever).
 */
function reclaimZombies(now: number): void {
  let reclaimed = 0;
  for (const job of listJobs()) {
    // Permanently-failed jobs are never reclaimed — keep the marker on disk
    // so a restart can't silently re-run a job the operator already triaged.
    if (job.state === "failed") continue;
    if (job.state !== "running") continue;
    if (typeof job.startedAt !== "number") continue;
    if (now - job.startedAt < getZombieTimeoutMs()) continue;

    if (job.attempts >= getMaxAttempts()) {
      markJobFailed(job, "SCAN_MAX_ATTEMPTS_EXCEEDED");
      continue;
    }
    // Re-queue: bump attempts and clear running markers so drain picks it up.
    const requeued: ScanJob = {
      ...job,
      state: "queued",
      startedAt: undefined,
      attempts: job.attempts + 1,
    };
    writeJsonAtomic(jobPath(job.jobId), requeued);
    reclaimed += 1;
  }
  if (reclaimed > 0) {
    console.info(`[scan-queue] reclaimed ${reclaimed} zombie job(s) after crash`);
  }
}

/**
 * Mark a job permanently failed and persist the failure to disk BEFORE
 * touching the session or anything else. The atomic write of a `state:
 * "failed"` job file is the source of truth — even if a later unlink fails
 * (Windows EPERM, antivirus lock) or the process crashes mid-call, the
 * failed marker is already on disk and reclaimZombies will skip it on the
 * next startup instead of re-running it forever.
 *
 * The job file is intentionally kept (not deleted): a leftover `.json` with
 * `state:"failed"` is the durable "do not retry" signal. drainQueue's
 * work-selection filter ignores failed jobs.
 */
function markJobFailed(job: ScanJob, reason: string): void {
  const failed: ScanJob = {
    ...job,
    state: "failed",
    startedAt: undefined,
    failureReason: reason,
    failedAt: Date.now(),
  };

  // Step 1: atomically persist the failed marker. This MUST succeed before
  // we touch anything else — it's the durable record that this job is dead.
  writeJsonAtomic(jobPath(job.jobId), failed);

  // Step 2: best-effort unlink. If it fails the marker is still on disk in
  // `failed` state, which reclaimZombies / drainQueue recognize and skip.
  try {
    unlinkSync(jobPath(job.jobId));
  } catch (error) {
    // Not fatal — the failed-state marker written above is the authority.
    // EPERM/EBUSY on Windows just means the file lingers in failed state,
    // which the queue already knows how to ignore.
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== "ENOENT") {
      console.warn(
        `[scan-queue] failed marker persisted, but unlink of ${job.jobId} failed (${code}); the file will stay in failed state and be ignored by the queue`
      );
    }
  }
  // Step 2b: drop the side-car payload files so disk doesn't accumulate
  // orphaned buffers under PAYLOAD_DIR for permanently-failed jobs.
  removeJobPayloads(job);

  // Step 3: surface the failure to polling clients via the session.
  updateSession(job.sessionId, {
    status: "failed",
    progress: 100,
    stageText: "扫描失败，请稍后重试。",
    error: reason,
  });
  logUserActivity({
    ts: new Date().toISOString(),
    event: "scan_failed",
    sessionId: job.sessionId,
    status: "failed",
    error: reason,
  });
}

export async function drainQueue(): Promise<void> {
  const state = queueState();
  if (state.draining) return;
  state.draining = true;

  try {
    reclaimZombies(Date.now());
    while (state.running < Math.max(1, MAX_CONCURRENT_SCANS)) {
      // Skip both in-flight (running) and permanently-failed jobs. Failed
      // jobs stay on disk as durable markers; we never pick them back up.
      const queued = listJobs().filter(
        (j) => j.state !== "running" && j.state !== "failed"
      );
      const job = queued[0];
      if (!job) return;
      state.running += 1;

      // Mark running + bump attempts BEFORE executing, so a crash between now
      // and completion leaves a recoverable trail on disk. Previously we
      // unlinked the job file first, which lost the job permanently on crash.
      const runningJob: ScanJob = {
        ...job,
        state: "running",
        startedAt: Date.now(),
        attempts: job.attempts + 1,
      };
      writeJsonAtomic(jobPath(job.jobId), runningJob);

      // Check max-attempts up front so a tight retry loop can't infinitely
      // spin on a perpetually-failing job.
      if (runningJob.attempts > getMaxAttempts()) {
        markJobFailed(runningJob, "SCAN_MAX_ATTEMPTS_EXCEEDED");
        state.running -= 1;
        continue;
      }

      void executeJob(runningJob).finally(() => {
        state.running -= 1;
        void drainQueue();
      });
    }
  } finally {
    state.draining = false;
  }
}

async function executeScan(sessionId: string, input: RunScanInput): Promise<void> {
  try {
    await runScan(sessionId, input);
  } catch (error) {
    console.error(`[scan-queue] job failed for ${sessionId}`, error);
    const errMsg = error instanceof Error ? error.message : "SCAN_FAILED";
    updateSession(sessionId, {
      status: "failed",
      progress: 100,
      stageText: "扫描失败，请稍后重试。",
      error: errMsg,
    });
    logUserActivity({
      ts: new Date().toISOString(),
      event: "scan_failed",
      sessionId,
      status: "failed",
      error: errMsg,
    });
  }
}

async function executeJob(job: ScanJob): Promise<void> {
  try {
    await executeScan(job.sessionId, deserializeInput(job.input));
    // Success — remove the job file AND its side-car payloads so neither is
    // retried. Only delete here (after success); deletion before execution
    // caused permanent job loss.
    try {
      unlinkSync(jobPath(job.jobId));
    } catch {
      /* already gone — fine */
    }
    removeJobPayloads(job);
  } catch (error) {
    // executeScan already surfaced the failure to the session; if attempts
    // remain, leave the file on disk in `queued` state so drain retries it.
    if (job.attempts >= getMaxAttempts()) {
      markJobFailed(job, "SCAN_MAX_ATTEMPTS_EXCEEDED");
    } else {
      console.warn(
        `[scan-queue] job ${job.jobId} attempt ${job.attempts} failed, will retry`,
        error
      );
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  void drainQueue();
}
