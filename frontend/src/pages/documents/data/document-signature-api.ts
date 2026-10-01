import { apiFetch, apiFetchFile } from "@/lib/api";

// `positions` are the signature frames the server sent to Skribble for this
// signer; it fills them itself and ignores any the client sends.
export type Signer = { first_name: string; last_name: string; email: string; role: "client" | "agency" | "other"; positions?: unknown[] };
export type SignatureStatus = "submitting" | "submission_unknown" | "pending" | "completed" | "needs_review" | "declined" | "withdrawn" | "expired" | "error";
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
  closed_kind?: "auto_expired" | "abandoned" | "review_accepted" | "review_rejected" | null;
  close_reason?: string | null;
  closed_at?: string | null;
  evidence: { signatures?: { email: string; status: string; signed_at: string | null }[] };
};
export type SigningPackage = { template: "single_order" | "confidentiality_release" | "privacy_consents"; documents: { id: string; title: string; version: number }[] };
export type SignatureState = {
  enabled: boolean; region: "DE"; test_mode: boolean; can_send: boolean; can_configure: boolean;
  signer_policy?: "flexible" | "client_only" | "agency_only" | "both_parties";
  ineligible_reason: string | null; requests: SignatureRequest[];
  suggested_signers?: Signer[];
  review_package?: { template: "privacy_information" | "cost_estimate"; documents: { id: string; title: string; version: number }[] } | null;
  // One entry per document signed together with this one, in bundle order.
  signing_packages?: SigningPackage[];
};
export const isSignaturePending = (status: SignatureStatus) => ["submitting", "submission_unknown", "pending"].includes(status);
/** Whether the signers of a sent request sign in frames placed in the document, or have to place their signature themselves. */
export const signatureFrameCoverage = (signers: Signer[]): "all" | "some" | "none" => {
  const framed = signers.filter((signer) => (signer.positions?.length ?? 0) > 0).length;
  return framed === 0 ? "none" : framed === signers.length ? "all" : "some";
};
export const fetchSignatureState =(id: string) => apiFetch<SignatureState>(`/documents/${id}/signature-requests`, { forceFresh: true });
// Every PDF of a package is malware-scanned before anything is sent, and a
// standalone scanner start takes several seconds. Aborting at the default
// timeout cancelled a request that would have succeeded moments later.
const CREATE_SIGNATURE_REQUEST_TIMEOUT_MS = 90_000;
export const createSignatureRequest = (id: string, signers: Signer[], attachmentDocumentId?: string, signingDocumentIds: string[] = []) => apiFetch<{ id: string }>(`/documents/${id}/signature-requests`, { method: "POST", timeoutMs: CREATE_SIGNATURE_REQUEST_TIMEOUT_MS, body: JSON.stringify({ signers, ...(attachmentDocumentId ? { attachment_document_id: attachmentDocumentId } : {}), ...(signingDocumentIds.length ? { signing_document_ids: signingDocumentIds } : {}) }) });
export const signatureAction = (id: string, action: "refresh" | "withdraw") => apiFetch(`/document-signature-requests/${id}/${action}`, { method: "POST" });
export const abandonSignatureRequest = (id: string, reason: string) => apiFetch(`/document-signature-requests/${id}/abandon`, { method: "POST", body: JSON.stringify({ reason }) });
export const resolveSignatureReview = (id: string, decision: "accept" | "reject", reason: string) => apiFetch(`/document-signature-requests/${id}/resolve-review`, { method: "POST", body: JSON.stringify({ decision, reason }) });
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
      && ["client", "agency", "other"].includes(s.role);
  })
    && new Set(signers.map(s => s.email.trim().toLowerCase())).size === signers.length;
}
