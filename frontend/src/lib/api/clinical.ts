import { get, post } from "./client";

export type InterpreterPreference = "preferred" | "neutral" | "avoid";

export type InterpreterSuggestion = {
  interpreter_id: string;
  interpreter_name: string;
  role: string;
  preference: InterpreterPreference;
  language_status: string;
  languages: string[];
  previous_appointment_count: number;
  completed_appointment_count: number;
  approved_report_count: number;
  total_report_hours: string;
  average_feedback_score: number | null;
  last_worked_at: string | null;
  score: number;
  reasons: string[];
};

export type InterpreterHistoryItem = {
  interpreter_id?: string;
  interpreter_name?: string;
  patient_id?: string;
  patient_code?: string;
  patient_name?: string;
  role?: string;
  preference: InterpreterPreference;
  preference_note: string | null;
  appointment_count: number;
  completed_appointment_count: number;
  approved_report_count: number;
  total_report_hours: string;
  average_feedback_score: number | null;
  feedback_count: number;
  last_appointment_date: string | null;
};

export type ServiceGroupParticipant = {
  id?: string;
  provider_id: string;
  provider_name?: string;
  doctor_id: string;
  doctor_name?: string;
  role_label?: string | null;
  quantity_override?: string | null;
  unit_price_override?: string | null;
  description_override?: string | null;
  external_invoice_id?: string | null;
  notes?: string | null;
  generated_leistung_id?: string | null;
};

export type OrderServiceGroup = {
  id: string;
  order_id: string;
  appointment_id: string | null;
  appointment_title: string | null;
  group_title: string;
  service_key: string | null;
  description: string | null;
  service_date: string | null;
  quantity: string;
  unit_price: string;
  currency: string;
  vat_rate: string;
  status: string;
  participants?: ServiceGroupParticipant[];
  participant_count?: number;
  generated_line_count?: number;
};

export type DrugProduct = {
  id: string;
  brand_name: string;
  country_code: string;
  atc_code: string | null;
  form: string | null;
  strength: string | null;
  manufacturer: string | null;
  verification_status: string;
  substances: string[];
  clinical_note: string | null;
};

export type GermanEquivalent = {
  equivalent_id: string;
  brand_name: string;
  country_code: string;
  atc_code: string | null;
  form: string | null;
  strength: string | null;
  manufacturer: string | null;
  confidence: string;
  verification_status: string;
  substances: string[];
  note: string | null;
  staff_warning: string;
};

export type MedicationEquivalentPayload = {
  medication_id: string;
  medication_name: string;
  medication_substance: string | null;
  candidates: GermanEquivalent[];
};

export function fetchInterpreterSuggestions(
  appointmentId: string,
): Promise<InterpreterSuggestion[]> {
  return get<InterpreterSuggestion[]>(
    `/appointments/${appointmentId}/interpreter-suggestions`,
  );
}

export function fetchPatientInterpreterHistory(
  patientId: string,
): Promise<InterpreterHistoryItem[]> {
  return get<InterpreterHistoryItem[]>(
    `/patients/${patientId}/interpreter-history`,
  );
}

export function setInterpreterPreference(
  patientId: string,
  body: {
    interpreter_id: string;
    preference: InterpreterPreference;
    note?: string | null;
  },
): Promise<unknown> {
  return post(`/patients/${patientId}/interpreter-preferences`, body);
}

export function fetchOrderServiceGroups(
  orderId: string,
): Promise<OrderServiceGroup[]> {
  return get<OrderServiceGroup[]>(`/orders/${orderId}/service-groups`);
}

export function fetchOrderServiceGroup(
  serviceGroupId: string,
): Promise<OrderServiceGroup> {
  return get<OrderServiceGroup>(`/order-service-groups/${serviceGroupId}`);
}

export function generateServiceGroupLines(
  serviceGroupId: string,
  overrideDuplicates = false,
): Promise<{
  generated_count: number;
  updated_count: number;
  skipped_duplicate_count: number;
  leistung_ids: string[];
}> {
  return post(`/order-service-groups/${serviceGroupId}/generate-lines`, {
    override_duplicates: overrideDuplicates,
  });
}

export function searchDrugProducts(params: {
  q: string;
  country_code?: string;
  include_candidates?: boolean;
}): Promise<DrugProduct[]> {
  const query = new URLSearchParams();
  query.set("q", params.q);
  if (params.country_code) query.set("country_code", params.country_code);
  if (params.include_candidates) query.set("include_candidates", "true");
  return get<DrugProduct[]>(`/drug-products/search?${query}`);
}

export function fetchMedicationEquivalents(
  caseId: string,
  medicationId: string,
  includeCandidates = false,
): Promise<MedicationEquivalentPayload> {
  const query = includeCandidates ? "?include_candidates=true" : "";
  return get<MedicationEquivalentPayload>(
    `/cases/${caseId}/medikamente/${medicationId}/equivalents${query}`,
  );
}
