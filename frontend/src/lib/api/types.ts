

export interface LeadsStats {
  total_this_month: number;
  total_last_month: number;
  growth_pct: number;
  growth_abs: number;
  qualified_this_month: number;
  converted_this_month: number;
  total_all: number;
}

export interface MonthlyEntry {
  month: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export interface Lead {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  country: string | null;
  intake_source: string | null;
  flow: string | null;
  lead_type?: string | null;
  console_promoted_at?: string | null;
  console_promoted_by?: string | null;
  qualification_status: string;
  /** ISO timestamp of the last status change — drives the "days in status" indicator. */
  status_changed_at?: string | null;
  compliance_status?: string;
  /**
   * Mirrors the backend `LeadConversionReadiness::conversion_ready` flag on
   * list payloads so the Convert button can stay disabled when the lead is
   * missing required data, instead of waiting for a 422.
   */
  qualification_ready?: boolean;
  conversion_ready?: boolean;
  failed_outcome?: FailedLeadOutcome;
  submitted_at: string | null;
  created_at: string;
  attachment_count?: number;
}

export interface ConvertLeadResponse {
  patient_id: string;
  patient_pid: string;
}

interface LeadAttachment {
  id: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number;
  uploaded_at: string;
  imported_document_id?: string | null;
  imported_at?: string | null;
}

interface LeadReadinessCheck {
  key: string;
  label: string;
  passed: boolean;
  blocking_for: string;
  stage?: string;
}

interface LeadReadinessStep {
  key: string;
  label: string;
  ready: boolean;
}

interface LifecycleEvent {
  from_stage: string | null;
  to_stage: string;
  transition_kind: string;
  note: string | null;
  metadata: Record<string, unknown>;
  changed_by: string | null;
  created_at: string;
}

interface FailedLeadOutcome {
  status: string;
  from_status?: string | null;
  reason: string | null;
  note?: string | null;
  processed_at: string | null;
  processed_by?: string | null;
}

interface LeadLifecycle {
  current_stage: string;
  stage_entered_at: string | null;
  can_convert: boolean;
  can_resolve_failed: boolean;
  history: LifecycleEvent[];
}

interface LeadReadiness {
  qualification_ready: boolean;
  conversion_ready: boolean;
  qualification_reasons: string[];
  blocking_reasons: string[];
  checks: LeadReadinessCheck[];
  steps: LeadReadinessStep[];
}

interface LeadPhoneEntry {
  number: string;
  type?: string;
}

export interface LeadDetail extends Lead {
  middle_name: string | null;
  suffix: string | null;
  date_of_birth: string | null;
  legal_sex: string | null;

  email_consent: boolean | null;
  primary_phone_type: string | null;
  phones: LeadPhoneEntry[] | null;
  whatsapp_consent: boolean | null;
  whatsapp_number: string | null;

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
  insurance_provider: string | null;
  insurance_number: string | null;
  insurance_type: "private" | "public" | "self_pay" | "foreign" | null;

  trusted_contact_name: string | null;
  trusted_contact_phone: string | null;
  trusted_contact_relation: string | null;
  trusted_contact_birth_date: string | null;
  trusted_contact_address: string | null;

  requested_specialties: string[];
  wizard_state: Record<string, unknown> | null;

  preferred_location: string | null;
  visit_timing: string | null;
  message: string | null;

  consent_automated_contact: boolean;
  consent_healthcare: boolean;
  consent_opt_out: boolean;
  consent_privacy_practices: boolean;

  raw_payload: unknown;
  locale: string | null;
  converted_patient_id: string | null;
  notes: string | null;
  user_agent: string | null;
  updated_at: string;
  readiness: LeadReadiness;
  failed_outcome: FailedLeadOutcome;
  lifecycle: LeadLifecycle;

  attachments: LeadAttachment[];
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface CreateLeadBody {
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  country?: string | null;
  notes?: string | null;
}
