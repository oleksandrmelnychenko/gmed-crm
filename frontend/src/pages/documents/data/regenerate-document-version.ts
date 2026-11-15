import { apiFetch, clearApiCache } from "@/lib/api";
import type { DocumentItem, TemplateCatalogResponse } from "../model/types";
import { buildGenerateDocumentPayload, templateForDocument } from "../model/document-model";
import { isOutdatedCurrentVersion, oneClickReplacementForm, regeneratesInOneClick } from "../model/outdated-document-version";
import { generateDocument } from "./document-api";

export type RegeneratedDocument =
  | { kind: "created"; id: string; title: string; previousId: string }
  /** The template needs manual input: the replacement form opens instead. */
  | { kind: "needs_form"; previousId: string };

export class RegenerateDocumentError extends Error {
  readonly code: "not_outdated" | "no_template";
  constructor(code: "not_outdated" | "no_template", message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Makes the new version of an outdated document from the current records:
 * `POST /documents/generate` with `replace_document_id`, the same path as
 * «Новая версия» on the documents screen. The server checks the role, the
 * patient access, that the old one is still the newest version without an
 * open signature request, stores the old one as superseded and audits it.
 */
export async function regenerateOutdatedDocument(documentId: string): Promise<RegeneratedDocument> {
  const [document, catalog] = await Promise.all([
    apiFetch<DocumentItem>(`/documents/${documentId}`, { forceFresh: true }),
    apiFetch<TemplateCatalogResponse>("/documents/templates", { cacheTtlMs: 300_000 }),
  ]);
  if (!isOutdatedCurrentVersion(document)) {
    throw new RegenerateDocumentError("not_outdated", "document_not_outdated");
  }
  const template = templateForDocument(catalog.templates, document);
  if (!template || !document.patient_id) {
    throw new RegenerateDocumentError("no_template", "document_template_missing");
  }
  if (!regeneratesInOneClick(template.id)) return { kind: "needs_form", previousId: document.id };
  const form = oneClickReplacementForm(document, template);
  const created = await generateDocument(buildGenerateDocumentPayload({ template, form }));
  clearApiCache("/documents");
  clearApiCache("/patients");
  return {
    kind: "created",
    id: created.id,
    title: created.original_filename || created.auto_name || template.label,
    previousId: document.id,
  };
}
