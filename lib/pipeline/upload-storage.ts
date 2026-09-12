/**
 * upload-storage.ts — per-session upload archive + activity log.
 *
 * - Saves uploaded images / documents to disk under
 *     data/uploads/{sessionId}/{sha12}_{sanitizedName}
 *   so admins can audit what each user uploaded after the fact. Originals are
 *   otherwise discarded by /api/scan once buffers are handed to the pipeline.
 * - Appends one JSON line per scan event to
 *     logs/user-activity.log
 *   so admins can tail activity without grepping across session files and
 *   middleware logs.
 *
 * Failures here must never block a scan: every disk write is best-effort and
 * logged to console if it fails.
 */
/**
 * @deprecated 2026-09-10 旧本地扫描管线(scan.ts/scan-queue.ts)已删除;生产上传走扫描服务 FileBackend(rag_service/infrastructure/file_backend.py)。
 * 本模块仅剩 session-store 的 removeAllUploads 兼容用途,勿在新代码中引用。
 */
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  appendFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";

export const UPLOAD_DIR = join(process.cwd(), "data", "uploads");
export const ACTIVITY_LOG = join(process.cwd(), "logs", "user-activity.log");

export type SavedUploadKind = "image" | "document";

export interface SavedUpload {
  /** Original filename as sent by the client. */
  originalName: string;
  /** Filename on disk: `{sha12}_{sanitizedOriginal}`. */
  savedAs: string;
  /** Absolute path on disk. */
  savedPath: string;
  /** Bytes written. */
  size: number;
  /** Client-supplied MIME type, may be `application/octet-stream`. */
  mimeType: string;
  /** Hex SHA-256 of the file content. */
  sha256: string;
  /** image vs document, per the multipart field name. */
  kind: SavedUploadKind;
}

export type UserActivityEvent =
  | "scan_started"
  | "scan_completed"
  | "scan_failed";

export interface UserActivityEntry {
  ts: string;
  event: UserActivityEvent;
  ip?: string;
  sessionId: string;
  category?: string;
  markets?: string[];
  fileCount?: number;
  totalBytes?: number;
  files?: Array<Pick<SavedUpload, "originalName" | "size" | "kind" | "sha256">>;
  status?: string;
  error?: string;
  durationMs?: number;
}

function sanitizeFilename(name: string): string {
  // Keep letters/digits/dot/dash/underscore; collapse everything else. Truncate
  // long names to keep the final path within filesystem limits.
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function saveUploadsForSession(
  sessionId: string,
  files: Array<{
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    kind: SavedUploadKind;
  }>
): SavedUpload[] {
  if (files.length === 0) return [];
  const sessionDir = join(UPLOAD_DIR, sessionId);
  ensureDir(sessionDir);

  const saved: SavedUpload[] = [];
  for (const file of files) {
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const savedAs = `${sha256.slice(0, 12)}_${sanitizeFilename(file.originalName)}`;
    const savedPath = join(sessionDir, savedAs);
    try {
      writeFileSync(savedPath, file.buffer);
    } catch (error) {
      // Best-effort: a failed write must not surface as a 500 to the client.
      console.warn(
        `[upload-storage] failed to write ${savedPath}:`,
        error
      );
      continue;
    }
    saved.push({
      originalName: file.originalName,
      savedAs,
      savedPath,
      size: file.buffer.length,
      mimeType: file.mimeType,
      sha256,
      kind: file.kind,
    });
  }
  return saved;
}

export function removeUploadsForSession(sessionId: string): void {
  const sessionDir = join(UPLOAD_DIR, sessionId);
  if (!existsSync(sessionDir)) return;
  try {
    rmSync(sessionDir, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `[upload-storage] failed to remove ${sessionDir}:`,
      error
    );
  }
}

export function logUserActivity(entry: UserActivityEntry): void {
  try {
    ensureDir(join(process.cwd(), "logs"));
    appendFileSync(ACTIVITY_LOG, JSON.stringify(entry) + "\n", "utf-8");
  } catch (error) {
    // Best-effort: a failed write must never break the calling code path.
    console.warn("[upload-storage] failed to append activity log:", error);
  }
}

/**
 * One-shot cleanup helper for clearStore() and tests. Removes every per-session
 * upload directory under data/uploads/.
 */
export function removeAllUploads(): void {
  if (!existsSync(UPLOAD_DIR)) return;
  try {
    for (const entry of readdirSync(UPLOAD_DIR)) {
      rmSync(join(UPLOAD_DIR, entry), { recursive: true, force: true });
    }
  } catch (error) {
    console.warn("[upload-storage] failed to clear uploads dir:", error);
  }
}