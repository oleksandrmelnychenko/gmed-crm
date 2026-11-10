/**
 * What a patient may send through "Upload documents": documents only, the
 * same types as a chat attachment (`pages/chat/model/attachments.ts`). The
 * server enforces the same list (`file_sniff::is_portal_upload_type`) and
 * also looks into the file; this check only spares the round trip.
 */
export const PORTAL_UPLOAD_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "heif",
  "txt",
  "csv",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "dcm",
] as const;

/** The `accept` value of the file field. */
export const PORTAL_UPLOAD_ACCEPT = PORTAL_UPLOAD_EXTENSIONS.map((extension) => `.${extension}`).join(",");

/** The server's limit (`MAX_FILE_SIZE` in documents.rs). */
export const PORTAL_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export type PortalUploadProblem = "type" | "empty" | "size";

/** Why the chosen file cannot be sent, or null when it can. */
export function portalUploadProblem(file: Pick<File, "name" | "size">): PortalUploadProblem | null {
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot + 1).trim().toLowerCase() : "";
  if (!(PORTAL_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) return "type";
  if (file.size <= 0) return "empty";
  if (file.size > PORTAL_UPLOAD_MAX_BYTES) return "size";
  return null;
}

/** The `uiText` key of the message for a problem. */
export const PORTAL_UPLOAD_PROBLEM_KEYS: Record<PortalUploadProblem, string> = {
  type: "portal_upload_type_not_allowed",
  empty: "portal_upload_empty_file",
  size: "portal_upload_too_large",
};
