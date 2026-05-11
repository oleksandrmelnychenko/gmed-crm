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

export type ServiceGroupParticipantInput = {
  provider_id: string;
  doctor_id: string;
  role_label?: string | null;
  quantity_override?: number | null;
  unit_price_override?: number | null;
  description_override?: string | null;
  external_invoice_id?: string | null;
  notes?: string | null;
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

export type CreateOrderServiceGroupInput = {
  appointment_id?: string | null;
  group_title: string;
  service_key?: string | null;
  agency_service_id?: string | null;
  description?: string | null;
  service_date?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  currency?: string | null;
  vat_rate?: number | null;
  participants?: ServiceGroupParticipantInput[];
};

type OrderServiceGroupLinePreviewItem = {
  participant_id: string;
  provider_id: string;
  provider_name: string;
  doctor_id: string;
  doctor_name: string;
  description: string;
  quantity: string;
  unit_price: string;
  currency: string;
  vat_rate: string;
  existing_leistung_id: string | null;
  action: "generate" | "update" | "skip_duplicate" | string;
};

export type OrderServiceGroupLinePreview = {
  generate_count: number;
  update_count: number;
  skip_duplicate_count: number;
  override_duplicates: boolean;
  lines: OrderServiceGroupLinePreviewItem[];
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
  relationship_id?: string | null;
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

export type MedicationDrugMatchResponse = {
  id: string;
  verification_status: string;
  confidence: string;
};

export type DrugImportPreviewRow = {
  brand_name?: string | null;
  country_code?: string | null;
  atc_code?: string | null;
  form?: string | null;
  strength?: string | null;
  manufacturer?: string | null;
  substances?: string[];
  clinical_note?: string | null;
  verification_status?: string | null;
};

export type DrugImportPreview = {
  mode: "dry_run" | string;
  received_count: number;
  valid_preview_count: number;
  issue_preview_count: number;
  preview: Array<DrugImportPreviewRow & {
    row_number: number;
    normalized_brand_name: string;
    issues: string[];
  }>;
  message: string;
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

export function createOrderServiceGroup(
  orderId: string,
  body: CreateOrderServiceGroupInput,
): Promise<{ id: string }> {
  return post(`/orders/${orderId}/service-groups`, body);
}

export function fetchOrderServiceGroupLinePreview(
  serviceGroupId: string,
  overrideDuplicates = false,
): Promise<OrderServiceGroupLinePreview> {
  const query = overrideDuplicates ? "?override_duplicates=true" : "";
  return get<OrderServiceGroupLinePreview>(
    `/order-service-groups/${serviceGroupId}/line-preview${query}`,
  );
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

export function verifyDrugProduct(
  productId: string,
  verificationStatus: "curated" | "candidate" | "verified" | "rejected",
  note?: string | null,
): Promise<unknown> {
  return post(`/drug-products/${productId}/verify`, {
    verification_status: verificationStatus,
    note,
  });
}

export function verifyDrugEquivalent(
  relationshipId: string,
  verificationStatus: "candidate" | "verified" | "rejected",
  note?: string | null,
): Promise<unknown> {
  return post(`/drug-equivalents/${relationshipId}/verify`, {
    verification_status: verificationStatus,
    note,
  });
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

export function createMedicationDrugMatch(
  caseId: string,
  medicationId: string,
  body: {
    drug_product_id: string;
    confidence?: number | null;
    note?: string | null;
  },
): Promise<MedicationDrugMatchResponse> {
  return post<MedicationDrugMatchResponse>(
    `/cases/${caseId}/medikamente/${medicationId}/drug-matches`,
    body,
  );
}

export function verifyMedicationDrugMatch(
  caseId: string,
  medicationId: string,
  matchId: string,
  verificationStatus: "candidate" | "verified" | "rejected",
  note?: string | null,
): Promise<unknown> {
  return post(
    `/cases/${caseId}/medikamente/${medicationId}/drug-matches/${matchId}/verify`,
    {
      verification_status: verificationStatus,
      note,
    },
  );
}

export function previewDrugImport(rows: DrugImportPreviewRow[]): Promise<DrugImportPreview> {
  return post<DrugImportPreview>("/drug-products/import-preview", { rows });
}
