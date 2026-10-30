import { apiFetch, ApiRequestError } from "@/lib/api";
import {
  isQuestionnaire,
  PayerLinkError,
  type PayerAnswersPatch,
  type PayerLinkClient,
  type PayerQuestionnaire,
} from "@/pages/payer-link/payer-link-api";

/**
 * Staff enter the payer's signed paper Selbstauskunft into the payer's own
 * questionnaire (owner rule 2026-10-29: what the payer does online, staff can
 * do from the wizard; DEV QA 2026-10-30). `/leads/{id}/payer-questionnaire…`
 * answers like the payer link — same answers, validation and "missing" list —
 * so the wizard reuses the payer page's form with this client. The sent
 * answers are marked as staff's (`entered_by_staff`).
 */

/** The questionnaire as staff see it: the payer's, plus who entered it. */
export type StaffPayerQuestionnaire = PayerQuestionnaire & {
  entered_by_staff?: boolean;
  check_level?: number;
  updated_at?: string | null;
};

const UPLOAD_TIMEOUT_MS = 120_000;

function base(leadId: string) {
  return `/leads/${encodeURIComponent(leadId)}/payer-questionnaire`;
}

/** The form understands the payer page's errors: the same code, status and extras. */
export function asPayerLinkError(cause: unknown): PayerLinkError {
  if (cause instanceof PayerLinkError) return cause;
  if (cause instanceof ApiRequestError) {
    const body = (cause.body ?? {}) as Record<string, unknown>;
    const code = typeof body.code === "string" ? body.code : cause.code ?? "";
    return new PayerLinkError(cause.status ?? 500, code, body);
  }
  return new PayerLinkError(0, "network");
}

async function call(path: string, init: Parameters<typeof apiFetch>[1] = {}): Promise<StaffPayerQuestionnaire> {
  try {
    const result = await apiFetch<unknown>(path, { forceFresh: true, ...init });
    if (!isQuestionnaire(result)) throw new PayerLinkError(500, "invalid_response");
    return result as StaffPayerQuestionnaire;
  } catch (cause) {
    throw asPayerLinkError(cause);
  }
}

function upload(path: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return call(path, { method: "POST", body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
}

export function fetchStaffPayerQuestionnaire(leadId: string) {
  return call(base(leadId));
}

/** Staff open the sent paper answers again to correct them. */
export function reopenStaffPayerQuestionnaire(leadId: string) {
  return call(`${base(leadId)}/reopen`, { method: "POST" });
}

/** Saves answers staff read from the paper form (e.g. the ID data of an uploaded copy). */
export function saveStaffPayerAnswers(leadId: string, patch: PayerAnswersPatch) {
  return call(base(leadId), { method: "POST", body: JSON.stringify(patch) });
}

/**
 * The payer page's client, bound to staff's routes of one lead. The code step
 * does not exist here; staff's own files are removed in the documents list.
 */
export function createStaffPayerClient(leadId: string): PayerLinkClient {
  const unavailable = () => Promise.reject(new PayerLinkError(400, "not_available"));
  return {
    info: unavailable,
    requestCode: unavailable,
    verifyCode: unavailable,
    questionnaire: () => fetchStaffPayerQuestionnaire(leadId),
    consent: (contactChannels: string[], language: string) =>
      call(`${base(leadId)}/consent`, {
        method: "POST",
        body: JSON.stringify({ acknowledged: true, contact_channels: contactChannels, language }),
      }),
    saveAnswers: (patch: PayerAnswersPatch) => saveStaffPayerAnswers(leadId, patch),
    uploadIdentityDocument: (file: File) => upload(`${base(leadId)}/identity-document`, file),
    uploadFundsProof: (file: File) => upload(`${base(leadId)}/funds-proof`, file),
    withdrawDocument: unavailable,
    submit: () => call(`${base(leadId)}/submit`, { method: "POST", body: JSON.stringify({ declared_correct: true }) }),
  } as PayerLinkClient;
}
