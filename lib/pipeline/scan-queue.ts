import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { runScan, type RunScanInput } from "@/lib/pipeline/scan";
import { updateSession } from "@/lib/pipeline/session-store";
import { logUserActivity } from "@/lib/pipeline/upload-storage";

const QUEUE_DIR = join(process.cwd(), "data", "scan-queue");
const MAX_CONCURRENT_SCANS = Number.parseInt(process.env.SCAN_WORKER_CONCURRENCY ?? "1", 10);

type ScanJob = {
  jobId: string;
  sessionId: string;
  input: SerializableRunScanInput;
  createdAt: number;
  attempts: number;
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

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(value), "utf-8");
  if (typeof renameSync === "function") {
    renameSync(tmpPath, filePath);
  } else {
    writeFileSync(filePath, JSON.stringify(value), "utf-8");
  }
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
  };
  writeJsonAtomic(jobPath(job.jobId), job);
  void drainQueue();
}

export async function drainQueue(): Promise<void> {
  const state = queueState();
  if (state.draining) return;
  state.draining = true;

  try {
    while (state.running < Math.max(1, MAX_CONCURRENT_SCANS)) {
      const [job] = listJobs();
      if (!job) return;
      state.running += 1;
      const path = jobPath(job.jobId);
      if (existsSync(path)) unlinkSync(path);
      void executeJob(job).finally(() => {
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
  await executeScan(job.sessionId, deserializeInput(job.input));
}

if (process.env.NODE_ENV !== "test") {
  void drainQueue();
}
