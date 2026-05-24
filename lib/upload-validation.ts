import { MAX_DOCUMENT_SIZE_BYTES, MAX_IMAGE_SIZE_BYTES } from "@/lib/constants";

type UploadKind = "image" | "document";

export type UploadValidationError =
  | "UNSUPPORTED_IMAGE_TYPE"
  | "UNSUPPORTED_DOCUMENT_TYPE"
  | "IMAGE_TOO_LARGE"
  | "DOCUMENT_TOO_LARGE"
  | "INVALID_FILE_SIGNATURE";

const IMAGE_TYPES = new Map([
  ["image/jpeg", ["jpg", "jpeg"]],
  ["image/png", ["png"]],
  ["image/webp", ["webp"]],
]);

const DOCUMENT_TYPES = new Map([
  ["application/pdf", ["pdf"]],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ["docx"]],
  ["application/octet-stream", ["docx"]],
  ["text/html", ["html", "htm"]],
  ["text/plain", ["txt"]],
]);

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function hasKnownExtension(file: File, types: Map<string, string[]>): boolean {
  const extensions = types.get(file.type) ?? [];
  return extensions.includes(extensionOf(file.name));
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function isZip(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]);
}

function hasValidSignature(file: File, bytes: Uint8Array): boolean {
  if (file.type === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (file.type === "image/png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
  if (file.type === "image/webp") {
    return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  if (file.type === "application/pdf") return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.type === "application/octet-stream") return isZip(bytes);
  if (file.type === "text/html" || file.type === "text/plain") return true;
  return false;
}

export async function validateUploadFile(file: File, kind: UploadKind): Promise<UploadValidationError | null> {
  if (kind === "image" && file.size > MAX_IMAGE_SIZE_BYTES) return "IMAGE_TOO_LARGE";
  if (kind === "document" && file.size > MAX_DOCUMENT_SIZE_BYTES) return "DOCUMENT_TOO_LARGE";

  const types = kind === "image" ? IMAGE_TYPES : DOCUMENT_TYPES;
  if (!types.has(file.type) || !hasKnownExtension(file, types)) {
    return kind === "image" ? "UNSUPPORTED_IMAGE_TYPE" : "UNSUPPORTED_DOCUMENT_TYPE";
  }

  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return hasValidSignature(file, bytes) ? null : "INVALID_FILE_SIGNATURE";
}

export const ACCEPTED_IMAGE_TYPES = [...IMAGE_TYPES.keys()];
export const ACCEPTED_DOCUMENT_TYPES = [...DOCUMENT_TYPES.keys()];
