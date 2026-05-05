import {
  formatEnumLabelFromKeys,
  getLang,
  t as translateCatalog,
  type TranslationKey,
} from "@/lib/i18n";

export type PatientLegalStatus = {
  dsgvoSigned: boolean;
  confidentialityReleaseSigned: boolean;
  identityVerified: boolean;
  documentPackComplete: boolean;
  complianceCompleted: boolean;
  contractStatus: string;
  notes: string;
};

export const PATIENT_CONTRACT_STATUS_OPTIONS = [
  "not_started",
  "pending",
  "sent",
  "signed",
  "expired",
  "terminated",
] as const;

type LegalStatusRecord = Record<string, unknown>;

const DEFAULT_PATIENT_LEGAL_STATUS: PatientLegalStatus = {
  dsgvoSigned: false,
  confidentialityReleaseSigned: false,
  identityVerified: false,
  documentPackComplete: false,
  complianceCompleted: false,
  contractStatus: "not_started",
  notes: "",
};

const PATIENT_CONTRACT_STATUS_LABEL_KEYS = {
  expired: "patient_contract_status_expired",
  not_started: "patient_contract_status_not_started",
  pending: "patient_contract_status_pending",
  sent: "patient_contract_status_sent",
  signed: "patient_contract_status_signed",
  terminated: "patient_contract_status_terminated",
} satisfies Partial<Record<string, TranslationKey>>;

function legalStatusTranslations() {
  return translateCatalog(getLang());
}

export function patientContractStatusLabel(value?: string | null) {
  return formatEnumLabelFromKeys(
    value,
    PATIENT_CONTRACT_STATUS_LABEL_KEYS,
    legalStatusTranslations(),
  );
}

function asRecord(value: unknown): LegalStatusRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as LegalStatusRecord;
}

function readBool(record: LegalStatusRecord | null, key: string) {
  return typeof record?.[key] === "boolean" ? Boolean(record[key]) : false;
}

function readString(record: LegalStatusRecord | null, key: string) {
  return typeof record?.[key] === "string" ? String(record[key]).trim() : "";
}

export function normalizePatientLegalStatus(value: unknown): PatientLegalStatus {
  if (typeof value === "string") {
    return {
      ...DEFAULT_PATIENT_LEGAL_STATUS,
      notes: value.trim(),
    };
  }

  const record = asRecord(value);
  const contractStatus = readString(record, "contract_status");

  return {
    dsgvoSigned: readBool(record, "dsgvo_signed"),
    confidentialityReleaseSigned: readBool(record, "confidentiality_release_signed"),
    identityVerified: readBool(record, "identity_verified"),
    documentPackComplete: readBool(record, "document_pack_complete"),
    complianceCompleted: readBool(record, "compliance_completed"),
    contractStatus:
      PATIENT_CONTRACT_STATUS_OPTIONS.includes(
        contractStatus as (typeof PATIENT_CONTRACT_STATUS_OPTIONS)[number]
      )
        ? contractStatus
        : DEFAULT_PATIENT_LEGAL_STATUS.contractStatus,
    notes: readString(record, "notes"),
  };
}

export function serializePatientLegalStatus(status: PatientLegalStatus) {
  return {
    dsgvo_signed: status.dsgvoSigned,
    confidentiality_release_signed: status.confidentialityReleaseSigned,
    identity_verified: status.identityVerified,
    document_pack_complete: status.documentPackComplete,
    compliance_completed: status.complianceCompleted,
    contract_status: status.contractStatus,
    notes: status.notes.trim() || null,
  };
}

export function getPatientLegalStatusChecklist(status: PatientLegalStatus) {
  const translations = legalStatusTranslations();
  return [
    { key: "dsgvo", label: translations.patient_legal_check_dsgvo, done: status.dsgvoSigned },
    {
      key: "confidentiality",
      label: translations.patient_legal_check_confidentiality,
      done: status.confidentialityReleaseSigned,
    },
    { key: "identity", label: translations.patient_legal_check_identity, done: status.identityVerified },
    {
      key: "document-pack",
      label: translations.patient_legal_check_document_pack,
      done: status.documentPackComplete,
    },
    {
      key: "compliance",
      label: translations.patient_legal_check_compliance,
      done: status.complianceCompleted,
    },
  ];
}

export function getPatientLegalStatusCompletion(status: PatientLegalStatus) {
  const checklist = getPatientLegalStatusChecklist(status);
  const completed = checklist.filter((item) => item.done).length;

  return {
    completed,
    total: checklist.length,
    ratio: checklist.length === 0 ? 0 : completed / checklist.length,
  };
}

export function getPatientLegalStatusSummary(status: PatientLegalStatus) {
  const translations = legalStatusTranslations();
  const completion = getPatientLegalStatusCompletion(status);
  if (status.complianceCompleted) {
    return translations.patient_legal_summary_complete;
  }
  if (completion.completed === 0) {
    return translations.patient_legal_summary_not_started;
  }
  return translations.patient_legal_summary_progress
    .replace("{completed}", String(completion.completed))
    .replace("{total}", String(completion.total));
}
