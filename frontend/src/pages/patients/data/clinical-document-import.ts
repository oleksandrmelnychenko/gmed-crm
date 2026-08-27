import { apiFetch } from "@/lib/api";
import type { ClinicalDocumentSubjectEvidence } from "./clinical-document-subject";

export type ClinicalDocumentImportTarget =
  | "diagnosis"
  | "anamnesis"
  | "medication"
  | "examination"
  | "lab_result"
  | "vital"
  | "recommendation";

export type ClinicalDocumentImportCandidate = {
  id: string;
  target: ClinicalDocumentImportTarget;
  value: string;
  normalized: Record<string, unknown>;
  confidence: number;
  selected: boolean;
  source: {
    page: number | null;
    section: string;
    text: string;
  };
};

export type ClinicalDocumentExtractionPage = {
  page_number: number | null;
  source: "native" | "ocr" | "native_fallback" | "existing" | "text";
  route_reason: string;
  native_quality: number | null;
  native_char_count: number;
  ocr_confidence: number | null;
  low_confidence_word_ratio: number | null;
  ocr_languages: string | null;
  ocr_engine: string | null;
  orientation_rotation: number;
  deskew_angle: number;
  word_count: number;
};

export type ClinicalDocumentExtraction = {
  page_count: number;
  text_chars: number;
  used_ocr: boolean;
  pages: ClinicalDocumentExtractionPage[];
};

export type ClinicalDocumentImportDraft = {
  document_type: string;
  source_language: string | null;
  parser_version: string;
  raw_text?: string;
  candidates: ClinicalDocumentImportCandidate[];
  warnings: string[];
  subject?: ClinicalDocumentSubjectEvidence | null;
  extraction?: ClinicalDocumentExtraction | null;
};

export type ClinicalDocumentTextPage = {
  pageNumber: number;
  text: string;
  textScope: "page" | "document";
  extraction: ClinicalDocumentExtractionPage | null;
};

export function clinicalDocumentPreviewPage(
  candidatePage: number | null | undefined,
  selectedSourcePage: number | null | undefined,
) {
  if (candidatePage && candidatePage > 0) return candidatePage;
  if (selectedSourcePage && selectedSourcePage > 0) return selectedSourcePage;
  return 1;
}

/**
 * Builds a stable one-based page model from the OCR text envelope.
 * Form-feed is the parser's page delimiter and empty segments are meaningful:
 * they represent real PDF pages where OCR found no usable text.
 */
export function clinicalDocumentTextPages(
  draft: ClinicalDocumentImportDraft | null | undefined,
): ClinicalDocumentTextPage[] {
  if (!draft) return [];

  const rawText = draft.raw_text ?? "";
  const hasPageBoundaries = rawText.includes("\f");
  const rawPages = hasPageBoundaries ? rawText.split("\f") : rawText ? [rawText] : [];
  const extractionPages = draft.extraction?.pages ?? [];
  const numberedPageCount = extractionPages.reduce(
    (maximum, page) => Math.max(maximum, page.page_number ?? 0),
    0,
  );
  const knownPageCount = Math.max(
    draft.extraction?.page_count ?? 0,
    numberedPageCount,
    rawPages.length,
  );
  if (knownPageCount === 0) return [];

  const extractionByPage = new Map<number, ClinicalDocumentExtractionPage>();
  for (const page of extractionPages) {
    if (page.page_number && page.page_number > 0) extractionByPage.set(page.page_number, page);
  }
  const singleUnnumberedExtraction = knownPageCount === 1
    ? extractionPages.find((page) => page.page_number === null) ?? null
    : null;
  const documentLevelText = knownPageCount > 1 && rawText.length > 0 && !hasPageBoundaries;

  return Array.from({ length: knownPageCount }, (_, index) => ({
    pageNumber: index + 1,
    text: documentLevelText ? rawText : (rawPages[index] ?? ""),
    textScope: documentLevelText ? "document" : "page",
    extraction: extractionByPage.get(index + 1) ?? singleUnnumberedExtraction,
  }));
}

export type ClinicalDocumentImportStatus =
  | "queued"
  | "processing"
  | "review_required"
  | "applying"
  | "applied"
  | "failed";

export type ClinicalDocumentImportSummary = {
  id: string;
  patient_id: string;
  document_id: string;
  document_name: string | null;
  mime_type: string | null;
  status: ClinicalDocumentImportStatus;
  document_type: string | null;
  source_language: string | null;
  parser_version: string | null;
  candidate_count: number;
  force_reextract?: boolean;
  replaces_import_id?: string | null;
  applied_counts: Record<string, number>;
  error_message: string | null;
  prepared_source_country?: string | null;
  prepared_patient_identity_confirmed?: boolean;
  prepared_identity_gate_version?: number;
  prepared_at?: string | null;
  completed_at: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClinicalDocumentImport = {
  id: string;
  patient_id: string;
  document_id: string;
  document_name: string | null;
  mime_type: string | null;
  status: ClinicalDocumentImportStatus;
  document_type: string | null;
  source_language: string | null;
  parser_version: string | null;
  draft: ClinicalDocumentImportDraft;
  reviewed_draft: ClinicalDocumentImportDraft | null;
  force_reextract?: boolean;
  replaces_import_id?: string | null;
  applied_counts: Record<string, number>;
  error_message: string | null;
  prepared_source_country?: string | null;
  prepared_patient_identity_confirmed?: boolean;
  prepared_identity_gate_version?: number;
  prepared_at?: string | null;
  completed_at: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ImportedMedicationPayload = {
  candidate_id: string;
  wirkstoff: string;
  handelsname?: string | null;
  category?: string | null;
  staerke?: string | null;
  form?: string | null;
  einnahmeform?: string | null;
  dose_morgens?: string | null;
  dose_mittags?: string | null;
  dose_abends?: string | null;
  dose_nachts?: string | null;
  einheit?: string | null;
  hinweis?: string | null;
  grund?: string | null;
  verordnet_am?: string | null;
  einnahme_von?: string | null;
  einnahme_bis?: string | null;
  /** Clinical/document date that anchors this reviewed regimen in the medication history. */
  source_date?: string | null;
  status?: string | null;
  on_hold?: boolean;
  hold_from?: string | null;
  hold_until?: string | null;
  hold_note?: string | null;
  apothekenpflichtig?: boolean;
  rezeptpflichtig?: boolean;
  btm?: boolean;
  aut_idem_sperre?: boolean;
  abgabebeschraenkung?: boolean;
  sonstige_vermerke?: string | null;
  source_country?: string | null;
  source_page?: number | null;
  source_raw_text?: string | null;
  source_identifiers?: Record<string, unknown>;
  source_field_confidence?: Record<string, number>;
  drug_product_id?: string | null;
  medication_series_id?: string | null;
  create_new_series?: boolean;
};

export type ImportedLabResultPayload = {
  measured_at: string;
  panel: string | null;
  laboratory_name: string | null;
  analyte_name: string;
  result_text: string;
  numeric_result: number | null;
  comparator: string | null;
  unit: string | null;
  reference_text: string | null;
  reference_low: number | null;
  reference_high: number | null;
  interpretation_note: string | null;
  abnormal_flag: string;
  source_country: string;
  source_import_id: string;
  source_candidate_id: string;
  source_page: number | null;
};

export type ImportedVitalPayload = {
  measured_at: string;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  heart_rate: number | null;
  temperature_c: number | null;
  oxygen_saturation: number | null;
  respiratory_rate: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  bmi: number | null;
  notes: string | null;
  source_country: string;
  source_import_id: string;
  source_candidate_id: string;
  source_page: number | null;
};

export type ClinicalDocumentCandidatePayloads = Record<
  string,
  ImportedMedicationPayload | ImportedLabResultPayload | ImportedVitalPayload
>;

export function clinicalImportNeedsSourceCountry(
  candidates: Pick<ClinicalDocumentImportCandidate, "target">[],
) {
  return candidates.some(
    (candidate) =>
      candidate.target === "diagnosis" ||
      candidate.target === "lab_result" ||
      candidate.target === "medication" ||
      candidate.target === "vital",
  );
}

export type ImportedMedicationAction =
  | "created"
  | "deduplicated"
  | "regimen_changed"
  | "status_transition"
  | "historical_observation";

export type ImportedMedicationResponse = {
  id: string;
  action: ImportedMedicationAction;
  idempotent: boolean;
  supersedes_medication_id?: string | null;
  medication_series_id?: string | null;
  regimen_fingerprint: string;
  match_candidate_count: number;
  source_date: string | null;
};

export type MedicationImportHistoryEvent = {
  id: string;
  patient_medication_id: string | null;
  prior_medication_id: string | null;
  medication_series_id?: string | null;
  event_type: ImportedMedicationAction;
  regimen_fingerprint: string;
  source_document_id: string | null;
  source_document_name: string | null;
  source_import_id: string;
  source_candidate_id: string;
  source_country: string | null;
  source_date: string | null;
  source_page: number | null;
  source_raw_text: string | null;
  source_identifiers: Record<string, unknown>;
  source_field_confidence: Record<string, number>;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown>;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  created_at: string;
};

export type MedicationImportHistoryPage = {
  items: MedicationImportHistoryEvent[];
  total: number;
  limit: number;
  offset: number;
};

export type PreparedClinicalDocumentImport = {
  ok: true;
  id: string;
  status: "applying";
  idempotent: boolean;
  source_country: string | null;
  patient_identity_confirmed: boolean;
};

export function clinicalDocumentImportAfterPrepare(
  current: ClinicalDocumentImport,
  reviewedDraft: ClinicalDocumentImportDraft,
  prepared: PreparedClinicalDocumentImport,
  preparedAt: string,
): ClinicalDocumentImport {
  return {
    ...current,
    status: "applying",
    reviewed_draft: reviewedDraft,
    prepared_source_country: prepared.source_country,
    prepared_patient_identity_confirmed: prepared.patient_identity_confirmed,
    prepared_identity_gate_version: 1,
    prepared_at: current.prepared_at ?? preparedAt,
  };
}

export function fetchClinicalDocumentImports(patientId: string) {
  return apiFetch<{ items: ClinicalDocumentImportSummary[] }>(
    `/patients/${patientId}/clinical-document-imports`,
    { cache: "no-store" },
  );
}

export function createClinicalDocumentImport(patientId: string, documentId: string) {
  return apiFetch<ClinicalDocumentImport>(
    `/patients/${patientId}/clinical-document-imports`,
    {
      method: "POST",
      body: JSON.stringify({ document_id: documentId }),
    },
  );
}

export function fetchClinicalDocumentImport(patientId: string, importId: string) {
  return apiFetch<ClinicalDocumentImport>(
    `/patients/${patientId}/clinical-document-imports/${importId}`,
    { cache: "no-store" },
  );
}

export function deleteClinicalDocumentImport(patientId: string, importId: string) {
  return apiFetch<void>(
    `/patients/${patientId}/clinical-document-imports/${importId}`,
    { method: "DELETE" },
  );
}

export function retryClinicalDocumentImport(patientId: string, importId: string) {
  return apiFetch<ClinicalDocumentImport>(
    `/patients/${patientId}/clinical-document-imports/${importId}/retry`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function rescanClinicalDocumentImport(patientId: string, importId: string) {
  return apiFetch<ClinicalDocumentImport>(
    `/patients/${patientId}/clinical-document-imports/${importId}/rescan`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function persistClinicalDocumentMedication(
  patientId: string,
  importId: string,
  payload: ImportedMedicationPayload,
) {
  return apiFetch<ImportedMedicationResponse>(
    `/patients/${patientId}/clinical-document-imports/${importId}/medications`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function persistClinicalDocumentVital(
  patientId: string,
  payload: ImportedVitalPayload,
) {
  return apiFetch<{ id: string; created_at: string; ok: true; idempotent: boolean }>(
    `/patients/${patientId}/vitals`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function fetchPatientMedicationImportHistory(
  patientId: string,
  options: { limit?: number; offset?: number } = {},
) {
  const limit = options.limit ?? 200;
  const offset = options.offset ?? 0;
  const query = `?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`;
  return apiFetch<MedicationImportHistoryPage>(
    `/patients/${patientId}/medication-import-history${query}`,
    { cache: "no-store" },
  );
}

export function prepareClinicalDocumentImport(
  patientId: string,
  importId: string,
  reviewedDraft: ClinicalDocumentImportDraft,
  candidatePayloads: ClinicalDocumentCandidatePayloads,
  sourceCountry?: string | null,
  patientIdentityConfirmed = false,
) {
  return apiFetch<PreparedClinicalDocumentImport>(
    `/patients/${patientId}/clinical-document-imports/${importId}/prepare`,
    {
      method: "POST",
      body: JSON.stringify({
        reviewed_draft: reviewedDraft,
        candidate_payloads: candidatePayloads,
        source_country: sourceCountry || undefined,
        patient_identity_confirmed: patientIdentityConfirmed,
      }),
    },
  );
}

export function completeClinicalDocumentImport(
  patientId: string,
  importId: string,
  reviewedDraft: ClinicalDocumentImportDraft,
  appliedCounts: Record<string, number>,
) {
  return apiFetch<ClinicalDocumentImport>(
    `/patients/${patientId}/clinical-document-imports/${importId}/complete`,
    {
      method: "POST",
      body: JSON.stringify({
        reviewed_draft: reviewedDraft,
        applied_counts: appliedCounts,
      }),
    },
  );
}
