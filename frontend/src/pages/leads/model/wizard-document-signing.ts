import { ApiRequestError } from "@/lib/api";
import type { DocumentItem } from "@/pages/documents/model/types";

const SIGNABLE_DOCUMENT_TYPES = new Set([
  "confidentiality_release",
  "consent_data_release_child",
  "consent_data_release_single",
  "framework_contract",
  "single_order",
  "order_cost_estimate",
  "enhanced_due_diligence",
  // The third-party payer's Kostenübernahmeerklärung (payer and GMED sign it).
  "cost_coverage_declaration",
  // The lead's patient form ("Patientenformular – Angaben und Erklärungen"):
  // only the patient side signs it.
  "lead_self_disclosure",
]);

type SigningDocument = Pick<DocumentItem,
  "generated_template_id" | "compliance_kind" | "art" | "mime_type" | "has_stored_file" | "file_deleted_at"
> & Partial<Pick<DocumentItem, "lead_id" | "patient_id">>;

// During lead intake the framework contract sends the whole onboarding package:
// the order, the patient form and both consents are signed inside it, not one by one.
const LEAD_INTAKE_PACKAGE_MEMBERS = new Set(["single_order", "confidentiality_release", "lead_self_disclosure"]);

// "Signed" only with proof (owner decisions 2026-10-11); shared with the
// documents page.
export { documentSignedFor, signatureNeedsProof } from "@/pages/documents/model/signature-proof";

/** The consent forms the wizard's step 4 creates: the adult's, or the minor's in its two variants. */
export type LeadConsentFormTemplate = "privacy_consents" | "consent_data_release_child" | "consent_data_release_single";

/**
 * Which consent form the wizard creates (QA 2026-10-12, A2-06): for a minor the parents or the
 * guardian declare for the child on the child's form — both parents under joint custody (also while
 * nobody stated the custody), one parent alone or the guardian otherwise. The server refuses the
 * adult form for a minor (`minor_consent_form_required`).
 */
export function leadConsentFormTemplate(
  minor: boolean,
  custody: "joint" | "sole_parent" | "guardian" | null | undefined,
): LeadConsentFormTemplate {
  if (!minor) return "privacy_consents";
  return custody === "sole_parent" || custody === "guardian"
    ? "consent_data_release_single"
    : "consent_data_release_child";
}

const LEAD_CONSENT_FORM_TEMPLATES: ReadonlySet<string> = new Set<LeadConsentFormTemplate>([
  "privacy_consents",
  "consent_data_release_child",
  "consent_data_release_single",
]);

/**
 * Whether a document of the wizard's consent slot is a new version of the form `templateId` will
 * create (QA 2026-10-12, round 3): the adult's and the minor's two forms are variants of one form,
 * so a changed date of birth or custody versions the existing form instead of adding a second one.
 * An uploaded document without a template stays a candidate, as before.
 */
export function versionsSameForm(documentTemplateId: string | null | undefined, templateId: string): boolean {
  if (!documentTemplateId) return true;
  if (documentTemplateId === templateId) return true;
  return LEAD_CONSENT_FORM_TEMPLATES.has(documentTemplateId) && LEAD_CONSENT_FORM_TEMPLATES.has(templateId);
}

type OrderSignatureDocument = Pick<DocumentItem, "id" | "signed_at" | "is_latest_version" | "created_at">;

export type OrderClientSignatureState<T extends OrderSignatureDocument = OrderSignatureDocument> = {
  /** No current order document yet: it has to be created first. */
  needsDocument: boolean;
  /** The current, unsigned order document whose signed scan can be uploaded. */
  documentToSign: T | null;
  /** The order is marked signed by the client but no signed order document exists
   * (marked by hand before the owner decision of 2026-10-12): still valid, flagged. */
  manualOnly: boolean;
};

/**
 * The client's signature of a lead's single order (Einzelauftrag): it counts
 * only with proof — a QES or the scan of the signed copy — never by one click
 * (owner decision 2026-10-12, QA C2-14). `signedPatient` is the order's flag,
 * which only the signed document sets.
 */
export function orderClientSignatureState<T extends OrderSignatureDocument>(
  orderDocuments: readonly T[],
  signedPatient: boolean,
): OrderClientSignatureState<T> {
  const current = orderDocuments
    .filter((document) => document.is_latest_version)
    .sort((left, right) => (right.created_at ?? "").localeCompare(left.created_at ?? ""));
  const signedByDocument = orderDocuments.some((document) => Boolean(document.signed_at));
  const manualOnly = signedPatient && !signedByDocument;
  const unsigned = current.find((document) => !document.signed_at) ?? null;
  return {
    needsDocument: current.length === 0,
    documentToSign: !signedPatient || manualOnly ? unsigned : null,
    manualOnly,
  };
}

// A wizard action policy, not a replacement for the signing API's permissions.
// Use document types, not translated titles or filenames (e.g. privacy notices).
export function canSignWizardDocument(document: SigningDocument): boolean {
  if (!document.has_stored_file || document.file_deleted_at) return false;
  if (document.mime_type?.split(";", 1)[0]?.trim().toLowerCase() !== "application/pdf") return false;

  const templateId = document.generated_template_id?.trim().toLowerCase();
  // A lead's documents belong to no patient until the lead is converted.
  const leadIntake = Boolean(document.lead_id) && !document.patient_id;
  if (templateId && leadIntake && LEAD_INTAKE_PACKAGE_MEMBERS.has(templateId)) return false;
  if (templateId) return SIGNABLE_DOCUMENT_TYPES.has(templateId);

  const art = document.art.trim().toLowerCase();
  if (SIGNABLE_DOCUMENT_TYPES.has(art)) return true;
  if (["identity", "privacy_information", "cost_estimate"].includes(art)) return false;

  // Uploaded consents/contracts may have a verified compliance classification
  // rather than a generated template.
  return ["confidentiality_release", "dsgvo", "framework_contract"].includes(
    document.compliance_kind?.trim().toLowerCase() ?? "",
  );
}

function errorCodes(error: ApiRequestError): unknown[] {
  return [error.body?.code, error.body?.error, error.code];
}

/**
 * Whether a failed "Создать документ" may still have stored the document: a
 * lost answer (network, gateway, server error) or the server's word that the
 * form exists already. The wizard then reloads the list, so the next click
 * makes a new version instead of a second v1 (DEV 2026-10-24).
 */
export function shouldReloadDocumentsAfterGenerationError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return true;
  if (errorCodes(error).includes("document_version_exists")) return true;
  return error.status === undefined || error.status === 0 || error.status >= 500;
}

/** 409 `document_version_exists` in words; `null` for other errors. */
export function documentVersionExistsErrorText(error: unknown, tx: (ru: string, de: string) => string): string | null {
  if (!(error instanceof ApiRequestError) || !errorCodes(error).includes("document_version_exists")) return null;
  return tx(
    "Этот документ уже создан — список обновлён. Чтобы изменить его, создайте новую версию.",
    "Dieses Dokument ist bereits erstellt – die Liste wurde aktualisiert. Für Änderungen eine neue Version erstellen.",
  );
}
