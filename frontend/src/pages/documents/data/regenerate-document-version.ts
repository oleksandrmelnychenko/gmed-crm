import { apiFetch, clearApiCache } from "@/lib/api";
import type { DocumentItem, TemplateCatalogResponse } from "../model/types";
import { buildGenerateDocumentPayload, templateForDocument } from "../model/document-model";
import { isOutdatedCurrentVersion, oneClickReplacementForm, regeneratesInOneClick } from "../model/outdated-document-version";
import { needsValidityAttention } from "../model/document-validity";
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
export async function regenerateOutdatedDocument(
  documentId: string,
  /**
   * `outdated` needs `terms_current: false`; `expired` renews a template
   * document whose «Gültig bis» passed or is near (owner 2026-11-15). The new
   * version starts without a date unless the records know it.
   */
  reason: "outdated" | "expired" = "outdated",
): Promise<RegeneratedDocument> {
  const [document, catalog] = await Promise.all([
    apiFetch<DocumentItem>(`/documents/${documentId}`, { forceFresh: true }),
    apiFetch<TemplateCatalogResponse>("/documents/templates", { cacheTtlMs: 300_000 }),
  ]);
  const renewable = reason === "expired" ? needsValidityAttention(document) : isOutdatedCurrentVersion(document);
  if (!renewable) {
    throw new RegenerateDocumentError("not_outdated", "document_not_outdated");
  }
  const template = templateForDocument(catalog.templates, document);
  if (!template || !document.patient_id) {
    throw new RegenerateDocumentError("no_template", "document_template_missing");
  }
  if (!regeneratesInOneClick(template.id)) return { kind: "needs_form", previousId: document.id };
  const form = oneClickReplacementForm(document, template);
  // The standard name ends with the patient, as the first version's did
  // (QA 2026-11-16 S3-1: new versions lost the name).
  const patients = document.patient_name
    ? [{ id: document.patient_id, patient_id: "", first_name: document.patient_name }]
    : [];
  const created = await generateDocument(buildGenerateDocumentPayload({ template, form, patients }));
  clearApiCache("/documents");
  clearApiCache("/patients");
  return {
    kind: "created",
    id: created.id,
    title: created.original_filename || created.auto_name || template.label,
    previousId: document.id,
  };
}

/**
 * «Продлить срок до …» of a Kostenvoranschlag (QA 2026-11-16 S2-1): the quote
 * it prints gets the new validity (audited like every quote change), then the
 * estimate's new version takes that date. The same date again is a no-op on
 * the server, so a failed second step can simply be retried.
 */
export async function extendEstimateValidity(documentId: string, validUntil: string): Promise<RegeneratedDocument> {
  await apiFetch<unknown>(`/documents/${documentId}/extend-quote-validity`, {
    method: "POST",
    body: JSON.stringify({ valid_until: validUntil }),
  });
  clearApiCache("/quotes");
  clearApiCache("/orders");
  return regenerateOutdatedDocument(documentId, "expired");
}
