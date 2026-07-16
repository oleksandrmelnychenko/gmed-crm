import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Archive,
  Check,
  CircleAlert,
  Download,
  Eye,
  FileCheck2,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  UserRoundCheck,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { LANGUAGE_OPTIONS, languageLabel } from "@/components/ui/language-multi-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { selectClass, StatusBadge, textareaClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import type { LeadDetail } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  completeCaseIntake,
  createCase,
  fetchCaseDetail,
  fetchCases,
  saveCaseAllergien,
  saveCaseMedikamente,
  saveCaseOverview,
  saveCaseVorerkrankungen,
} from "@/pages/cases/data/case-api";
import {
  createContract,
  createQuote,
  fetchAgencyServices,
  fetchContracts,
  fetchQuotes,
  updateContractStatus,
  updateQuoteStatus,
} from "@/pages/contracts/data/contracts-api";
import type { AgencyServiceItem, ContractItem, QuoteItem } from "@/pages/contracts/model/types";
import {
  createDocumentPreviewObjectUrl,
  deleteStoredDocumentFile,
  downloadDocumentFile,
  fetchDocuments,
  generateDocument,
  markDocumentSigned,
  revokeDocumentPreviewObjectUrl,
  uploadDocument,
  type DocumentComplianceKind,
} from "@/pages/documents/data/document-api";
import type { DocumentItem } from "@/pages/documents/model/types";
import {
  createOrder,
  createOrderLeistung,
  fetchOrder,
  fetchOrders,
  updateOrderCommercialBasis,
} from "@/pages/orders/data/order-api";
import type { Leistung, OrderSummary } from "@/pages/orders/model/types";
import {
  fetchAllDoctors,
  type AllDoctorOption,
  type ClinicalDiagnosis,
  type ClinicalMedication,
  type ClinicalNarrative,
  type ClinicalWarning,
} from "@/pages/patients/data/patient-clinical";
import { fetchProviders, fetchSpecializations } from "@/pages/providers/data/provider-api";
import type { ProviderSummary, SpecializationItem } from "@/pages/providers/model/types";
import {
  LEAD_WIZARD_SERVICE_OPTIONS,
  leadIntakeTypeFromLead,
  leadErrorBlockingReasons,
  leadErrorMessage,
  knownLeadProgramServiceLabel,
  leadLocationDetailedLabel,
  leadLocationLabel,
  leadPreferredLocationLabel,
  leadProgramServiceLabel,
  leadSourceLabel,
  leadVisitTimingLabel,
  normalizeLeadServiceSelection,
  normalizeLeadServiceValue,
  updateLeadServiceSelection,
} from "@/pages/leads/model/leads-model";

import { LeadQuestionnaireFacts } from "./lead-questionnaire-facts";

import {
  createLead,
  fetchLeadDetail,
  importLeadAttachments,
  resolveFailedLead,
  updateLeadStatus,
  updateLeadWizard,
  wizardConvertLead,
} from "../data/leads-api";

type Tx = (ru: string, de: string) => string;
type StepId = "master_data" | "medical" | "service" | "documents" | "order" | "commercial" | "release";
type CaseListItem = { id: string };

type LeadWizardProps = {
  leadId: string | null;
  open: boolean;
  createMode?: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (leadId: string) => void;
  onConverted?: (patientId: string) => void;
  onArchived?: () => void;
  onShowDetails?: (leadId: string) => void;
  onOrderCreated?: (orderId: string) => void;
};

type TrustedContactDraft = {
  id: string;
  name: string;
  phone: string;
  email: string;
  relation: string;
  birthDate: string;
  address: string;
};

type Draft = {
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  birthDate: string;
  legalSex: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  language: string;
  whatsappNumber: string;
  hasInsurance: "" | "yes" | "no";
  insuranceCoversGermany: string;
  insuranceType: string;
  insuranceProvider: string;
  insuranceNumber: string;
  trustedContacts: TrustedContactDraft[];
  concern: string;
  anamnese: string;
  narrative: ClinicalNarrative | null;
  diagnoses: ClinicalDiagnosis[];
  medications: ClinicalMedication[];
  allergies: ClinicalWarning[];
  caves: ClinicalWarning[];
  serviceNeeds: string[];
  serviceComments: Record<string, string>;
  discoverySource: string;
  referrer: string;
  serviceNotes: string;
  specialties: string[];
  programDateFrom: string;
  programDateTo: string;
  privacyConsent: boolean;
  healthcareConsent: boolean;
};

type ServiceLine = {
  id: string;
  agencyServiceId: string | null;
  clientReference: string | null;
  description: string;
  quantity: string;
  price: string;
  vat: string;
};

type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";
type WizardDocumentKind = "identity" | "confidentiality_release" | "privacy_consents";
type CommercialDocumentKind = "framework_contract" | "single_order" | "cost_estimate";

type AutosaveSnapshot = {
  draft: Draft;
  lines: ServiceLine[];
  paidAmount: string;
  prepayment: boolean;
  step: StepId;
};

type StoredCommercialDraft = {
  lines: ServiceLine[];
  paidAmount: string;
  prepayment: boolean;
};

type CommercialFlagsPatch = {
  signed_patient?: boolean;
  signed_agency?: boolean;
  prepayment_required?: boolean;
};

type CommercialFlagKey = keyof CommercialFlagsPatch;

type MasterFieldKey =
  | "firstName"
  | "lastName"
  | "birthDate"
  | "legalSex"
  | "email"
  | "phone"
  | "street"
  | "city"
  | "zip"
  | "insuranceType"
  | "insuranceProvider"
  | "insuranceNumber";

type MasterValidationErrors = Partial<Record<MasterFieldKey, string>>;

type ValidationIssue = {
  key: string;
  step: StepId;
  message: string;
  fieldId?: string;
};

type ValidationContext =
  | { kind: "master" }
  | { kind: "medical" }
  | { kind: "documents" }
  | { kind: "order" }
  | { kind: "server"; reasons: string[] };

type WizardDocumentPreview = {
  contentType: string;
  id: string;
  kind: "image" | "pdf";
  title: string;
  url: string;
};

const AUTOSAVE_DELAY_MS = 800;
const MAX_DOCUMENT_FILE_SIZE = 25 * 1024 * 1024;
const LeadMedicalIntakeForm = lazy(() =>
  import("./lead-medical-intake-form").then((module) => ({
    default: module.LeadMedicalIntakeForm,
  })),
);
const SERVICE_CONCERN_ID = "lead-wizard-concern";
const SERVICE_SPECIALTIES_ID = "lead-wizard-specialties";
const MEDICAL_ANAMNESE_ID = "lead-wizard-anamnese";
const ORDER_DATE_FROM_ID = "lead-wizard-program-date-from";
const ORDER_DATE_TO_ID = "lead-wizard-program-date-to";
const PRIVACY_CONSENT_ID = "lead-wizard-privacy-consent";
const HEALTHCARE_CONSENT_ID = "lead-wizard-healthcare-consent";
const CONFIDENTIALITY_RELEASE_ID = "lead-wizard-confidentiality-release";
const PRIVACY_DOCUMENT_ID = "lead-wizard-privacy-document";
const FRAMEWORK_DOCUMENT_ID = "lead-wizard-framework-document";
const ORDER_DOCUMENT_ID = "lead-wizard-order-document";
const COST_ESTIMATE_DOCUMENT_ID = "lead-wizard-cost-estimate-document";

const DISCOVERY_SOURCE_OPTIONS = [
  { value: "customer_referral", ru: "Рекомендация клиента", de: "Empfehlung eines Kunden" },
  { value: "online", ru: "Онлайн", de: "Online" },
  { value: "employee_referral", ru: "Рекомендация сотрудника", de: "Empfehlung eines Mitarbeiters" },
  { value: "medical_referral", ru: "Рекомендация врача или клиники", de: "Empfehlung eines Arztes oder einer Klinik" },
  { value: "partner_referral", ru: "Партнёр или агентство", de: "Partner oder Agentur" },
  { value: "insurance_referral", ru: "Страховая компания", de: "Versicherung" },
  { value: "social_media", ru: "Социальные сети", de: "Soziale Medien" },
  { value: "advertising", ru: "Реклама", de: "Werbung" },
  { value: "event", ru: "Мероприятие", de: "Veranstaltung" },
  { value: "other", ru: "Другое", de: "Sonstiges" },
] as const;

const MASTER_FIELD_ORDER: MasterFieldKey[] = [
  "firstName",
  "lastName",
  "birthDate",
  "legalSex",
  "email",
  "phone",
  "street",
  "city",
  "zip",
  "insuranceType",
  "insuranceProvider",
  "insuranceNumber",
];

const MASTER_FIELD_IDS: Record<MasterFieldKey, string> = {
  firstName: "lead-wizard-first-name",
  lastName: "lead-wizard-last-name",
  birthDate: "lead-wizard-birth-date",
  legalSex: "lead-wizard-legal-sex",
  email: "lead-wizard-email",
  phone: "lead-wizard-phone",
  street: "lead-wizard-street",
  city: "lead-wizard-city",
  zip: "lead-wizard-zip",
  insuranceType: "lead-wizard-insurance-type",
  insuranceProvider: "lead-wizard-insurance-provider",
  insuranceNumber: "lead-wizard-insurance-number",
};

const STEPS: Array<{ id: StepId; ru: string; de: string }> = [
  { id: "master_data", ru: "Данные клиента", de: "Personendaten" },
  { id: "medical", ru: "Медицинская характеристика", de: "Medizinische Merkmale" },
  { id: "service", ru: "Сервисная история", de: "Servicehistorie" },
  { id: "documents", ru: "Документы", de: "Unterlagen" },
  { id: "order", ru: "Оформление заказа", de: "Auftragserfassung" },
  { id: "commercial", ru: "Договор и смета", de: "Vertrag & Angebot" },
  { id: "release", ru: "Создание пациента", de: "Freigabe" },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function inputString(value: unknown, fallback = "") {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function germanDocumentDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value.trim();
}

function questionnairePayload(lead: LeadDetail) {
  const raw = asRecord(lead.raw_payload);
  return asRecord(raw?.["payload"]);
}

function questionnaireText(lead: LeadDetail, ...keys: string[]) {
  const payload = questionnairePayload(lead);
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function emptyTrustedContact(): TrustedContactDraft {
  return {
    id: crypto.randomUUID(),
    name: "",
    phone: "",
    email: "",
    relation: "",
    birthDate: "",
    address: "",
  };
}

function trustedContactsFromLead(lead: LeadDetail): TrustedContactDraft[] {
  const storedContacts = Array.isArray(lead.trusted_contacts)
    ? lead.trusted_contacts.flatMap((contact) => {
        const name = contact.name?.trim();
        if (!name) return [];
        return [{
          id: contact.id || crypto.randomUUID(),
          name,
          phone: contact.phone ?? "",
          email: contact.email ?? "",
          relation: contact.relation ?? "",
          birthDate: contact.birth_date ?? "",
          address: contact.address ?? "",
        }];
      })
    : [];
  if (storedContacts.length > 0) return storedContacts;

  const legacyName = lead.trusted_contact_name
    ?? questionnaireText(lead, "emergencyContactName", "trustedContactName");
  if (!legacyName.trim()) return [];
  return [{
    id: crypto.randomUUID(),
    name: legacyName.trim(),
    phone: lead.trusted_contact_phone
      ?? questionnaireText(lead, "emergencyContactPhone", "trustedContactPhone"),
    email: lead.trusted_contact_email
      ?? questionnaireText(lead, "emergencyContactEmail", "trustedContactEmail"),
    relation: lead.trusted_contact_relation
      ?? questionnaireText(lead, "emergencyContactRelation", "trustedContactRelation"),
    birthDate: lead.trusted_contact_birth_date ?? "",
    address: lead.trusted_contact_address
      ?? questionnaireText(lead, "emergencyContactAddress", "trustedContactAddress"),
  }];
}

function storedCommercialDraftFromLead(lead: LeadDetail): StoredCommercialDraft | null {
  const stored = asRecord(lead.wizard_state?.["commercial_draft"]);
  if (!stored) return null;

  const lines = Array.isArray(stored.lines)
    ? stored.lines.flatMap((value, index) => {
        const line = asRecord(value);
        if (!line) return [];
        return [{
          id: inputString(line.id, `stored-line-${index + 1}`),
          agencyServiceId:
            typeof line.agency_service_id === "string" ? line.agency_service_id : null,
          clientReference:
            typeof line.client_reference === "string" ? line.client_reference : null,
          description: inputString(line.description),
          quantity: inputString(line.quantity, "1"),
          price: inputString(line.price),
          vat: inputString(line.vat, "19"),
        }];
      })
    : [];

  return {
    lines,
    paidAmount: inputString(stored.paid_amount),
    prepayment: stored.prepayment === true,
  };
}

function autosaveSnapshotSignature(snapshot: AutosaveSnapshot) {
  return JSON.stringify(snapshot);
}

function autosavePayload(
  snapshot: AutosaveSnapshot,
  previousWizardState: Record<string, unknown>,
) {
  const { draft, lines, paidAmount, prepayment, step } = snapshot;
  const payload: Record<string, unknown> & { wizard_state: Record<string, unknown> } = {
    date_of_birth: draft.birthDate || undefined,
    legal_sex: draft.legalSex || undefined,
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    middle_name: draft.middleName.trim(),
    suffix: draft.suffix.trim(),
    whatsapp_number: draft.whatsappNumber.trim(),
    has_insurance: draft.hasInsurance ? draft.hasInsurance === "yes" : undefined,
    insurance_covers_germany: draft.insuranceCoversGermany || undefined,
    insurance_type: draft.insuranceType || undefined,
    insurance_provider: draft.insuranceProvider.trim(),
    insurance_number: draft.insuranceNumber.trim(),
    trusted_contacts: draft.trustedContacts.map((contact) => ({
      id: contact.id,
      name: contact.name.trim(),
      phone: contact.phone.trim() || null,
      email: contact.email.trim() || null,
      relation: contact.relation.trim() || null,
      birth_date: contact.birthDate || null,
      address: contact.address.trim() || null,
    })),
    street_address: draft.street.trim(),
    city: draft.city.trim(),
    state: draft.state.trim(),
    zip_code: draft.zip.trim(),
    country: draft.country.trim(),
    primary_language: draft.language.trim(),
    primary_concern_text: draft.concern.trim(),
    additional_concerns: draft.anamnese.trim(),
    services: draft.serviceNeeds,
    needs_interpreter: draft.serviceNeeds.includes("interpreter_support"),
    notes: draft.serviceNotes.trim(),
    requested_specialties: draft.specialties,
    consent_privacy_practices: draft.privacyConsent,
    consent_healthcare: draft.healthcareConsent,
    wizard_state: {
      ...previousWizardState,
      step,
      onboarding_version: 3,
      discovery_source: draft.discoverySource,
      referrer: draft.referrer,
      program_date_from: draft.programDateFrom,
      program_date_to: draft.programDateTo,
      service_comments: draft.serviceNeeds.reduce<Record<string, string>>((comments, value) => {
        const comment = draft.serviceComments[value];
        if (comment?.trim()) comments[value] = comment;
        return comments;
      }, {}),
      clinical_draft: {
        narrative: draft.narrative,
        diagnoses: draft.diagnoses,
        medications: draft.medications,
        allergies: draft.allergies,
        caves: draft.caves,
      },
      commercial_draft: {
        lines: lines.map((line) => ({
          id: line.id,
          agency_service_id: line.agencyServiceId,
          client_reference: line.clientReference,
          description: line.description,
          quantity: line.quantity,
          price: line.price,
          vat: line.vat,
        })),
        paid_amount: paidAmount,
        prepayment,
      },
    },
  };

  if (draft.firstName.trim()) payload.first_name = draft.firstName.trim();
  if (draft.lastName.trim()) payload.last_name = draft.lastName.trim();

  return payload;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function nullableString(record: Record<string, unknown>, ...keys: string[]) {
  return firstString(record, ...keys).trim() || null;
}

function firstBoolean(record: Record<string, unknown>, ...keys: string[]) {
  return keys.some((key) => record[key] === true);
}

function serviceCommentsFromLead(lead: LeadDetail) {
  const stored = recordFromUnknown(lead.wizard_state?.["service_comments"]);
  return Object.entries(stored).reduce<Record<string, string>>((comments, [value, comment]) => {
    if (typeof comment !== "string" || !value.trim()) return comments;
    comments[normalizeLeadServiceValue(value)] = comment;
    return comments;
  }, {});
}

function normalizedLanguageCode(value: string | null | undefined) {
  const key = value?.trim().toLowerCase().replaceAll("_", "-");
  if (!key) return "";
  const aliases: Record<string, string> = {
    deutsch: "de",
    german: "de",
    englisch: "en",
    english: "en",
    russisch: "ru",
    russian: "ru",
    "русский": "ru",
    ukrainisch: "uk",
    ukrainian: "uk",
    "українська": "uk",
    arabisch: "ar",
    arabic: "ar",
    portugiesisch: "pt",
    portuguese: "pt",
    "französisch": "fr",
    french: "fr",
    spanisch: "es",
    spanish: "es",
    italienisch: "it",
    italian: "it",
    "türkisch": "tr",
    turkish: "tr",
    polnisch: "pl",
    polish: "pl",
    tschechisch: "cs",
    czech: "cs",
    "dänisch": "da",
    danish: "da",
    griechisch: "el",
    greek: "el",
    lettisch: "lv",
    latvian: "lv",
    chinesisch: "zh",
    chinese: "zh",
    persisch: "fa",
    persian: "fa",
    farsi: "fa",
    urdu: "ur",
  };
  const normalized = aliases[key] ?? key.split("-")[0] ?? "";
  return LANGUAGE_OPTIONS.some((option) => option.value === normalized) ? normalized : "";
}

function clinicalRowsFromLead(lead: LeadDetail) {
  const clinical = recordFromUnknown(lead.wizard_state?.["clinical_draft"]);
  const rows = <T,>(key: string, map: (row: Record<string, unknown>, index: number) => T) => (
    Array.isArray(clinical[key])
      ? (clinical[key] as unknown[]).map((item, index) => map(recordFromUnknown(item), index))
      : []
  );
  const narrativeRow = asRecord(clinical["narrative"]);
  const fallbackAnamnese = lead.additional_concerns?.trim() || null;
  const narrative: ClinicalNarrative | null = narrativeRow || fallbackAnamnese
    ? {
        id: narrativeRow && typeof narrativeRow.id === "string" ? narrativeRow.id : null,
        anamnese_aktuelle: narrativeRow
          ? nullableString(narrativeRow, "anamnese_aktuelle") ?? fallbackAnamnese
          : fallbackAnamnese,
        anamnese_vorgeschichte: narrativeRow
          ? nullableString(narrativeRow, "anamnese_vorgeschichte")
          : null,
        anamnese_vegetative: narrativeRow
          ? nullableString(narrativeRow, "anamnese_vegetative")
          : null,
        anamnese_sozial: narrativeRow
          ? nullableString(narrativeRow, "anamnese_sozial")
          : null,
        beurteilung: narrativeRow ? nullableString(narrativeRow, "beurteilung") : null,
        is_active: narrativeRow?.is_active !== false,
        created_at: narrativeRow ? nullableString(narrativeRow, "created_at") : null,
        updated_at: narrativeRow ? nullableString(narrativeRow, "updated_at") : null,
      }
    : null;

  return {
    narrative,
    diagnoses: rows("diagnoses", (row, index): ClinicalDiagnosis => {
      const kindValue = firstString(row, "kind");
      const certaintyValue = firstString(row, "certainty");
      const chronificationValue = firstString(row, "chronifizierung", "chronification");
      const statusValue = firstString(row, "status");
      const sourceMode = firstString(row, "source_mode", "sourceMode");
      return {
        id: null,
        cid: firstString(row, "cid", "id") || `lead-diagnosis-${index + 1}`,
        parent_cid: nullableString(row, "parent_cid", "parentCid", "parent_id"),
        parent_id: null,
        kind: ["main", "secondary", "prozedur"].includes(kindValue)
          ? kindValue as ClinicalDiagnosis["kind"]
          : index === 0 ? "main" : "secondary",
        label: firstString(row, "label"),
        certainty: ["verdacht", "bestaetigt", "zustand_nach"].includes(certaintyValue)
          ? certaintyValue as ClinicalDiagnosis["certainty"]
          : "bestaetigt",
        chronifizierung: ["akut", "chronisch", "rezidivierend"].includes(chronificationValue)
          ? chronificationValue as ClinicalDiagnosis["chronifizierung"]
          : null,
        icd_code: nullableString(row, "icd_code", "icdCode"),
        ops_code: nullableString(row, "ops_code", "opsCode"),
        diagnosed_on: nullableString(row, "diagnosed_on", "diagnosedOn"),
        note: nullableString(row, "note"),
        source_mode: sourceMode === "extern" ? "extern" : "intern",
        provider_id: nullableString(row, "provider_id", "providerId"),
        provider_name: nullableString(row, "provider_name", "providerName"),
        doctor_id: nullableString(row, "doctor_id", "doctorId"),
        doctor_name: nullableString(row, "doctor_name", "doctorName"),
        doctor_title: nullableString(row, "doctor_title", "doctorTitle"),
        doctor_fachbereich: nullableString(row, "doctor_fachbereich", "doctorFachbereich"),
        external_clinic: nullableString(row, "external_clinic", "externalClinic"),
        external_doctor: nullableString(row, "external_doctor", "externalDoctor"),
        external_country: nullableString(row, "external_country", "externalCountry"),
        treating_doctor_id: nullableString(row, "treating_doctor_id", "treatingDoctorId"),
        treating_doctor_name: nullableString(row, "treating_doctor_name", "treatingDoctorName"),
        treating_doctor_title: nullableString(row, "treating_doctor_title", "treatingDoctorTitle"),
        treating_none: firstBoolean(row, "treating_none", "treatingNone"),
        status: ["active", "chronic", "resolved"].includes(statusValue)
          ? statusValue as ClinicalDiagnosis["status"]
          : chronificationValue === "chronisch" ? "chronic" : "active",
      };
    }),
    medications: rows("medications", (row, index): ClinicalMedication => {
      const categoryValue = firstString(row, "category");
      const statusValue = firstString(row, "status");
      const legacyStrength = [firstString(row, "dose"), firstString(row, "doseUnit")]
        .filter(Boolean)
        .join(" ");
      return {
        id: firstString(row, "id") || `lead-medication-${index + 1}`,
        provider_id: nullableString(row, "provider_id", "providerId"),
        provider_name: nullableString(row, "provider_name", "providerName"),
        doctor_id: nullableString(row, "doctor_id", "doctorId", "prescriberId"),
        doctor_name: nullableString(row, "doctor_name", "doctorName", "prescriber"),
        doctor_title: nullableString(row, "doctor_title", "doctorTitle"),
        doctor_fachbereich: nullableString(row, "doctor_fachbereich", "doctorFachbereich"),
        category: ["dauer", "besondere", "selbst"].includes(categoryValue)
          ? categoryValue as ClinicalMedication["category"]
          : firstString(row, "medicationType") === "permanent" ? "dauer" : "besondere",
        wirkstoff:
          nullableString(row, "wirkstoff", "activeIngredient") ??
          nullableString(row, "handelsname", "name"),
        handelsname: firstString(row, "handelsname", "name"),
        staerke: (nullableString(row, "staerke") ?? legacyStrength) || null,
        form: nullableString(row, "form"),
        einnahmeform: nullableString(row, "einnahmeform", "route"),
        dose_morgens: nullableString(row, "dose_morgens", "doseMorning"),
        dose_mittags: nullableString(row, "dose_mittags", "doseNoon"),
        dose_abends: nullableString(row, "dose_abends", "doseEvening"),
        dose_nachts: nullableString(row, "dose_nachts", "doseNight"),
        einheit: nullableString(row, "einheit", "unit"),
        hinweis: nullableString(row, "hinweis", "schedule", "note"),
        grund: nullableString(row, "grund", "reason"),
        verordnet_am: nullableString(row, "verordnet_am", "prescribedOn"),
        einnahme_von: nullableString(row, "einnahme_von", "since"),
        einnahme_bis: nullableString(row, "einnahme_bis", "expiryDate"),
        status: ["aktiv", "pausiert", "abgesetzt", "geplant"].includes(statusValue)
          ? statusValue as ClinicalMedication["status"]
          : "aktiv",
        apothekenpflichtig: firstBoolean(row, "apothekenpflichtig", "pharmacyOnly"),
        rezeptpflichtig: firstBoolean(row, "rezeptpflichtig", "prescriptionOnly"),
        btm: firstBoolean(row, "btm"),
        aut_idem_sperre: firstBoolean(row, "aut_idem_sperre", "autIdemBlocked"),
        abgabebeschraenkung: firstBoolean(row, "abgabebeschraenkung", "dispensingRestricted"),
        sonstige_vermerke: nullableString(row, "sonstige_vermerke", "otherNotes"),
        on_hold: firstBoolean(row, "on_hold", "onHold"),
        hold_until: nullableString(row, "hold_until", "holdUntil"),
        hold_note: nullableString(row, "hold_note", "holdNote"),
      };
    }),
    allergies: rows("allergies", (row, index): ClinicalWarning => ({
      id: firstString(row, "id") || `lead-allergy-${index + 1}`,
      kind: "allergie",
      label: firstString(row, "label"),
      reaction: nullableString(row, "reaction"),
      severity: nullableString(row, "severity"),
      note: nullableString(row, "note"),
    })),
    caves: rows("caves", (row, index): ClinicalWarning => ({
      id: firstString(row, "id") || `lead-cave-${index + 1}`,
      kind: "cave",
      label: firstString(row, "label"),
      reaction: null,
      severity: null,
      note: nullableString(row, "note"),
    })),
  };
}

function hasStoredClinicalDraft(lead: LeadDetail) {
  const clinical = asRecord(lead.wizard_state?.["clinical_draft"]);
  return Boolean(
    clinical
    && (
      asRecord(clinical["narrative"])
      || ["diagnoses", "medications", "allergies", "caves"]
        .some((key) => Array.isArray(clinical[key]))
    ),
  );
}

function draftFromLead(lead: LeadDetail): Draft {
  const clinical = clinicalRowsFromLead(lead);
  return {
    firstName: lead.first_name ?? "",
    middleName: lead.middle_name ?? "",
    lastName: lead.last_name ?? "",
    suffix: lead.suffix ?? "",
    birthDate: lead.date_of_birth ?? "",
    legalSex: lead.legal_sex ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    street: lead.street_address ?? "",
    city: lead.city ?? "",
    state: lead.state ?? "",
    zip: lead.zip_code ?? "",
    country: lead.country ?? "",
    language: normalizedLanguageCode(lead.primary_language) || normalizedLanguageCode(lead.locale),
    whatsappNumber: lead.whatsapp_number ?? "",
    hasInsurance: lead.has_insurance == null ? "" : lead.has_insurance ? "yes" : "no",
    insuranceCoversGermany: lead.insurance_covers_germany ?? "",
    insuranceType: lead.insurance_type ?? "",
    insuranceProvider: lead.insurance_provider ?? "",
    insuranceNumber: lead.insurance_number ?? "",
    trustedContacts: trustedContactsFromLead(lead),
    concern: lead.primary_concern_text ?? "",
    anamnese: clinical.narrative?.anamnese_aktuelle ?? lead.additional_concerns ?? "",
    narrative: clinical.narrative,
    diagnoses: clinical.diagnoses,
    medications: clinical.medications,
    allergies: clinical.allergies,
    caves: clinical.caves,
    serviceNeeds: normalizeLeadServiceSelection([
      ...(lead.services ?? []),
      ...(lead.needs_interpreter ? ["interpreter_support"] : []),
    ]),
    serviceComments: serviceCommentsFromLead(lead),
    discoverySource: inputString(lead.wizard_state?.["discovery_source"]) || questionnaireText(lead, "discoverySource", "howDidYouHearAboutUs", "referralSource"),
    referrer: inputString(lead.wizard_state?.["referrer"]),
    serviceNotes: lead.notes ?? "",
    specialties: lead.requested_specialties ?? [],
    programDateFrom: inputString(lead.wizard_state?.["program_date_from"]),
    programDateTo: inputString(lead.wizard_state?.["program_date_to"]),
    privacyConsent: lead.consent_privacy_practices,
    healthcareConsent: lead.consent_healthcare,
  };
}

function blankDraft(): Draft {
  return {
    firstName: "",
    middleName: "",
    lastName: "",
    suffix: "",
    birthDate: "",
    legalSex: "",
    email: "",
    phone: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    country: "",
    language: "",
    whatsappNumber: "",
    hasInsurance: "",
    insuranceCoversGermany: "",
    insuranceType: "",
    insuranceProvider: "",
    insuranceNumber: "",
    trustedContacts: [],
    concern: "",
    anamnese: "",
    narrative: null,
    diagnoses: [],
    medications: [],
    allergies: [],
    caves: [],
    serviceNeeds: [],
    serviceComments: {},
    discoverySource: "",
    referrer: "",
    serviceNotes: "",
    specialties: [],
    programDateFrom: "",
    programDateTo: "",
    privacyConsent: false,
    healthcareConsent: false,
  };
}

function intakeTypeLabel(lead: LeadDetail, tx: Tx) {
  switch (leadIntakeTypeFromLead(lead)) {
    case "questionnaire":
      return tx("Опросник", "Fragebogen");
    case "form":
      return tx("Форма", "Formular");
    default:
      return tx("Внутреннее обращение", "Interne Anfrage");
  }
}

function intakeTypeTone(lead: LeadDetail) {
  switch (leadIntakeTypeFromLead(lead)) {
    case "questionnaire":
      return "brand" as const;
    case "form":
      return "warning" as const;
    default:
      return "info" as const;
  }
}

function intakeFlowLabel(value: string | null | undefined, tx: Tx) {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, [string, string]> = {
    medical: ["Медицинский", "Medizinisch"],
    contact: ["Контактная форма", "Kontaktformular"],
    standard: ["Стандартный", "Standard"],
  };
  const label = normalized ? labels[normalized] : null;
  return label ? tx(label[0], label[1]) : value || tx("Не указано", "Nicht angegeben");
}

function yesNoValue(value: boolean | null, tx: Tx) {
  if (value == null) return tx("Не указано", "Nicht angegeben");
  return value ? tx("Да", "Ja") : tx("Нет", "Nein");
}

function phoneTypeLabel(value: string | null | undefined, tx: Tx) {
  const labels: Record<string, [string, string]> = {
    mobile: ["Мобильный", "Mobil"],
    home: ["Домашний", "Privat"],
    private: ["Личный", "Privat"],
    work: ["Рабочий", "Geschäftlich"],
    other: ["Другой", "Sonstige"],
  };
  const normalized = value?.trim().toLowerCase();
  const label = normalized ? labels[normalized] : null;
  return label ? tx(label[0], label[1]) : value || tx("Не указано", "Nicht angegeben");
}

function serviceNeedLabel(value: string, tx: Tx) {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, [string, string]> = {
    medical: ["Медицинское сопровождение", "Medizinische Betreuung"],
    medical_support: ["Медицинское сопровождение", "Medizinische Betreuung"],
    treatment: ["Организация лечения", "Behandlungsorganisation"],
    driver: ["Водитель", "Fahrer"],
    chauffeur: ["Водитель", "Fahrer"],
    transfer: ["Трансфер", "Transfer"],
    airport_transfer: ["Трансфер из аэропорта", "Flughafentransfer"],
    concierge: ["Консьерж", "Concierge"],
    concierge_support: ["Консьерж", "Concierge"],
    interpreter: ["Переводчик", "Dolmetscher"],
  };
  const label = labels[normalized];
  return label ? tx(label[0], label[1]) : value;
}

function newLine(index = 1): ServiceLine {
  return {
    id: "line-" + Date.now().toString(36) + "-" + index,
    agencyServiceId: null,
    clientReference: null,
    description: "",
    quantity: "1",
    price: "",
    vat: "19",
  };
}

function money(value: string): number {
  const parsed = Number(value.replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

const MONEY_FORMATTERS = {
  de: new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }),
  ru: new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }),
};

function formatMoneyValue(value: number, lang: string) {
  return (lang === "de" ? MONEY_FORMATTERS.de : MONEY_FORMATTERS.ru).format(value);
}

function validLine(line: ServiceLine): boolean {
  return line.description.trim().length > 0 && money(line.quantity) > 0 && money(line.price) >= 0 && money(line.vat) >= 0 && money(line.vat) <= 100;
}

function lineFromOrderLeistung(item: Leistung): ServiceLine {
  return {
    id: item.id,
    agencyServiceId: item.agency_service_id ?? null,
    clientReference: item.client_reference ?? null,
    description: item.description,
    quantity: String(item.quantity ?? "1"),
    price: String(item.unit_price ?? ""),
    vat: String(item.vat_rate ?? "19"),
  };
}

function wizardDocumentKind(item: DocumentItem): WizardDocumentKind | null {
  const complianceKind = item.compliance_kind?.trim().toLowerCase();
  if (complianceKind === "identity" || complianceKind === "confidentiality_release") {
    return complianceKind;
  }
  if (complianceKind === "dsgvo") return "privacy_consents";

  if (item.generated_template_id === "confidentiality_release") return "confidentiality_release";
  if (
    item.generated_template_id === "privacy_consents"
    || item.generated_template_id === "consent_data_release_child"
    || item.generated_template_id === "consent_data_release_single"
  ) {
    return "privacy_consents";
  }

  const classification = [item.art, item.category, item.auto_name, item.original_filename]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (classification.includes("identity") || classification.includes("passport") || classification.includes("ausweis")) {
    return "identity";
  }
  if (classification.includes("schweigepflicht")) {
    return "confidentiality_release";
  }
  if (classification.includes("dsgvo") || classification.includes("datenschutz") || classification.includes("einwilligung")) {
    return "privacy_consents";
  }
  return null;
}

function formatFileSize(size: number | null, lang: string) {
  if (!size || size <= 0) return "";
  const formatter = new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
    maximumFractionDigits: size >= 1024 * 1024 ? 1 : 0,
  });
  if (size >= 1024 * 1024) return `${formatter.format(size / (1024 * 1024))} MB`;
  return `${formatter.format(size / 1024)} KB`;
}

function wizardDocumentFilename(document: DocumentItem) {
  return document.original_filename || document.auto_name || "document";
}

function wizardDocumentPreviewKind(document: DocumentItem): "image" | "pdf" | null {
  const mimeType = document.mime_type?.trim().toLowerCase() ?? "";
  const filename = wizardDocumentFilename(document).toLowerCase();
  if (mimeType.startsWith("image/") || /\.(?:avif|bmp|gif|jpe?g|png|webp)$/.test(filename)) {
    return "image";
  }
  if (mimeType === "application/pdf" || filename.endsWith(".pdf")) return "pdf";
  return null;
}

function errorText(error: unknown, tx: Tx): string {
  return leadErrorMessage(error, tx);
}

function readinessStepLabel(key: string, tx: Tx) {
  const labels: Record<string, string> = {
    master_data: tx("Данные клиента", "Personendaten"),
    medical: tx("Медицинская характеристика", "Medizinische Merkmale"),
    service: tx("Сервисная история", "Servicehistorie"),
    need: tx("Сервисная история", "Servicehistorie"),
    documents: tx("Документы", "Unterlagen"),
    order: tx("Оформление заказа", "Auftragserfassung"),
    commercial: tx("Договор, заказ и смета", "Vertrag, Auftrag und Kostenvoranschlag"),
    release: tx("Готовность к созданию пациента", "Bereit zur Patientenanlage"),
  };
  return labels[key] ?? tx("Проверка данных", "Datenprüfung");
}

function readinessReasonLabel(reason: string, tx: Tx) {
  const labels: Record<string, string> = {
    "Lead must be qualified before conversion": tx("Подтвердите данные обращения", "Angaben zum Anliegen bestätigen"),
    "Compliance is not signed yet": tx("Подтвердите необходимые согласия", "Erforderliche Einwilligungen bestätigen"),
    "Birth date is missing": tx("Укажите дату рождения", "Geburtsdatum angeben"),
    "Legal sex is missing": tx("Укажите пол по документам", "Geschlecht laut Ausweisdokument angeben"),
    "Email or phone is required": tx("Укажите электронную почту или телефон", "E-Mail-Adresse oder Telefonnummer angeben"),
    "Privacy practices consent is missing": tx("Подтвердите ознакомление с политикой конфиденциальности", "Datenschutzhinweise bestätigen"),
    "Healthcare consent is missing": tx("Получите согласие на обработку медицинских данных", "Einwilligung zur Verarbeitung von Gesundheitsdaten einholen"),
    "Complete street, city and postal code": tx("Заполните улицу, город и почтовый индекс", "Straße, Ort und Postleitzahl vollständig angeben"),
    "Complete city and postal code": tx("Заполните город и почтовый индекс", "Ort und Postleitzahl vollständig angeben"),
    "Primary concern is missing": tx("Укажите причину обращения", "Anliegen angeben"),
    "Requested specialty is missing": tx("Выберите хотя бы одну специализацию", "Mindestens eine Fachrichtung auswählen"),
    "Identity document is not verified": tx("Подтвердите документ, удостоверяющий личность", "Ausweisdokument bestätigen"),
    "Signed DSGVO document is missing": tx("Создайте и подтвердите документ согласий", "Einwilligungsdokument erstellen und bestätigen"),
    "Signed confidentiality release is missing": tx("Создайте и подтвердите освобождение от медицинской тайны", "Schweigepflichtsentbindung erstellen und bestätigen"),
    "Anamnesis intake is incomplete": tx("Заполните и сохраните анамнез", "Anamnese ausfüllen und abschließen"),
    "Framework contract is not signed": tx("Подпишите рамочный договор", "Rahmenvertrag unterzeichnen"),
    "Framework contract document is missing": tx("Создайте документ рамочного договора", "Rahmenvertragsdokument erstellen"),
    "Onboarding order is missing": tx("Создайте заказ", "Auftrag erstellen"),
    "Order needs at least one valid service": tx("Добавьте в заказ хотя бы одну услугу", "Mindestens eine Leistung zum Auftrag hinzufügen"),
    "Order document is missing": tx("Создайте документ заказа", "Einzelauftrag erstellen"),
    "Customer order signature is missing": tx("Получите подпись клиента на заказе", "Unterschrift des Kunden für den Auftrag einholen"),
    "Agency order signature is missing": tx("Подтвердите заказ со стороны агентства", "Auftrag durch die Agentur bestätigen"),
    "Quote is not accepted": tx("Подтвердите смету", "Kostenvoranschlag annehmen"),
    "Cost estimate document is missing": tx("Создайте документ сметы", "Kostenvoranschlag als Dokument erstellen"),
    "Required prepayment is not complete": tx("Укажите полученную предоплату", "Erforderliche Vorauszahlung erfassen"),
    "Lead is already converted": tx("Пациент уже создан", "Patient wurde bereits angelegt"),
  };
  return labels[reason] ?? tx("Проверьте незавершённые данные", "Unvollständige Angaben prüfen");
}

function readinessReasonStep(reason: string): StepId {
  const steps: Record<string, StepId> = {
    "Lead must be qualified before conversion": "documents",
    "Compliance is not signed yet": "documents",
    "Birth date is missing": "master_data",
    "Legal sex is missing": "master_data",
    "Email or phone is required": "master_data",
    "Privacy practices consent is missing": "documents",
    "Healthcare consent is missing": "documents",
    "Complete street, city and postal code": "master_data",
    "Complete city and postal code": "master_data",
    "Primary concern is missing": "medical",
    "Requested specialty is missing": "order",
    "Identity document is not verified": "documents",
    "Signed DSGVO document is missing": "documents",
    "Signed confidentiality release is missing": "documents",
    "Anamnesis intake is incomplete": "medical",
    "Framework contract is not signed": "commercial",
    "Framework contract document is missing": "commercial",
    "Onboarding order is missing": "commercial",
    "Order needs at least one valid service": "commercial",
    "Order document is missing": "commercial",
    "Customer order signature is missing": "commercial",
    "Agency order signature is missing": "commercial",
    "Quote is not accepted": "commercial",
    "Cost estimate document is missing": "commercial",
    "Required prepayment is not complete": "commercial",
    "Lead is already converted": "release",
  };
  return steps[reason] ?? "release";
}

function readinessReasonFieldId(reason: string, draft: Draft | null) {
  const fields: Record<string, string> = {
    "Birth date is missing": MASTER_FIELD_IDS.birthDate,
    "Legal sex is missing": MASTER_FIELD_IDS.legalSex,
    "Email or phone is required": MASTER_FIELD_IDS.email,
    "Privacy practices consent is missing": PRIVACY_CONSENT_ID,
    "Healthcare consent is missing": HEALTHCARE_CONSENT_ID,
    "Primary concern is missing": SERVICE_CONCERN_ID,
    "Requested specialty is missing": SERVICE_SPECIALTIES_ID,
    "Identity document is not verified": "lead-file-identity",
    "Signed DSGVO document is missing": PRIVACY_DOCUMENT_ID,
    "Signed confidentiality release is missing": CONFIDENTIALITY_RELEASE_ID,
    "Anamnesis intake is incomplete": MEDICAL_ANAMNESE_ID,
    "Framework contract is not signed": FRAMEWORK_DOCUMENT_ID,
    "Framework contract document is missing": FRAMEWORK_DOCUMENT_ID,
    "Order document is missing": ORDER_DOCUMENT_ID,
    "Cost estimate document is missing": COST_ESTIMATE_DOCUMENT_ID,
  };
  if (reason === "Complete street, city and postal code" || reason === "Complete city and postal code") {
    if (!draft?.street.trim() && reason !== "Complete city and postal code") return MASTER_FIELD_IDS.street;
    if (!draft?.city.trim()) return MASTER_FIELD_IDS.city;
    return MASTER_FIELD_IDS.zip;
  }
  return fields[reason];
}

function masterValidationIssues(errors: MasterValidationErrors, tx: Tx): ValidationIssue[] {
  const labels: Record<MasterFieldKey, string> = {
    firstName: tx("Имя", "Vorname"),
    lastName: tx("Фамилия", "Nachname"),
    birthDate: tx("Дата рождения", "Geburtsdatum"),
    legalSex: tx("Пол по документам", "Geschlecht laut Ausweisdokument"),
    email: tx("Электронная почта", "E-Mail-Adresse"),
    phone: tx("Телефон", "Telefonnummer"),
    street: tx("Улица и дом", "Straße und Hausnummer"),
    city: tx("Город", "Ort"),
    zip: tx("Почтовый индекс", "Postleitzahl"),
    insuranceType: tx("Тип страхования", "Versicherungsart"),
    insuranceProvider: tx("Страховая компания", "Versicherer"),
    insuranceNumber: tx("Номер полиса", "Versicherungsnummer"),
  };
  const sharedContactError = errors.email && errors.email === errors.phone
    ? errors.email
    : null;

  return MASTER_FIELD_ORDER.flatMap((field) => {
    const message = errors[field];
    if (!message) return [];
    if (field === "phone" && sharedContactError) return [];
    if (field === "email" && sharedContactError) {
      return [{
        key: "primary-contact",
        step: "master_data" as const,
        message: sharedContactError,
        fieldId: MASTER_FIELD_IDS.email,
      }];
    }
    return [{
      key: field,
      step: "master_data" as const,
      message: `${labels[field]}: ${message}`,
      fieldId: MASTER_FIELD_IDS[field],
    }];
  });
}

function orderValidationIssues(draft: Draft | null, tx: Tx): ValidationIssue[] {
  if (!draft) return [];
  const issues: ValidationIssue[] = [];
  if (draft.specialties.length === 0) {
    issues.push({
      key: "specialties",
      step: "order",
      message: tx("Выберите хотя бы одну специализацию", "Mindestens eine Fachrichtung auswählen"),
      fieldId: SERVICE_SPECIALTIES_ID,
    });
  }
  if (!draft.programDateFrom && draft.programDateTo) {
    issues.push({
      key: "program-date-from",
      step: "order",
      message: tx("Укажите дату начала программы", "Startdatum des Programms angeben"),
      fieldId: ORDER_DATE_FROM_ID,
    });
  }
  if (draft.programDateFrom && !draft.programDateTo) {
    issues.push({
      key: "program-date-to",
      step: "order",
      message: tx("Укажите дату окончания программы", "Enddatum des Programms angeben"),
      fieldId: ORDER_DATE_TO_ID,
    });
  } else if (
    draft.programDateFrom
    && draft.programDateTo
    && draft.programDateTo < draft.programDateFrom
  ) {
    issues.push({
      key: "program-date-range",
      step: "order",
      message: tx(
        "Дата окончания не может быть раньше даты начала",
        "Das Enddatum darf nicht vor dem Startdatum liegen",
      ),
      fieldId: ORDER_DATE_TO_ID,
    });
  }
  return issues;
}

function documentsValidationIssues(
  draft: Draft | null,
  documents: Record<WizardDocumentKind, DocumentItem[]>,
  tx: Tx,
): ValidationIssue[] {
  if (!draft) return [];
  const issues: ValidationIssue[] = [];
  if (!draft.privacyConsent) {
    issues.push({
      key: "privacy-consent",
      step: "documents",
      message: readinessReasonLabel("Privacy practices consent is missing", tx),
      fieldId: PRIVACY_CONSENT_ID,
    });
  }
  if (!draft.healthcareConsent) {
    issues.push({
      key: "healthcare-consent",
      step: "documents",
      message: readinessReasonLabel("Healthcare consent is missing", tx),
      fieldId: HEALTHCARE_CONSENT_ID,
    });
  }
  if (!documents.confidentiality_release.some((document) => (
    document.signed_at && document.compliance_kind === "confidentiality_release"
  ))) {
    issues.push({
      key: "confidentiality-release",
      step: "documents",
      message: readinessReasonLabel("Signed confidentiality release is missing", tx),
      fieldId: CONFIDENTIALITY_RELEASE_ID,
    });
  }
  if (!documents.privacy_consents.some((document) => (
    document.signed_at && document.compliance_kind === "dsgvo"
  ))) {
    issues.push({
      key: "privacy-document",
      step: "documents",
      message: readinessReasonLabel("Signed DSGVO document is missing", tx),
      fieldId: PRIVACY_DOCUMENT_ID,
    });
  }
  if (!documents.identity.some((document) => (
    document.signed_at && document.compliance_kind === "identity"
  ))) {
    issues.push({
      key: "identity-document",
      step: "documents",
      message: readinessReasonLabel("Identity document is not verified", tx),
      fieldId: "lead-file-identity",
    });
  }
  return issues;
}

function validateMasterDraft(draft: Draft | null, tx: Tx): MasterValidationErrors {
  if (!draft) return {};

  const errors: MasterValidationErrors = {};
  const required = tx("Обязательное поле", "Pflichtfeld");
  if (!draft.firstName.trim()) errors.firstName = required;
  if (!draft.lastName.trim()) errors.lastName = required;
  if (!draft.birthDate) {
    errors.birthDate = required;
  } else if (draft.birthDate > new Date().toISOString().slice(0, 10)) {
    errors.birthDate = tx(
      "Дата рождения не может быть в будущем",
      "Das Geburtsdatum darf nicht in der Zukunft liegen",
    );
  }
  if (!draft.legalSex) errors.legalSex = required;

  const email = draft.email.trim();
  const phone = draft.phone.trim();
  if (!email && !phone) {
    const contactRequired = tx(
      "Укажите электронную почту или телефон",
      "E-Mail oder Telefonnummer angeben",
    );
    errors.email = contactRequired;
    errors.phone = contactRequired;
  } else {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = tx(
        "Введите корректный адрес электронной почты",
        "Gültige E-Mail-Adresse eingeben",
      );
    }
    if (phone && phone.replace(/\D/g, "").length < 6) {
      errors.phone = tx(
        "Введите корректный номер телефона",
        "Gültige Telefonnummer eingeben",
      );
    }
  }

  if (draft.healthcareConsent) {
    if (!draft.street.trim()) errors.street = required;
    if (!draft.city.trim()) errors.city = required;
    if (!draft.zip.trim()) errors.zip = required;
  }
  if (draft.hasInsurance === "yes") {
    if (!draft.insuranceType) errors.insuranceType = required;
    if (!draft.insuranceProvider.trim()) errors.insuranceProvider = required;
    if (!draft.insuranceNumber.trim()) errors.insuranceNumber = required;
  }
  return errors;
}

function Field({
  label,
  children,
  className,
  error,
  errorId,
  required = false,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  error?: string;
  errorId?: string;
  required?: boolean;
}) {
  return (
    <label className={cn("min-w-0 space-y-1.5", className)}>
      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {required ? <span aria-hidden="true" className="ml-0.5 text-destructive">*</span> : null}
      </span>
      {children}
      {error ? (
        <span id={errorId} role="alert" className="block text-xs leading-4 text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function StateMark({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", done ? "text-emerald-700" : "text-muted-foreground")}>
      {done ? <Check className="size-3.5" /> : <span className="size-3.5 rounded-full border border-current" />}
      {label}
    </span>
  );
}

function ToggleRow({
  id,
  checked,
  label,
  onChange,
  disabled,
}: {
  id?: string;
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 border-b border-border/70 py-3 last:border-b-0">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-[var(--brand)]" />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}

function WizardDocumentRows({
  documents,
  complianceKind,
  emptyLabel,
  lang,
  busy,
  disabled,
  tx,
  onOpen,
  onDownload,
  onSign,
  onDelete,
}: {
  documents: DocumentItem[];
  complianceKind?: DocumentComplianceKind;
  emptyLabel: string;
  lang: string;
  busy: string | null;
  disabled: boolean;
  tx: Tx;
  onOpen: (document: DocumentItem) => void;
  onDownload: (document: DocumentItem) => void;
  onSign?: (document: DocumentItem, kind: DocumentComplianceKind) => void;
  onDelete: (document: DocumentItem) => void;
}) {
  if (documents.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {documents.map((document) => {
        const signed = Boolean(
          complianceKind
          && document.signed_at
          && document.compliance_kind === complianceKind,
        );
        const sizeLabel = formatFileSize(document.file_size, lang);
        return (
          <div key={document.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <button
                type="button"
                className="block max-w-full truncate text-left text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onOpen(document)}
              >
                {wizardDocumentFilename(document)}
              </button>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="font-mono tabular-nums">{document.document_number || `DOC-${document.id.slice(0, 8).toUpperCase()}`}</span>
                {sizeLabel ? <span className="font-mono tabular-nums">{sizeLabel}</span> : null}
                {complianceKind ? (
                  <StateMark
                    done={signed}
                    label={signed ? tx("Подписан", "Unterzeichnet") : tx("Ожидает подписи", "Unterschrift offen")}
                  />
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {wizardDocumentPreviewKind(document) ? (
                <Button type="button" variant="ghost" size="icon-sm" title={tx("Просмотреть", "Vorschau")} aria-label={tx("Просмотреть", "Vorschau")} disabled={disabled} onClick={() => onOpen(document)}>
                  {busy === `preview-${document.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="icon-sm" title={tx("Скачать", "Herunterladen")} aria-label={tx("Скачать", "Herunterladen")} disabled={disabled} onClick={() => onDownload(document)}>
                {busy === `download-${document.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              </Button>
              {complianceKind && onSign ? (
                <Button type="button" variant="ghost" size="icon-sm" title={tx("Подтвердить подпись", "Unterschrift bestätigen")} aria-label={tx("Подтвердить подпись", "Unterschrift bestätigen")} disabled={signed || disabled} onClick={() => onSign(document, complianceKind)}>
                  <FileCheck2 className={cn("size-3.5", signed && "text-emerald-700")} />
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" title={tx("Удалить", "Löschen")} aria-label={tx("Удалить", "Löschen")} disabled={disabled} onClick={() => onDelete(document)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LeadWizard({
  leadId: requestedLeadId,
  open,
  createMode = false,
  onOpenChange,
  onCreated,
  onConverted,
  onArchived,
  onShowDetails,
}: LeadWizardProps) {
  const { lang, t } = useLang();
  const tx: Tx = useCallback((ru, de) => (lang === "de" ? de : ru), [lang]);
  const [createdLeadId, setCreatedLeadId] = useState<string | null>(null);
  const leadId = requestedLeadId ?? createdLeadId;
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState<StepId>("master_data");
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [, setCases] = useState<CaseListItem[]>([]);
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [specialties, setSpecialties] = useState<SpecializationItem[]>([]);
  const [agencyServices, setAgencyServices] = useState<AgencyServiceItem[]>([]);
  const [clinicalProviders, setClinicalProviders] = useState<ProviderSummary[]>([]);
  const [allDoctors, setAllDoctors] = useState<AllDoctorOption[]>([]);
  const [medicalLookupsLoading, setMedicalLookupsLoading] = useState(false);
  const [commercialLookupsLoading, setCommercialLookupsLoading] = useState(false);
  const [lines, setLines] = useState<ServiceLine[]>([]);
  const [prepayment, setPrepayment] = useState(false);
  const [signedPatient, setSignedPatient] = useState(false);
  const [signedAgency, setSignedAgency] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const [autosaveError, setAutosaveError] = useState("");
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [deleteDocument, setDeleteDocument] = useState<DocumentItem | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [trustedContactEditor, setTrustedContactEditor] = useState<TrustedContactDraft | null>(null);
  const [trustedContactEditorError, setTrustedContactEditorError] = useState("");
  const [documentPreview, setDocumentPreview] = useState<WizardDocumentPreview | null>(null);
  const [touchedMasterFields, setTouchedMasterFields] = useState<Set<MasterFieldKey>>(
    () => new Set(),
  );
  const [masterValidationAttempted, setMasterValidationAttempted] = useState(false);
  const [orderValidationAttempted, setOrderValidationAttempted] = useState(false);
  const [medicalValidationAttempted, setMedicalValidationAttempted] = useState(false);
  const [validationContext, setValidationContext] = useState<ValidationContext | null>(null);
  const hydrated = useRef<string | null>(null);
  const stepNavRef = useRef<HTMLElement | null>(null);
  const wizardStateBaseRef = useRef<Record<string, unknown>>({});
  const currentAutosaveSignatureRef = useRef("");
  const lastSavedAutosaveSignatureRef = useRef("");
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const medicalSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const stepNavigationInFlightRef = useRef(false);
  const reloadVersionRef = useRef(0);
  const caseIdRef = useRef<string | null>(null);
  const documentPreviewUrlRef = useRef<string | null>(null);
  // Service options that were present when the draft was hydrated. Kept so that
  // unchecking a lead-supplied service (one outside the fixed questionnaire options)
  // leaves its row in place instead of removing it and making it unrecoverable.
  const initialServiceOptionsRef = useRef<string[]>([]);
  const commercialFlagRequestVersionRef = useRef<Record<CommercialFlagKey, number>>({
    signed_patient: 0,
    signed_agency: 0,
    prepayment_required: 0,
  });

  const showWizardError = useCallback((nextError: unknown) => {
    const reasons = leadErrorBlockingReasons(nextError);
    if (reasons.length > 0) {
      const firstReason = reasons[0];
      if (!firstReason) return;
      setError("");
      setValidationContext({ kind: "server", reasons });
      setStep(readinessReasonStep(firstReason));
      const fieldId = readinessReasonFieldId(firstReason, null);
      if (fieldId) {
        window.requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
      }
      return;
    }
    setValidationContext(null);
    setError(errorText(nextError, tx));
  }, [tx]);

  const clearServerValidation = useCallback(() => {
    setValidationContext((current) => current?.kind === "server" ? null : current);
  }, []);

  const replaceDocumentPreview = useCallback((nextPreview: WizardDocumentPreview | null) => {
    const currentUrl = documentPreviewUrlRef.current;
    if (currentUrl && currentUrl !== nextPreview?.url) {
      revokeDocumentPreviewObjectUrl(currentUrl);
    }
    documentPreviewUrlRef.current = nextPreview?.url ?? null;
    setDocumentPreview(nextPreview);
  }, []);

  useEffect(() => () => {
    if (documentPreviewUrlRef.current) {
      revokeDocumentPreviewObjectUrl(documentPreviewUrlRef.current);
      documentPreviewUrlRef.current = null;
    }
  }, []);

  const reload = useCallback(async (hydrateDraft: boolean, hydrateCommercial = false) => {
    if (!leadId) return;
    const reloadVersion = reloadVersionRef.current + 1;
    reloadVersionRef.current = reloadVersion;
    const isCurrentReload = () => reloadVersionRef.current === reloadVersion;
    setLoading(true);
    setMedicalLookupsLoading(true);
    setCommercialLookupsLoading(true);
    setError("");
    setValidationContext(null);
    replaceDocumentPreview(null);
    try {
      const leadPromise = fetchLeadDetail(leadId);
      const initialDocumentsPromise = fetchDocuments(
        "/documents?lead_id=" + encodeURIComponent(leadId),
      ).catch(() => []);
      const documentsPromise = leadPromise.then(async (nextLead) => {
        let attachmentImportError: unknown = null;
        let nextDocuments = await initialDocumentsPromise;
        if (nextLead.attachments?.some((attachment) => !attachment.imported_at)) {
          try {
            await importLeadAttachments(leadId);
            nextDocuments = await fetchDocuments(
              "/documents?lead_id=" + encodeURIComponent(leadId),
            ).catch(() => nextDocuments);
          } catch (nextError) {
            attachmentImportError = nextError;
          }
        }
        return { attachmentImportError, documents: nextDocuments };
      });
      const medicalLookupsPromise = Promise.all([
        fetchProviders("/providers?active_only=true&provider_type=medical").catch(() => []),
        fetchAllDoctors().catch(() => []),
      ]);
      const commercialLookupsPromise = Promise.all([
        fetchSpecializations().catch(() => []),
        fetchAgencyServices("/agency-services?active_only=true").catch(() => []),
      ]);

      void medicalLookupsPromise
        .then(([nextProviders, nextAllDoctors]) => {
          if (!isCurrentReload()) return;
          setClinicalProviders(
            nextProviders.filter((item) => item.provider_type === "medical"),
          );
          setAllDoctors(nextAllDoctors);
        })
        .finally(() => {
          if (isCurrentReload()) setMedicalLookupsLoading(false);
        });
      void commercialLookupsPromise
        .then(([nextSpecialties, nextAgencyServices]) => {
          if (!isCurrentReload()) return;
          setSpecialties(nextSpecialties);
          setAgencyServices(nextAgencyServices.filter((item) => item.is_active));
        })
        .finally(() => {
          if (isCurrentReload()) setCommercialLookupsLoading(false);
        });

      const [
        nextLead,
        nextDocumentState,
        nextCases,
        nextContracts,
        nextOrders,
        nextQuotes,
      ] = await Promise.all([
        leadPromise,
        documentsPromise,
        fetchCases("/cases?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchContracts("/framework-contracts?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchOrders("/orders?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchQuotes("/quotes?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
      ]);
      if (!isCurrentReload()) return;
      setDocuments(nextDocumentState.documents);
      if (nextDocumentState.attachmentImportError) {
        setError(
          `${tx("Не удалось импортировать файлы опросника", "Fragebogendateien konnten nicht importiert werden")}: ${errorText(nextDocumentState.attachmentImportError, tx)}`,
        );
      }
      const nextOrder = nextOrders[0] ?? null;
      const nextCase = nextCases[0] as CaseListItem | undefined;
      const [nextCaseDetail, nextOrderDetail] = await Promise.all([
        nextCase && hydrateDraft
          ? fetchCaseDetail(nextCase.id).catch(() => null)
          : Promise.resolve(null),
        nextOrder && (hydrateDraft || hydrateCommercial)
          ? fetchOrder(nextOrder.id).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!isCurrentReload()) return;
      const paymentQuote = nextQuotes.find((item) => item.status === "accepted") ?? nextQuotes[0];
      const storedCommercialDraft = storedCommercialDraftFromLead(nextLead);
      const storedLeadDraft = draftFromLead(nextLead);
      const leadDraft: Draft = {
        ...storedLeadDraft,
        programDateFrom: storedLeadDraft.programDateFrom || nextOrder?.date_from || "",
        programDateTo: storedLeadDraft.programDateTo || nextOrder?.date_to || "",
      };
      const caseAnamnese = nextCaseDetail?.aktuelle_anamnese?.trim() || "";
      const nextDraft: Draft = nextCaseDetail && !hasStoredClinicalDraft(nextLead) ? {
        ...leadDraft,
        concern: nextCaseDetail.hauptanfragegrund || leadDraft.concern,
        anamnese: caseAnamnese || leadDraft.anamnese,
        narrative: caseAnamnese
          ? {
              id: null,
              anamnese_aktuelle: caseAnamnese,
              anamnese_vorgeschichte: leadDraft.narrative?.anamnese_vorgeschichte ?? null,
              anamnese_vegetative: leadDraft.narrative?.anamnese_vegetative ?? null,
              anamnese_sozial: leadDraft.narrative?.anamnese_sozial ?? null,
              beurteilung: leadDraft.narrative?.beurteilung ?? null,
              is_active: true,
            }
          : leadDraft.narrative,
        referrer: nextCaseDetail.zuweiser || leadDraft.referrer,
        diagnoses: nextCaseDetail.vorerkrankungen.length > 0
          ? nextCaseDetail.vorerkrankungen.map((item, itemIndex) => ({
              id: null,
              cid: leadDraft.diagnoses[itemIndex]?.cid ?? `case-diagnosis-${itemIndex + 1}`,
              parent_cid: null,
              parent_id: null,
              label: item.erkrankung,
              kind: leadDraft.diagnoses[itemIndex]?.kind ?? (itemIndex === 0 ? "main" : "secondary"),
              certainty: leadDraft.diagnoses[itemIndex]?.certainty ?? "bestaetigt",
              chronifizierung: leadDraft.diagnoses[itemIndex]?.chronifizierung ?? null,
              icd_code: leadDraft.diagnoses[itemIndex]?.icd_code ?? null,
              ops_code: null,
              diagnosed_on: item.erstdiagnose ?? null,
              note: item.notiz ?? null,
              source_mode: "intern" as const,
              provider_id: null,
              provider_name: null,
              doctor_id: null,
              doctor_name: null,
              doctor_title: null,
              doctor_fachbereich: null,
              external_clinic: null,
              external_doctor: null,
              external_country: null,
              treating_doctor_id: null,
              treating_doctor_name: null,
              treating_doctor_title: null,
              treating_none: false,
            }))
          : leadDraft.diagnoses,
        medications: nextCaseDetail.medikamente.length > 0
          ? nextCaseDetail.medikamente.map((item, itemIndex) => {
              const existing = leadDraft.medications[itemIndex];
              return {
                id: existing?.id ?? item.id ?? `case-medication-${itemIndex + 1}`,
                provider_id: existing?.provider_id ?? null,
                provider_name: existing?.provider_name ?? null,
                doctor_id: item.verordnender_arzt_id ?? existing?.doctor_id ?? null,
                doctor_name: item.verordnender_arzt ?? existing?.doctor_name ?? null,
                doctor_title: existing?.doctor_title ?? null,
                doctor_fachbereich: existing?.doctor_fachbereich ?? null,
                category: existing?.category ?? (item.med_typ === "permanent" ? "dauer" : "besondere"),
                wirkstoff: item.wirkstoff ?? null,
                handelsname: item.handelsname,
                staerke: [item.dosis, item.dosis_einheit].filter(Boolean).join(" ") || null,
                form: item.darreichungsform ?? null,
                einnahmeform: existing?.einnahmeform ?? null,
                dose_morgens: existing?.dose_morgens ?? item.dosis ?? null,
                dose_mittags: existing?.dose_mittags ?? null,
                dose_abends: existing?.dose_abends ?? null,
                dose_nachts: existing?.dose_nachts ?? null,
                einheit: item.einheit ?? null,
                hinweis: [item.einnahmeschema, item.anmerkung].filter(Boolean).join("\n") || null,
                grund: item.grund ?? null,
                verordnet_am: existing?.verordnet_am ?? null,
                einnahme_von: item.seit ?? null,
                einnahme_bis: item.expiry_date ?? null,
                status: existing?.status ?? "aktiv",
                apothekenpflichtig: existing?.apothekenpflichtig ?? false,
                rezeptpflichtig: existing?.rezeptpflichtig ?? false,
                btm: existing?.btm ?? false,
                aut_idem_sperre: existing?.aut_idem_sperre ?? false,
                abgabebeschraenkung: existing?.abgabebeschraenkung ?? false,
                sonstige_vermerke: existing?.sonstige_vermerke ?? null,
                on_hold: existing?.on_hold ?? false,
                hold_until: existing?.hold_until ?? null,
                hold_note: existing?.hold_note ?? null,
              };
            })
          : leadDraft.medications,
        allergies: nextCaseDetail.allergien.length > 0
          ? nextCaseDetail.allergien.map((item, itemIndex) => ({
              id: leadDraft.allergies[itemIndex]?.id ?? `case-allergy-${itemIndex + 1}`,
              kind: "allergie" as const,
              label: item.allergie,
              reaction: item.reaktion ?? null,
              severity: leadDraft.allergies[itemIndex]?.severity ?? null,
              note: leadDraft.allergies[itemIndex]?.note ?? null,
            }))
          : leadDraft.allergies,
      } : leadDraft;
      const nextStep: StepId = "master_data";
      const nextLines = storedCommercialDraft?.lines.length
        ? storedCommercialDraft.lines
        : nextOrderDetail?.leistungen.length
          ? nextOrderDetail.leistungen.map(lineFromOrderLeistung)
          : [];
      const nextPrepayment = storedCommercialDraft
        ? storedCommercialDraft.prepayment
        : Boolean(nextOrder?.prepayment_required);
      const nextPaidAmount = storedCommercialDraft
        ? storedCommercialDraft.paidAmount
        : paymentQuote?.paid_amount == null
          ? ""
          : String(paymentQuote.paid_amount);

      setLead(nextLead);
      setCases(nextCases as CaseListItem[]);
      caseIdRef.current = nextCase?.id ?? null;
      setContracts(nextContracts);
      setOrders(nextOrders);
      setQuotes(nextQuotes);
      wizardStateBaseRef.current = nextLead.wizard_state ?? {};
      if (hydrateDraft || hydrated.current !== leadId) {
        hydrated.current = leadId;
        setDraft(nextDraft);
        initialServiceOptionsRef.current = nextDraft.serviceNeeds;
        setStep(nextStep);
        setTouchedMasterFields(new Set());
        setMasterValidationAttempted(false);
        setOrderValidationAttempted(false);
        setMedicalValidationAttempted(false);
        setValidationContext(null);
      }
      if (hydrateDraft || hydrateCommercial) {
        setLines(nextLines);
        setPrepayment(nextPrepayment);
        setSignedPatient(Boolean(nextOrder?.signed_patient));
        setSignedAgency(Boolean(nextOrder?.signed_agency));
        setPaidAmount(nextPaidAmount);
      }
      if (hydrateDraft) {
        const signature = autosaveSnapshotSignature({
          draft: nextDraft,
          lines: nextLines,
          paidAmount: nextPaidAmount,
          prepayment: nextPrepayment,
          step: nextStep,
        });
        currentAutosaveSignatureRef.current = signature;
        lastSavedAutosaveSignatureRef.current = signature;
        setAutosaveError("");
        setAutosaveStatus("saved");
      }
    } catch (nextError) {
      if (isCurrentReload()) showWizardError(nextError);
    } finally {
      if (isCurrentReload()) setLoading(false);
    }
  }, [leadId, replaceDocumentPreview, showWizardError, tx]);

  const refreshLeadState = useCallback(async () => {
    if (!leadId) return null;
    const nextLead = await fetchLeadDetail(leadId);
    if (hydrated.current === leadId) {
      setLead(nextLead);
    }
    return nextLead;
  }, [leadId]);

  const refreshDocumentsState = useCallback(async () => {
    if (!leadId) return;
    const [nextLead, nextDocuments] = await Promise.all([
      fetchLeadDetail(leadId),
      fetchDocuments("/documents?lead_id=" + encodeURIComponent(leadId)),
    ]);
    if (hydrated.current !== leadId) return;
    setLead(nextLead);
    setDocuments(nextDocuments);
  }, [leadId]);

  useEffect(() => {
    if (!open || !createMode || leadId || hydrated.current === "__new__") return;

    const nextDraft = blankDraft();
    const signature = autosaveSnapshotSignature({
      draft: nextDraft,
      lines: [],
      paidAmount: "",
      prepayment: false,
      step: "master_data",
    });

    hydrated.current = "__new__";
    setLead(null);
    setDraft(nextDraft);
    setStep("master_data");
    setDocuments([]);
    setCases([]);
    setContracts([]);
    setOrders([]);
    setQuotes([]);
    setSpecialties([]);
    setAgencyServices([]);
    setClinicalProviders([]);
    setAllDoctors([]);
    setMedicalLookupsLoading(false);
    setCommercialLookupsLoading(false);
    setLines([]);
    setPrepayment(false);
    setSignedPatient(false);
    setSignedAgency(false);
    setPaidAmount("");
    setLoading(false);
    setError("");
    setAutosaveError("");
    setAutosaveStatus("idle");
    setTouchedMasterFields(new Set());
    setMasterValidationAttempted(false);
    setOrderValidationAttempted(false);
    setMedicalValidationAttempted(false);
    setValidationContext(null);
    wizardStateBaseRef.current = {};
    currentAutosaveSignatureRef.current = signature;
    lastSavedAutosaveSignatureRef.current = signature;
    caseIdRef.current = null;
    initialServiceOptionsRef.current = [];
  }, [createMode, leadId, open]);

  useEffect(() => {
    if (open && leadId) void reload(hydrated.current !== leadId);
  }, [leadId, open, reload]);

  // Opening the wizard on a brand-new lead moves it into "in progress"
  // (see docs/lead-status-strategy-ua.md). Guarded to fire once per lead.
  const promotedInProgressRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !leadId || lead?.qualification_status !== "new") return;
    if (promotedInProgressRef.current === leadId) return;
    promotedInProgressRef.current = leadId;
    void updateLeadStatus(leadId, "in_progress")
      .then(() => refreshLeadState())
      .catch(() => undefined);
  }, [open, leadId, lead?.qualification_status, refreshLeadState]);

  useEffect(() => {
    if (open) return;
    reloadVersionRef.current += 1;
    setCreatedLeadId(null);
    hydrated.current = null;
    setLead(null);
    setDraft(null);
    setDocuments([]);
    setCases([]);
    setContracts([]);
    setOrders([]);
    setQuotes([]);
    setError("");
    setAutosaveError("");
    setAutosaveStatus("idle");
    setMedicalLookupsLoading(false);
    setCommercialLookupsLoading(false);
    setArchiveConfirmOpen(false);
    setDeleteDocument(null);
    setDeleteReason("");
    setDeleteError("");
    setTrustedContactEditor(null);
    setTrustedContactEditorError("");
    replaceDocumentPreview(null);
    setTouchedMasterFields(new Set());
    setMasterValidationAttempted(false);
    setOrderValidationAttempted(false);
    setMedicalValidationAttempted(false);
    setValidationContext(null);
    currentAutosaveSignatureRef.current = "";
    lastSavedAutosaveSignatureRef.current = "";
    wizardStateBaseRef.current = {};
    caseIdRef.current = null;
    initialServiceOptionsRef.current = [];
  }, [open, replaceDocumentPreview]);

  useEffect(() => {
    if (!open) return;
    const stepNav = stepNavRef.current;
    const activeStep = stepNav?.querySelector<HTMLElement>(
      `[data-step="${step}"]`,
    );
    if (!stepNav || !activeStep) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stepNav.scrollTo({
      behavior: reduceMotion ? "auto" : "smooth",
      left: activeStep.offsetLeft - (stepNav.clientWidth - activeStep.offsetWidth) / 2,
    });
  }, [open, step]);

  const order = orders[0] ?? null;
  const contract = contracts.find((item) => item.status !== "terminated") ?? null;
  const orderQuotes = useMemo(
    () => quotes.filter((item) => !order || item.order_id === order.id),
    [order, quotes],
  );
  const quote = orderQuotes[0] ?? null;
  const acceptedQuote = orderQuotes.find((item) => item.status === "accepted") ?? null;
  const agencyServiceById = useMemo(
    () => new Map(agencyServices.map((service) => [service.id, service])),
    [agencyServices],
  );
  const wizardDocuments = useMemo(() => {
    const grouped: Record<WizardDocumentKind, DocumentItem[]> = {
      identity: [],
      confidentiality_release: [],
      privacy_consents: [],
    };
    documents.forEach((item) => {
      if (item.file_deleted_at || item.has_stored_file === false) return;
      const kind = wizardDocumentKind(item);
      if (kind) grouped[kind].push(item);
    });
    return grouped;
  }, [documents]);
  const commercialDocuments = useMemo(() => {
    const grouped: Record<CommercialDocumentKind, DocumentItem[]> = {
      framework_contract: [],
      single_order: [],
      cost_estimate: [],
    };
    documents.forEach((item) => {
      if (item.file_deleted_at || item.has_stored_file === false) return;
      const templateId = item.generated_template_id as CommercialDocumentKind | null;
      if (templateId && templateId in grouped) grouped[templateId].push(item);
    });
    return grouped;
  }, [documents]);
  const supplementaryDocuments = useMemo(
    () => documents.filter((item) => (
      !item.file_deleted_at
      && item.has_stored_file !== false
      && !wizardDocumentKind(item)
      && !["framework_contract", "single_order", "cost_estimate"].includes(item.generated_template_id ?? "")
    )),
    [documents],
  );
  const intakeType = lead ? leadIntakeTypeFromLead(lead) : null;
  const isQuestionnaireLead = intakeType === "questionnaire";
  const isExternalIntakeLead = intakeType === "questionnaire" || intakeType === "form";
  const readiness = useMemo(() => new Map((lead?.readiness.steps ?? []).map((item) => [item.key, item.ready])), [lead?.readiness.steps]);
  const estimate = useMemo(() => {
    let net = 0;
    let vat = 0;
    lines.filter(validLine).forEach((line) => {
      const lineNet = money(line.quantity) * money(line.price);
      net += lineNet;
      vat += lineNet * money(line.vat) / 100;
    });
    return { net: Math.round(net * 100) / 100, vat: Math.round(vat * 100) / 100, gross: Math.round((net + vat) * 100) / 100 };
  }, [lines]);
  const masterErrors = useMemo(() => validateMasterDraft(draft, tx), [draft, tx]);
  const orderIssues = useMemo(() => orderValidationIssues(draft, tx), [draft, tx]);
  const validationIssues = useMemo<ValidationIssue[]>(() => {
    if (!validationContext) return [];
    if (validationContext.kind === "master") {
      return masterValidationIssues(masterErrors, tx);
    }
    if (validationContext.kind === "medical") {
      if (!draft) return [];
      const issues: ValidationIssue[] = [];
      if (!draft.concern.trim()) {
        issues.push({
          key: "concern",
          step: "medical",
          message: tx("Причина обращения: обязательное поле", "Anliegen: Pflichtfeld"),
          fieldId: SERVICE_CONCERN_ID,
        });
      }
      if (!draft.anamnese.trim()) {
        issues.push({
          key: "anamnese",
          step: "medical",
          message: tx("Анамнез: обязательное поле", "Anamnese: Pflichtfeld"),
          fieldId: MEDICAL_ANAMNESE_ID,
        });
      }
      return issues;
    }
    if (validationContext.kind === "documents") {
      return documentsValidationIssues(draft, wizardDocuments, tx);
    }
    if (validationContext.kind === "order") {
      return orderIssues;
    }
    return validationContext.reasons.map((reason) => ({
      key: reason,
      step: readinessReasonStep(reason),
      message: readinessReasonLabel(reason, tx),
      fieldId: readinessReasonFieldId(reason, draft),
    }));
  }, [draft, masterErrors, orderIssues, tx, validationContext, wizardDocuments]);
  const visibleOrderErrors = orderValidationAttempted ? orderIssues : [];
  const orderFieldError = (...keys: string[]) =>
    visibleOrderErrors.find((issue) => keys.includes(issue.key))?.message;
  const autosaveSnapshot = useMemo<AutosaveSnapshot | null>(
    () => draft ? { draft, lines, paidAmount, prepayment, step } : null,
    [draft, lines, paidAmount, prepayment, step],
  );

  const persistMedicalDraft = useCallback(async (medicalDraft: Draft) => {
    const run = async () => {
      if (!leadId) throw new Error("Lead is not selected");
      let id = caseIdRef.current;
      if (!id) {
        id = (await createCase({
          lead_id: leadId,
          hauptanfragegrund: medicalDraft.concern.trim(),
          aktuelle_anamnese: medicalDraft.anamnese.trim(),
          zuweiser: medicalDraft.referrer.trim(),
        })).id;
        caseIdRef.current = id;
        setCases([{ id }]);
      }
      await saveCaseOverview(id, {
        hauptanfragegrund: medicalDraft.concern.trim(),
        aktuelle_anamnese: medicalDraft.anamnese.trim(),
        zuweiser: medicalDraft.referrer.trim(),
      });
      await Promise.all([
        saveCaseVorerkrankungen(id, {
          items: medicalDraft.diagnoses.filter((item) => item.label.trim()).map((item) => ({
            erkrankung: item.label.trim(),
            erstdiagnose: item.diagnosed_on || null,
            notiz: item.note?.trim() || null,
          })),
        }),
        saveCaseAllergien(id, {
          items: medicalDraft.allergies.filter((item) => item.label.trim()).map((item) => ({
            allergie: item.label.trim(),
            reaktion: item.reaction?.trim() || null,
          })),
        }),
        saveCaseMedikamente(id, {
          items: medicalDraft.medications
            .filter((item) => item.wirkstoff?.trim())
            .map((item) => {
              const schedule = [
                item.dose_morgens ? `M ${item.dose_morgens}` : "",
                item.dose_mittags ? `Mi ${item.dose_mittags}` : "",
                item.dose_abends ? `A ${item.dose_abends}` : "",
                item.dose_nachts ? `N ${item.dose_nachts}` : "",
              ].filter(Boolean).join(" · ");
              return {
                handelsname: item.handelsname?.trim() || "",
                wirkstoff: item.wirkstoff!.trim(),
                dosis: item.staerke?.trim() || null,
                dosis_einheit: null,
                einnahmeschema: schedule || null,
                darreichungsform: item.form || null,
                einheit: item.einheit?.trim() || null,
                anmerkung: [item.hinweis, item.sonstige_vermerke]
                  .filter(Boolean)
                  .join("\n") || null,
                grund: item.grund?.trim() || null,
                seit: item.einnahme_von || null,
                verordnender_arzt_id: item.doctor_id
                  && allDoctors.some((doctor) => doctor.id === item.doctor_id)
                  ? item.doctor_id
                  : null,
                verordnender_arzt: [item.doctor_title, item.doctor_name]
                  .filter(Boolean)
                  .join(" ") || null,
                med_typ: item.category === "dauer" ? "permanent" : "temporary",
                expiry_date: item.einnahme_bis || null,
              };
            }),
        }),
      ]);
      return id;
    };
    const queued = medicalSaveQueueRef.current.then(run, run);
    medicalSaveQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [allDoctors, leadId]);

  const persistSnapshot = useCallback((
    snapshot: AutosaveSnapshot,
    force = false,
    knownSignature?: string,
  ) => {
    const signature = knownSignature ?? autosaveSnapshotSignature(snapshot);
    const previousWizardState = wizardStateBaseRef.current;
    const payload = autosavePayload(snapshot, previousWizardState);

    const run = async () => {
      if (!force && currentAutosaveSignatureRef.current !== signature) return;

      let targetLeadId = leadId;
      if (
        (hydrated.current === targetLeadId || (!targetLeadId && hydrated.current === "__new__")) &&
        currentAutosaveSignatureRef.current === signature
      ) {
        setAutosaveError("");
        setAutosaveStatus("saving");
      }

      try {
        let createdNow = false;
        if (!targetLeadId) {
          const created = await createLead({
            first_name: snapshot.draft.firstName.trim(),
            last_name: snapshot.draft.lastName.trim(),
            email: snapshot.draft.email.trim() || null,
            phone: snapshot.draft.phone.trim() || null,
            source: "manual",
            country: snapshot.draft.country.trim() || null,
            notes: snapshot.draft.serviceNotes.trim() || null,
          });
          targetLeadId = created.id;
          createdNow = true;
          hydrated.current = targetLeadId;
          setCreatedLeadId(targetLeadId);
          onCreated?.(targetLeadId);
        }

        await updateLeadWizard(targetLeadId, payload);
        if (hydrated.current !== targetLeadId) return;

        wizardStateBaseRef.current = payload.wizard_state;
        if (createdNow) setLead(await fetchLeadDetail(targetLeadId));
        lastSavedAutosaveSignatureRef.current = signature;
        if (currentAutosaveSignatureRef.current === signature) {
          setAutosaveError("");
          setAutosaveStatus("saved");
        } else {
          setAutosaveStatus("dirty");
        }
      } catch (nextError) {
        if (
          hydrated.current === targetLeadId &&
          currentAutosaveSignatureRef.current === signature
        ) {
          setAutosaveError(errorText(nextError, tx));
          setAutosaveStatus("error");
        }
        throw nextError;
      }
    };

    const queued = saveQueueRef.current.then(run, run);
    saveQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }, [leadId, onCreated, tx]);

  useEffect(() => {
    if (!open || !autosaveSnapshot || loading) return;

    const signature = autosaveSnapshotSignature(autosaveSnapshot);
    currentAutosaveSignatureRef.current = signature;

    if (signature === lastSavedAutosaveSignatureRef.current) {
      setAutosaveError("");
      setAutosaveStatus("saved");
      return;
    }

    setAutosaveError("");
    setAutosaveStatus("dirty");
    if (!leadId) return;
    const timer = window.setTimeout(() => {
      void persistSnapshot(autosaveSnapshot, false, signature).catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [
    autosaveSnapshot,
    leadId,
    loading,
    open,
    persistSnapshot,
  ]);

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setError("");
    clearServerValidation();
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const openNewTrustedContact = () => {
    setTrustedContactEditorError("");
    setTrustedContactEditor(emptyTrustedContact());
  };

  const openTrustedContact = (contact: TrustedContactDraft) => {
    setTrustedContactEditorError("");
    setTrustedContactEditor({ ...contact });
  };

  const closeTrustedContactEditor = () => {
    setTrustedContactEditor(null);
    setTrustedContactEditorError("");
  };

  const patchTrustedContactEditor = <K extends keyof TrustedContactDraft>(
    key: K,
    value: TrustedContactDraft[K],
  ) => {
    if (key === "name" && trustedContactEditorError) setTrustedContactEditorError("");
    setTrustedContactEditor((current) => current ? { ...current, [key]: value } : current);
  };

  const saveTrustedContact = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trustedContactEditor) return;
    const name = trustedContactEditor.name.trim();
    if (!name) {
      setTrustedContactEditorError(tx("Укажите имя контактного лица", "Name der Kontaktperson angeben"));
      return;
    }

    const normalizedContact: TrustedContactDraft = {
      ...trustedContactEditor,
      name,
      phone: trustedContactEditor.phone.trim(),
      email: trustedContactEditor.email.trim(),
      relation: trustedContactEditor.relation.trim(),
      address: trustedContactEditor.address.trim(),
    };
    setError("");
    clearServerValidation();
    setDraft((current) => {
      if (!current) return current;
      const exists = current.trustedContacts.some((contact) => contact.id === normalizedContact.id);
      return {
        ...current,
        trustedContacts: exists
          ? current.trustedContacts.map((contact) => (
              contact.id === normalizedContact.id ? normalizedContact : contact
            ))
          : [...current.trustedContacts, normalizedContact],
      };
    });
    closeTrustedContactEditor();
  };

  const removeTrustedContact = (contactId: string) => {
    setError("");
    clearServerValidation();
    setDraft((current) => current ? {
      ...current,
      trustedContacts: current.trustedContacts.filter((contact) => contact.id !== contactId),
    } : current);
  };

  const toggleServiceNeed = (value: string, checked: boolean) => {
    setError("");
    clearServerValidation();
    setDraft((current) => {
      if (!current) return current;
      const serviceNeeds = updateLeadServiceSelection(current.serviceNeeds, value, checked);
      const selectedServices = new Set(serviceNeeds);
      const serviceComments = Object.fromEntries(
        Object.entries(current.serviceComments).filter(([service]) => selectedServices.has(service)),
      );
      return {
        ...current,
        serviceNeeds,
        serviceComments,
      };
    });
  };

  const patchServiceComment = (value: string, comment: string) => {
    const normalized = normalizeLeadServiceValue(value);
    setError("");
    clearServerValidation();
    setDraft((current) => current ? {
      ...current,
      serviceComments: {
        ...current.serviceComments,
        [normalized]: comment,
      },
    } : current);
  };

  const touchMasterField = (field: MasterFieldKey) => {
    setTouchedMasterFields((current) => {
      if (current.has(field)) return current;
      const nextFields = new Set(current);
      nextFields.add(field);
      return nextFields;
    });
  };

  const visibleMasterError = (field: MasterFieldKey) =>
    masterValidationAttempted || touchedMasterFields.has(field)
      ? masterErrors[field]
      : undefined;

  const ensureMasterDataReady = () => {
    const firstInvalid = MASTER_FIELD_ORDER.find((field) => masterErrors[field]);
    if (!firstInvalid) {
      setValidationContext((current) => current?.kind === "master" ? null : current);
      return true;
    }
    setError("");
    setValidationContext({ kind: "master" });
    setMasterValidationAttempted(true);
    setStep("master_data");
    window.requestAnimationFrame(() => {
      document.getElementById(MASTER_FIELD_IDS[firstInvalid])?.focus();
    });
    return false;
  };

  async function save(target = step, trackBusy = true): Promise<boolean> {
    if (!draft || (!leadId && !createMode)) return false;
    if (trackBusy) setBusy("save");
    setError("");
    setValidationContext(null);
    try {
      const snapshot: AutosaveSnapshot = {
        draft,
        lines,
        paidAmount,
        prepayment,
        step: target,
      };
      currentAutosaveSignatureRef.current = autosaveSnapshotSignature(snapshot);
      await persistSnapshot(snapshot, true);
      return true;
    } catch (nextError) {
      showWizardError(nextError);
      return false;
    } finally {
      if (trackBusy) setBusy(null);
    }
  }

  async function finishOrder(targetStep: StepId): Promise<boolean> {
    if (!leadId || !draft) return false;
    const issues = orderIssues;
    if (issues.length > 0) {
      setError("");
      setValidationContext({ kind: "order" });
      setOrderValidationAttempted(true);
      setStep("order");
      window.requestAnimationFrame(() => document.getElementById(issues[0]?.fieldId ?? "")?.focus());
      return false;
    }
    const saved = await save(targetStep);
    if (saved) setOrderValidationAttempted(false);
    return saved;
  }

  async function persistMedicalCase(): Promise<string> {
    if (!draft) throw new Error("Lead is not selected");
    return persistMedicalDraft(draft);
  }

  async function finishIntake(targetStep: StepId): Promise<boolean> {
    if (!leadId || !draft) return false;
    setError("");
    if (!ensureMasterDataReady()) return false;
    if (!draft.concern.trim() || !draft.anamnese.trim()) {
      setValidationContext({ kind: "medical" });
      setMedicalValidationAttempted(true);
      setStep("medical");
      const fieldId = !draft.concern.trim() ? SERVICE_CONCERN_ID : MEDICAL_ANAMNESE_ID;
      window.requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
      return false;
    }
    const documentIssues = documentsValidationIssues(draft, wizardDocuments, tx);
    if (documentIssues.length > 0) {
      setValidationContext({ kind: "documents" });
      setStep("documents");
      window.requestAnimationFrame(() => {
        document.getElementById(documentIssues[0]?.fieldId ?? "")?.focus();
      });
      return false;
    }
    setBusy("intake");
    setValidationContext(null);
    try {
      const id = await persistMedicalCase();
      await completeCaseIntake(id, true, {
        hauptanfragegrund: draft.concern.trim(),
        aktuelle_anamnese: draft.anamnese.trim(),
      });
      const saved = await save(targetStep, false);
      if (saved && lead?.qualification_status !== "qualified") {
        await updateLeadStatus(leadId, "qualified");
      }
      if (saved) await refreshLeadState();
      return saved;
    } catch (nextError) {
      showWizardError(nextError);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function upload(kind: "identity", file: File) {
    if (!leadId) return;
    if (file.size > MAX_DOCUMENT_FILE_SIZE) {
      setError(tx("Размер файла не должен превышать 25 МБ", "Die Datei darf höchstens 25 MB groß sein"));
      return;
    }
    setBusy("upload-" + kind);
    try {
      const form = new FormData();
      form.set("lead_id", leadId);
      form.set("file", file);
      form.set("auto_name", "Identity document");
      form.set("art", "identity");
      form.set("category", "identity");
      await uploadDocument(form);
      await refreshDocumentsState();
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function downloadDocument(document: DocumentItem) {
    setBusy(`download-${document.id}`);
    setError("");
    try {
      await downloadDocumentFile(
        document.id,
        wizardDocumentFilename(document),
      );
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function openOrDownloadDocument(document: DocumentItem) {
    const previewKind = wizardDocumentPreviewKind(document);
    if (!previewKind) {
      await downloadDocument(document);
      return;
    }

    setBusy(`preview-${document.id}`);
    setError("");
    try {
      const preview = await createDocumentPreviewObjectUrl(document.id);
      replaceDocumentPreview({
        ...preview,
        id: document.id,
        kind: previewKind,
        title: wizardDocumentFilename(document),
      });
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function deleteWizardDocument() {
    if (!deleteDocument) return;
    const reason = deleteReason.trim();
    if (!reason) {
      setDeleteError(tx("Укажите причину удаления", "Löschgrund angeben"));
      return;
    }

    setBusy(`delete-${deleteDocument.id}`);
    setDeleteError("");
    try {
      await deleteStoredDocumentFile(deleteDocument.id, reason);
      setDeleteDocument(null);
      setDeleteReason("");
      await refreshDocumentsState();
    } catch (nextError) {
      setDeleteError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function signDocument(id: string, kind: DocumentComplianceKind) {
    setBusy("sign-" + kind);
    try {
      await markDocumentSigned(id, kind);
      await refreshDocumentsState();
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  function trustedContactRecipients() {
    if (!draft) return "";
    return draft.trustedContacts.map((contact) => [
      contact.name.trim(),
      contact.birthDate ? `geb. am ${germanDocumentDate(contact.birthDate)}` : "",
      contact.relation.trim() ? `Beziehung: ${contact.relation.trim()}` : "",
      contact.address.trim() ? `Adresse: ${contact.address.trim()}` : "",
      contact.email.trim() ? `E-Mail: ${contact.email.trim()}` : "",
      contact.phone.trim() ? `Tel.: ${contact.phone.trim()}` : "",
    ].filter(Boolean).join(", ")).filter(Boolean).join("\n");
  }

  async function generateLeadComplianceDocument(
    templateId: "confidentiality_release" | "privacy_consents",
  ) {
    if (!leadId || !draft || !lead) return;
    setBusy(`generate-${templateId}`);
    setError("");
    try {
      if (!(await save("documents", false))) return;
      const generated = await generateDocument({
        template_id: templateId,
        lead_id: leadId,
        language: "de",
        document_language: "de",
        document_direction: "outgoing",
        document_variant: "original",
        access_category: "patient",
        status: "active",
        bindings: templateId === "privacy_consents"
          ? {
              extra_release_recipients: trustedContactRecipients(),
              consent_privacy: draft.privacyConsent,
              consent_healthcare: draft.healthcareConsent,
              consent_provider_release: draft.healthcareConsent,
              consent_email: Boolean(lead.email_consent),
              consent_whatsapp: Boolean(lead.whatsapp_consent),
            }
          : {},
      });
      const nextDocuments = await fetchDocuments(`/documents?lead_id=${encodeURIComponent(leadId)}`);
      setDocuments(nextDocuments);
      const generatedDocument = nextDocuments.find((document) => document.id === generated.id);
      if (generatedDocument) await openOrDownloadDocument(generatedDocument);
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  function commercialNeedsDescription() {
    if (!draft) return "";
    const serviceCommentLines = draft.serviceNeeds.flatMap((value) => {
      const comment = draft.serviceComments[value]?.trim();
      if (!comment) return [];
      const label = knownLeadProgramServiceLabel(value, t) ?? serviceNeedLabel(value, tx);
      return [`- ${label}: ${comment}`];
    });

    return [
      draft.concern.trim(),
      lead?.message ? `${tx("Комментарий клиента", "Kundennachricht")}: ${lead.message.trim()}` : "",
      draft.serviceNeeds.length > 0
        ? `${tx("Запрошенные услуги", "Gewünschte Leistungen")}: ${draft.serviceNeeds.map((value) => knownLeadProgramServiceLabel(value, t) ?? serviceNeedLabel(value, tx)).join(", ")}`
        : "",
      serviceCommentLines.length > 0
        ? `${tx("Комментарии к услугам", "Kommentare zu Leistungen")}:
${serviceCommentLines.join("\n")}`
        : "",
      lead?.location_detailed
        ? `${tx("Текущее местонахождение", "Aktueller Aufenthaltsort")}: ${leadLocationDetailedLabel(lead.location_detailed, t)}`
        : lead?.location
          ? `${tx("Текущее местонахождение", "Aktueller Aufenthaltsort")}: ${leadLocationLabel(lead.location, t)}`
          : "",
      lead?.preferred_location
        ? `${tx("Предпочитаемое место лечения", "Bevorzugter Behandlungsort")}: ${leadPreferredLocationLabel(lead.preferred_location, t)}`
        : "",
      lead?.visit_timing
        ? `${tx("Желаемый срок", "Gewünschter Zeitraum")}: ${leadVisitTimingLabel(lead.visit_timing, t)}`
        : "",
      lead?.needs_interpreter
        ? tx("Нужен переводчик", "Dolmetscher benötigt")
        : "",
      lead?.can_travel != null
        ? `${tx("Может приехать", "Kann anreisen")}: ${yesNoValue(lead.can_travel, tx)}`
        : "",
      lead?.has_travel_documents != null
        ? `${tx("Проездные документы", "Reisedokumente")}: ${yesNoValue(lead.has_travel_documents, tx)}`
        : "",
    ].filter(Boolean).join("\n");
  }

  async function ensureCommercial(flags: CommercialFlagsPatch = {}) {
    if (!leadId || !draft) throw new Error(tx("Обращение не выбрано", "Kein Lead ausgewählt"));
    if (!lines.some(validLine)) throw new Error(tx("Добавьте корректную услугу", "Mindestens eine gültige Leistung ist erforderlich"));
    if (!(await save("commercial", false))) throw new Error(tx("Не удалось сохранить обращение", "Lead konnte nicht gespeichert werden"));
    let contractId = contract?.id;
    if (!contractId) {
      contractId = (await createContract({
        lead_id: leadId,
        status: "sent",
        client_reference: "lead-onboarding:" + leadId + ":framework",
      })).id;
    }
    let orderId = order?.id;
    const needsDescription = commercialNeedsDescription();
    if (!orderId) {
      orderId = (await createOrder({
        source_lead_id: leadId,
        contract_id: contractId,
        needs_description: needsDescription,
        date_from: draft.programDateFrom,
        date_to: draft.programDateTo,
      })).id;
    }
    await Promise.all(
      lines.filter(validLine).map((line) =>
        createOrderLeistung(orderId, {
          agency_service_id: line.agencyServiceId,
          description: line.description.trim(),
          quantity: money(line.quantity),
          unit_price: money(line.price),
          vat_rate: money(line.vat),
          client_reference: line.clientReference ?? "lead-wizard:" + leadId + ":" + line.id,
        }),
      ),
    );
    await updateOrderCommercialBasis(orderId, {
      contract_id: contractId,
      total_estimated: estimate.gross.toFixed(2),
      prepayment_required: flags.prepayment_required ?? prepayment,
      signed_patient: flags.signed_patient ?? signedPatient,
      signed_agency: flags.signed_agency ?? signedAgency,
      needs_description: needsDescription,
      date_from: draft.programDateFrom,
      date_to: draft.programDateTo,
    });
    return { contractId, orderId };
  }

  async function prepareCommercial() {
    setBusy("commercial");
    try {
      await ensureCommercial();
      await reload(false, true);
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function signContract(documentId?: string) {
    setBusy("contract");
    try {
      const result = await ensureCommercial();
      await updateContractStatus(result.contractId, { status: "signed" });
      if (documentId) await markDocumentSigned(documentId, "framework_contract");
      await reload(false, true);
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function saveFlags(
    patchValue: CommercialFlagsPatch,
    rollbackValue: CommercialFlagsPatch,
  ) {
    const flagKeys = Object.keys(patchValue) as CommercialFlagKey[];
    const requestVersions = new Map(
      flagKeys.map((key) => {
        const version = commercialFlagRequestVersionRef.current[key] + 1;
        commercialFlagRequestVersionRef.current[key] = version;
        return [key, version] as const;
      }),
    );
    const targetLeadId = leadId;
    const existingOrderId = order?.id;
    if (!existingOrderId) setBusy("flags");
    setError("");
    try {
      if (existingOrderId) {
        await updateOrderCommercialBasis(existingOrderId, patchValue);
        setOrders((current) => current.map((item) => (
          item.id === existingOrderId ? { ...item, ...patchValue } : item
        )));

        if (targetLeadId) {
          void refreshLeadState().catch(() => undefined);
        }
      } else {
        await ensureCommercial(patchValue);
        await reload(false, true);
      }
    } catch (nextError) {
      if (hydrated.current === targetLeadId) {
        showWizardError(nextError);
        flagKeys.forEach((key) => {
          if (commercialFlagRequestVersionRef.current[key] !== requestVersions.get(key)) return;
          const rollback = rollbackValue[key];
          if (rollback === undefined) return;
          if (key === "signed_patient") setSignedPatient(rollback);
          if (key === "signed_agency") setSignedAgency(rollback);
          if (key === "prepayment_required") setPrepayment(rollback);
        });
      }
    } finally {
      if (!existingOrderId) setBusy(null);
    }
  }

  async function createOrAcceptQuote(accept: boolean) {
    setBusy(accept ? "accept" : "quote");
    try {
      let quoteId = quote?.id;
      let createdQuote: QuoteItem | null = null;
      if (!accept || !quoteId) {
        const result = await ensureCommercial();
        const created = await createQuote(result.orderId, {});
        quoteId = created.id;
        createdQuote = {
          id: created.id,
          order_id: created.order_id,
          order_number: order?.order_number ?? "",
          contract_id: created.contract_id ?? result.contractId,
          patient_id: created.patient_id ?? null,
          lead_id: created.lead_id ?? leadId,
          patient_name: lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") : "",
          patient_pid: "",
          quote_number: created.quote_number,
          status: created.status,
          total_net: created.total_net,
          total_vat: created.total_vat,
          total_gross: created.total_gross,
          valid_until: created.valid_until ?? null,
          paid_amount: created.paid_amount ?? "0",
          paid_at: created.paid_at ?? null,
          notes: created.notes ?? null,
          version_count: created.version_count,
          current_version_number: created.current_version_number,
          created_at: created.created_at,
          updated_at: created.updated_at,
          line_items: created.line_items,
        };
      }
      if (accept) {
        const accepted = await updateQuoteStatus(quoteId, {
          status: "accepted",
          paid_amount: prepayment ? money(paidAmount) : undefined,
        });
        setQuotes((current) => [accepted, ...current.filter((item) => item.id !== accepted.id)]);
      } else if (createdQuote) {
        setQuotes((current) => [createdQuote, ...current.filter((item) => item.id !== createdQuote.id)]);
      }
      void reload(false, true);
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function generateCommercialDocument(templateId: CommercialDocumentKind) {
    if (!leadId || !draft) return;
    setBusy(`generate-${templateId}`);
    setError("");
    try {
      const commercial = await ensureCommercial();
      if (templateId === "cost_estimate" && !quote) {
        await createQuote(commercial.orderId, {});
      }
      const generated = await generateDocument({
        template_id: templateId,
        lead_id: leadId,
        order_id: commercial.orderId,
        language: "de",
        document_language: "de",
        document_direction: "outgoing",
        document_variant: "original",
        access_category: templateId === "cost_estimate" ? "financial" : "patient",
        status: "active",
        bindings: {
          specialties: draft.specialties.map((value) => specialtyDocumentLabel(value)).join(", "),
          period_from: draft.programDateFrom || undefined,
          period_to: draft.programDateTo || undefined,
          estimate_total: `${estimate.gross.toFixed(2)} EUR`,
          service_lines: lines.filter(validLine).map((line) => ({
            description: serviceDocumentDescription(line),
            quantity: line.quantity,
            fee: `${money(line.price).toFixed(2)} EUR`,
            line_total: `${(money(line.quantity) * money(line.price)).toFixed(2)} EUR`,
          })),
        },
      });
      const [nextDocuments] = await Promise.all([
        fetchDocuments(`/documents?lead_id=${encodeURIComponent(leadId)}`),
        reload(false, true),
      ]);
      setDocuments(nextDocuments);
      const generatedDocument = nextDocuments.find((document) => document.id === generated.id);
      if (generatedDocument) await openOrDownloadDocument(generatedDocument);
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    if (!leadId) return;
    if (!(await finishIntake("release"))) return;
    if (!(await finishOrder("release"))) return;
    setBusy("convert");
    try {
      const result = await wizardConvertLead(leadId);
      if (onConverted) onConverted(result.patient_id);
      else onOpenChange(false);
    } catch (nextError) {
      await reload(false);
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function archiveLead() {
    if (!leadId) return;
    setBusy("archive");
    setError("");
    try {
      await resolveFailedLead(leadId, {
        resolution: "archive",
        reason: "not_our_lead",
      });
      setArchiveConfirmOpen(false);
      if (onArchived) onArchived();
      else onOpenChange(false);
    } catch (nextError) {
      showWizardError(nextError);
    } finally {
      setBusy(null);
    }
  }

  async function createLeadAndNavigate(target: StepId) {
    try {
      if (!ensureMasterDataReady()) return;
      if (await save(target)) setStep(target);
    } finally {
      stepNavigationInFlightRef.current = false;
    }
  }

  function navigateToStep(target: StepId) {
    if (target === step || busy !== null || stepNavigationInFlightRef.current) return;
    setError("");
    setValidationContext(null);
    setOrderValidationAttempted(false);
    setMedicalValidationAttempted(false);

    if (!leadId && createMode) {
      stepNavigationInFlightRef.current = true;
      void createLeadAndNavigate(target).catch(showWizardError);
      return;
    }

    setStep(target);
  }

  function updateLine(id: string, patchValue: Partial<ServiceLine>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patchValue } : line));
  }

  function addAgencyService(serviceId: string) {
    const service = agencyServiceById.get(serviceId);
    if (!service) return;
    setLines((current) => {
      if (current.some((line) => line.agencyServiceId === service.id)) return current;
      return [
        ...current,
        {
          ...newLine(current.length + 1),
          agencyServiceId: service.id,
          description: service.service_name,
          price: inputString(service.unit_price),
          vat: inputString(service.vat_rate, "19"),
        },
      ];
    });
  }

  function openValidationIssue(issue: ValidationIssue) {
    setStep(issue.step);
    if (!issue.fieldId) return;
    window.requestAnimationFrame(() => {
      document.getElementById(issue.fieldId ?? "")?.focus();
    });
  }

  function specialtyLabel(value: string) {
    const specialty = specialties.find(
      (item) => (item.code || item.name_en) === value,
    );
    if (!specialty) return value;
    return lang === "de"
      ? specialty.name_de || specialty.name_en
      : specialty.name_ru || specialty.name_de || specialty.name_en;
  }

  function specialtyDocumentLabel(value: string) {
    const specialty = specialties.find(
      (item) => (item.code || item.name_en) === value,
    );
    return specialty?.name_de || specialty?.name_en || specialty?.name_ru || value;
  }

  function serviceDocumentDescription(line: ServiceLine) {
    const catalogService = line.agencyServiceId
      ? agencyServiceById.get(line.agencyServiceId)
      : undefined;
    return catalogService?.service_name.trim() || line.description.trim();
  }

  if (!leadId && !createMode) return null;
  const isBusy = busy !== null;
  const autosaveIsDirty = autosaveStatus === "dirty"
    || autosaveStatus === "saving"
    || autosaveStatus === "error";
  const editingTrustedContact = Boolean(
    trustedContactEditor
    && draft?.trustedContacts.some((contact) => contact.id === trustedContactEditor.id),
  );
  return (
    <>
      <Dialog open={open} dirty={autosaveIsDirty} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 sm:h-[min(88vh,52rem)] sm:w-[min(96vw,84rem)] sm:max-w-[84rem]">
        <DialogTitle className="sr-only">{tx("Оформление обращения", "Lead-Aufnahme")}</DialogTitle>
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border px-4 py-3 pr-14 sm:px-5 sm:pr-14">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">
              {lead
                ? [lead.first_name, lead.last_name].filter(Boolean).join(" ")
                : createMode
                  ? tx("Новый лид", "Neuer Lead")
                  : tx("Оформление обращения", "Lead-Aufnahme")}
            </h2>
            {autosaveStatus === "error" ? (
              <div
                role="alert"
                aria-live="polite"
                title={autosaveError || undefined}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-destructive"
              >
                <CircleAlert aria-hidden="true" className="size-3" />
                {tx("Не удалось сохранить изменения", "Änderungen konnten nicht gespeichert werden")}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {leadId && lead && ["new", "in_progress", "qualified"].includes(lead.qualification_status) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-destructive hover:text-destructive"
                disabled={loading || isBusy}
                onClick={() => {
                  if (!leadId) return;
                  void updateLeadStatus(leadId, "not_qualified")
                    .then(() => refreshLeadState())
                    .catch((error) => setError(errorText(error, tx)));
                }}
              >
                {tx("Не подходит", "Nicht geeignet")}
              </Button>
            ) : null}
            {leadId && lead && ["not_qualified", "archived"].includes(lead.qualification_status) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8"
                disabled={loading || isBusy}
                onClick={() => {
                  if (!leadId) return;
                  void updateLeadStatus(leadId, "in_progress")
                    .then(() => refreshLeadState())
                    .catch((error) => setError(errorText(error, tx)));
                }}
              >
                {tx("Вернуть в работу", "Zurück in Bearbeitung")}
              </Button>
            ) : null}
            {leadId ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive"
                title={tx("Архивировать обращение", "Lead archivieren")}
                aria-label={tx("Архивировать обращение", "Lead archivieren")}
                disabled={loading || isBusy}
                onClick={() => setArchiveConfirmOpen(true)}
              >
                <Archive aria-hidden="true" className="size-3.5" />
              </Button>
            ) : null}
            {onShowDetails && leadId ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={tx("Подробности обращения", "Lead-Details")}
                aria-label={tx("Подробности обращения", "Lead-Details")}
                disabled={loading || isBusy}
                onClick={() => onShowDetails(leadId)}
              >
                <Eye aria-hidden="true" className="size-3.5" />
              </Button>
            ) : null}
            {leadId ? (
              <Button type="button" variant="outline" size="icon-sm" title={tx("Обновить", "Aktualisieren")} aria-label={tx("Обновить", "Aktualisieren")} disabled={loading || isBusy} onClick={() => void reload(false)}>
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              </Button>
            ) : null}
          </div>
        </header>

        <nav
          ref={stepNavRef}
          className="overflow-x-auto overscroll-x-contain border-b border-border"
          aria-label={tx("Этапы оформления", "Schritte der Lead-Aufnahme")}
        >
          <div className="grid min-w-[72rem] grid-cols-7 sm:min-w-0">
            {STEPS.map((item, itemIndex) => {
              const selected = item.id === step;
              const done = item.id === "master_data"
                ? Boolean(draft && Object.keys(masterErrors).length === 0)
                : item.id === "medical"
                  ? Boolean(draft?.concern.trim() && draft.anamnese.trim())
                  : item.id === "order"
                    ? Boolean(draft && orderIssues.length === 0)
                    : readiness.get(item.id) ?? false;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-step={item.id}
                  disabled={loading || isBusy}
                  onClick={() => navigateToStep(item.id)}
                  aria-current={selected ? "step" : undefined}
                  className={cn(
                    "relative min-w-0 border-r border-border px-3 py-3 text-left last:border-r-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                    selected && "bg-muted/50 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-[var(--brand)]",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]", done ? "border-emerald-600 text-emerald-700" : "border-muted-foreground/50 text-muted-foreground")}>
                      {done ? <Check aria-hidden="true" className="size-3" /> : itemIndex + 1}
                    </span>
                    <span className="min-w-0 break-words text-[11px] font-medium leading-tight text-foreground">
                      {lang === "de" ? item.de : item.ru}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <main aria-busy={loading || isBusy} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-5">
          {error ? <div role="alert" className="mb-5 border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
          {validationIssues.length > 0 ? (
            <div role="alert" aria-live="assertive" className="mb-5 border-l-2 border-destructive bg-destructive/5 px-3 py-3 text-sm text-destructive">
              <div className="flex items-center gap-2 font-medium">
                <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                {tx("Требуют внимания", "Bitte prüfen")}
              </div>
              <ul className="mt-2 space-y-1.5">
                {validationIssues.map((issue) => (
                  <li key={issue.key}>
                    <button
                      type="button"
                      className="w-full text-left text-xs leading-5 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openValidationIssue(issue)}
                    >
                      <span className="font-medium">{readinessStepLabel(issue.step, tx)}:</span>{" "}
                      {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {loading && !lead ? <div role="status" aria-live="polite" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{tx("Загрузка…", "Wird geladen…")}</div> : null}

          {draft && step === "master_data" ? (
            <section className="min-w-0 space-y-5">
              {lead ? (
                <LeadQuestionnaireFacts
                  topBorder={false}
                  items={[
                    { label: tx("Тип", "Typ"), value: <StatusBadge tone={intakeTypeTone(lead)}>{intakeTypeLabel(lead, tx)}</StatusBadge> },
                    { label: tx("Канал поступления", "Eingangskanal"), value: lead.source ? leadSourceLabel(lead.source, t) : tx("Не указано", "Nicht angegeben") },
                    { label: tx("Тип формы", "Formulartyp"), value: intakeFlowLabel(lead.flow, tx) },
                    ...(isExternalIntakeLead ? [{
                      label: tx("Язык заполнения", "Eingabesprache"),
                      value: normalizedLanguageCode(lead.locale)
                        ? languageLabel(normalizedLanguageCode(lead.locale), lang)
                        : lead.locale || tx("Не указано", "Nicht angegeben"),
                    }] : []),
                  ]}
                />
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={tx("Откуда вы о нас узнали?", "Wie sind Sie auf uns aufmerksam geworden?")}>
                  <NativeComboboxSelect
                    aria-label={tx("Откуда вы о нас узнали?", "Wie sind Sie auf uns aufmerksam geworden?")}
                    name="discovery_source"
                    value={draft.discoverySource}
                    onChange={(event) => patch("discoverySource", event.target.value)}
                    className={selectClass}
                  >
                    <option value="">{tx("Выберите источник", "Quelle auswählen")}</option>
                    {draft.discoverySource && !DISCOVERY_SOURCE_OPTIONS.some((option) => option.value === draft.discoverySource) ? (
                      <option value={draft.discoverySource}>
                        {tx("Текущее значение", "Aktueller Wert")}: {draft.discoverySource}
                      </option>
                    ) : null}
                    {DISCOVERY_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {lang === "de" ? option.de : option.ru}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </Field>
                <Field
                  label={tx("Имя", "Vorname")}
                  required
                  error={visibleMasterError("firstName")}
                  errorId={`${MASTER_FIELD_IDS.firstName}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.firstName}
                    name="first_name"
                    autoComplete="given-name"
                    required
                    aria-invalid={Boolean(visibleMasterError("firstName"))}
                    aria-describedby={visibleMasterError("firstName") ? `${MASTER_FIELD_IDS.firstName}-error` : undefined}
                    className={cn(visibleMasterError("firstName") && "border-destructive")}
                    value={draft.firstName}
                    onBlur={() => touchMasterField("firstName")}
                    onChange={(event) => patch("firstName", event.target.value)}
                  />
                </Field>
                <Field label={tx("Отчество / второе имя", "Zweiter Vorname")}>
                  <Input
                    name="middle_name"
                    autoComplete="additional-name"
                    value={draft.middleName}
                    onChange={(event) => patch("middleName", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Фамилия", "Nachname")}
                  required
                  error={visibleMasterError("lastName")}
                  errorId={`${MASTER_FIELD_IDS.lastName}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.lastName}
                    name="last_name"
                    autoComplete="family-name"
                    required
                    aria-invalid={Boolean(visibleMasterError("lastName"))}
                    aria-describedby={visibleMasterError("lastName") ? `${MASTER_FIELD_IDS.lastName}-error` : undefined}
                    className={cn(visibleMasterError("lastName") && "border-destructive")}
                    value={draft.lastName}
                    onBlur={() => touchMasterField("lastName")}
                    onChange={(event) => patch("lastName", event.target.value)}
                  />
                </Field>
                <Field label={tx("Дополнение к имени", "Namenszusatz")}>
                  <Input
                    name="name_suffix"
                    value={draft.suffix}
                    onChange={(event) => patch("suffix", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Дата рождения", "Geburtsdatum")}
                  required
                  error={visibleMasterError("birthDate")}
                  errorId={`${MASTER_FIELD_IDS.birthDate}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.birthDate}
                    name="birth_date"
                    autoComplete="bday"
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    required
                    aria-invalid={Boolean(visibleMasterError("birthDate"))}
                    aria-describedby={visibleMasterError("birthDate") ? `${MASTER_FIELD_IDS.birthDate}-error` : undefined}
                    className={cn(visibleMasterError("birthDate") && "border-destructive")}
                    value={draft.birthDate}
                    onBlur={() => touchMasterField("birthDate")}
                    onChange={(event) => patch("birthDate", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Пол по документам", "Geschlecht laut Ausweisdokument")}
                  required
                  error={visibleMasterError("legalSex")}
                  errorId={`${MASTER_FIELD_IDS.legalSex}-error`}
                >
                  <NativeComboboxSelect
                    id={MASTER_FIELD_IDS.legalSex}
                    name="legal_sex"
                    value={draft.legalSex}
                    required
                    aria-invalid={Boolean(visibleMasterError("legalSex"))}
                    aria-describedby={visibleMasterError("legalSex") ? `${MASTER_FIELD_IDS.legalSex}-error` : undefined}
                    onBlur={() => touchMasterField("legalSex")}
                    onChange={(event) => patch("legalSex", event.target.value)}
                    className={cn(selectClass, visibleMasterError("legalSex") && "border-destructive")}
                  >
                    <option value="">{tx("Выберите", "Auswählen")}</option>
                    <option value="female">{tx("Женский", "Weiblich")}</option>
                    <option value="male">{tx("Мужской", "Männlich")}</option>
                    <option value="diverse">{tx("Другой", "Divers")}</option>
                    <option value="no_entry">{tx("Без указания", "Keine Angabe")}</option>
                  </NativeComboboxSelect>
                </Field>
                <Field
                  label="E-Mail"
                  required={!draft.phone.trim()}
                  error={visibleMasterError("email")}
                  errorId={`${MASTER_FIELD_IDS.email}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.email}
                    name="email"
                    autoComplete="email"
                    spellCheck={false}
                    type="email"
                    aria-required={!draft.phone.trim()}
                    aria-invalid={Boolean(visibleMasterError("email"))}
                    aria-describedby={visibleMasterError("email") ? `${MASTER_FIELD_IDS.email}-error` : undefined}
                    className={cn(visibleMasterError("email") && "border-destructive")}
                    value={draft.email}
                    onBlur={() => touchMasterField("email")}
                    onChange={(event) => patch("email", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Телефон", "Telefon")}
                  required={!draft.email.trim()}
                  error={visibleMasterError("phone")}
                  errorId={`${MASTER_FIELD_IDS.phone}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.phone}
                    name="phone"
                    autoComplete="tel"
                    type="tel"
                    aria-required={!draft.email.trim()}
                    aria-invalid={Boolean(visibleMasterError("phone"))}
                    aria-describedby={visibleMasterError("phone") ? `${MASTER_FIELD_IDS.phone}-error` : undefined}
                    className={cn(visibleMasterError("phone") && "border-destructive")}
                    value={draft.phone}
                    onBlur={() => touchMasterField("phone")}
                    onChange={(event) => patch("phone", event.target.value)}
                  />
                </Field>
                <Field label="WhatsApp">
                  <Input
                    name="whatsapp_number"
                    autoComplete="tel"
                    type="tel"
                    value={draft.whatsappNumber}
                    onChange={(event) => patch("whatsappNumber", event.target.value)}
                  />
                </Field>
                <Field label={tx("Предпочитаемый язык", "Bevorzugte Sprache")}>
                  <NativeComboboxSelect name="primary_language" value={draft.language} className={selectClass} onChange={(event) => patch("language", event.target.value)}>
                    <option value="">{tx("Выберите", "Auswählen")}</option>
                    {draft.language && !LANGUAGE_OPTIONS.some((item) => item.value === draft.language) ? <option value={draft.language}>{draft.language}</option> : null}
                    {LANGUAGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{languageLabel(item.value, lang)}</option>)}
                  </NativeComboboxSelect>
                </Field>
                <Field
                  label={tx("Улица и дом", "Straße und Hausnummer")}
                  required={draft.healthcareConsent}
                  error={visibleMasterError("street")}
                  errorId={`${MASTER_FIELD_IDS.street}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.street}
                    name="street_address"
                    autoComplete="street-address"
                    required={draft.healthcareConsent}
                    aria-invalid={Boolean(visibleMasterError("street"))}
                    aria-describedby={visibleMasterError("street") ? `${MASTER_FIELD_IDS.street}-error` : undefined}
                    className={cn(visibleMasterError("street") && "border-destructive")}
                    value={draft.street}
                    onBlur={() => touchMasterField("street")}
                    onChange={(event) => patch("street", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Город", "Ort")}
                  required={draft.healthcareConsent}
                  error={visibleMasterError("city")}
                  errorId={`${MASTER_FIELD_IDS.city}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.city}
                    name="city"
                    autoComplete="address-level2"
                    required={draft.healthcareConsent}
                    aria-invalid={Boolean(visibleMasterError("city"))}
                    aria-describedby={visibleMasterError("city") ? `${MASTER_FIELD_IDS.city}-error` : undefined}
                    className={cn(visibleMasterError("city") && "border-destructive")}
                    value={draft.city}
                    onBlur={() => touchMasterField("city")}
                    onChange={(event) => patch("city", event.target.value)}
                  />
                </Field>
                <Field label={tx("Регион / область", "Region / Bundesland")}>
                  <Input
                    name="address_region"
                    autoComplete="address-level1"
                    value={draft.state}
                    onChange={(event) => patch("state", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Почтовый индекс", "Postleitzahl")}
                  required={draft.healthcareConsent}
                  error={visibleMasterError("zip")}
                  errorId={`${MASTER_FIELD_IDS.zip}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.zip}
                    name="postal_code"
                    autoComplete="postal-code"
                    required={draft.healthcareConsent}
                    aria-invalid={Boolean(visibleMasterError("zip"))}
                    aria-describedby={visibleMasterError("zip") ? `${MASTER_FIELD_IDS.zip}-error` : undefined}
                    className={cn(visibleMasterError("zip") && "border-destructive")}
                    value={draft.zip}
                    onBlur={() => touchMasterField("zip")}
                    onChange={(event) => patch("zip", event.target.value)}
                  />
                </Field>
                <Field label={tx("Страна", "Land")} className="md:col-span-2">
                  <CountrySelect value={draft.country} lang={lang} className={selectClass} aria-label={tx("Страна", "Land")} onChange={(value) => patch("country", value ?? "")} />
                </Field>
                <div className="border-t border-border pt-4 md:col-span-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {tx("Страхование", "Versicherung")}
                  </h3>
                </div>
                <Field label={tx("Есть страхование", "Versicherung vorhanden")}>
                  <NativeComboboxSelect
                    name="has_insurance"
                    value={draft.hasInsurance}
                    className={selectClass}
                    onChange={(event) => {
                      const value = event.target.value as Draft["hasInsurance"];
                      clearServerValidation();
                      setDraft((current) => current ? {
                        ...current,
                        hasInsurance: value,
                        ...(value === "no" ? {
                          insuranceType: "self_pay",
                          insuranceProvider: "",
                          insuranceNumber: "",
                          insuranceCoversGermany: "",
                        } : {}),
                      } : current);
                    }}
                  >
                    <option value="">{tx("Не указано", "Nicht angegeben")}</option>
                    <option value="yes">{tx("Да", "Ja")}</option>
                    <option value="no">{tx("Нет, самооплата", "Nein, Selbstzahler")}</option>
                  </NativeComboboxSelect>
                </Field>
                <Field
                  label={tx("Тип страхования", "Versicherungsart")}
                  required={draft.hasInsurance === "yes"}
                  error={visibleMasterError("insuranceType")}
                  errorId={`${MASTER_FIELD_IDS.insuranceType}-error`}
                >
                  <NativeComboboxSelect
                    id={MASTER_FIELD_IDS.insuranceType}
                    name="insurance_type"
                    value={draft.insuranceType}
                    required={draft.hasInsurance === "yes"}
                    aria-invalid={Boolean(visibleMasterError("insuranceType"))}
                    aria-describedby={visibleMasterError("insuranceType") ? `${MASTER_FIELD_IDS.insuranceType}-error` : undefined}
                    className={cn(selectClass, visibleMasterError("insuranceType") && "border-destructive")}
                    onBlur={() => touchMasterField("insuranceType")}
                    onChange={(event) => patch("insuranceType", event.target.value)}
                  >
                    <option value="">{tx("Выберите", "Auswählen")}</option>
                    <option value="private">{tx("Частное", "Privat")}</option>
                    <option value="public">{tx("Государственное", "Gesetzlich")}</option>
                    <option value="foreign">{tx("Иностранное", "Ausland")}</option>
                    <option value="self_pay">{tx("Самооплата", "Selbstzahler")}</option>
                  </NativeComboboxSelect>
                </Field>
                <Field
                  label={tx("Страховая компания", "Versicherer")}
                  required={draft.hasInsurance === "yes"}
                  error={visibleMasterError("insuranceProvider")}
                  errorId={`${MASTER_FIELD_IDS.insuranceProvider}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.insuranceProvider}
                    name="insurance_provider"
                    required={draft.hasInsurance === "yes"}
                    aria-invalid={Boolean(visibleMasterError("insuranceProvider"))}
                    aria-describedby={visibleMasterError("insuranceProvider") ? `${MASTER_FIELD_IDS.insuranceProvider}-error` : undefined}
                    className={cn(visibleMasterError("insuranceProvider") && "border-destructive")}
                    value={draft.insuranceProvider}
                    onBlur={() => touchMasterField("insuranceProvider")}
                    onChange={(event) => patch("insuranceProvider", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Номер полиса", "Versicherungsnummer")}
                  required={draft.hasInsurance === "yes"}
                  error={visibleMasterError("insuranceNumber")}
                  errorId={`${MASTER_FIELD_IDS.insuranceNumber}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.insuranceNumber}
                    name="insurance_number"
                    autoComplete="off"
                    required={draft.hasInsurance === "yes"}
                    aria-invalid={Boolean(visibleMasterError("insuranceNumber"))}
                    aria-describedby={visibleMasterError("insuranceNumber") ? `${MASTER_FIELD_IDS.insuranceNumber}-error` : undefined}
                    className={cn(visibleMasterError("insuranceNumber") && "border-destructive")}
                    value={draft.insuranceNumber}
                    onBlur={() => touchMasterField("insuranceNumber")}
                    onChange={(event) => patch("insuranceNumber", event.target.value)}
                  />
                </Field>
                <Field label={tx("Покрывает лечение в Германии", "Deckung in Deutschland")}>
                  <NativeComboboxSelect
                    name="insurance_covers_germany"
                    value={draft.insuranceCoversGermany}
                    className={selectClass}
                    disabled={draft.hasInsurance === "no"}
                    onChange={(event) => patch("insuranceCoversGermany", event.target.value)}
                  >
                    <option value="">{tx("Не указано", "Nicht angegeben")}</option>
                    <option value="yes">{tx("Да", "Ja")}</option>
                    <option value="no">{tx("Нет", "Nein")}</option>
                    <option value="not_sure">{tx("Неизвестно", "Nicht sicher")}</option>
                  </NativeComboboxSelect>
                </Field>
              </div>
              {isExternalIntakeLead && lead ? (
                <LeadQuestionnaireFacts
                  items={[
                    { label: tx("Тип основного телефона", "Typ der Hauptnummer"), value: phoneTypeLabel(lead.primary_phone_type, tx) },
                    {
                      label: tx("Телефоны из опросника", "Telefonnummern aus dem Fragebogen"),
                      value: lead.phones?.length
                        ? lead.phones.map((item) => `${item.number} · ${phoneTypeLabel(item.type, tx)}`).join("\n")
                        : tx("Не указано", "Nicht angegeben"),
                      wide: true,
                    },
                  ]}
                />
              ) : null}
            </section>
          ) : null}

          {draft && lead && step === "medical" ? (
            <section className="space-y-5">
              <Field label={tx("Направивший врач", "Zuweisender Arzt")} className="block pb-2"><Input value={draft.referrer} onChange={(event) => patch("referrer", event.target.value)} /></Field>
              <Field
                required
                label={tx("Причина обращения", "Anliegen")}
                error={medicalValidationAttempted && !draft.concern.trim() ? tx("Обязательное поле", "Pflichtfeld") : undefined}
                errorId={`${SERVICE_CONCERN_ID}-error`}
              >
                <textarea
                  id={SERVICE_CONCERN_ID}
                  className={cn(
                    textareaClass,
                    "min-h-28",
                    medicalValidationAttempted && !draft.concern.trim() && "border-destructive",
                  )}
                  aria-invalid={medicalValidationAttempted && !draft.concern.trim()}
                  aria-describedby={medicalValidationAttempted && !draft.concern.trim() ? `${SERVICE_CONCERN_ID}-error` : undefined}
                  value={draft.concern}
                  onChange={(event) => patch("concern", event.target.value)}
                />
              </Field>
              {medicalLookupsLoading ? (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
                >
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  {tx("Загружаются справочники врачей и клиник…", "Ärzte- und Klinikkataloge werden geladen…")}
                </div>
              ) : null}
              <Suspense
                fallback={(
                  <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    {tx("Загрузка медицинской формы…", "Medizinisches Formular wird geladen…")}
                  </div>
                )}
              >
                <LeadMedicalIntakeForm
                  lead={lead}
                  tx={tx}
                  lang={lang}
                  anamneseId={MEDICAL_ANAMNESE_ID}
                  narrative={draft.narrative}
                  diagnoses={draft.diagnoses}
                  medications={draft.medications}
                  allergies={draft.allergies}
                  caves={draft.caves}
                  providers={clinicalProviders}
                  allDoctors={allDoctors}
                  validationAttempted={medicalValidationAttempted}
                  onNarrativeChange={(value) => {
                    setError("");
                    clearServerValidation();
                    setDraft((current) => current ? {
                      ...current,
                      narrative: value,
                      anamnese: value.anamnese_aktuelle ?? "",
                    } : current);
                  }}
                  onDiagnosesChange={(value) => patch("diagnoses", value)}
                  onMedicationsChange={(value) => patch("medications", value)}
                  onAllergiesChange={(value) => patch("allergies", value)}
                  onCavesChange={(value) => patch("caves", value)}
                />
              </Suspense>
            </section>
          ) : null}


          {draft && lead && step === "service" ? (
            <section className="space-y-5">
              {isQuestionnaireLead ? (
                <LeadQuestionnaireFacts
                  items={[
                    { label: tx("Нужен переводчик", "Dolmetscher benötigt"), value: yesNoValue(draft.serviceNeeds.includes("interpreter_support"), tx) },
                    { label: tx("Может приехать", "Kann anreisen"), value: yesNoValue(lead.can_travel, tx) },
                    { label: tx("Есть проездные документы", "Reisedokumente vorhanden"), value: yesNoValue(lead.has_travel_documents, tx) },
                    { label: tx("Регион нахождения", "Aufenthaltsregion"), value: lead.location ? leadLocationLabel(lead.location, t) : tx("Не указано", "Nicht angegeben") },
                    { label: tx("Детальная локация", "Detaillierter Standort"), value: lead.location_detailed ? leadLocationDetailedLabel(lead.location_detailed, t) : tx("Не указано", "Nicht angegeben") },
                    { label: tx("Предпочитаемое место лечения", "Bevorzugter Behandlungsort"), value: lead.preferred_location ? leadPreferredLocationLabel(lead.preferred_location, t) : tx("Не указано", "Nicht angegeben") },
                    { label: tx("Желаемый срок", "Gewünschter Zeitraum"), value: lead.visit_timing ? leadVisitTimingLabel(lead.visit_timing, t) : tx("Не указано", "Nicht angegeben") },
                    { label: tx("Интерес к программе", "Interesse an einem Programm"), value: yesNoValue(lead.wants_membership, tx) },
                    { label: tx("Выбранная программа", "Gewähltes Programm"), value: lead.selected_program ? leadProgramServiceLabel(lead.selected_program, t) : tx("Не указано", "Nicht angegeben") },
                  ]}
                />
              ) : null}
              {lead.message ? (
                <LeadQuestionnaireFacts
                  items={[{
                    label: tx("Комментарий клиента", "Kundennachricht"),
                    value: lead.message,
                    wide: true,
                  }]}
                />
              ) : null}
              <div className="space-y-3">
                <span className="block text-sm font-medium text-foreground">
                  {tx("Запрошенные услуги", "Gewünschte Leistungen")}
                </span>
                <div className="grid items-start gap-2 sm:grid-cols-2">
                  {Array.from(new Set([
                    ...LEAD_WIZARD_SERVICE_OPTIONS,
                    ...initialServiceOptionsRef.current,
                    ...draft.serviceNeeds,
                  ])).map((value, index) => {
                    const checked = draft.serviceNeeds.includes(value);
                    const label = knownLeadProgramServiceLabel(value, t) ?? serviceNeedLabel(value, tx);
                    const fieldKey = `${index}-${value.replace(/[^a-z0-9_-]/gi, "-")}`;
                    const checkboxId = `lead-service-${fieldKey}`;
                    const commentId = `lead-service-comment-${fieldKey}`;
                    const commentLabel = tx("Комментарий к услуге", "Kommentar zur Leistung");
                    return (
                      <div
                        key={value}
                        className={cn(
                          "overflow-hidden rounded-md border bg-background",
                          checked ? "border-[var(--brand)]" : "border-border",
                        )}
                      >
                        <label
                          htmlFor={checkboxId}
                          className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2.5"
                        >
                          <input
                            id={checkboxId}
                            type="checkbox"
                            className="size-4 shrink-0 accent-[var(--brand)]"
                            checked={checked}
                            onChange={(event) => toggleServiceNeed(value, event.target.checked)}
                          />
                          <span className="min-w-0 break-words text-sm text-foreground">{label}</span>
                        </label>
                        {checked ? (
                          <div className="space-y-1.5 border-t border-border px-3 pb-3 pt-2.5">
                            <label
                              htmlFor={commentId}
                              className="block text-[11px] font-medium uppercase text-muted-foreground"
                            >
                              {commentLabel}
                            </label>
                            <textarea
                              id={commentId}
                              aria-label={`${commentLabel}: ${label}`}
                              className={cn(textareaClass, "min-h-20 resize-y bg-white text-slate-900")}
                              value={draft.serviceComments[value] ?? ""}
                              onChange={(event) => patchServiceComment(value, event.target.value)}
                              placeholder={tx("Детали по этой услуге", "Details zu dieser Leistung")}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
              <Field label={tx("Общий комментарий", "Allgemeiner Kommentar")}><textarea className={cn(textareaClass, "min-h-24")} value={draft.serviceNotes} onChange={(event) => patch("serviceNotes", event.target.value)} /></Field>
            </section>
          ) : null}

          {draft && step === "documents" ? (
            <section className="space-y-5">
              <div id={CONFIDENTIALITY_RELEASE_ID} tabIndex={-1} className="space-y-4 border-y border-border py-4 focus:outline-none">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    {tx("Освобождение от медицинской тайны", "Schweigepflichtsentbindung")}
                  </h3>
                  <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void generateLeadComplianceDocument("confidentiality_release")}>
                    {busy === "generate-confidentiality_release" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                    {wizardDocuments.confidentiality_release.length > 0 ? tx("Создать новую версию", "Neue Version erstellen") : tx("Создать документ", "Dokument erstellen")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {tx(
                    "Отдельное освобождение всех лечащих врачей и медицинских учреждений от медицинской тайны.",
                    "Separate Entbindung aller behandelnden Ärzte und medizinischen Einrichtungen von der Schweigepflicht.",
                  )}
                </p>
                <WizardDocumentRows
                  documents={wizardDocuments.confidentiality_release}
                  complianceKind="confidentiality_release"
                  emptyLabel={tx("Документ ещё не создан", "Dokument wurde noch nicht erstellt")}
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onSign={(document, kind) => void signDocument(document.id, kind)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                />
              </div>

              <div id={PRIVACY_DOCUMENT_ID} tabIndex={-1} className="space-y-4 border-b border-border pb-4 focus:outline-none">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    {tx("Согласие на использование и передачу персональных и медицинских данных", "Einverständniserklärung zur Datenübermittlung")}
                  </h3>
                  <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void generateLeadComplianceDocument("privacy_consents")}>
                    {busy === "generate-privacy_consents" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                    {wizardDocuments.privacy_consents.length > 0 ? tx("Создать новую версию", "Neue Version erstellen") : tx("Создать документ", "Dokument erstellen")}
                  </Button>
                </div>
                <div className="border-y border-border">
                  <ToggleRow id={PRIVACY_CONSENT_ID} checked={draft.privacyConsent} disabled={isBusy} onChange={(checked) => patch("privacyConsent", checked)} label={tx("Клиент ознакомлен с политикой конфиденциальности", "Datenschutzhinweise wurden bestätigt")} />
                  <ToggleRow id={HEALTHCARE_CONSENT_ID} checked={draft.healthcareConsent} disabled={isBusy} onChange={(checked) => patch("healthcareConsent", checked)} label={tx("Получено согласие на обработку медицинских данных", "Einwilligung zur Verarbeitung von Gesundheitsdaten liegt vor")} />
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold uppercase text-muted-foreground">
                          {tx("Доверенное лицо / дополнительный получатель", "Vertrauenskontakt / zusätzlicher Empfänger")}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                          {draft.trustedContacts.length}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tx(
                          "Все контакты будут отдельными строками подставлены в согласие на передачу данных.",
                          "Alle Kontakte werden als separate Einträge in die Datenübermittlungserklärung übernommen.",
                        )}
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={openNewTrustedContact}>
                      <Plus aria-hidden="true" className="size-3.5" />
                      {tx("Добавить контакт", "Kontakt hinzufügen")}
                    </Button>
                  </div>
                  {draft.trustedContacts.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
                      {tx("Доверенные контакты пока не добавлены", "Noch keine Vertrauenskontakte hinzugefügt")}
                    </div>
                  ) : (
                    <ul aria-label={tx("Доверенные контакты", "Vertrauenskontakte")} className="divide-y divide-border rounded-md border border-border">
                      {draft.trustedContacts.map((contact) => (
                        <li key={contact.id} className="flex items-start gap-3 px-3 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span className="break-words text-sm font-medium text-foreground">{contact.name}</span>
                              {contact.relation ? (
                                <span className="text-xs text-muted-foreground">{contact.relation}</span>
                              ) : null}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              {contact.birthDate ? <span>{germanDocumentDate(contact.birthDate)}</span> : null}
                              {contact.email ? <span className="break-all">{contact.email}</span> : null}
                              {contact.phone ? <span>{contact.phone}</span> : null}
                              {contact.address ? <span className="break-words">{contact.address}</span> : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title={tx("Редактировать контакт", "Kontakt bearbeiten")}
                              aria-label={`${tx("Редактировать контакт", "Kontakt bearbeiten")}: ${contact.name}`}
                              onClick={() => openTrustedContact(contact)}
                            >
                              <Pencil aria-hidden="true" className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive"
                              title={tx("Удалить контакт", "Kontakt entfernen")}
                              aria-label={`${tx("Удалить контакт", "Kontakt entfernen")}: ${contact.name}`}
                              onClick={() => removeTrustedContact(contact.id)}
                            >
                              <Trash2 aria-hidden="true" className="size-3.5" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <WizardDocumentRows
                  documents={wizardDocuments.privacy_consents}
                  complianceKind="dsgvo"
                  emptyLabel={tx("Документ ещё не создан", "Dokument wurde noch nicht erstellt")}
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onSign={(document, kind) => void signDocument(document.id, kind)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                />
              </div>

              <div className="space-y-3 border-b border-border pb-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    {tx("Документ, удостоверяющий личность", "Ausweisdokument")}
                  </h3>
                  <input
                    id="lead-file-identity"
                    type="file"
                    className="peer sr-only"
                    accept=".pdf,.jpg,.jpeg,.png"
                    disabled={isBusy}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) {
                        void upload("identity", file);
                        event.currentTarget.value = "";
                      }
                    }}
                  />
                  <label
                    htmlFor="lead-file-identity"
                    className={cn(
                      "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground shadow-xs hover:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                      isBusy && "pointer-events-none opacity-50",
                    )}
                  >
                    <Upload aria-hidden="true" className="size-3.5" />
                    {wizardDocuments.identity.length > 0 ? tx("Добавить файл", "Datei hinzufügen") : tx("Загрузить файл", "Datei hochladen")}
                  </label>
                </div>
                <WizardDocumentRows
                  documents={wizardDocuments.identity}
                  complianceKind="identity"
                  emptyLabel={tx("Файл не загружен", "Keine Datei hochgeladen")}
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onSign={(document, kind) => void signDocument(document.id, kind)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                />
              </div>
              {supplementaryDocuments.length > 0 ? (
                <div className="space-y-3 border-b border-border pb-4">
                  <div className="text-sm font-medium text-foreground">
                    {tx("Другие документы", "Weitere Dokumente")}
                  </div>
                  <WizardDocumentRows
                    documents={supplementaryDocuments}
                    emptyLabel=""
                    lang={lang}
                    busy={busy}
                    disabled={isBusy}
                    tx={tx}
                    onOpen={(document) => void openOrDownloadDocument(document)}
                    onDownload={(document) => void downloadDocument(document)}
                    onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          {draft && step === "order" ? (
            <section className="min-w-0 space-y-5">
              {commercialLookupsLoading ? (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
                >
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  {tx("Загружаются каталоги специализаций и услуг…", "Fachrichtungs- und Leistungskataloge werden geladen…")}
                </div>
              ) : null}
              <div className="space-y-3">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {tx("Специализации", "Fachrichtungen")}
                  <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>
                </span>
                <NativeComboboxSelect
                  id={SERVICE_SPECIALTIES_ID}
                  aria-label={tx("Добавить специализацию", "Fachrichtung hinzufügen")}
                  aria-invalid={Boolean(orderFieldError("specialties"))}
                  aria-describedby={orderFieldError("specialties") ? `${SERVICE_SPECIALTIES_ID}-error` : undefined}
                  name="specialty"
                  value=""
                  onChange={(event) => {
                    const selected = specialties.find((item) => item.id === event.target.value);
                    if (!selected) return;
                    const value = selected.code || selected.name_en;
                    if (!draft.specialties.includes(value)) patch("specialties", [...draft.specialties, value]);
                  }}
                  className={cn(selectClass, orderFieldError("specialties") && "border-destructive")}
                >
                  <option value="">{tx("Добавить специализацию", "Fachrichtung hinzufügen")}</option>
                  {specialties.map((item) => (
                    <option key={item.id} value={item.id}>
                      {lang === "de" ? item.name_de || item.name_en : item.name_ru || item.name_de || item.name_en}
                    </option>
                  ))}
                </NativeComboboxSelect>
                {orderFieldError("specialties") ? (
                  <span id={`${SERVICE_SPECIALTIES_ID}-error`} role="alert" className="block text-xs leading-4 text-destructive">
                    {orderFieldError("specialties")}
                  </span>
                ) : null}
                {draft.specialties.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {draft.specialties.map((value) => (
                      <div key={value} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border bg-muted/25 px-3 py-2">
                        <span className="min-w-0 break-words text-sm text-foreground">{specialtyLabel(value)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0"
                          title={tx("Удалить специализацию", "Fachrichtung entfernen")}
                          aria-label={tx("Удалить специализацию", "Fachrichtung entfernen")}
                          onClick={() => patch("specialties", draft.specialties.filter((item) => item !== value))}
                        >
                          <X aria-hidden="true" className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={tx("Начало программы", "Programmbeginn")}
                  required={Boolean(draft.programDateTo)}
                  error={orderFieldError("program-date-from")}
                  errorId={`${ORDER_DATE_FROM_ID}-error`}
                >
                  <Input
                    id={ORDER_DATE_FROM_ID}
                    name="program_date_from"
                    type="date"
                    required={Boolean(draft.programDateTo)}
                    aria-invalid={Boolean(orderFieldError("program-date-from"))}
                    aria-describedby={orderFieldError("program-date-from") ? `${ORDER_DATE_FROM_ID}-error` : undefined}
                    className={cn(orderFieldError("program-date-from") && "border-destructive")}
                    value={draft.programDateFrom}
                    onChange={(event) => patch("programDateFrom", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Окончание программы", "Programmende")}
                  required={Boolean(draft.programDateFrom)}
                  error={orderFieldError("program-date-to", "program-date-range")}
                  errorId={`${ORDER_DATE_TO_ID}-error`}
                >
                  <Input
                    id={ORDER_DATE_TO_ID}
                    name="program_date_to"
                    type="date"
                    min={draft.programDateFrom || undefined}
                    required={Boolean(draft.programDateFrom)}
                    aria-invalid={Boolean(orderFieldError("program-date-to", "program-date-range"))}
                    aria-describedby={orderFieldError("program-date-to", "program-date-range") ? `${ORDER_DATE_TO_ID}-error` : undefined}
                    className={cn(orderFieldError("program-date-to", "program-date-range") && "border-destructive")}
                    value={draft.programDateTo}
                    onChange={(event) => patch("programDateTo", event.target.value)}
                  />
                </Field>
              </div>
            </section>
          ) : null}

          {draft && step === "commercial" ? (
            <section className="space-y-5">
              {commercialLookupsLoading ? (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
                >
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  {tx("Загружается каталог услуг…", "Leistungskatalog wird geladen…")}
                </div>
              ) : null}
              <div id={FRAMEWORK_DOCUMENT_ID} tabIndex={-1} className="space-y-3 border-y border-border py-4 focus:outline-none">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{tx("Рамочный договор", "Rahmenvertrag")}</h3>
                    <div className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
                      {contract?.contract_number ?? "FC-…"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StateMark done={contract?.status === "signed"} label={contract?.status === "signed" ? tx("Подписан", "Unterzeichnet") : tx("Ожидает подписи", "Unterschrift offen")} />
                    <Button type="button" variant="outline" size="sm" disabled={isBusy || !lines.some(validLine)} onClick={() => void generateCommercialDocument("framework_contract")}>
                      {busy === "generate-framework_contract" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                      {commercialDocuments.framework_contract.length > 0 ? tx("Новая версия", "Neue Version") : tx("Создать", "Erstellen")}
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={isBusy || !contract || commercialDocuments.framework_contract.length === 0} onClick={() => void signContract(commercialDocuments.framework_contract[0]?.id)}>
                      {busy === "contract" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileCheck2 className="size-3.5" />}
                      {tx("Подтвердить подпись", "Unterschrift bestätigen")}
                    </Button>
                  </div>
                </div>
                <WizardDocumentRows
                  documents={commercialDocuments.framework_contract}
                  complianceKind="framework_contract"
                  emptyLabel={tx("Документ ещё не создан", "Dokument wurde noch nicht erstellt")}
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onSign={(document) => void signContract(document.id)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                />
              </div>
              {draft.serviceNeeds.length > 0 ? (
                <LeadQuestionnaireFacts
                  items={[
                    {
                      label: tx("Запрос клиента", "Kundenbedarf"),
                      value: draft.serviceNeeds.map((value) => knownLeadProgramServiceLabel(value, t) ?? serviceNeedLabel(value, tx)).join(", "),
                      wide: true,
                    },
                  ]}
                />
              ) : null}
              <div className="space-y-3">
                <span className="text-sm font-medium text-foreground">{tx("Позиции заказа", "Auftragspositionen")}</span>
                <NativeComboboxSelect
                  aria-label={tx("Выбрать услугу из каталога", "Leistung aus dem Katalog auswählen")}
                  name="agency_service"
                  value=""
                  onChange={(event) => addAgencyService(event.target.value)}
                  className={selectClass}
                >
                  <option value="">{tx("Выберите услугу из каталога", "Leistung aus dem Katalog auswählen")}</option>
                  {agencyServices.map((service) => (
                    <option
                      key={service.id}
                      value={service.id}
                      disabled={lines.some((line) => line.agencyServiceId === service.id)}
                    >
                      {service.service_name} · {formatMoneyValue(money(inputString(service.unit_price)), lang)} {service.currency}
                    </option>
                  ))}
                </NativeComboboxSelect>
                {lines.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{tx("Услуги не выбраны", "Keine Leistungen ausgewählt")}</p>
                ) : (
                  <div className="overflow-hidden rounded-md border border-border">
                    <div className="overflow-x-auto">
                      <table
                        aria-label={tx("Позиции заказа", "Auftragspositionen")}
                        className="w-full min-w-[760px] border-collapse text-sm"
                      >
                      <caption className="sr-only">
                        {tx("Позиции заказа", "Auftragspositionen")}
                      </caption>
                      <thead className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left font-medium">
                            {tx("Услуга", "Leistung")}
                          </th>
                          <th scope="col" className="w-28 px-3 py-2 text-right font-medium">
                            {tx("Количество", "Menge")}
                          </th>
                          <th scope="col" className="w-36 px-3 py-2 text-right font-medium">
                            {tx("Цена за единицу", "Einzelpreis")}
                          </th>
                          <th scope="col" className="w-24 px-3 py-2 text-right font-medium">
                            {tx("НДС", "MwSt.")}
                          </th>
                          <th scope="col" className="w-36 px-3 py-2 text-right font-medium">
                            {tx("Сумма", "Gesamt")}
                          </th>
                          <th scope="col" className="w-14 px-2 py-2">
                            <span className="sr-only">{tx("Действия", "Aktionen")}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-card">
                        {lines.map((line) => {
                          const catalogService = line.agencyServiceId
                            ? agencyServiceById.get(line.agencyServiceId)
                            : undefined;
                          const currency = catalogService?.currency || "EUR";
                          const lineTotal = money(line.quantity) * money(line.price);
                          return (
                            <tr key={line.id} className="align-middle hover:bg-muted/30">
                              <th scope="row" className="min-w-60 px-3 py-2.5 text-left font-normal">
                                <div className="break-words font-medium text-foreground">{line.description}</div>
                                {catalogService?.unit_label ? (
                                  <div className="mt-0.5 text-xs text-muted-foreground">{catalogService.unit_label}</div>
                                ) : null}
                              </th>
                              <td className="px-3 py-2">
                                <Input
                                  name={`service_quantity_${line.id}`}
                                  autoComplete="off"
                                  inputMode="decimal"
                                  aria-label={`${tx("Количество", "Menge")}: ${line.description}`}
                                  className="h-8 text-right font-mono tabular-nums"
                                  value={line.quantity}
                                  onChange={(event) => updateLine(line.id, { quantity: event.target.value })}
                                />
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-foreground">
                                {formatMoneyValue(money(line.price), lang)} {currency}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-foreground">
                                {formatMoneyValue(money(line.vat), lang)}%
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-medium tabular-nums text-foreground">
                                {formatMoneyValue(lineTotal, lang)} {currency}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  title={tx("Удалить услугу", "Leistung entfernen")}
                                  aria-label={`${tx("Удалить услугу", "Leistung entfernen")}: ${line.description}`}
                                  onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}
                                >
                                  <X className="size-3.5" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      </table>
                    </div>
                    <dl
                      aria-label={tx("Итоги заказа", "Auftragssummen")}
                      className="grid grid-cols-3 divide-x divide-border border-t border-border bg-muted/30"
                    >
                      <div className="min-w-0 px-2 py-2.5 text-right sm:px-3">
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {tx("Нетто", "Netto")}
                        </dt>
                        <dd className="mt-0.5 whitespace-nowrap font-mono text-xs tabular-nums text-foreground sm:text-sm">
                          {formatMoneyValue(estimate.net, lang)} EUR
                        </dd>
                      </div>
                      <div className="min-w-0 px-2 py-2.5 text-right sm:px-3">
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {tx("НДС", "MwSt.")}
                        </dt>
                        <dd className="mt-0.5 whitespace-nowrap font-mono text-xs tabular-nums text-foreground sm:text-sm">
                          {formatMoneyValue(estimate.vat, lang)} EUR
                        </dd>
                      </div>
                      <div className="min-w-0 px-2 py-2.5 text-right sm:px-3">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                          {tx("Итого", "Gesamt")}
                        </dt>
                        <dd className="mt-0.5 whitespace-nowrap font-mono text-xs font-semibold tabular-nums text-foreground sm:text-sm">
                          {formatMoneyValue(estimate.gross, lang)} EUR
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>
              <div id={ORDER_DOCUMENT_ID} tabIndex={-1} className="space-y-3 border-y border-border py-4 focus:outline-none">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{tx("Документ заказа", "Einzelauftrag")}</h3>
                    <div className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
                      {order?.order_number ?? "A-…"}
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled={isBusy || !lines.some(validLine)} onClick={() => void generateCommercialDocument("single_order")}>
                    {busy === "generate-single_order" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                    {commercialDocuments.single_order.length > 0 ? tx("Новая версия", "Neue Version") : tx("Создать", "Erstellen")}
                  </Button>
                </div>
                <WizardDocumentRows
                  documents={commercialDocuments.single_order}
                  emptyLabel={tx("Документ ещё не создан", "Dokument wurde noch nicht erstellt")}
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                />
              </div>
              <div className="border-y border-border">
                <ToggleRow
                  checked={signedPatient}
                  disabled={isBusy}
                  onChange={(checked) => {
                    setSignedPatient(checked);
                    void saveFlags(
                      { signed_patient: checked },
                      { signed_patient: signedPatient },
                    );
                  }}
                  label={tx("Клиент подписал заказ", "Auftrag vom Kunden unterzeichnet")}
                />
                <ToggleRow
                  checked={signedAgency}
                  disabled={isBusy}
                  onChange={(checked) => {
                    setSignedAgency(checked);
                    void saveFlags(
                      { signed_agency: checked },
                      { signed_agency: signedAgency },
                    );
                  }}
                  label={tx("Агентство подтвердило заказ", "Auftrag von der Agentur bestätigt")}
                />
                <ToggleRow
                  checked={prepayment}
                  disabled={isBusy}
                  onChange={(checked) => {
                    setPrepayment(checked);
                    void saveFlags(
                      { prepayment_required: checked },
                      { prepayment_required: prepayment },
                    );
                  }}
                  label={tx("Требуется предоплата", "Vorauszahlung erforderlich")}
                />
              </div>
              <div className="grid gap-3 border-b border-border pb-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <Field label={tx("Полученная предоплата", "Erhaltene Vorauszahlung")}>
                  <Input className="font-mono tabular-nums" inputMode="decimal" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} disabled={!prepayment} placeholder="0.00" />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" disabled={isBusy || !lines.some(validLine)} onClick={() => void createOrAcceptQuote(false)}>
                    {busy === "quote" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    {quote ? tx("Пересчитать смету", "Kostenvoranschlag neu berechnen") : tx("Рассчитать смету", "Kostenvoranschlag berechnen")}
                  </Button>
                  <Button type="button" variant="outline" disabled={isBusy || !quote} onClick={() => void createOrAcceptQuote(true)}>
                    {busy === "accept" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    {tx("Подтвердить смету", "Kostenvoranschlag annehmen")}
                  </Button>
                </div>
              </div>
              <div id={COST_ESTIMATE_DOCUMENT_ID} tabIndex={-1} className="space-y-3 border-b border-border pb-4 focus:outline-none">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{tx("Документ сметы", "Kostenvoranschlag")}</h3>
                    <div className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
                      {quote?.quote_number ?? "KV-…"}
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled={isBusy || !lines.some(validLine)} onClick={() => void generateCommercialDocument("cost_estimate")}>
                    {busy === "generate-cost_estimate" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                    {commercialDocuments.cost_estimate.length > 0 ? tx("Новая версия", "Neue Version") : tx("Создать", "Erstellen")}
                  </Button>
                </div>
                <WizardDocumentRows
                  documents={commercialDocuments.cost_estimate}
                  emptyLabel={tx("Документ ещё не создан", "Dokument wurde noch nicht erstellt")}
                  lang={lang}
                  busy={busy}
                  disabled={isBusy}
                  tx={tx}
                  onOpen={(document) => void openOrDownloadDocument(document)}
                  onDownload={(document) => void downloadDocument(document)}
                  onDelete={(document) => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3"><StateMark done={Boolean(readiness.get("commercial"))} label={acceptedQuote ? tx("Смета подтверждена", "Kostenvoranschlag angenommen") : quote ? tx("Смета создана и ожидает подтверждения", "Kostenvoranschlag erstellt, Annahme ausstehend") : tx("Смета ещё не создана", "Kostenvoranschlag noch nicht erstellt")} /><Button type="button" disabled={isBusy || !lines.some(validLine)} onClick={() => void prepareCommercial()}>{busy === "commercial" ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}{tx("Сохранить договор и заказ", "Vertrag und Auftrag speichern")}</Button></div>
            </section>
          ) : null}

          {lead && step === "release" ? (
            <section className="space-y-5">
              <div><h3 className="text-sm font-semibold text-foreground">{tx("Создание пациента", "Patient anlegen")}</h3><p className="mt-1 text-sm text-muted-foreground">{tx("Проверьте все этапы. После подтверждения система создаст карточку пациента и перенесёт в неё данные обращения.", "Prüfen Sie alle Schritte. Nach der Bestätigung wird die Patientenakte angelegt und die Angaben aus dem Lead werden übernommen.")}</p></div>
              <div className="border-y border-border">{lead.readiness.steps.map((item) => <div key={item.key} className="flex items-center justify-between gap-4 border-b border-border/70 py-3 last:border-b-0"><span className="text-sm text-foreground">{readinessStepLabel(item.key, tx)}</span><StateMark done={item.ready} label={item.ready ? tx("Выполнено", "Erledigt") : tx("Не завершено", "Noch offen")} /></div>)}</div>
              {lead.readiness.blocking_reasons.length > 0 ? <div className="border-l-2 border-amber-500 bg-amber-50/50 px-3 py-3 text-sm text-amber-900"><div className="font-medium">{tx("Что осталось заполнить", "Was noch fehlt")}</div><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">{lead.readiness.blocking_reasons.map((reason) => <li key={reason}>{readinessReasonLabel(reason, tx)}</li>)}</ul></div> : null}
              <div className="flex justify-end"><Button type="button" disabled={isBusy || !lead.readiness.conversion_ready} onClick={() => void convert()}>{busy === "convert" ? <LoaderCircle className="size-4 animate-spin" /> : <UserRoundCheck className="size-4" />}{tx("Создать пациента", "Patient anlegen")}</Button></div>
            </section>
          ) : null}
        </main>

      </DialogContent>
      </Dialog>
      <Sheet
        open={Boolean(trustedContactEditor)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeTrustedContactEditor();
        }}
      >
        <SheetContent
          side="right"
          className="w-full max-w-none gap-0 border-l border-border p-0 sm:max-w-lg"
        >
          {trustedContactEditor ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={saveTrustedContact}>
              <SheetHeader className="shrink-0 border-b border-border px-5 py-4 pr-14">
                <SheetTitle>
                  {editingTrustedContact
                    ? tx("Редактировать доверенный контакт", "Vertrauenskontakt bearbeiten")
                    : tx("Добавить доверенный контакт", "Vertrauenskontakt hinzufügen")}
                </SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
                <p className="text-xs leading-5 text-muted-foreground">
                  {tx(
                    "Контакт будет сохранён в лиде и отдельной строкой добавлен в согласие на передачу данных.",
                    "Der Kontakt wird im Lead gespeichert und als eigener Eintrag in die Datenübermittlungserklärung übernommen.",
                  )}
                </p>
                <Field
                  required
                  label={tx("Имя и фамилия", "Vor- und Nachname")}
                  error={trustedContactEditorError || undefined}
                  errorId="trusted-contact-name-error"
                >
                  <Input
                    autoFocus
                    required
                    value={trustedContactEditor.name}
                    aria-invalid={Boolean(trustedContactEditorError)}
                    aria-describedby={trustedContactEditorError ? "trusted-contact-name-error" : undefined}
                    onChange={(event) => patchTrustedContactEditor("name", event.target.value)}
                  />
                </Field>
                <Field label="E-Mail">
                  <Input
                    type="email"
                    value={trustedContactEditor.email}
                    onChange={(event) => patchTrustedContactEditor("email", event.target.value)}
                  />
                </Field>
                <Field label={tx("Телефон", "Telefon")}>
                  <Input
                    type="tel"
                    value={trustedContactEditor.phone}
                    onChange={(event) => patchTrustedContactEditor("phone", event.target.value)}
                  />
                </Field>
                <Field label={tx("Кем приходится клиенту", "Beziehung zur Person")}>
                  <Input
                    value={trustedContactEditor.relation}
                    onChange={(event) => patchTrustedContactEditor("relation", event.target.value)}
                  />
                </Field>
                <Field label={tx("Дата рождения", "Geburtsdatum")}>
                  <Input
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={trustedContactEditor.birthDate}
                    onChange={(event) => patchTrustedContactEditor("birthDate", event.target.value)}
                  />
                </Field>
                <Field label={tx("Адрес", "Adresse")}>
                  <Input
                    value={trustedContactEditor.address}
                    onChange={(event) => patchTrustedContactEditor("address", event.target.value)}
                  />
                </Field>
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
                <Button type="button" variant="outline" onClick={closeTrustedContactEditor}>
                  {tx("Отмена", "Abbrechen")}
                </Button>
                <Button type="submit">
                  {editingTrustedContact ? tx("Сохранить", "Speichern") : tx("Добавить", "Hinzufügen")}
                </Button>
              </div>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>
      <Dialog
        open={Boolean(documentPreview)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) replaceDocumentPreview(null);
        }}
      >
        <DialogContent className="flex h-[90vh] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 sm:h-[min(88vh,52rem)] sm:w-[min(96vw,84rem)] sm:max-w-[84rem]">
          <DialogHeader className="border-b border-border px-4 py-3 pr-14 sm:px-5 sm:pr-14">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="truncate text-base">
                  {documentPreview?.title ?? tx("Просмотр документа", "Dokumentvorschau")}
                </DialogTitle>
                <DialogDescription className="truncate">
                  {documentPreview?.contentType ?? ""}
                </DialogDescription>
              </div>
              {documentPreview ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="shrink-0"
                  title={tx("Скачать файл", "Datei herunterladen")}
                  aria-label={tx("Скачать файл", "Datei herunterladen")}
                  onClick={() => void downloadDocumentFile(documentPreview.id, documentPreview.title)}
                >
                  <Download aria-hidden="true" className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-3">
            {documentPreview?.kind === "image" ? (
              <img
                src={documentPreview.url}
                alt={documentPreview.title}
                className="mx-auto h-full max-h-full w-full object-contain"
              />
            ) : documentPreview ? (
              <iframe
                title={documentPreview.title}
                src={documentPreview.url}
                className="h-full min-h-[32rem] w-full border border-border bg-white"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleteDocument)}
        allowImplicitDismissal
        onOpenChange={(nextOpen) => {
          if (nextOpen) return;
          setDeleteDocument(null);
          setDeleteReason("");
          setDeleteError("");
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tx("Удалить файл?", "Datei löschen?")}</DialogTitle>
            <DialogDescription>
              {deleteDocument?.original_filename || deleteDocument?.auto_name}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void deleteWizardDocument();
            }}
          >
            <Field
              required
              label={tx("Причина удаления", "Löschgrund")}
              error={deleteError || undefined}
              errorId="lead-wizard-delete-reason-error"
            >
              <textarea
                className={cn(textareaClass, "min-h-20", deleteError && "border-destructive")}
                value={deleteReason}
                aria-invalid={Boolean(deleteError)}
                aria-describedby={deleteError ? "lead-wizard-delete-reason-error" : undefined}
                onChange={(event) => {
                  setDeleteReason(event.target.value);
                  if (deleteError) setDeleteError("");
                }}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy?.startsWith("delete-")} onClick={() => setDeleteDocument(null)}>
                {tx("Отмена", "Abbrechen")}
              </Button>
              <Button type="submit" variant="destructive" disabled={busy?.startsWith("delete-")}>
                {busy?.startsWith("delete-") ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                {tx("Удалить файл", "Datei löschen")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tx("Переместить обращение в архив?", "Lead archivieren?")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Обращение исчезнет из активного списка, но останется доступным в архиве.",
                "Der Lead wird aus der aktiven Liste entfernt und bleibt im Archiv verfügbar.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy === "archive"}
              onClick={() => setArchiveConfirmOpen(false)}
            >
              {tx("Отмена", "Abbrechen")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy === "archive"}
              onClick={() => void archiveLead()}
            >
              {busy === "archive" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
              {tx("Архивировать", "Archivieren")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
