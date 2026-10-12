import { formatAppDate } from "@/lib/app-time-zone";
import {
  formatEnumLabelFromKeys,
  getLang,
  t as translateCatalog,
  uiText,
  type Lang,
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

function legalStatusTranslations(lang?: Lang) {
  return translateCatalog(lang ?? getLang());
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

/**
 * The checklist items staff save on the card. DSGVO consent and the
 * confidentiality release are left out: they follow signed documents only —
 * the scan of the paper copy or a QES (owner decision 2026-10-12) — and the
 * server refuses a changed value (`legal_status_requires_signed_document`).
 */
export function serializePatientLegalStatus(status: PatientLegalStatus) {
  return {
    identity_verified: status.identityVerified,
    document_pack_complete: status.documentPackComplete,
    compliance_completed: status.complianceCompleted,
    contract_status: status.contractStatus,
    notes: status.notes.trim() || null,
  };
}

/**
 * `lang` is the UI language of a React caller: the labels follow a language
 * switch instead of staying in the language of the first render (QA B-22).
 */
export function getPatientLegalStatusChecklist(status: PatientLegalStatus, lang?: Lang) {
  const translations = legalStatusTranslations(lang);
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

export function isPatientLegalStatusComplete(status: PatientLegalStatus) {
  const completion = getPatientLegalStatusCompletion(status);
  return completion.total > 0 && completion.completed === completion.total;
}

/** The checklist items that follow signed documents only (owner decision 2026-10-12). */
export const DOCUMENT_BOUND_LEGAL_STATUS_ITEMS = [
  { checklistKey: "dsgvo", kind: "dsgvo", templateId: "privacy_consents" },
  { checklistKey: "confidentiality", kind: "confidentiality_release", templateId: "confidentiality_release" },
] as const;

export type DocumentBoundLegalStatusKind = (typeof DOCUMENT_BOUND_LEGAL_STATUS_ITEMS)[number]["kind"];

/**
 * `signed`: set by a current signed document; `manual`: set without one
 * (ticked by hand before 2026-10-12, or its signed document archived) — it
 * keeps counting for the gates and is flagged; `revoked`: unticked because
 * the patient revoked the consent in the register (`revokedAt`) — new orders
 * wait for a consent signed after it; `missing`: not set.
 */
export type LegalStatusEvidenceState = "signed" | "manual" | "revoked" | "missing";

const EVIDENCE_STATES: readonly LegalStatusEvidenceState[] = ["signed", "manual", "revoked", "missing"];

export type LegalStatusEvidenceItem = {
  state: LegalStatusEvidenceState;
  /** When the consent was revoked (state `revoked`). */
  revokedAt: string | null;
  signedDocument: {
    id: string;
    name: string;
    documentNumber: string | null;
    signedAt: string | null;
    /** `paper_signature`, `electronic_signature` or `signed_document` (an upload marked signed). */
    source: string;
  } | null;
  /** The newest document of the kind still to be signed: the target of "Подписано на бумаге". */
  pendingDocument: {
    id: string;
    name: string;
    documentNumber: string | null;
    /** In an open electronic signature request: no paper signature until it is withdrawn. */
    signaturePending: boolean;
  } | null;
  /** The template the card offers when the patient has no document of the kind yet. */
  templateId: string;
};

export type PatientLegalStatusEvidence = Record<DocumentBoundLegalStatusKind, LegalStatusEvidenceItem>;

function readNullableString(record: LegalStatusRecord | null, key: string) {
  const value = readString(record, key);
  return value || null;
}

/**
 * `legal_status_evidence` of the patient detail. An older server without it
 * yields `missing`/`signed` from the stored flag alone, without documents.
 */
export function normalizePatientLegalStatusEvidence(
  value: unknown,
  status: PatientLegalStatus,
): PatientLegalStatusEvidence {
  const record = asRecord(value);
  const result = {} as PatientLegalStatusEvidence;
  for (const item of DOCUMENT_BOUND_LEGAL_STATUS_ITEMS) {
    const entry = asRecord(record?.[item.kind]);
    const flag = item.kind === "dsgvo" ? status.dsgvoSigned : status.confidentialityReleaseSigned;
    const signed = asRecord(entry?.signed_document);
    const pending = asRecord(entry?.pending_document);
    const state = readString(entry, "state") as LegalStatusEvidenceState;
    result[item.kind] = {
      state: EVIDENCE_STATES.includes(state) ? state : flag ? "signed" : "missing",
      revokedAt: readNullableString(entry, "revoked_at"),
      signedDocument: signed && readString(signed, "id")
        ? {
            id: readString(signed, "id"),
            name: readString(signed, "name"),
            documentNumber: readNullableString(signed, "document_number"),
            signedAt: readNullableString(signed, "signed_at"),
            source: readString(signed, "source"),
          }
        : null,
      pendingDocument: pending && readString(pending, "id")
        ? {
            id: readString(pending, "id"),
            name: readString(pending, "name"),
            documentNumber: readNullableString(pending, "document_number"),
            signaturePending: readBool(pending, "signature_pending"),
          }
        : null,
      templateId: readString(entry, "template_id") || item.templateId,
    };
  }
  return result;
}

const SIGNATURE_SOURCE_KEYS: Record<string, string> = {
  paper_signature: "patient_legal_doc_source_paper_signature",
  electronic_signature: "patient_legal_doc_source_electronic_signature",
  signed_document: "patient_legal_doc_source_signed_document",
};

/**
 * The state line of a document-bound item: "Подписано 12.10.2026 · скан на
 * бумаге", "Отмечено вручную, подписанный документ отсутствует", "Согласие
 * отозвано 12.10.2026" or "Нет подписанного документа". Dates in DD.MM.YYYY,
 * Berlin day.
 */
export function legalStatusDocumentStateText(evidence: LegalStatusEvidenceItem, lang: Lang): string {
  const text = (key: string, values?: Record<string, string>) => uiText(key, lang, values);
  if (evidence.state === "manual") return text("patient_legal_doc_manual");
  if (evidence.state === "revoked") {
    const date = formatAppDate(evidence.revokedAt);
    return date ? text("patient_legal_doc_revoked_on", { date }) : text("patient_legal_doc_status_revoked");
  }
  if (evidence.state === "missing") return text("patient_legal_doc_missing");
  const date = formatAppDate(evidence.signedDocument?.signedAt);
  const signed = date
    ? text("patient_legal_doc_signed_on", { date })
    : text("patient_legal_doc_status_signed");
  const sourceKey = evidence.signedDocument ? SIGNATURE_SOURCE_KEYS[evidence.signedDocument.source] : undefined;
  return sourceKey ? `${signed} · ${text(sourceKey)}` : signed;
}

export function getPatientLegalStatusSummary(status: PatientLegalStatus) {
  const translations = legalStatusTranslations();
  const completion = getPatientLegalStatusCompletion(status);
  if (isPatientLegalStatusComplete(status)) {
    return translations.patient_legal_summary_complete;
  }
  if (completion.completed === 0) {
    return translations.patient_legal_summary_not_started;
  }
  return translations.patient_legal_summary_progress
    .replace("{completed}", String(completion.completed))
    .replace("{total}", String(completion.total));
}
