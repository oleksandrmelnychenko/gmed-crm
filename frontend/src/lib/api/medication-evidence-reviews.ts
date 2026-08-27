import { get, post } from "./client";

export type MedicationEvidenceReviewStatus =
  | "requested"
  | "draft_ready"
  | "failed"
  | "superseded";

export type MedicationEvidenceSummary = {
  active_medications: number;
  identified_medications: number;
  unresolved_medications: number;
  findings_total: number;
  high_priority_findings: number;
  missing_data_total: number;
  benefit_assessments_total: number;
};

export type MedicationEvidenceProvider = {
  kind: "none";
  status: "not_configured" | "disabled";
  external_calls_enabled: false;
  reason_code: "external_provider_not_configured";
};

export type MedicationAiProvider = {
  kind: "none" | "openai";
  status: "not_configured" | "disabled" | "blocked" | "ready";
  external_calls_enabled: boolean;
  reason_code: string;
  model: string | null;
};

export type MedicationEvidenceClinicalReview = {
  status: "not_configured";
  can_approve: false;
};

export type MedicationEvidenceReviewPermissions = {
  can_create_review: boolean;
  can_read_review: boolean;
};

export type MedicationEvidenceReviewSummary = {
  id: string;
  status: MedicationEvidenceReviewStatus;
  created_at: string;
};

export type MedicationEvidenceReviewPreview = {
  mode: "local_evidence_only";
  generated_at: string;
  intelligence_fingerprint: string;
  summary: MedicationEvidenceSummary;
  medication_ids: string[];
  provider: MedicationEvidenceProvider;
  ai_provider: MedicationAiProvider;
  clinical_review: MedicationEvidenceClinicalReview;
  permissions: MedicationEvidenceReviewPermissions;
  latest_review: MedicationEvidenceReviewSummary | null;
};

export type MedicationEvidenceFinding = {
  id: string;
  severity: string;
  category: string;
  title_ru: string;
  title_de: string;
  medication_ids: string[];
  evidence_refs: string[];
  source_id: string | null;
  published_at: string | null;
  source_url: string | null;
  substances: string[];
  citation_ref: string;
};

export type MedicationEvidenceMissingData = {
  code: string;
  reason_ru: string;
  reason_de: string;
  citation_ref: string;
};

export type MedicationEvidenceSourceSnapshot = {
  id: string;
  fetched_at: string;
  published_at: string | null;
  version: string | null;
  checksum_sha256: string;
  item_count: number | null;
  source_url: string;
};

export type MedicationEvidenceSource = {
  id: string;
  label: string;
  authority: string;
  kind: string;
  url: string;
  machine_readable: boolean;
  ingestion_status: string;
  health: string;
  last_successful_snapshot: MedicationEvidenceSourceSnapshot | null;
  citation_ref: string;
};

export type MedicationEvidenceCitation = {
  id: string;
  kind: "finding" | "missing_data" | "source" | "benefit_assessment";
  source_id: string | null;
  source_url: string | null;
  evidence_refs: string[];
};

export type MedicationEvidenceBenefitAssessment = {
  evidence_ref: string;
  medication_id: string;
  decision_id: string;
  dossier_reference: string;
  official_url: string;
  decision_date: string;
  indication_short: string;
  patient_group: string;
  benefit_extent: string;
  benefit_probability: string | null;
  assessed_substances: string[];
  citation_ref: string;
};

export type MedicationEvidenceDraftItem = {
  text_ru: string;
  text_de: string;
  citation_refs: string[];
};

export type MedicationEvidenceReview = {
  mode: "local_evidence_only";
  review: {
    id: string;
    status: MedicationEvidenceReviewStatus;
    created_at: string;
    completed_at: string | null;
    bundle_id: string;
  };
  bundle: {
    id: string;
    version: "medication-evidence-v1";
    fingerprint: string;
    created_at: string;
    summary: MedicationEvidenceSummary;
    medication_ids: string[];
    findings: MedicationEvidenceFinding[];
    missing_data: MedicationEvidenceMissingData[];
    sources: MedicationEvidenceSource[];
    citations: MedicationEvidenceCitation[];
    benefit_assessments: MedicationEvidenceBenefitAssessment[];
  };
  draft: {
    id: string;
    status: "ready";
    created_at: string;
    evidence_summary: MedicationEvidenceDraftItem[];
    verification_questions: MedicationEvidenceDraftItem[];
    limitations: MedicationEvidenceDraftItem[];
    citation_refs: string[];
  };
  provider: MedicationEvidenceProvider;
  clinical_review: MedicationEvidenceClinicalReview;
  permissions: MedicationEvidenceReviewPermissions;
};

export type CreateMedicationEvidenceReviewInput = {
  intelligence_fingerprint: string;
  idempotency_key: string;
};

export type MedicationAiAnalysisStatus = "requested" | "processing" | "ready" | "failed";

export type MedicationAiAnalysis = {
  id: string;
  review_id: string;
  status: MedicationAiAnalysisStatus;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  provider: MedicationAiProvider;
  prompt_version: string;
  draft: {
    evidence_summary: MedicationEvidenceDraftItem[];
    verification_questions: MedicationEvidenceDraftItem[];
    limitations: MedicationEvidenceDraftItem[];
    citation_refs: string[];
  } | null;
  error_code: string | null;
};

const EMPTY_SUMMARY: MedicationEvidenceSummary = {
  active_medications: 0,
  identified_medications: 0,
  unresolved_medications: 0,
  findings_total: 0,
  high_priority_findings: 0,
  missing_data_total: 0,
  benefit_assessments_total: 0,
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function nullableCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function reviewStatus(value: unknown): MedicationEvidenceReviewStatus {
  return value === "draft_ready"
    || value === "failed"
    || value === "superseded"
    || value === "requested"
    ? value
    : "requested";
}

function summary(value: unknown): MedicationEvidenceSummary {
  const payload = record(value);
  return {
    ...EMPTY_SUMMARY,
    active_medications: count(payload.active_medications),
    identified_medications: count(payload.identified_medications),
    unresolved_medications: count(payload.unresolved_medications),
    findings_total: count(payload.findings_total),
    high_priority_findings: count(payload.high_priority_findings),
    missing_data_total: count(payload.missing_data_total),
    benefit_assessments_total: count(payload.benefit_assessments_total),
  };
}

function provider(value: unknown): MedicationEvidenceProvider {
  const payload = record(value);
  return {
    kind: "none",
    status: payload.status === "disabled" ? "disabled" : "not_configured",
    external_calls_enabled: false,
    reason_code: "external_provider_not_configured",
  };
}

function aiProvider(value: unknown): MedicationAiProvider {
  const payload = record(value);
  const status = payload.status === "ready"
    || payload.status === "blocked"
    || payload.status === "disabled"
    || payload.status === "not_configured"
    ? payload.status
    : "not_configured";
  return {
    kind: payload.kind === "openai" ? "openai" : "none",
    status,
    external_calls_enabled: payload.external_calls_enabled === true,
    reason_code: string(payload.reason_code),
    model: nullableString(payload.model),
  };
}

function clinicalReview(): MedicationEvidenceClinicalReview {
  return { status: "not_configured", can_approve: false };
}

function permissions(value: unknown): MedicationEvidenceReviewPermissions {
  const payload = record(value);
  return {
    can_create_review: payload.can_create_review === true,
    can_read_review: payload.can_read_review === true,
  };
}

function snapshot(value: unknown): MedicationEvidenceSourceSnapshot | null {
  const payload = record(value);
  if (Object.keys(payload).length === 0) return null;
  return {
    id: string(payload.id),
    fetched_at: string(payload.fetched_at),
    published_at: nullableString(payload.published_at),
    version: nullableString(payload.version),
    checksum_sha256: string(payload.checksum_sha256),
    item_count: nullableCount(payload.item_count),
    source_url: string(payload.source_url),
  };
}

function draftItems(value: unknown): MedicationEvidenceDraftItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const payload = record(item);
    return {
      text_ru: string(payload.text_ru),
      text_de: string(payload.text_de),
      citation_refs: stringArray(payload.citation_refs),
    };
  });
}

export function normalizeMedicationEvidenceReviewPreview(
  value: unknown,
): MedicationEvidenceReviewPreview {
  const payload = record(value);
  const latestReview = record(payload.latest_review);
  return {
    mode: "local_evidence_only",
    generated_at: string(payload.generated_at),
    intelligence_fingerprint: string(payload.intelligence_fingerprint),
    summary: summary(payload.summary),
    medication_ids: stringArray(payload.medication_ids),
    provider: provider(payload.provider),
    ai_provider: aiProvider(payload.ai_provider),
    clinical_review: clinicalReview(),
    permissions: permissions(payload.permissions),
    latest_review: Object.keys(latestReview).length === 0
      ? null
      : {
          id: string(latestReview.id),
          status: reviewStatus(latestReview.status),
          created_at: string(latestReview.created_at),
        },
  };
}

export function normalizeMedicationEvidenceReview(value: unknown): MedicationEvidenceReview {
  const payload = record(value);
  const review = record(payload.review);
  const bundle = record(payload.bundle);
  const draft = record(payload.draft);
  const findings = Array.isArray(bundle.findings) ? bundle.findings : [];
  const missingData = Array.isArray(bundle.missing_data) ? bundle.missing_data : [];
  const sources = Array.isArray(bundle.sources) ? bundle.sources : [];
  const citations = Array.isArray(bundle.citations) ? bundle.citations : [];
  const benefitAssessments = Array.isArray(bundle.benefit_assessments)
    ? bundle.benefit_assessments
    : [];

  return {
    mode: "local_evidence_only",
    review: {
      id: string(review.id),
      status: reviewStatus(review.status),
      created_at: string(review.created_at),
      completed_at: nullableString(review.completed_at),
      bundle_id: string(review.bundle_id),
    },
    bundle: {
      id: string(bundle.id),
      version: "medication-evidence-v1",
      fingerprint: string(bundle.fingerprint),
      created_at: string(bundle.created_at),
      summary: summary(bundle.summary),
      medication_ids: stringArray(bundle.medication_ids),
      findings: findings.map((item) => {
        const finding = record(item);
        return {
          id: string(finding.id),
          severity: string(finding.severity),
          category: string(finding.category),
          title_ru: string(finding.title_ru),
          title_de: string(finding.title_de),
          medication_ids: stringArray(finding.medication_ids),
          evidence_refs: stringArray(finding.evidence_refs),
          source_id: nullableString(finding.source_id),
          published_at: nullableString(finding.published_at),
          source_url: nullableString(finding.source_url),
          substances: stringArray(finding.substances),
          citation_ref: string(finding.citation_ref),
        };
      }),
      missing_data: missingData.map((item) => {
        const missing = record(item);
        return {
          code: string(missing.code),
          reason_ru: string(missing.reason_ru),
          reason_de: string(missing.reason_de),
          citation_ref: string(missing.citation_ref),
        };
      }),
      sources: sources.map((item) => {
        const source = record(item);
        return {
          id: string(source.id),
          label: string(source.label),
          authority: string(source.authority),
          kind: string(source.kind),
          url: string(source.url),
          machine_readable: source.machine_readable === true,
          ingestion_status: string(source.ingestion_status),
          health: string(source.health),
          last_successful_snapshot: snapshot(source.last_successful_snapshot),
          citation_ref: string(source.citation_ref),
        };
      }),
      citations: citations.map((item) => {
        const citation = record(item);
        return {
          id: string(citation.id),
          kind: citation.kind === "missing_data"
            || citation.kind === "source"
            || citation.kind === "benefit_assessment"
            ? citation.kind
            : "finding",
          source_id: nullableString(citation.source_id),
          source_url: nullableString(citation.source_url),
          evidence_refs: stringArray(citation.evidence_refs),
        };
      }),
      benefit_assessments: benefitAssessments.map((item) => {
        const assessment = record(item);
        return {
          evidence_ref: string(assessment.evidence_ref),
          medication_id: string(assessment.medication_id),
          decision_id: string(assessment.decision_id),
          dossier_reference: string(assessment.dossier_reference),
          official_url: string(assessment.official_url),
          decision_date: string(assessment.decision_date),
          indication_short: string(assessment.indication_short),
          patient_group: string(assessment.patient_group),
          benefit_extent: string(assessment.benefit_extent),
          benefit_probability: nullableString(assessment.benefit_probability),
          assessed_substances: stringArray(assessment.assessed_substances),
          citation_ref: string(assessment.citation_ref),
        };
      }),
    },
    draft: {
      id: string(draft.id),
      status: "ready",
      created_at: string(draft.created_at),
      evidence_summary: draftItems(draft.evidence_summary),
      verification_questions: draftItems(draft.verification_questions),
      limitations: draftItems(draft.limitations),
      citation_refs: stringArray(draft.citation_refs),
    },
    provider: provider(payload.provider),
    clinical_review: clinicalReview(),
    permissions: permissions(payload.permissions),
  };
}

function collectionPath(patientId: string) {
  return `/patients/${encodeURIComponent(patientId)}/medication-evidence-reviews`;
}

export async function fetchMedicationEvidenceReviewPreview(
  patientId: string,
): Promise<MedicationEvidenceReviewPreview> {
  const payload = await get<unknown>(`${collectionPath(patientId)}/preview`);
  return normalizeMedicationEvidenceReviewPreview(payload);
}

export async function createMedicationEvidenceReview(
  patientId: string,
  input: CreateMedicationEvidenceReviewInput,
): Promise<MedicationEvidenceReview> {
  const payload = await post<unknown>(collectionPath(patientId), input);
  return normalizeMedicationEvidenceReview(payload);
}

export async function fetchMedicationEvidenceReview(
  patientId: string,
  reviewId: string,
): Promise<MedicationEvidenceReview> {
  const payload = await get<unknown>(
    `${collectionPath(patientId)}/${encodeURIComponent(reviewId)}`,
  );
  return normalizeMedicationEvidenceReview(payload);
}

export function normalizeMedicationAiAnalysis(value: unknown): MedicationAiAnalysis {
  const payload = record(value);
  const draft = record(payload.draft);
  const status = payload.status === "processing"
    || payload.status === "ready"
    || payload.status === "failed"
    || payload.status === "requested"
    ? payload.status
    : "requested";
  return {
    id: string(payload.id),
    review_id: string(payload.review_id),
    status,
    requested_at: string(payload.requested_at),
    started_at: nullableString(payload.started_at),
    completed_at: nullableString(payload.completed_at),
    provider: aiProvider(payload.provider),
    prompt_version: string(payload.prompt_version),
    draft: Object.keys(draft).length === 0
      ? null
      : {
          evidence_summary: draftItems(draft.evidence_summary),
          verification_questions: draftItems(draft.verification_questions),
          limitations: draftItems(draft.limitations),
          citation_refs: stringArray(draft.citation_refs),
        },
    error_code: nullableString(payload.error_code),
  };
}

function aiAnalysisPath(patientId: string, reviewId: string) {
  return `${collectionPath(patientId)}/${encodeURIComponent(reviewId)}/ai-analysis`;
}

export async function createMedicationAiAnalysis(
  patientId: string,
  reviewId: string,
  idempotencyKey: string,
): Promise<MedicationAiAnalysis> {
  const payload = await post<unknown>(aiAnalysisPath(patientId, reviewId), {
    idempotency_key: idempotencyKey,
  });
  return normalizeMedicationAiAnalysis(payload);
}

export async function fetchMedicationAiAnalysis(
  patientId: string,
  reviewId: string,
): Promise<MedicationAiAnalysis> {
  const payload = await get<unknown>(aiAnalysisPath(patientId, reviewId));
  return normalizeMedicationAiAnalysis(payload);
}

export async function retryMedicationAiAnalysis(
  patientId: string,
  reviewId: string,
): Promise<MedicationAiAnalysis> {
  const payload = await post<unknown>(`${aiAnalysisPath(patientId, reviewId)}/retry`, {});
  return normalizeMedicationAiAnalysis(payload);
}
