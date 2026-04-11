import { get, post } from "./client";
import { apiFetch, getAccessToken } from "@/lib/api";

export type IntakeStatus =
  | "new"
  | "reviewed"
  | "converted"
  | "archived"
  | "spam";

export interface VisitorIntakeListItem {
  id: string;
  source: string | null;
  flow: string | null;
  locale: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  primary_phone: string | null;
  country: string | null;
  city: string | null;
  processing_status: IntakeStatus;
  converted_lead_id: string | null;
  submitted_at: string | null;
  created_at: string;
  attachment_count: number;
}

export interface VisitorIntakeAttachment {
  id: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number;
  uploaded_at: string;
}

export interface VisitorIntakePhone {
  number: string;
  type?: string;
}

export interface VisitorIntakeDetail {
  id: string;
  source: string | null;
  flow: string | null;
  locale: string | null;
  submitted_at: string | null;

  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  date_of_birth: string | null;
  legal_sex: string | null;

  email: string | null;
  email_consent: boolean | null;
  primary_phone: string | null;
  primary_phone_type: string | null;
  phones: VisitorIntakePhone[] | null;
  whatsapp_consent: boolean | null;
  whatsapp_number: string | null;

  country: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;

  primary_language: string | null;
  needs_interpreter: boolean | null;

  location: string | null;
  location_detailed: string | null;
  wants_membership: boolean | null;
  selected_program: string | null;
  can_travel: boolean | null;
  has_medical_records: string | null;
  records_in_accepted_language: boolean | null;
  has_travel_documents: boolean | null;

  currently_in_treatment: boolean | null;
  has_health_risk_for_travel: boolean | null;

  primary_concern_text: string | null;
  additional_concerns: string | null;

  services: string[];
  has_insurance: boolean | null;
  insurance_covers_germany: string | null;

  preferred_location: string | null;
  visit_timing: string | null;
  message: string | null;

  consent_automated_contact: boolean;
  consent_healthcare: boolean;
  consent_opt_out: boolean;
  consent_privacy_practices: boolean;

  raw_payload: unknown;
  processing_status: IntakeStatus;
  converted_lead_id: string | null;
  internal_notes: string | null;
  user_agent: string | null;

  created_at: string;
  updated_at: string;

  attachments: VisitorIntakeAttachment[];
}

export interface ListIntakesParams {
  search?: string;
  status?: IntakeStatus | "";
  flow?: string;
  limit?: number;
}

export function fetchIntakes(
  params: ListIntakesParams = {},
): Promise<VisitorIntakeListItem[]> {
  const q = new URLSearchParams();
  if (params.search?.trim()) q.set("search", params.search.trim());
  if (params.status) q.set("status", params.status);
  if (params.flow?.trim()) q.set("flow", params.flow.trim());
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return get<VisitorIntakeListItem[]>(`/visitor-intakes${qs ? `?${qs}` : ""}`);
}

export function fetchIntake(id: string): Promise<VisitorIntakeDetail> {
  return get<VisitorIntakeDetail>(`/visitor-intakes/${id}`);
}

export function updateIntakeStatus(
  id: string,
  status: IntakeStatus,
  internalNotes?: string,
): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>(`/visitor-intakes/${id}/status`, {
    status,
    internal_notes: internalNotes ?? null,
  });
}

/**
 * Download an intake attachment as a Blob. The calling component is
 * responsible for triggering the download (object URL + anchor click).
 */
export async function downloadIntakeAttachment(
  intakeId: string,
  attachmentId: string,
): Promise<Blob> {
  const token = getAccessToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(
    `/api/v1/visitor-intakes/${intakeId}/attachments/${attachmentId}`,
    { headers },
  );
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status}`);
  }
  return res.blob();
}

// Silence unused import warning when apiFetch isn't referenced directly
void apiFetch;
