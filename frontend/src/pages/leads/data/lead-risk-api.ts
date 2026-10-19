import { apiFetch } from "@/lib/api";

import { normalizeLeadRiskAssessment, type RiskDecisionKind } from "../model/lead-risk-assessment";

const base = (leadId: string) => `/leads/${encodeURIComponent(leadId)}`;

const send = (method: "POST" | "PUT", body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * `GET /leads/{id}/risk-assessment`: the server reassesses first, then answers
 * with points, level, triggers, blocks, decisions and history. Null on an
 * older server or for an answer that is not one.
 */
export async function fetchLeadRiskAssessment(leadId: string) {
  return normalizeLeadRiskAssessment(
    await apiFetch<unknown>(`${base(leadId)}/risk-assessment`, { forceFresh: true }),
  );
}

/**
 * `POST /leads/{id}/risk-assessment/decisions`: release / request more /
 * reject with a reason (at least 10 characters). At level 3 a release or a
 * reject is a proposal until a second reviewer confirms it.
 */
export async function postLeadRiskDecision(
  leadId: string,
  input: { decision: RiskDecisionKind; reason: string; blocks?: string[] },
) {
  const body: Record<string, unknown> = { decision: input.decision, reason: input.reason.trim() };
  if (input.decision === "request_more") body.blocks = input.blocks ?? [];
  return apiFetch<unknown>(`${base(leadId)}/risk-assessment/decisions`, send("POST", body));
}

/** `POST …/decisions/{id}/confirm`: the second reviewer confirms a level-3 proposal (own reason). */
export async function confirmLeadRiskDecision(leadId: string, decisionId: string, reason: string) {
  return apiFetch<unknown>(
    `${base(leadId)}/risk-assessment/decisions/${encodeURIComponent(decisionId)}/confirm`,
    send("POST", { reason: reason.trim() }),
  );
}

/** `POST …/decisions/{id}/withdraw`: the proposer takes the proposal back (own reason). */
export async function withdrawLeadRiskDecision(leadId: string, decisionId: string, reason: string) {
  return apiFetch<unknown>(
    `${base(leadId)}/risk-assessment/decisions/${encodeURIComponent(decisionId)}/withdraw`,
    send("POST", { reason: reason.trim() }),
  );
}

/** `POST /leads/{id}/risk-assessment/restart`: a reviewer starts a grandfathered or not-started assessment. */
export async function restartLeadRiskAssessment(leadId: string) {
  return apiFetch<unknown>(`${base(leadId)}/risk-assessment/restart`, send("POST", {}));
}

/** The identity document data staff enter from the scan (the lead only uploads it). */
export type IdentityDocumentDataInput = {
  id_document_type: string | null;
  id_document_number: string | null;
  id_issuing_authority: string | null;
  id_issuing_country: string | null;
  /** Calendar dates, `YYYY-MM-DD`; a past `id_valid_until` is accepted (it is trigger T12). */
  id_issued_on: string | null;
  id_valid_until: string | null;
  id_document_unreadable: boolean;
};

/** `PUT /leads/{id}/identity-document-data` (the patient's document). */
export async function saveLeadIdentityDocumentData(leadId: string, input: IdentityDocumentDataInput) {
  return apiFetch<unknown>(`${base(leadId)}/identity-document-data`, send("PUT", input));
}

/** `PUT /leads/{id}/representatives/{rid}/identity-document-data` (a representative's document). */
export async function saveRepresentativeIdentityDocumentData(
  leadId: string,
  representativeId: string,
  input: IdentityDocumentDataInput,
) {
  return apiFetch<unknown>(
    `${base(leadId)}/representatives/${encodeURIComponent(representativeId)}/identity-document-data`,
    send("PUT", input),
  );
}

/** Which file of a representative staff upload: the identity document or the proof of authority. */
export type RepresentativeUploadKind = "identity" | "authority";

/**
 * `POST /leads/{id}/representatives/{rid}/identity-document` or
 * `…/authority-document` (multipart `file`, PDF/JPG/PNG up to 25 MB): staff
 * upload a representative's file in the wizard, stored like the cabinet's.
 */
export async function uploadRepresentativeDocument(
  leadId: string,
  representativeId: string,
  kind: RepresentativeUploadKind,
  file: File,
) {
  const form = new FormData();
  form.append("file", file);
  const part = kind === "authority" ? "authority-document" : "identity-document";
  return apiFetch<unknown>(
    `${base(leadId)}/representatives/${encodeURIComponent(representativeId)}/${part}`,
    { method: "POST", body: form },
  );
}
