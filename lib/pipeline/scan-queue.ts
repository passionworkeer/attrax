import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { runScan, type RunScanInput } from "@/lib/pipeline/scan";
import { updateSession } from "@/lib/pipeline/session-store";
import { writeJsonAtomic } from "@/lib/pipeline/session-store";
import { logUserActivity } from "@/lib/pipeline/upload-storage";

const QUEUE_DIR = join(process.cwd(), "data", "scan-queue");
const MAX_CONCURRENT_SCANS = Number.parseInt(process.env.SCAN_WORKER_CONCURRENCY ?? "1", 10);
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
  images: Array<{ bufferBase64: string; originalName: string; mimeType: string }>;
  pdfs?: Array<{ bufferBase64: string; name: string; mimeType: string }>;
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

function serializeInput(input: RunScanInput): SerializableRunScanInput {
  return {
    ...input,
    images: input.images.map((image) => ({
      bufferBase64: image.buffer.toString("base64"),
      originalName: image.originalName,
      mimeType: image.mimeType,
    })),
    pdfs: input.pdfs?.map((pdf) => ({
      bufferBase64: Buffer.from(pdf.buffer).toString("base64"),
      name: pdf.name,
      mimeType: pdf.mimeType,
    })),
  };
}

function deserializeInput(input: SerializableRunScanInput): RunScanInput {
  return {
    ...input,
    images: input.images.map((image) => ({
      buffer: Buffer.from(image.bufferBase64, "base64"),
      originalName: image.originalName,
      mimeType: image.mimeType,
    })),
    pdfs: input.pdfs?.map((pdf) => ({
      buffer: Buffer.from(pdf.bufferBase64, "base64"),
      name: pdf.name,
      mimeType: pdf.mimeType,
    })),
  };
}

export function enqueueScan(sessionId: string, input: RunScanInput): void {
  if (process.env.NODE_ENV === "test") {
    void executeScan(sessionId, input);
    return;
  }

  ensureQueueDir();
  const job: ScanJob = {
    jobId: `${Date.now()}_${sessionId}`,
    sessionId,
    input: serializeInput(input),
    createdAt: Date.now(),
    attempts: 0,
    state: "queued",
  };
  writeJsonAtomic(jobPath(job.jobId), job);
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
    // Success — remove the job file so it isn't retried. Only delete here
    // (after success); deletion before execution caused permanent job loss.
    try {
      unlinkSync(jobPath(job.jobId));
    } catch {
      /* already gone — fine */
    }
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
