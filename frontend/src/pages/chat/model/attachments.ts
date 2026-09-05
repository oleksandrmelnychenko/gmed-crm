export const CHAT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_COUNT = 10;
const attachmentMimeTypes: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  txt: "text/plain", csv: "text/csv", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  dcm: "application/dicom",
};
export const CHAT_ATTACHMENT_ACCEPT = Object.keys(attachmentMimeTypes).map((extension) => `.${extension}`).join(",");
export type PendingChatAttachment = { id: string; file: File };

export function chatAttachmentMime(filename: string) {
  if (filename.lastIndexOf(".") <= 0) return "application/octet-stream";
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  return Object.hasOwn(attachmentMimeTypes, extension) ? attachmentMimeTypes[extension] : "application/octet-stream";
}

export function chatAttachmentProblem(file: Pick<File, "name" | "size">): "type" | "size" | "name" | null {
  if (new TextEncoder().encode(file.name).length > 255 || /[\\/]/.test(file.name) || [...file.name].some((char) => char.charCodeAt(0) < 32)) return "name";
  if (chatAttachmentMime(file.name) === "application/octet-stream") return "type";
  return file.size > CHAT_ATTACHMENT_MAX_BYTES ? "size" : null;
}

export function chatAttachmentPreviewKind(filename: string) {
  const mime = chatAttachmentMime(filename);
  if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime)) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/plain" || mime === "text/csv") return "text";
  return null;
}

export function downloadChatAttachment(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
