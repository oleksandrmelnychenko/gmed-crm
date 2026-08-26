import { get, post } from "./client";

export type MedicationIntelligenceIdentityStatus =
  | "verified"
  | "candidate"
  | "unresolved";

export type MedicationIntelligenceSeverity = "info" | "warning" | "high";

export type MedicationIntelligenceIngestionStatus =
  | "available"
  | "planned"
  | "manual_reference"
  | "error";

export type MedicationIntelligenceSourceHealth =
  | "fresh"
  | "stale"
  | "error"
  | "never";

export type MedicationIntelligenceSourceSnapshot = {
  id: string;
  fetched_at: string;
  published_at: string | null;
  version: string | null;
  checksum_sha256: string;
  item_count: number | null;
  source_url: string;
};

export type MedicationIdentitySourceState = "internal_curated" | "official_snapshot";

export type MedicationIdentityMatchBasis =
  | "exact_pzn"
  | "exact_substance"
  | "exact_strength"
  | "exact_form";

export type MedicationIdentityPermissions = {
  can_search_candidates: boolean;
  can_confirm_identity: boolean;
  reason_code: string | null;
};

export type MedicationIdentitySubject = {
  id: string;
  name: string;
  substance: string | null;
  strength: string | null;
  form: string | null;
  pzn: string | null;
  atc_code: string | null;
  version: string;
  identity_status: MedicationIntelligenceIdentityStatus;
};

export type MedicationIdentityCandidateProduct = {
  id: string;
  brand_name: string;
  substances: string[];
  strength: string | null;
  form: string | null;
  pzn: string | null;
  atc_code: string | null;
  country_code: string | null;
  manufacturer: string | null;
};

export type MedicationIdentityCandidateProvenance = {
  source_state: MedicationIdentitySourceState;
  source_id: string;
  source_label: string;
  authority: string | null;
  official_url: string | null;
  snapshot_id: string | null;
  snapshot_version: string | null;
  snapshot_fetched_at: string | null;
  snapshot_published_at: string | null;
};

export type MedicationIdentityCandidate = {
  id: string;
  product: MedicationIdentityCandidateProduct;
  match_basis: MedicationIdentityMatchBasis[];
  confirmable: boolean;
  blocking_reasons: string[];
  provenance: MedicationIdentityCandidateProvenance;
};

export type MedicationIdentityCandidateSet = {
  medication: MedicationIdentitySubject;
  candidate_set: {
    id: string;
    generated_at: string;
    expires_at: string | null;
    query_basis: string[];
  };
  candidates: MedicationIdentityCandidate[];
  permissions: MedicationIdentityPermissions;
};

export type MedicationIdentityConfirmationInput = {
  candidate_set_id: string;
  candidate_id: string;
  medication_version: string;
  source_snapshot_id: string | null;
  staff_acknowledged: true;
  note?: string | null;
  idempotency_key?: string;
};

export type MedicationIdentityConfirmationResult = {
  medication_id: string;
  identity_status: "verified";
  medication_version: string;
  refresh_token: string;
  audit: {
    confirmed_by: string;
    confirmed_at: string;
  };
};

export type MedicationIntelligenceSummary = {
  active_medications: number;
  identified_medications: number;
  unresolved_medications: number;
  findings_total: number;
  high_priority_findings: number;
  missing_data_total: number;
};

export type MedicationIntelligenceMedication = {
  id: string;
  name: string;
  substance: string | null;
  status: string;
  atc_code: string | null;
  pzn: string | null;
  country_code: string | null;
  identity_status: MedicationIntelligenceIdentityStatus;
};

export type MedicationIntelligenceFinding = {
  id: string;
  severity: MedicationIntelligenceSeverity;
  category: string;
  title_ru: string;
  title_de: string;
  detail_ru: string;
  detail_de: string;
  medication_ids: string[];
  evidence_refs: string[];
  source_id: string | null;
  published_at: string | null;
  source_url: string | null;
  substances: string[];
};

export type MedicationIntelligenceMissingData = {
  code: string;
  label_ru: string;
  label_de: string;
  reason_ru: string;
  reason_de: string;
};

export type MedicationIntelligenceSource = {
  id: string;
  label: string;
  authority: string;
  kind: string;
  url: string;
  machine_readable: boolean;
  ingestion_status: MedicationIntelligenceIngestionStatus;
  health: MedicationIntelligenceSourceHealth;
  freshness_ttl_hours: number | null;
  last_attempt_at: string | null;
  last_error: string | null;
  last_successful_snapshot: MedicationIntelligenceSourceSnapshot | null;
};

export type MedicationIntelligenceResponse = {
  mode: "open_sources_only";
  generated_at: string;
  disclaimer: {
    ru: string;
    de: string;
  };
  summary: MedicationIntelligenceSummary;
  medications: MedicationIntelligenceMedication[];
  findings: MedicationIntelligenceFinding[];
  missing_data: MedicationIntelligenceMissingData[];
  sources: MedicationIntelligenceSource[];
  identity_permissions: MedicationIdentityPermissions;
};

const EMPTY_SUMMARY: MedicationIntelligenceSummary = {
  active_medications: 0,
  identified_medications: 0,
  unresolved_medications: 0,
  findings_total: 0,
  high_priority_findings: 0,
  missing_data_total: 0,
};

const EMPTY_IDENTITY_PERMISSIONS: MedicationIdentityPermissions = {
  can_search_candidates: false,
  can_confirm_identity: false,
  reason_code: null,
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
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function nullableCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function identityStatus(value: unknown): MedicationIntelligenceIdentityStatus {
  return value === "verified" || value === "candidate" || value === "unresolved"
    ? value
    : "unresolved";
}

function severity(value: unknown): MedicationIntelligenceSeverity {
  return value === "high" || value === "warning" || value === "info" ? value : "info";
}

function ingestionStatus(value: unknown): MedicationIntelligenceIngestionStatus {
  return value === "available"
    || value === "planned"
    || value === "manual_reference"
    || value === "error"
    ? value
    : "manual_reference";
}

function sourceHealth(value: unknown): MedicationIntelligenceSourceHealth {
  return value === "fresh" || value === "stale" || value === "error" || value === "never"
    ? value
    : "never";
}

function identitySourceState(value: unknown): MedicationIdentitySourceState {
  return value === "official_snapshot" ? "official_snapshot" : "internal_curated";
}

function matchBasis(value: unknown): MedicationIdentityMatchBasis[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MedicationIdentityMatchBasis =>
    item === "exact_pzn"
      || item === "exact_substance"
      || item === "exact_strength"
      || item === "exact_form",
  );
}

function successfulSnapshot(value: unknown): MedicationIntelligenceSourceSnapshot | null {
  const snapshot = record(value);
  if (Object.keys(snapshot).length === 0) return null;
  return {
    id: string(snapshot.id),
    fetched_at: string(snapshot.fetched_at),
    published_at: nullableString(snapshot.published_at),
    version: nullableString(snapshot.version),
    checksum_sha256: string(snapshot.checksum_sha256),
    item_count: nullableCount(snapshot.item_count),
    source_url: string(snapshot.source_url),
  };
}

export function normalizeMedicationIntelligence(
  value: unknown,
): MedicationIntelligenceResponse {
  const payload = record(value);
  const disclaimer = record(payload.disclaimer);
  const summary = record(payload.summary);
  const medications = Array.isArray(payload.medications) ? payload.medications : [];
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const missingData = Array.isArray(payload.missing_data) ? payload.missing_data : [];
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const identityPermissions = record(payload.identity_permissions);

  return {
    mode: "open_sources_only",
    generated_at: string(payload.generated_at),
    disclaimer: {
      ru: string(disclaimer.ru),
      de: string(disclaimer.de),
    },
    summary: {
      ...EMPTY_SUMMARY,
      active_medications: count(summary.active_medications),
      identified_medications: count(summary.identified_medications),
      unresolved_medications: count(summary.unresolved_medications),
      findings_total: count(summary.findings_total),
      high_priority_findings: count(summary.high_priority_findings),
      missing_data_total: count(summary.missing_data_total),
    },
    medications: medications.map((item) => {
      const medication = record(item);
      return {
        id: string(medication.id),
        name: string(medication.name),
        substance: nullableString(medication.substance),
        status: string(medication.status),
        atc_code: nullableString(medication.atc_code),
        pzn: nullableString(medication.pzn),
        country_code: nullableString(medication.country_code),
        identity_status: identityStatus(medication.identity_status),
      };
    }),
    findings: findings.map((item) => {
      const finding = record(item);
      return {
        id: string(finding.id),
        severity: severity(finding.severity),
        category: string(finding.category),
        title_ru: string(finding.title_ru),
        title_de: string(finding.title_de),
        detail_ru: string(finding.detail_ru),
        detail_de: string(finding.detail_de),
        medication_ids: stringArray(finding.medication_ids),
        evidence_refs: stringArray(finding.evidence_refs),
        source_id: nullableString(finding.source_id),
        published_at: nullableString(finding.published_at),
        source_url: nullableString(finding.source_url),
        substances: stringArray(finding.substances),
      };
    }),
    missing_data: missingData.map((item) => {
      const missing = record(item);
      return {
        code: string(missing.code),
        label_ru: string(missing.label_ru),
        label_de: string(missing.label_de),
        reason_ru: string(missing.reason_ru),
        reason_de: string(missing.reason_de),
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
        ingestion_status: ingestionStatus(source.ingestion_status),
        health: sourceHealth(source.health),
        freshness_ttl_hours: nullableCount(source.freshness_ttl_hours),
        last_attempt_at: nullableString(source.last_attempt_at),
        last_error: nullableString(source.last_error),
        last_successful_snapshot: successfulSnapshot(source.last_successful_snapshot),
      };
    }),
    identity_permissions: {
      ...EMPTY_IDENTITY_PERMISSIONS,
      can_search_candidates: identityPermissions.can_search_candidates === true,
      can_confirm_identity: identityPermissions.can_confirm_identity === true,
      reason_code: nullableString(identityPermissions.reason_code),
    },
  };
}

export function normalizeMedicationIdentityCandidateSet(
  value: unknown,
): MedicationIdentityCandidateSet {
  const payload = record(value);
  const medication = record(payload.medication);
  const candidateSet = record(payload.candidate_set);
  const permissions = record(payload.permissions);
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];

  return {
    medication: {
      id: string(medication.id),
      name: string(medication.name),
      substance: nullableString(medication.substance),
      strength: nullableString(medication.strength),
      form: nullableString(medication.form),
      pzn: nullableString(medication.pzn),
      atc_code: nullableString(medication.atc_code),
      version: string(medication.version),
      identity_status: identityStatus(medication.identity_status),
    },
    candidate_set: {
      id: string(candidateSet.id),
      generated_at: string(candidateSet.generated_at),
      expires_at: nullableString(candidateSet.expires_at),
      query_basis: stringArray(candidateSet.query_basis),
    },
    candidates: candidates.map((item) => {
      const candidate = record(item);
      const product = record(candidate.product);
      const provenance = record(candidate.provenance);
      return {
        id: string(candidate.id),
        product: {
          id: string(product.id),
          brand_name: string(product.brand_name),
          substances: stringArray(product.substances),
          strength: nullableString(product.strength),
          form: nullableString(product.form),
          pzn: nullableString(product.pzn),
          atc_code: nullableString(product.atc_code),
          country_code: nullableString(product.country_code),
          manufacturer: nullableString(product.manufacturer),
        },
        match_basis: matchBasis(candidate.match_basis),
        confirmable: candidate.confirmable === true,
        blocking_reasons: stringArray(candidate.blocking_reasons),
        provenance: {
          source_state: identitySourceState(provenance.source_state),
          source_id: string(provenance.source_id),
          source_label: string(provenance.source_label),
          authority: nullableString(provenance.authority),
          official_url: nullableString(provenance.official_url),
          snapshot_id: nullableString(provenance.snapshot_id),
          snapshot_version: nullableString(provenance.snapshot_version),
          snapshot_fetched_at: nullableString(provenance.snapshot_fetched_at),
          snapshot_published_at: nullableString(provenance.snapshot_published_at),
        },
      };
    }),
    permissions: {
      can_search_candidates: permissions.can_search_candidates === true,
      can_confirm_identity: permissions.can_confirm_identity === true,
      reason_code: nullableString(permissions.reason_code),
    },
  };
}

export async function fetchMedicationIntelligence(
  patientId: string,
): Promise<MedicationIntelligenceResponse> {
  const payload = await get<unknown>(
    `/patients/${encodeURIComponent(patientId)}/medication-intelligence`,
  );
  return normalizeMedicationIntelligence(payload);
}

export async function fetchMedicationIdentityCandidates(
  patientId: string,
  medicationId: string,
): Promise<MedicationIdentityCandidateSet> {
  const payload = await get<unknown>(
    `/patients/${encodeURIComponent(patientId)}/medications/${encodeURIComponent(medicationId)}/identity-candidates`,
  );
  return normalizeMedicationIdentityCandidateSet(payload);
}

export async function generateMedicationIdentityCandidates(
  patientId: string,
  medicationId: string,
): Promise<MedicationIdentityCandidateSet> {
  const payload = await post<unknown>(
    `/patients/${encodeURIComponent(patientId)}/medications/${encodeURIComponent(medicationId)}/identity-candidates`,
  );
  return normalizeMedicationIdentityCandidateSet(payload);
}

function normalizeMedicationIdentityConfirmationResult(
  value: unknown,
): MedicationIdentityConfirmationResult {
  const payload = record(value);
  const audit = record(payload.audit);
  return {
    medication_id: string(payload.medication_id),
    identity_status: "verified",
    medication_version: string(payload.medication_version),
    refresh_token: string(payload.refresh_token),
    audit: {
      confirmed_by: string(audit.confirmed_by),
      confirmed_at: string(audit.confirmed_at),
    },
  };
}

export async function confirmMedicationIdentity(
  patientId: string,
  medicationId: string,
  input: MedicationIdentityConfirmationInput,
): Promise<MedicationIdentityConfirmationResult> {
  const payload = await post<unknown>(
    `/patients/${encodeURIComponent(patientId)}/medications/${encodeURIComponent(medicationId)}/identity-confirmations`,
    input,
  );
  return normalizeMedicationIdentityConfirmationResult(payload);
}
