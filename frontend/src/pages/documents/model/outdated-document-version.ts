import { appDateKey } from "@/lib/app-time-zone";
import type { DocumentItem, DocumentTemplate, GenerateFormState } from "./types";
import { resolveGeneratedDocumentAccessCategory } from "./document-model";

/**
 * A document whose terms no longer hold (`document_terms_current`: the order,
 * the estimate or the paying parent changed after it was made) and that is
 * still the version to sign: the newest one, not archived. Older versions of
 * the same document are history and need nothing.
 */
type VersionState = {
  terms_current?: boolean | null;
  status?: string | null;
  is_latest_version?: boolean | null;
};

export function isOutdatedCurrentVersion(document: VersionState): boolean {
  return document.terms_current === false
    && document.is_latest_version !== false
    && document.status !== "archived";
}

/** IDs for `OutdatedSignatureDocuments`: every listed document that needs a new version. */
export function outdatedDocumentIds(documents: ReadonlyArray<VersionState & { id: string }>): string[] {
  return documents.filter(isOutdatedCurrentVersion).map((document) => document.id);
}

/**
 * Templates the server fills completely from the patient, the order and the
 * contract (`document_terms_current` tracks exactly these): a new version
 * needs no manual input, so it is made with one click. Any other template
 * opens the replacement form on the documents screen.
 */
const ONE_CLICK_TEMPLATES = new Set([
  "single_order", "order_cost_estimate", "framework_contract",
  // The consent forms print the newest consent choice (owner 2026-11-16).
  "privacy_consents", "consent_data_release_child", "consent_data_release_single",
]);

export function regeneratesInOneClick(templateId: string | null | undefined): boolean {
  return ONE_CLICK_TEMPLATES.has(templateId ?? "");
}

/**
 * Bindings of the previous version that are no data of the patient, the order
 * or the payer and stay with the document: where the parties sign and the
 * framework contract's threshold. Names, payer, period and services are left
 * out on purpose: the server prints them from the current records, and an old
 * payer name would win over the current payer (`merge_payer`).
 */
const KEPT_BINDING_KEYS = ["party_sign_place", "party_city", "agency_sign_place", "cost_threshold"];

function keptBindings(persisted: Record<string, unknown> | null | undefined): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const key of KEPT_BINDING_KEYS) {
    const value = persisted?.[key];
    if (typeof value === "string" && value.trim()) kept[key] = value.trim();
    else if (typeof value === "number") kept[key] = String(value);
  }
  return kept;
}

/**
 * The form of a one-click new version: same template, patient, order and
 * appointment, replacing the outdated version, dated today; the server reads
 * every other value from the current records, as the lead wizard and the
 * order workspace do.
 */
export function oneClickReplacementForm(
  document: DocumentItem,
  template: DocumentTemplate,
): GenerateFormState {
  const language = template.supported_languages.includes(document.document_language ?? "")
    ? (document.document_language as string)
    : template.supported_languages[0] ?? "de";
  return {
    templateId: template.id,
    patientId: document.patient_id ?? "",
    orderId: document.order_id ?? "",
    appointmentId: document.appointment_id ?? "",
    replaceDocumentId: document.id,
    // Empty: the server names the new version like the template's standard name.
    autoName: "",
    status: document.status === "draft" ? "draft" : "active",
    visibility: (document.visibility as GenerateFormState["visibility"]) ?? template.default_visibility,
    language,
    titleOverride: "",
    introduction: "",
    closingNote: "",
    klinik: document.klinik ?? "",
    ursprung: "",
    documentDirection: "outgoing",
    documentVariant: "original",
    documentLanguage: language,
    accessCategory: (document.access_category as GenerateFormState["accessCategory"])
      ?? resolveGeneratedDocumentAccessCategory(template, "patient"),
    documentDate: appDateKey(),
    sourcePerson: document.source_person ?? "",
    sourceInstitution: document.source_institution ?? "GMED",
    // The addressee may be the contracting parent who changed: the server
    // names the current one.
    addresseePerson: "",
    addresseeInstitution: "",
    financialStatus: "",
    paymentDueDate: "",
    paymentDate: "",
    paymentMethod: "",
    notes: "",
    textBlockKeys: [],
    manualText: "",
    manualTextDirty: false,
    bindings: keptBindings(document.generated_bindings),
  };
}
