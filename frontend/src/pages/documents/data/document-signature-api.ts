import { apiFetch, apiFetchFile } from "@/lib/api";

export type Signer = { first_name: string; last_name: string; email: string; role: "client" | "agency" | "other" };
export type SignatureStatus = "submitting" | "submission_unknown" | "pending" | "completed" | "needs_review" | "declined" | "withdrawn" | "expired" | "error";
export type SignatureRequest = {
  id: string; status: SignatureStatus; test_mode: boolean; signers: Signer[];
  result_document_id: string | null; has_report: boolean; last_error: string | null; created_at: string;
  evidence: { signatures?: { email: string; status: string; signed_at: string | null }[] };
};
export type SignatureState = {
  enabled: boolean; region: "DE"; test_mode: boolean; can_send: boolean; can_configure: boolean;
  ineligible_reason: string | null; requests: SignatureRequest[];
};
export const isSignaturePending = (status: SignatureStatus) => ["submitting", "submission_unknown", "pending"].includes(status);
export const fetchSignatureState = (id: string) => apiFetch<SignatureState>(`/documents/${id}/signature-requests`, { forceFresh: true });
export const createSignatureRequest = (id: string, signers: Signer[]) => apiFetch<{ id: string }>(`/documents/${id}/signature-requests`, { method: "POST", body: JSON.stringify({ signers }) });
export const signatureAction = (id: string, action: "refresh" | "withdraw") => apiFetch(`/document-signature-requests/${id}/${action}`, { method: "POST" });
export type SignatureConnection = { configured: boolean; region: "DE"; mode: "demo" | "live"; username: string | null; source: "database" | "environment" };
export const fetchSignatureConnection = () => apiFetch<SignatureConnection>("/document-signatures/connection", { forceFresh: true });
export const saveSignatureConnection = (username: string, apiKey: string, mode: "demo" | "live") => apiFetch<SignatureConnection>("/document-signatures/connection", { method: "POST", body: JSON.stringify({ username, api_key: apiKey, mode }), timeoutMs: 60_000 });
export const checkSignatureConnection = () => apiFetch("/document-signatures/connection/check", { method: "POST", timeoutMs: 60_000 });
export const disconnectSignatureConnection = () => apiFetch("/document-signatures/connection/disconnect", { method: "POST" });
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
