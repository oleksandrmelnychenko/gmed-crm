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
  return [
    { key: "dsgvo", label: "DSGVO", done: status.dsgvoSigned },
    {
      key: "confidentiality",
      label: "Schweigepflicht",
      done: status.confidentialityReleaseSigned,
    },
    { key: "identity", label: "ID verified", done: status.identityVerified },
    {
      key: "document-pack",
      label: "Document pack",
      done: status.documentPackComplete,
    },
    {
      key: "compliance",
      label: "Compliance complete",
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
  const completion = getPatientLegalStatusCompletion(status);
  if (status.complianceCompleted) {
    return "Compliance complete";
  }
  if (completion.completed === 0) {
    return "Compliance not started";
  }
  return `${completion.completed}/${completion.total} compliance checks completed`;
}
