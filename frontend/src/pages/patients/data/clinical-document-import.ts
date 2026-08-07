import { apiFetch } from "@/lib/api";

export type ClinicalDocumentImportTarget =
  | "diagnosis"
  | "anamnesis"
  | "medication"
  | "examination"
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
  extraction?: ClinicalDocumentExtraction | null;
};

export type ClinicalDocumentImportStatus =
  | "queued"
  | "processing"
  | "review_required"
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
  applied_counts: Record<string, number>;
  error_message: string | null;
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
  applied_counts: Record<string, number>;
  error_message: string | null;
  completed_at: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

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
