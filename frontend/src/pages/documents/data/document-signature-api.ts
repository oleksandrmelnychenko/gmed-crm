import { apiFetch, apiFetchFile } from "@/lib/api";

// `minor`: a minor patient who co-signs next to the legal representatives
// (optional, from about 14 years and capable of understanding; never required).
// `payer`: the Kostenübernehmer of a cost coverage declaration.
export type SignerRole = "client" | "minor" | "payer" | "agency" | "other";
// `positions` are the signature frames the server sent to Skribble for this
// signer; it fills them itself and ignores any the client sends.
export type Signer = { first_name: string; last_name: string; email: string; role: SignerRole; positions?: unknown[] };
export type SignatureStatus = "submitting" | "submission_unknown" | "pending" | "completed" | "needs_review" | "declined" | "withdrawn" | "expired" | "error";
export type SignatureLevel = "AES" | "QES";
export type SignerPolicy = "flexible" | "client_only" | "agency_only" | "both_parties" | "payer_and_agency" | "client_payer_and_agency";
export type DeliveryChannel = "skribble" | "email" | "portal" | "in_person" | "post";
/** One document of a request, in bundle order; the source has position 0. */
export type SignatureRequestMember = {
  document_id: string; position: number; page_start: number | null; page_count: number | null;
  result_document_id: string | null; accessible: boolean; title: string | null; template: string | null; version: number | null;
};
export type SignatureRequest = {
  id: string; status: SignatureStatus; test_mode: boolean; signers: Signer[];
  source_document_id?: string;
  result_document_id: string | null; has_report: boolean; last_error: string | null; created_at: string;
  updated_at?: string;
  can_withdraw?: boolean;
  // Owner decision 2026-09-28 (Q9): untrackable requests can be given up,
  // `needs_review` is accepted or rejected; both with a reason.
  can_abandon?: boolean;
  can_resolve_review?: boolean;
  can_record_delivery?: boolean;
  closed_kind?: "auto_expired" | "abandoned" | "review_accepted" | "review_rejected" | null;
  close_reason?: string | null;
  closed_at?: string | null;
  is_package?: boolean;
  members?: SignatureRequestMember[];
  attachments?: { document_id: string; stage: string; title: string | null }[];
  level?: SignatureLevel;
  language?: string;
  expires_at?: string | null;
  invitation_note?: string | null;
  signed_at?: string | null;
  delivered_to_signers_at?: string | null;
  delivery_channel?: DeliveryChannel | null;
  evidence: { signatures?: { email: string; status: string; signed_at: string | null }[] };
};
export type SigningPackage = { template: string; templates?: string[]; documents: { id: string; title: string; version: number; template?: string | null }[] };
export type SignatureState = {
  enabled: boolean; region: "DE"; test_mode: boolean; can_send: boolean; can_configure: boolean;
  signer_policy?: SignerPolicy;
  minimum_level?: SignatureLevel;
  scope?: { patient_id: string | null; lead_id: string | null };
  electronic_form_excluded?: string | null;
  ineligible_reason: string | null; requests: SignatureRequest[];
  suggested_signers?: Signer[];
  review_package?: { template: "privacy_information" | "cost_estimate"; documents: { id: string; title: string; version: number }[] } | null;
  // Preset companions of this document, in bundle order (suggestions only).
  signing_packages?: SigningPackage[];
};
export type PackageCandidate = {
  id: string; title: string; template: string | null; art: string; version: number; order_id: string | null; size: number | null;
  signer_policy: SignerPolicy; minimum_level: SignatureLevel; frame_roles: string[]; has_frames: boolean;
  companion: "privacy_information" | "cost_estimate" | null; is_medical: boolean; pending_elsewhere: boolean;
  electronic_form_excluded: string | null; ineligible_reason: string | null;
};
export type PackageAttachmentCandidate = { id: string; title: string; template: string | null; art: string; version: number; order_id: string | null; size: number | null };
export type PackageCandidates = {
  scope: { patient_id: string | null; lead_id: string | null };
  documents: PackageCandidate[];
  attachments: PackageAttachmentCandidate[];
  preset_document_ids: string[];
  suggested_signers: Signer[];
  suggested_language: string;
  languages: string[];
  limits: { max_documents: number; max_bundle_bytes: number; max_expiry_days: number; max_message_chars: number };
};
export type PackageDraft = {
  document_ids: string[]; signers: Signer[]; attachment_ids: string[];
  level: SignatureLevel; expires_at?: string | null; message?: string; language?: string;
};

export const isSignaturePending = (status: SignatureStatus) => ["submitting", "submission_unknown", "pending"].includes(status);
/** Whether the signers of a sent request sign in frames placed in the document, or have to place their signature themselves. */
export const signatureFrameCoverage = (signers: Signer[]): "all" | "some" | "none" => {
  const framed = signers.filter((signer) => (signer.positions?.length ?? 0) > 0).length;
  return framed === 0 ? "none" : framed === signers.length ? "all" : "some";
};
export const fetchSignatureState = (id: string) => apiFetch<SignatureState>(`/documents/${id}/signature-requests`, { forceFresh: true });
export const fetchPackageCandidates = (documentId: string) => apiFetch<PackageCandidates>(`/signature-packages/candidates?document_id=${encodeURIComponent(documentId)}`, { forceFresh: true });
// Every PDF of a package is malware-scanned before anything is sent, and a
// standalone scanner start takes several seconds. Aborting at the default
// timeout cancelled a request that would have succeeded moments later.
const CREATE_SIGNATURE_REQUEST_TIMEOUT_MS = 90_000;
export const createSignatureRequest = (id: string, signers: Signer[], attachmentDocumentId?: string, signingDocumentIds: string[] = []) => apiFetch<{ id: string }>(`/documents/${id}/signature-requests`, { method: "POST", timeoutMs: CREATE_SIGNATURE_REQUEST_TIMEOUT_MS, body: JSON.stringify({ signers, ...(attachmentDocumentId ? { attachment_document_id: attachmentDocumentId } : {}), ...(signingDocumentIds.length ? { signing_document_ids: signingDocumentIds } : {}) }) });
export const createSignaturePackage = (draft: PackageDraft) => apiFetch<{ id: string }>("/signature-packages", {
  method: "POST", timeoutMs: CREATE_SIGNATURE_REQUEST_TIMEOUT_MS,
  body: JSON.stringify({
    document_ids: draft.document_ids, signers: draft.signers, attachment_ids: draft.attachment_ids, level: draft.level,
    ...(draft.expires_at ? { expires_at: draft.expires_at } : {}),
    ...(draft.message?.trim() ? { message: draft.message.trim() } : {}),
    ...(draft.language ? { language: draft.language } : {}),
  }),
});
export const signatureAction = (id: string, action: "refresh" | "withdraw") => apiFetch(`/document-signature-requests/${id}/${action}`, { method: "POST" });
export const abandonSignatureRequest = (id: string, reason: string) => apiFetch(`/document-signature-requests/${id}/abandon`, { method: "POST", body: JSON.stringify({ reason }) });
export const resolveSignatureReview = (id: string, decision: "accept" | "reject", reason: string) => apiFetch(`/document-signature-requests/${id}/resolve-review`, { method: "POST", body: JSON.stringify({ decision, reason }) });
export const recordSignatureDelivery = (id: string, channel: DeliveryChannel) => apiFetch(`/document-signature-requests/${id}/delivered`, { method: "POST", body: JSON.stringify({ channel }) });
/** A reason for an abandon or review decision: 10 to 2000 characters (server rule). */
export const signatureReasonValid = (reason: string | null | undefined) => { const length = (reason ?? "").trim().length; return length >= 10 && length <= 2000; };
export type SignatureConnection = { configured: boolean; region: "DE"; mode: "demo" | "live"; username: string | null; source: "database" | "environment" };
export const fetchSignatureConnection = () => apiFetch<SignatureConnection>("/document-signatures/connection", { forceFresh: true });
export const saveSignatureConnection = (username: string, apiKey: string, mode: "demo" | "live") => apiFetch<SignatureConnection>("/document-signatures/connection", { method: "POST", body: JSON.stringify({ username, api_key: apiKey, mode }), timeoutMs: 60_000 });
export const checkSignatureConnection = () => apiFetch("/document-signatures/connection/check", { method: "POST", timeoutMs: 60_000 });
export const disconnectSignatureConnection = () => apiFetch("/document-signatures/connection/disconnect", { method: "POST" });
export const fetchSignatureDefaults = () => apiFetch<{ signers: Signer[] }>("/document-signatures/signer-defaults", { forceFresh: true });
export const saveSignatureDefaults = (signers: Signer[]) => apiFetch<{ signers: Signer[] }>("/document-signatures/signer-defaults", { method: "PUT", body: JSON.stringify({ signers }) });
export async function downloadSignatureReport(id: string) {
  const { blob } = await apiFetchFile(`/document-signature-requests/${id}/report`);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "signature-report.pdf";
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function validSigners(signers: Signer[]) {
  const encoder = new TextEncoder();
  return signers.length > 0 && signers.length <= 6 && signers.every(s => {
    const namesValid = [s.first_name, s.last_name].every(value => {
      const name = value.trim();
      return name.length > 0 && encoder.encode(name).length <= 120
        && !Array.from(name).some(c => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159));
    });
    const email = s.email.trim();
    const parts = email.split("@");
    return namesValid && email.length <= 254 && parts.length === 2 && parts[0].length > 0
      && parts[1].includes(".") && !parts[1].startsWith(".") && !parts[1].endsWith(".")
      && Array.from(email).every(c => c.charCodeAt(0) > 32 && c.charCodeAt(0) < 127)
      && ["client", "minor", "payer", "agency", "other"].includes(s.role);
  })
    && new Set(signers.map(s => s.email.trim().toLowerCase())).size === signers.length;
}

const isPatientSide = (role: SignerRole) => role === "client" || role === "minor";

/** The package needs what its strictest document needs (mirrors the server). */
export function combinedSignerPolicy(policies: SignerPolicy[]): SignerPolicy | "conflict" {
  if (policies.includes("agency_only")) return policies.every(policy => policy === "agency_only") ? "agency_only" : "conflict";
  const needsPayer = policies.some(policy => policy === "payer_and_agency" || policy === "client_payer_and_agency");
  const needsClient = policies.some(policy => policy === "client_only" || policy === "both_parties" || policy === "client_payer_and_agency");
  if (needsPayer) return needsClient ? "client_payer_and_agency" : "payer_and_agency";
  if (policies.includes("both_parties")) return "both_parties";
  if (policies.includes("client_only")) return "client_only";
  return "flexible";
}

/** Server rule per policy; `null` when the signers fit. */
export function signerPolicyError(policy: SignerPolicy | "conflict", signers: Signer[]): string | null {
  if (policy === "conflict") return "signature_policy_conflict";
  const has = (role: SignerRole) => signers.some(signer => signer.role === role);
  const [hasClient, hasAgency, hasPayer] = [has("client"), has("agency"), has("payer")];
  if (has("minor") && !hasClient) return "minor_needs_representative";
  if (policy === "client_only" && !(hasClient && signers.every(signer => isPatientSide(signer.role)))) return "patient_signature_only";
  if (policy === "agency_only" && !signers.every(signer => signer.role === "agency")) return "agency_signature_only";
  if (policy === "both_parties" && !(hasClient && hasAgency)) return "both_contract_parties_required";
  if (policy === "payer_and_agency" && !(hasPayer && hasAgency)) return "payer_and_agency_required";
  if (policy === "client_payer_and_agency" && !(hasClient && hasPayer && hasAgency)) return "client_payer_and_agency_required";
  return null;
}

/** § 126a BGB: the package level is the highest minimum of its documents. */
export function packageMinimumLevel(levels: SignatureLevel[]): SignatureLevel {
  return levels.includes("QES") || levels.length === 0 ? "QES" : "AES";
}

/** Informational attachments the selected documents require (companions). */
export function requiredAttachmentTemplates(documents: Pick<PackageCandidate, "companion">[]) {
  return [...new Set(documents.flatMap(document => document.companion ? [document.companion] : []))];
}

export type PackageWarning = { document_id?: string; kind: "no_frames" | "pending_elsewhere" | "ineligible" | "electronic_form_excluded" | "too_large" | "too_many" | "policy_conflict" };

/** Problems the composer shows before sending. Only `no_frames` does not block. */
export function packageWarnings(selected: PackageCandidate[], limits: PackageCandidates["limits"]): PackageWarning[] {
  const warnings: PackageWarning[] = [];
  for (const document of selected) {
    if (document.electronic_form_excluded) warnings.push({ document_id: document.id, kind: "electronic_form_excluded" });
    else if (document.pending_elsewhere) warnings.push({ document_id: document.id, kind: "pending_elsewhere" });
    else if (document.ineligible_reason) warnings.push({ document_id: document.id, kind: "ineligible" });
    if (!document.has_frames) warnings.push({ document_id: document.id, kind: "no_frames" });
  }
  // The merged PDF is slightly larger than the sum of its parts; warn early.
  const total = selected.reduce((sum, document) => sum + (document.size ?? 0), 0);
  if (total > limits.max_bundle_bytes) warnings.push({ kind: "too_large" });
  if (selected.length > limits.max_documents) warnings.push({ kind: "too_many" });
  if (combinedSignerPolicy(selected.map(document => document.signer_policy)) === "conflict") warnings.push({ kind: "policy_conflict" });
  return warnings;
}

export const blockingWarning = (warning: PackageWarning) => warning.kind !== "no_frames";

/** RU/DE text for server error codes of the signing workflow. */
export function signatureErrorText(code: string | null | undefined, tx: (ru: string, de: string) => string, details?: { statute?: string; minimum_level?: string }): string {
  switch (code) {
    case "review_attachment_required":
    case "review_attachment_changed":
    case "unexpected_review_attachment":
      return tx("Выберите актуальные приложения для ознакомления и проверьте их PDF.", "Wählen und prüfen Sie die aktuellen Anlagen zur Kenntnisnahme.");
    case "signing_document_required":
    case "signing_document_changed":
    case "document_changed":
      return tx("Документ пакета изменился. Обновите окно и проверьте актуальные версии.", "Ein Dokument des Pakets wurde geändert. Laden Sie das Fenster neu und prüfen Sie die aktuellen Versionen.");
    case "both_contract_parties_required":
      return tx("Для договора нужны клиент и представитель агентства.", "Verträge benötigen Kunde und Agenturvertretung.");
    case "patient_signature_only":
      return tx("Этот пакет подписывает только сторона пациента (пациент или законные представители).", "Dieses Paket unterschreibt nur die Patientenseite (Patient/in oder gesetzliche Vertretung).");
    case "agency_signature_only":
      return tx("Этот внутренний AML/PEP-документ подписывает только представитель GMED.", "Dieses interne AML/PeP-Dokument wird nur von der GMED-Vertretung unterzeichnet.");
    case "signature_policy_conflict":
      return tx("Внутренний документ GMED нельзя отправлять в одном пакете с документами для пациента.", "Ein internes GMED-Dokument kann nicht im selben Paket wie Dokumente für die Patientenseite versendet werden.");
    case "payer_and_agency_required":
      return tx("Заявление о принятии расходов подписывают плательщик и представитель GMED.", "Die Kostenübernahmeerklärung unterschreiben der Kostenübernehmer und die GMED-Vertretung.");
    case "client_payer_and_agency_required":
      return tx("Этот пакет подписывают клиент, плательщик и представитель GMED.", "Dieses Paket unterschreiben Kunde, Kostenübernehmer und GMED-Vertretung.");
    case "minor_needs_representative":
      return tx("Несовершеннолетний подписывает только вместе с законным представителем.", "Minderjährige unterschreiben nur zusammen mit der gesetzlichen Vertretung.");
    case "signature_already_pending":
      return tx("Один из документов уже отправлен на подпись в другом запросе.", "Eines der Dokumente ist bereits in einer anderen Anfrage zur Unterschrift versendet.");
    case "signature_bundle_too_large":
      return tx("Пакет слишком большой для подписи (максимум 18 МБ). Уберите документы или отправьте их отдельно.", "Das Paket ist zu groß für die Signatur (höchstens 18 MB). Entfernen Sie Dokumente oder versenden Sie sie einzeln.");
    case "signature_pdf_already_signed":
      return tx("PDF уже содержит цифровую подпись — в пакете она была бы потеряна. Отправьте этот документ отдельно или используйте неподписанную версию.", "Die PDF enthält bereits eine digitale Signatur, die im Paket verloren ginge. Versenden Sie dieses Dokument einzeln oder nutzen Sie die unsignierte Fassung.");
    case "signature_bundle_invalid_pdf":
      return tx("Один из PDF не удаётся прочитать, поэтому его нельзя объединить в пакет.", "Eine der PDFs kann nicht gelesen und daher nicht in das Paket übernommen werden.");
    case "electronic_form_excluded":
      return tx(`Для этого документа закон исключает электронную форму${details?.statute ? ` (${details.statute})` : ""}. Его нужно подписать на бумаге.`, `Für dieses Dokument ist die elektronische Form gesetzlich ausgeschlossen${details?.statute ? ` (${details.statute})` : ""}. Es muss auf Papier unterschrieben werden.`);
    case "signature_level_too_low":
      return tx(`Для этого пакета нужен уровень подписи ${details?.minimum_level ?? "QES"}.`, `Dieses Paket erfordert mindestens die Signaturstufe ${details?.minimum_level ?? "QES"}.`);
    case "signature_expiry_invalid":
      return tx("Срок действия должен быть не раньше чем через час и не позже чем через 180 дней.", "Die Frist muss mindestens eine Stunde und höchstens 180 Tage in der Zukunft liegen.");
    case "signature_message_invalid":
      return tx("Сообщение: не более 500 символов, без служебных символов.", "Nachricht: höchstens 500 Zeichen, ohne Steuerzeichen.");
    case "signature_package_scope_mismatch":
    case "signature_package_scope_required":
      return tx("В пакет можно включать только документы одного пациента или одного лида.", "Ein Paket enthält nur Dokumente einer Patientin/eines Patienten oder eines Leads.");
    case "informational_document_not_signable":
      return tx("Информационные документы прикладываются для ознакомления и не подписываются.", "Informationsdokumente werden zur Kenntnisnahme beigefügt und nicht unterschrieben.");
    case "signature_package_size":
      return tx("В пакете должно быть от 1 до 10 документов.", "Ein Paket enthält 1 bis 10 Dokumente.");
    case "signature_withdraw_failed":
      return tx("Skribble не подтвердил отзыв. Запрос остаётся открытым — повторите позже.", "Skribble hat das Zurückziehen nicht bestätigt. Die Anfrage bleibt offen – versuchen Sie es später erneut.");
    default:
      return tx("Действие не выполнено. Проверьте статус перед повторной отправкой.", "Aktion fehlgeschlagen. Prüfen Sie vor erneutem Versand den Status.");
  }
}
