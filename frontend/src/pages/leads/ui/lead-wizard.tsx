import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  Eye,
  FileCheck2,
  FileText,
  LoaderCircle,
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
import { selectClass, textareaClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import type { LeadDetail } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  completeCaseIntake,
  createCase,
  fetchCaseDetail,
  fetchCaseDoctors,
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
  deleteStoredDocumentFile,
  downloadDocumentFile,
  fetchDocuments,
  markDocumentSigned,
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
import type { DoctorOption } from "@/pages/cases/model/types";
import { fetchSpecializations } from "@/pages/providers/data/provider-api";
import type { SpecializationItem } from "@/pages/providers/model/types";
import {
  LEAD_QUESTIONNAIRE_SERVICE_OPTIONS,
  leadIntakeTypeFromLead,
  knownLeadProgramServiceLabel,
  leadLocationDetailedLabel,
  leadLocationLabel,
  leadPreferredLocationLabel,
  leadProgramServiceLabel,
  leadSourceLabel,
  leadVisitTimingLabel,
  normalizeLeadServiceValue,
} from "@/pages/leads/model/leads-model";

import {
  LeadMedicalIntakeForm,
  type LeadAllergyDraft,
  type LeadCaveDraft,
  type LeadDiagnosisDraft,
  type LeadMedicationDraft,
} from "./lead-medical-intake-form";
import { LeadQuestionnaireFacts } from "./lead-questionnaire-facts";

import {
  fetchLeadDetail,
  importLeadAttachments,
  resolveFailedLead,
  updateLeadStatus,
  updateLeadWizard,
  wizardConvertLead,
} from "../data/leads-api";

type Tx = (ru: string, de: string) => string;
type StepId = "master_data" | "medical" | "service" | "documents" | "commercial" | "release";
type CaseListItem = { id: string };

type LeadWizardProps = {
  leadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted?: (patientId: string) => void;
  onArchived?: () => void;
  onShowDetails?: (leadId: string) => void;
  onOrderCreated?: (orderId: string) => void;
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
  concern: string;
  anamnese: string;
  diagnoses: LeadDiagnosisDraft[];
  medications: LeadMedicationDraft[];
  allergies: LeadAllergyDraft[];
  caves: LeadCaveDraft[];
  serviceNeeds: string[];
  serviceComments: Record<string, string>;
  discoverySource: string;
  referrer: string;
  serviceNotes: string;
  specialties: string[];
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
type WizardDocumentKind = "identity" | "dsgvo";

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
  | "zip";

type MasterValidationErrors = Partial<Record<MasterFieldKey, string>>;

const AUTOSAVE_DELAY_MS = 800;
const MAX_DOCUMENT_FILE_SIZE = 25 * 1024 * 1024;
const SERVICE_CONCERN_ID = "lead-wizard-concern";
const SERVICE_SPECIALTIES_ID = "lead-wizard-specialties";
const MEDICAL_ANAMNESE_ID = "lead-wizard-anamnese";

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
};

const STEPS: Array<{ id: StepId; ru: string; de: string }> = [
  { id: "master_data", ru: "Данные клиента", de: "Personendaten" },
  { id: "medical", ru: "Медицинская характеристика", de: "Medizinische Merkmale" },
  { id: "service", ru: "Сервисная история", de: "Servicehistorie" },
  { id: "documents", ru: "Документы", de: "Unterlagen" },
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
    street_address: draft.street.trim(),
    city: draft.city.trim(),
    state: draft.state.trim(),
    zip_code: draft.zip.trim(),
    country: draft.country.trim(),
    primary_language: draft.language.trim(),
    primary_concern_text: draft.concern.trim(),
    additional_concerns: draft.anamnese.trim(),
    services: draft.serviceNeeds,
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
      service_comments: draft.serviceNeeds.reduce<Record<string, string>>((comments, value) => {
        const comment = draft.serviceComments[value];
        if (comment?.trim()) comments[value] = comment;
        return comments;
      }, {}),
      clinical_draft: {
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

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : "";
}

function booleanFromUnknown(value: unknown) {
  return value === true;
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
  return {
    diagnoses: rows("diagnoses", (row, index): LeadDiagnosisDraft => ({
      id: stringFromUnknown(row["id"]) || `diagnosis-${index + 1}`,
      label: stringFromUnknown(row["label"]),
      diagnosedOn: stringFromUnknown(row["diagnosedOn"]),
      note: stringFromUnknown(row["note"]),
      kind: row["kind"] === "secondary" || (row["kind"] !== "main" && index > 0)
        ? "secondary"
        : "main",
      icdCode: stringFromUnknown(row["icdCode"]),
      certainty: ["verdacht", "bestaetigt", "zustand_nach"].includes(stringFromUnknown(row["certainty"]))
        ? stringFromUnknown(row["certainty"]) as LeadDiagnosisDraft["certainty"]
        : "bestaetigt",
      chronification: ["akut", "chronisch", "rezidivierend"].includes(stringFromUnknown(row["chronification"]))
        ? stringFromUnknown(row["chronification"]) as LeadDiagnosisDraft["chronification"]
        : "",
    })),
    medications: rows("medications", (row, index): LeadMedicationDraft => ({
      id: stringFromUnknown(row["id"]) || `medication-${index + 1}`,
      name: stringFromUnknown(row["name"]),
      activeIngredient: stringFromUnknown(row["activeIngredient"]),
      dose: stringFromUnknown(row["dose"]),
      schedule: stringFromUnknown(row["schedule"]),
      form: stringFromUnknown(row["form"]),
      route: stringFromUnknown(row["route"]),
      doseUnit: stringFromUnknown(row["doseUnit"]),
      unit: stringFromUnknown(row["unit"]),
      note: stringFromUnknown(row["note"]),
      reason: stringFromUnknown(row["reason"]),
      since: stringFromUnknown(row["since"]),
      prescriberId: stringFromUnknown(row["prescriberId"]),
      prescriber: stringFromUnknown(row["prescriber"]),
      medicationType: stringFromUnknown(row["medicationType"]) || "permanent",
      expiryDate: stringFromUnknown(row["expiryDate"]),
      category: ["dauer", "besondere", "selbst"].includes(stringFromUnknown(row["category"]))
        ? stringFromUnknown(row["category"]) as LeadMedicationDraft["category"]
        : stringFromUnknown(row["medicationType"]) === "permanent" ? "dauer" : "besondere",
      status: ["aktiv", "pausiert", "abgesetzt", "geplant"].includes(stringFromUnknown(row["status"]))
        ? stringFromUnknown(row["status"]) as LeadMedicationDraft["status"]
        : "aktiv",
      doseMorning: stringFromUnknown(row["doseMorning"]),
      doseNoon: stringFromUnknown(row["doseNoon"]),
      doseEvening: stringFromUnknown(row["doseEvening"]),
      doseNight: stringFromUnknown(row["doseNight"]),
      prescribedOn: stringFromUnknown(row["prescribedOn"]),
      pharmacyOnly: booleanFromUnknown(row["pharmacyOnly"]),
      prescriptionOnly: booleanFromUnknown(row["prescriptionOnly"]),
      btm: booleanFromUnknown(row["btm"]),
      autIdemBlocked: booleanFromUnknown(row["autIdemBlocked"]),
      dispensingRestricted: booleanFromUnknown(row["dispensingRestricted"]),
      otherNotes: stringFromUnknown(row["otherNotes"]),
    })),
    allergies: rows("allergies", (row, index): LeadAllergyDraft => ({
      id: stringFromUnknown(row["id"]) || `allergy-${index + 1}`,
      label: stringFromUnknown(row["label"]),
      reaction: stringFromUnknown(row["reaction"]),
      severity: stringFromUnknown(row["severity"]),
      note: stringFromUnknown(row["note"]),
    })),
    caves: rows("caves", (row, index): LeadCaveDraft => ({
      id: stringFromUnknown(row["id"]) || `cave-${index + 1}`,
      label: stringFromUnknown(row["label"]),
      note: stringFromUnknown(row["note"]),
    })),
  };
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
    concern: lead.primary_concern_text ?? "",
    anamnese: lead.additional_concerns ?? "",
    diagnoses: clinical.diagnoses,
    medications: clinical.medications,
    allergies: clinical.allergies,
    caves: clinical.caves,
    serviceNeeds: Array.from(new Set([
      ...(lead.services ?? []),
      ...(lead.needs_interpreter ? ["interpreter_support"] : []),
    ].map(normalizeLeadServiceValue).filter(Boolean))),
    serviceComments: serviceCommentsFromLead(lead),
    discoverySource: inputString(lead.wizard_state?.["discovery_source"]) || questionnaireText(lead, "discoverySource", "howDidYouHearAboutUs", "referralSource"),
    referrer: inputString(lead.wizard_state?.["referrer"]),
    serviceNotes: lead.notes ?? "",
    specialties: lead.requested_specialties ?? [],
    privacyConsent: lead.consent_privacy_practices,
    healthcareConsent: lead.consent_healthcare,
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
  if (complianceKind === "identity" || complianceKind === "dsgvo") return complianceKind;

  const classification = [item.art, item.category, item.auto_name, item.original_filename]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (classification.includes("identity") || classification.includes("passport") || classification.includes("ausweis")) {
    return "identity";
  }
  if (classification.includes("dsgvo") || classification.includes("datenschutz")) {
    return "dsgvo";
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

function errorText(error: unknown, tx: Tx): string {
  const message = error instanceof Error && error.message ? error.message : "Request failed";
  const labels: Record<string, string> = {
    "Request failed": tx("Не удалось выполнить действие", "Aktion konnte nicht abgeschlossen werden"),
    "Lead is not selected": tx("Обращение не выбрано", "Kein Lead ausgewählt"),
    "Lead could not be saved": tx("Не удалось сохранить обращение", "Lead konnte nicht gespeichert werden"),
    "No order services available for quote": tx("Добавьте хотя бы одну услугу", "Mindestens eine Leistung hinzufügen"),
    "Failed to create quote": tx("Не удалось создать смету", "Kostenvoranschlag konnte nicht erstellt werden"),
    "Case intake is incomplete": tx("Заполните причину обращения и анамнез", "Anliegen und Anamnese vollständig ausfüllen"),
  };
  return labels[message] ?? message;
}

function readinessStepLabel(key: string, tx: Tx) {
  const labels: Record<string, string> = {
    master_data: tx("Данные клиента", "Personendaten"),
    medical: tx("Медицинская характеристика", "Medizinische Merkmale"),
    service: tx("Сервисная история", "Servicehistorie"),
    need: tx("Сервисная история", "Servicehistorie"),
    documents: tx("Документы", "Unterlagen"),
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
    "Signed DSGVO document is missing": tx("Загрузите и подтвердите согласие на обработку персональных данных", "Datenschutzeinwilligung hochladen und bestätigen"),
    "Anamnesis intake is incomplete": tx("Заполните и сохраните анамнез", "Anamnese ausfüllen und abschließen"),
    "Framework contract is not signed": tx("Подпишите рамочный договор", "Rahmenvertrag unterzeichnen"),
    "Onboarding order is missing": tx("Создайте заказ", "Auftrag erstellen"),
    "Order needs at least one valid service": tx("Добавьте в заказ хотя бы одну услугу", "Mindestens eine Leistung zum Auftrag hinzufügen"),
    "Customer order signature is missing": tx("Получите подпись клиента на заказе", "Unterschrift des Kunden für den Auftrag einholen"),
    "Agency order signature is missing": tx("Подтвердите заказ со стороны агентства", "Auftrag durch die Agentur bestätigen"),
    "Quote is not accepted": tx("Подтвердите смету", "Kostenvoranschlag annehmen"),
    "Required prepayment is not complete": tx("Укажите полученную предоплату", "Erforderliche Vorauszahlung erfassen"),
    "Lead is already converted": tx("Пациент уже создан", "Patient wurde bereits angelegt"),
  };
  return labels[reason] ?? tx("Проверьте незавершённые данные", "Unvollständige Angaben prüfen");
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
  checked,
  label,
  onChange,
  disabled,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 border-b border-border/70 py-3 last:border-b-0">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-[var(--brand)]" />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}

export function LeadWizard({
  leadId,
  open,
  onOpenChange,
  onConverted,
  onArchived,
  onShowDetails,
}: LeadWizardProps) {
  const { lang, t } = useLang();
  const tx: Tx = useCallback((ru, de) => (lang === "de" ? de : ru), [lang]);
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
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
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
  const [touchedMasterFields, setTouchedMasterFields] = useState<Set<MasterFieldKey>>(
    () => new Set(),
  );
  const [masterValidationAttempted, setMasterValidationAttempted] = useState(false);
  const [serviceValidationAttempted, setServiceValidationAttempted] = useState(false);
  const [medicalValidationAttempted, setMedicalValidationAttempted] = useState(false);
  const hydrated = useRef<string | null>(null);
  const stepNavRef = useRef<HTMLElement | null>(null);
  const wizardStateBaseRef = useRef<Record<string, unknown>>({});
  const currentAutosaveSignatureRef = useRef("");
  const lastSavedAutosaveSignatureRef = useRef("");
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const medicalSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const caseIdRef = useRef<string | null>(null);
  const commercialFlagRequestVersionRef = useRef<Record<CommercialFlagKey, number>>({
    signed_patient: 0,
    signed_agency: 0,
    prepayment_required: 0,
  });

  const reload = useCallback(async (hydrateDraft: boolean, hydrateCommercial = false) => {
    if (!leadId) return;
    setLoading(true);
    setError("");
    try {
      let attachmentImportError: unknown = null;
      const leadPromise = fetchLeadDetail(leadId);
      const documentsPromise = leadPromise.then(async (nextLead) => {
        if (nextLead.attachments?.some((attachment) => !attachment.imported_at)) {
          try {
            await importLeadAttachments(leadId);
          } catch (nextError) {
            attachmentImportError = nextError;
          }
        }
        return fetchDocuments("/documents?lead_id=" + encodeURIComponent(leadId)).catch(() => []);
      });
      const [nextLead, nextDocuments, nextCases, nextContracts, nextOrders, nextQuotes, nextSpecialties, nextAgencyServices, nextDoctors] = await Promise.all([
        leadPromise,
        documentsPromise,
        fetchCases("/cases?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchContracts("/framework-contracts?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchOrders("/orders?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchQuotes("/quotes?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchSpecializations().catch(() => []),
        fetchAgencyServices("/agency-services?active_only=true").catch(() => []),
        fetchCaseDoctors().catch(() => []),
      ]);
      const nextOrder = nextOrders[0] ?? null;
      const nextCase = nextCases[0] as CaseListItem | undefined;
      const nextCaseDetail = nextCase
        ? await fetchCaseDetail(nextCase.id).catch(() => null)
        : null;
      const nextOrderDetail = nextOrder && (hydrateDraft || hydrateCommercial)
        ? await fetchOrder(nextOrder.id).catch(() => null)
        : null;
      const paymentQuote = nextQuotes.find((item) => item.status === "accepted") ?? nextQuotes[0];
      const storedCommercialDraft = storedCommercialDraftFromLead(nextLead);
      const leadDraft = draftFromLead(nextLead);
      const nextDraft: Draft = nextCaseDetail ? {
        ...leadDraft,
        concern: nextCaseDetail.hauptanfragegrund || leadDraft.concern,
        anamnese: nextCaseDetail.aktuelle_anamnese || leadDraft.anamnese,
        referrer: nextCaseDetail.zuweiser || leadDraft.referrer,
        diagnoses: nextCaseDetail.vorerkrankungen.length > 0
          ? nextCaseDetail.vorerkrankungen.map((item, itemIndex) => ({
              id: leadDraft.diagnoses[itemIndex]?.id ?? `case-diagnosis-${itemIndex + 1}`,
              label: item.erkrankung,
              diagnosedOn: item.erstdiagnose ?? "",
              note: item.notiz ?? "",
              kind: leadDraft.diagnoses[itemIndex]?.kind ?? (itemIndex === 0 ? "main" : "secondary"),
              icdCode: leadDraft.diagnoses[itemIndex]?.icdCode ?? "",
              certainty: leadDraft.diagnoses[itemIndex]?.certainty ?? "bestaetigt",
              chronification: leadDraft.diagnoses[itemIndex]?.chronification ?? "",
            }))
          : leadDraft.diagnoses,
        medications: nextCaseDetail.medikamente.length > 0
          ? nextCaseDetail.medikamente.map((item, itemIndex) => ({
              id: leadDraft.medications[itemIndex]?.id ?? item.id ?? `case-medication-${itemIndex + 1}`,
              name: item.handelsname,
              activeIngredient: item.wirkstoff ?? "",
              dose: item.dosis ?? "",
              schedule: item.einnahmeschema ?? "",
              form: item.darreichungsform ?? "",
              route: leadDraft.medications[itemIndex]?.route ?? "",
              doseUnit: item.dosis_einheit ?? "",
              unit: item.einheit ?? "",
              note: item.anmerkung ?? "",
              reason: item.grund ?? "",
              since: item.seit ?? "",
              prescriberId: item.verordnender_arzt_id ?? "",
              prescriber: item.verordnender_arzt ?? "",
              medicationType: leadDraft.medications[itemIndex]?.medicationType ?? item.med_typ ?? "permanent",
              expiryDate: item.expiry_date ?? "",
              category: leadDraft.medications[itemIndex]?.category ?? (item.med_typ === "permanent" ? "dauer" : "besondere"),
              status: leadDraft.medications[itemIndex]?.status ?? "aktiv",
              doseMorning: leadDraft.medications[itemIndex]?.doseMorning ?? "",
              doseNoon: leadDraft.medications[itemIndex]?.doseNoon ?? "",
              doseEvening: leadDraft.medications[itemIndex]?.doseEvening ?? "",
              doseNight: leadDraft.medications[itemIndex]?.doseNight ?? "",
              prescribedOn: leadDraft.medications[itemIndex]?.prescribedOn ?? "",
              pharmacyOnly: leadDraft.medications[itemIndex]?.pharmacyOnly ?? false,
              prescriptionOnly: leadDraft.medications[itemIndex]?.prescriptionOnly ?? false,
              btm: leadDraft.medications[itemIndex]?.btm ?? false,
              autIdemBlocked: leadDraft.medications[itemIndex]?.autIdemBlocked ?? false,
              dispensingRestricted: leadDraft.medications[itemIndex]?.dispensingRestricted ?? false,
              otherNotes: leadDraft.medications[itemIndex]?.otherNotes ?? "",
            }))
          : leadDraft.medications,
        allergies: nextCaseDetail.allergien.length > 0
          ? nextCaseDetail.allergien.map((item, itemIndex) => ({
              id: leadDraft.allergies[itemIndex]?.id ?? `case-allergy-${itemIndex + 1}`,
              label: item.allergie,
              reaction: item.reaktion ?? "",
              severity: leadDraft.allergies[itemIndex]?.severity ?? "",
              note: leadDraft.allergies[itemIndex]?.note ?? "",
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
      setDocuments(nextDocuments);
      setCases(nextCases as CaseListItem[]);
      caseIdRef.current = nextCase?.id ?? null;
      setContracts(nextContracts);
      setOrders(nextOrders);
      setQuotes(nextQuotes);
      setSpecialties(nextSpecialties);
      setAgencyServices(nextAgencyServices.filter((item) => item.is_active));
      setDoctors(nextDoctors);
      wizardStateBaseRef.current = nextLead.wizard_state ?? {};
      if (hydrateDraft || hydrated.current !== leadId) {
        hydrated.current = leadId;
        setDraft(nextDraft);
        setStep(nextStep);
        setTouchedMasterFields(new Set());
        setMasterValidationAttempted(false);
        setServiceValidationAttempted(false);
        setMedicalValidationAttempted(false);
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
      if (attachmentImportError) {
        setError(
          `${tx("Не удалось импортировать файлы опросника", "Fragebogendateien konnten nicht importiert werden")}: ${errorText(attachmentImportError, tx)}`,
        );
      }
    } catch (nextError) {
      setError(errorText(nextError, tx));
    } finally {
      setLoading(false);
    }
  }, [leadId, tx]);

  useEffect(() => {
    if (open && leadId) void reload(true);
  }, [leadId, open, reload]);

  useEffect(() => {
    if (open) return;
    hydrated.current = null;
    setLead(null);
    setDraft(null);
    setError("");
    setAutosaveError("");
    setAutosaveStatus("idle");
    setArchiveConfirmOpen(false);
    setDeleteDocument(null);
    setDeleteReason("");
    setDeleteError("");
    setTouchedMasterFields(new Set());
    setMasterValidationAttempted(false);
    setServiceValidationAttempted(false);
    setMedicalValidationAttempted(false);
    currentAutosaveSignatureRef.current = "";
    lastSavedAutosaveSignatureRef.current = "";
    wizardStateBaseRef.current = {};
    caseIdRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const activeStep = stepNavRef.current?.querySelector<HTMLElement>(
      `[data-step="${step}"]`,
    );
    if (!activeStep) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeStep.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
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
  const wizardDocuments = useMemo(() => {
    const grouped: Record<WizardDocumentKind, DocumentItem[]> = {
      identity: [],
      dsgvo: [],
    };
    documents.forEach((item) => {
      if (item.file_deleted_at || item.has_stored_file === false) return;
      const kind = wizardDocumentKind(item);
      if (kind) grouped[kind].push(item);
    });
    return grouped;
  }, [documents]);
  const supplementaryDocuments = useMemo(
    () => documents.filter((item) => (
      !item.file_deleted_at
      && item.has_stored_file !== false
      && !wizardDocumentKind(item)
    )),
    [documents],
  );
  const intakeType = lead ? leadIntakeTypeFromLead(lead) : null;
  const isQuestionnaireLead = intakeType === "questionnaire";
  const isExternalIntakeLead = intakeType === "questionnaire" || intakeType === "form";
  const readiness = useMemo(() => new Map((lead?.readiness.steps ?? []).map((item) => [item.key, item.ready])), [lead?.readiness.steps]);
  const index = STEPS.findIndex((item) => item.id === step);
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
          erstdiagnose: item.diagnosedOn || null,
          notiz: item.note.trim() || null,
        })),
      }),
      saveCaseAllergien(id, {
        items: medicalDraft.allergies.filter((item) => item.label.trim()).map((item) => ({
          allergie: item.label.trim(),
          reaktion: item.reaction.trim() || null,
        })),
      }),
      saveCaseMedikamente(id, {
        items: medicalDraft.medications.filter((item) => item.name.trim()).map((item) => ({
          handelsname: item.name.trim(),
          wirkstoff: item.activeIngredient.trim() || null,
          dosis: item.dose.trim() || null,
          dosis_einheit: item.doseUnit.trim() || null,
          einnahmeschema: item.schedule.trim() || null,
          darreichungsform: item.form || null,
          einheit: item.unit.trim() || null,
          anmerkung: item.note.trim() || null,
          grund: item.reason.trim() || null,
          seit: item.since.trim() || null,
          verordnender_arzt_id: doctors.some((doctor) => doctor.id === item.prescriberId) ? item.prescriberId : null,
          verordnender_arzt: item.prescriber.trim() || null,
          med_typ: item.category === "dauer" ? "permanent" : "temporary",
          expiry_date: item.expiryDate || null,
        })),
      }),
      ]);
      return id;
    };
    const queued = medicalSaveQueueRef.current.then(run, run);
    medicalSaveQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [doctors, leadId]);

  const persistSnapshot = useCallback((snapshot: AutosaveSnapshot, force = false) => {
    if (!leadId) return Promise.reject(new Error(tx("Обращение не выбрано", "Kein Lead ausgewählt")));

    const targetLeadId = leadId;
    const signature = autosaveSnapshotSignature(snapshot);
    const previousWizardState = wizardStateBaseRef.current;
    const payload = autosavePayload(snapshot, previousWizardState);

    const run = async () => {
      if (!force && currentAutosaveSignatureRef.current !== signature) return;

      if (
        hydrated.current === targetLeadId &&
        currentAutosaveSignatureRef.current === signature
      ) {
        setAutosaveError("");
        setAutosaveStatus("saving");
      }

      try {
        await updateLeadWizard(targetLeadId, payload);
        if (snapshot.step === "medical") await persistMedicalDraft(snapshot.draft);
        if (hydrated.current !== targetLeadId) return;

        wizardStateBaseRef.current = payload.wizard_state;
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
  }, [leadId, persistMedicalDraft, tx]);

  useEffect(() => {
    if (!open || !leadId || !draft || loading) return;

    const snapshot: AutosaveSnapshot = {
      draft,
      lines,
      paidAmount,
      prepayment,
      step,
    };
    const signature = autosaveSnapshotSignature(snapshot);
    currentAutosaveSignatureRef.current = signature;

    if (signature === lastSavedAutosaveSignatureRef.current) {
      setAutosaveError("");
      setAutosaveStatus("saved");
      return;
    }

    setAutosaveError("");
    setAutosaveStatus("dirty");
    const timer = window.setTimeout(() => {
      void persistSnapshot(snapshot).catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [draft, leadId, lines, loading, open, paidAmount, persistSnapshot, prepayment, step]);

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setError("");
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const toggleServiceNeed = (value: string, checked: boolean) => {
    const normalized = normalizeLeadServiceValue(value);
    setError("");
    setDraft((current) => {
      if (!current) return current;
      if (checked) {
        return current.serviceNeeds.includes(normalized)
          ? current
          : { ...current, serviceNeeds: [...current.serviceNeeds, normalized] };
      }
      const serviceComments = { ...current.serviceComments };
      delete serviceComments[normalized];
      return {
        ...current,
        serviceNeeds: current.serviceNeeds.filter((item) => item !== normalized),
        serviceComments,
      };
    });
  };

  const patchServiceComment = (value: string, comment: string) => {
    const normalized = normalizeLeadServiceValue(value);
    setError("");
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
    if (!firstInvalid) return true;
    setMasterValidationAttempted(true);
    setStep("master_data");
    window.requestAnimationFrame(() => {
      document.getElementById(MASTER_FIELD_IDS[firstInvalid])?.focus();
    });
    return false;
  };

  async function save(target = step, trackBusy = true): Promise<boolean> {
    if (!leadId || !draft) return false;
    if (trackBusy) setBusy("save");
    setError("");
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
      await reload(false);
      return true;
    } catch (nextError) {
      setError(errorText(nextError, tx));
      return false;
    } finally {
      if (trackBusy) setBusy(null);
    }
  }

  async function finishService(targetStep: StepId): Promise<boolean> {
    if (!leadId || !draft) return false;
    if (!draft.concern.trim() || draft.specialties.length === 0) {
      setServiceValidationAttempted(true);
      const targetId = !draft.concern.trim() ? SERVICE_CONCERN_ID : SERVICE_SPECIALTIES_ID;
      window.requestAnimationFrame(() => document.getElementById(targetId)?.focus());
      return false;
    }
    const saved = await save(targetStep);
    if (saved) setServiceValidationAttempted(false);
    return saved;
  }

  async function persistMedicalCase(): Promise<string> {
    if (!draft) throw new Error("Lead is not selected");
    return persistMedicalDraft(draft);
  }

  async function finishMedical(targetStep: StepId): Promise<boolean> {
    if (!draft) return false;
    if (!draft.anamnese.trim()) {
      setMedicalValidationAttempted(true);
      window.requestAnimationFrame(() => document.getElementById(MEDICAL_ANAMNESE_ID)?.focus());
      return false;
    }
    setBusy("intake");
    setError("");
    try {
      await persistMedicalCase();
      const saved = await save(targetStep, false);
      if (saved) setMedicalValidationAttempted(false);
      return saved;
    } catch (nextError) {
      setError(errorText(nextError, tx));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function finishIntake(targetStep: StepId): Promise<boolean> {
    if (!leadId || !draft) return false;
    setError("");
    if (!ensureMasterDataReady()) return false;
    if (!draft.concern.trim()) {
      setServiceValidationAttempted(true);
      setStep("service");
      window.requestAnimationFrame(() => document.getElementById(SERVICE_CONCERN_ID)?.focus());
      return false;
    }
    if (!draft.anamnese.trim()) {
      setMedicalValidationAttempted(true);
      setStep("medical");
      window.requestAnimationFrame(() => document.getElementById(MEDICAL_ANAMNESE_ID)?.focus());
      return false;
    }
    setBusy("intake");
    try {
      const id = await persistMedicalCase();
      await completeCaseIntake(id, true, {
        hauptanfragegrund: draft.concern.trim(),
        aktuelle_anamnese: draft.anamnese.trim(),
      });
      const saved = await save(targetStep, false);
      if (saved && lead?.qualification_status !== "qualified") {
        await updateLeadStatus(leadId, "qualified");
        await reload(false);
      }
      return saved;
    } catch (nextError) {
      setError(errorText(nextError, tx));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function upload(kind: "identity" | "dsgvo", file: File) {
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
      form.set("auto_name", kind === "identity" ? "Identity document" : "DSGVO consent");
      form.set("art", kind === "identity" ? "identity" : "consent");
      form.set("category", kind === "identity" ? "identity" : "consent");
      await uploadDocument(form);
      await reload(false);
    } catch (nextError) {
      setError(errorText(nextError, tx));
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
        document.original_filename || document.auto_name || "document",
      );
    } catch (nextError) {
      setError(errorText(nextError, tx));
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
      await reload(false);
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
      await reload(false);
    } catch (nextError) {
      setError(errorText(nextError, tx));
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
      })).id;
    }
    for (const line of lines.filter(validLine)) {
      await createOrderLeistung(orderId, {
        agency_service_id: line.agencyServiceId,
        description: line.description.trim(),
        quantity: money(line.quantity),
        unit_price: money(line.price),
        vat_rate: money(line.vat),
        client_reference: line.clientReference ?? "lead-wizard:" + leadId + ":" + line.id,
      });
    }
    await updateOrderCommercialBasis(orderId, {
      contract_id: contractId,
      total_estimated: estimate.gross.toFixed(2),
      prepayment_required: flags.prepayment_required ?? prepayment,
      signed_patient: flags.signed_patient ?? signedPatient,
      signed_agency: flags.signed_agency ?? signedAgency,
      needs_description: needsDescription,
    });
    return { contractId, orderId };
  }

  async function prepareCommercial() {
    setBusy("commercial");
    try {
      await ensureCommercial();
      await reload(false, true);
    } catch (nextError) {
      setError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function signContract() {
    setBusy("contract");
    try {
      const result = await ensureCommercial();
      await updateContractStatus(result.contractId, { status: "signed" });
      await reload(false, true);
    } catch (nextError) {
      setError(errorText(nextError, tx));
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
          void fetchLeadDetail(targetLeadId).then((nextLead) => {
            if (hydrated.current === targetLeadId) setLead(nextLead);
          }).catch(() => undefined);
        }
      } else {
        await ensureCommercial(patchValue);
        await reload(false, true);
      }
    } catch (nextError) {
      if (hydrated.current === targetLeadId) {
        setError(errorText(nextError, tx));
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
      setError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    if (!leadId) return;
    setBusy("convert");
    try {
      if (!(await save("release", false))) return;
      const result = await wizardConvertLead(leadId);
      onConverted?.(result.patient_id);
      onOpenChange(false);
    } catch (nextError) {
      setError(errorText(nextError, tx));
      await reload(false);
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
      setError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  function next() {
    if (step === "master_data" && !ensureMasterDataReady()) return;

    const target = STEPS[index + 1];
    if (!target) return;
    if (step === "documents") {
      void finishIntake(target.id).then((saved) => {
        if (saved) setStep(target.id);
      });
      return;
    }
    if (step === "medical") {
      void finishMedical(target.id).then((saved) => {
        if (saved) setStep(target.id);
      });
      return;
    }
    if (step === "service") {
      void finishService(target.id).then((saved) => {
        if (saved) setStep(target.id);
      });
      return;
    }
    void save(target.id).then((saved) => {
      if (saved) setStep(target.id);
    });
  }

  function updateLine(id: string, patchValue: Partial<ServiceLine>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patchValue } : line));
  }

  function addAgencyService(serviceId: string) {
    const service = agencyServices.find((item) => item.id === serviceId);
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

  function specialtyLabel(value: string) {
    const specialty = specialties.find(
      (item) => (item.code || item.name_en) === value,
    );
    if (!specialty) return value;
    return lang === "de"
      ? specialty.name_de || specialty.name_en
      : specialty.name_ru || specialty.name_de || specialty.name_en;
  }

  if (!leadId) return null;
  const isBusy = busy !== null;
  const renderedAutosaveSignature = draft
    ? autosaveSnapshotSignature({ draft, lines, paidAmount, prepayment, step })
    : "";
  const autosaveIsDirty = Boolean(
    draft && renderedAutosaveSignature !== lastSavedAutosaveSignatureRef.current,
  ) || autosaveStatus === "saving" || autosaveStatus === "error";
  return (
    <>
      <Dialog open={open} dirty={autosaveIsDirty} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 sm:h-[min(88vh,52rem)] sm:w-[min(92vw,64rem)] sm:max-w-5xl">
        <DialogTitle className="sr-only">{tx("Оформление обращения", "Lead-Aufnahme")}</DialogTitle>
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border px-4 py-3 pr-14 sm:px-5 sm:pr-14">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">{lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") : tx("Оформление обращения", "Lead-Aufnahme")}</h2>
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
            <Button type="button" variant="outline" size="icon-sm" title={tx("Обновить", "Aktualisieren")} aria-label={tx("Обновить", "Aktualisieren")} disabled={loading || isBusy} onClick={() => void reload(false)}>
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </header>

        <nav
          ref={stepNavRef}
          className="overflow-x-auto overscroll-x-contain border-b border-border"
          aria-label={tx("Этапы оформления", "Schritte der Lead-Aufnahme")}
        >
          <div className="grid min-w-[52rem] grid-cols-6 sm:min-w-0">
            {STEPS.map((item, itemIndex) => {
              const selected = item.id === step;
              const done = item.id === "medical"
                ? Boolean(draft?.anamnese.trim())
                : readiness.get(item.id) ?? false;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-step={item.id}
                  onClick={() => {
                    if (step === "medical" && itemIndex > index) {
                      void finishMedical(item.id).then((saved) => {
                        if (saved) setStep(item.id);
                      });
                      return;
                    }
                    if (step === "service" && itemIndex > index) {
                      void finishService(item.id).then((saved) => {
                        if (saved) setStep(item.id);
                      });
                      return;
                    }
                    if (step === "documents" && itemIndex > index) {
                      void finishIntake(item.id).then((saved) => {
                        if (saved) setStep(item.id);
                      });
                      return;
                    }
                    setStep(item.id);
                  }}
                  aria-current={selected ? "step" : undefined}
                  className={cn(
                    "relative min-w-0 border-r border-border px-3 py-3 text-left last:border-r-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
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

        <main aria-busy={loading || isBusy} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
          {error ? <div role="alert" className="mb-5 border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
          {loading && !lead ? <div role="status" aria-live="polite" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{tx("Загрузка…", "Wird geladen…")}</div> : null}

          {draft && step === "master_data" ? (
            <section className="space-y-5">
              <h3 className="text-sm font-semibold text-foreground">{tx("Данные клиента", "Personendaten")}</h3>
              {lead ? (
                <LeadQuestionnaireFacts
                  items={[
                    { label: tx("Тип", "Typ"), value: intakeTypeLabel(lead, tx) },
                    { label: tx("Источник", "Quelle"), value: lead.source ? leadSourceLabel(lead.source, t) : tx("Не указано", "Nicht angegeben") },
                    { label: tx("Сценарий", "Ablauf"), value: intakeFlowLabel(lead.flow, tx) },
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
                <Field label={tx("Суффикс имени", "Namenszusatz")}>
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
            <LeadMedicalIntakeForm
              lead={lead}
              tx={tx}
              anamneseId={MEDICAL_ANAMNESE_ID}
              anamnese={draft.anamnese}
              diagnoses={draft.diagnoses}
              medications={draft.medications}
              allergies={draft.allergies}
              caves={draft.caves}
              doctors={doctors}
              validationAttempted={medicalValidationAttempted}
              onAnamneseChange={(value) => patch("anamnese", value)}
              onDiagnosesChange={(value) => patch("diagnoses", value)}
              onMedicationsChange={(value) => patch("medications", value)}
              onAllergiesChange={(value) => patch("allergies", value)}
              onCavesChange={(value) => patch("caves", value)}
            />
          ) : null}


          {draft && lead && step === "service" ? (
            <section className="space-y-5">
              <Field
                required
                label={tx("Причина обращения", "Anliegen")}
                error={serviceValidationAttempted && !draft.concern.trim() ? tx("Обязательное поле", "Pflichtfeld") : undefined}
                errorId={`${SERVICE_CONCERN_ID}-error`}
              >
                <textarea
                  id={SERVICE_CONCERN_ID}
                  className={cn(
                    textareaClass,
                    "min-h-28",
                    serviceValidationAttempted && !draft.concern.trim() && "border-destructive",
                  )}
                  aria-invalid={serviceValidationAttempted && !draft.concern.trim()}
                  aria-describedby={serviceValidationAttempted && !draft.concern.trim() ? `${SERVICE_CONCERN_ID}-error` : undefined}
                  value={draft.concern}
                  onChange={(event) => patch("concern", event.target.value)}
                />
              </Field>
              {isQuestionnaireLead ? (
                <LeadQuestionnaireFacts
                  items={[
                    { label: tx("Нужен переводчик", "Dolmetscher benötigt"), value: yesNoValue(lead.needs_interpreter, tx) },
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
                    ...LEAD_QUESTIONNAIRE_SERVICE_OPTIONS,
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
                              className={cn(textareaClass, "min-h-20 resize-y")}
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
              <Field label={tx("Откуда вы о нас узнали?", "Wie sind Sie auf uns aufmerksam geworden?")}>
                <Input
                  name="discovery_source"
                  autoComplete="off"
                  value={draft.discoverySource}
                  onChange={(event) => patch("discoverySource", event.target.value)}
                />
              </Field>
              <div className="space-y-3 pt-2">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {tx("Специализации", "Fachrichtungen")}
                  <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>
                </span>
                <NativeComboboxSelect
                  id={SERVICE_SPECIALTIES_ID}
                  aria-label={tx("Добавить специализацию", "Fachrichtung hinzufügen")}
                  aria-invalid={serviceValidationAttempted && draft.specialties.length === 0}
                  aria-describedby={serviceValidationAttempted && draft.specialties.length === 0 ? `${SERVICE_SPECIALTIES_ID}-error` : undefined}
                  name="specialty"
                  value=""
                  onChange={(event) => {
                    const selected = specialties.find((item) => item.id === event.target.value);
                    if (!selected) return;
                    const value = selected.code || selected.name_en;
                    if (!draft.specialties.includes(value)) patch("specialties", [...draft.specialties, value]);
                  }}
                  className={cn(selectClass, serviceValidationAttempted && draft.specialties.length === 0 && "border-destructive")}
                >
                  <option value="">{tx("Добавить специализацию", "Fachrichtung hinzufügen")}</option>
                  {specialties.map((item) => <option key={item.id} value={item.id}>{lang === "de" ? item.name_de || item.name_en : item.name_ru || item.name_de || item.name_en}</option>)}
                </NativeComboboxSelect>
                {serviceValidationAttempted && draft.specialties.length === 0 ? (
                  <span id={`${SERVICE_SPECIALTIES_ID}-error`} role="alert" className="block text-xs leading-4 text-destructive">
                    {tx("Выберите хотя бы одну специализацию", "Mindestens eine Fachrichtung auswählen")}
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
              <Field label={tx("Направивший врач", "Zuweisender Arzt")}><Input value={draft.referrer} onChange={(event) => patch("referrer", event.target.value)} /></Field>
            </section>
          ) : null}

          {draft && step === "documents" ? (
            <section className="space-y-5">
              {(["identity", "dsgvo"] as const).map((kind) => {
                const kindDocuments = wizardDocuments[kind];
                const label = kind === "identity" ? tx("Документ, удостоверяющий личность", "Ausweisdokument") : tx("Согласие на обработку персональных данных", "Datenschutzeinwilligung (DSGVO)");
                const fileId = "lead-file-" + kind;
                return (
                  <div key={kind} className="space-y-3 border-y border-border py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">{label}</div>
                      <input
                        id={fileId}
                        type="file"
                        className="peer sr-only"
                        accept=".pdf,.jpg,.jpeg,.png"
                        disabled={isBusy}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          if (file) {
                            void upload(kind, file);
                            event.currentTarget.value = "";
                          }
                        }}
                      />
                      <label
                        htmlFor={fileId}
                        className={cn(
                          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground shadow-xs hover:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                          isBusy && "pointer-events-none opacity-50",
                        )}
                      >
                        <Upload aria-hidden="true" className="size-3.5" />
                        {kindDocuments.length > 0 ? tx("Добавить файл", "Datei hinzufügen") : tx("Загрузить файл", "Datei hochladen")}
                      </label>
                    </div>

                    {kindDocuments.length > 0 ? (
                      <div className="divide-y divide-border rounded-md border border-border">
                        {kindDocuments.map((document) => {
                          const signed = Boolean(document.signed_at && document.compliance_kind === kind);
                          const sizeLabel = formatFileSize(document.file_size, lang);
                          return (
                            <div key={document.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                              <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-foreground">
                                  {document.original_filename || document.auto_name}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                  {sizeLabel ? <span className="font-mono tabular-nums">{sizeLabel}</span> : null}
                                  <StateMark done={signed} label={signed ? tx("Подтверждён", "Bestätigt") : tx("Не подтверждён", "Nicht bestätigt")} />
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <Button type="button" variant="ghost" size="icon-sm" title={tx("Скачать файл", "Datei herunterladen")} aria-label={tx("Скачать файл", "Datei herunterladen")} disabled={isBusy} onClick={() => void downloadDocument(document)}>
                                  {busy === `download-${document.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                                </Button>
                                <Button type="button" variant="ghost" size="icon-sm" title={tx("Подтвердить документ", "Dokument bestätigen")} aria-label={tx("Подтвердить документ", "Dokument bestätigen")} disabled={signed || isBusy} onClick={() => void signDocument(document.id, kind)}>
                                  <FileCheck2 className={cn("size-3.5", signed && "text-emerald-700")} />
                                </Button>
                                <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" title={tx("Удалить файл", "Datei löschen")} aria-label={tx("Удалить файл", "Datei löschen")} disabled={isBusy} onClick={() => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}>
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">{tx("Файлы не добавлены", "Keine Dateien hinzugefügt")}</div>
                    )}
                  </div>
                );
              })}
              {supplementaryDocuments.length > 0 ? (
                <div className="space-y-3 border-y border-border py-3">
                  <div className="text-sm font-medium text-foreground">
                    {tx("Другие документы", "Weitere Dokumente")}
                  </div>
                  <div className="divide-y divide-border rounded-md border border-border">
                    {supplementaryDocuments.map((document) => (
                      <div key={document.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                        <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">
                            {document.original_filename || document.auto_name}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {formatFileSize(document.file_size, lang)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button type="button" variant="ghost" size="icon-sm" title={tx("Скачать файл", "Datei herunterladen")} aria-label={tx("Скачать файл", "Datei herunterladen")} disabled={isBusy} onClick={() => void downloadDocument(document)}>
                            {busy === `download-${document.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" title={tx("Удалить файл", "Datei löschen")} aria-label={tx("Удалить файл", "Datei löschen")} disabled={isBusy} onClick={() => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {isExternalIntakeLead && lead ? (
                <LeadQuestionnaireFacts
                  items={[
                    { label: tx("Согласие на связь по E-Mail", "Einwilligung zur Kontaktaufnahme per E-Mail"), value: yesNoValue(lead.email_consent, tx) },
                    { label: tx("Согласие на связь по WhatsApp", "Einwilligung zur Kontaktaufnahme per WhatsApp"), value: yesNoValue(lead.whatsapp_consent, tx) },
                    { label: tx("Согласие на автоматизированный контакт", "Einwilligung zur automatisierten Kontaktaufnahme"), value: yesNoValue(lead.consent_automated_contact, tx) },
                    { label: tx("Информация о праве отказа подтверждена", "Hinweis zum Widerruf bestätigt"), value: yesNoValue(lead.consent_opt_out, tx) },
                  ]}
                />
              ) : null}
              <div className="border-y border-border"><ToggleRow checked={draft.privacyConsent} disabled={isBusy} onChange={(checked) => patch("privacyConsent", checked)} label={tx("Клиент ознакомлен с политикой конфиденциальности", "Datenschutzhinweise wurden bestätigt")} /><ToggleRow checked={draft.healthcareConsent} disabled={isBusy} onChange={(checked) => patch("healthcareConsent", checked)} label={tx("Получено согласие на обработку медицинских данных", "Einwilligung zur Verarbeitung von Gesundheitsdaten liegt vor")} /></div>
            </section>
          ) : null}

          {draft && step === "commercial" ? (
            <section className="space-y-5">
              <h3 className="text-sm font-semibold text-foreground">{tx("Договор, заказ и смета", "Vertrag, Auftrag und Kostenvoranschlag")}</h3>
              <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3"><div><div className="text-sm font-medium text-foreground">{tx("Рамочный договор", "Rahmenvertrag")}</div><div className="mt-1 text-xs text-muted-foreground">{contract?.contract_number ?? tx("Договор ещё не создан", "Vertrag noch nicht erstellt")}</div></div><div className="flex items-center gap-2"><StateMark done={contract?.status === "signed"} label={contract?.status === "signed" ? tx("Договор подписан", "Vertrag unterzeichnet") : tx("Договор не подписан", "Vertrag nicht unterzeichnet")} /><Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void signContract()}>{busy === "contract" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileCheck2 className="size-3.5" />}{tx("Подписать договор", "Vertrag unterzeichnen")}</Button></div></div>
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
                <span className="text-sm font-medium text-foreground">{tx("Услуги", "Leistungen")}</span>
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
                ) : null}
                {lines.map((line) => {
                  const catalogService = agencyServices.find((service) => service.id === line.agencyServiceId);
                  return (
                    <div key={line.id} className="grid gap-3 rounded-md border border-border px-3 py-3 sm:grid-cols-[minmax(0,1fr)_90px_110px_80px_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-medium text-foreground">{line.description}</div>
                        {catalogService?.unit_label ? <div className="mt-0.5 text-xs text-muted-foreground">{catalogService.unit_label}</div> : null}
                      </div>
                      <Field label={tx("Количество", "Menge")}>
                        <Input name={`service_quantity_${line.id}`} autoComplete="off" inputMode="decimal" aria-label={tx("Количество", "Menge")} value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} />
                      </Field>
                      <div className="font-mono text-sm tabular-nums text-foreground sm:text-right">
                        <div className="font-sans text-[11px] uppercase text-muted-foreground">{tx("Цена за единицу", "Einzelpreis")}</div>
                        {formatMoneyValue(money(line.price), lang)} {catalogService?.currency || "EUR"}
                      </div>
                      <div className="font-mono text-sm tabular-nums text-foreground sm:text-right">
                        <div className="font-sans text-[11px] uppercase text-muted-foreground">{tx("НДС", "MwSt.")}</div>
                        {formatMoneyValue(money(line.vat), lang)}%
                      </div>
                      <Button type="button" variant="ghost" size="icon-sm" title={tx("Удалить услугу", "Leistung entfernen")} aria-label={tx("Удалить услугу", "Leistung entfernen")} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}><X className="size-3.5" /></Button>
                    </div>
                  );
                })}
                <div className="flex flex-wrap justify-end gap-x-6 gap-y-2 text-sm text-muted-foreground">
                  <span>{tx("Нетто", "Netto")}: <span className="font-mono tabular-nums">{formatMoneyValue(estimate.net, lang)} EUR</span></span>
                  <span>{tx("НДС", "MwSt.")}: <span className="font-mono tabular-nums">{formatMoneyValue(estimate.vat, lang)} EUR</span></span>
                  <span className="font-semibold text-foreground">{tx("Итого", "Gesamt")}: <span className="font-mono tabular-nums">{formatMoneyValue(estimate.gross, lang)} EUR</span></span>
                </div>
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
              <div className="grid gap-3 border-b border-border pb-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"><Field label={tx("Полученная предоплата", "Erhaltene Vorauszahlung")}><Input className="font-mono tabular-nums" inputMode="decimal" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} disabled={!prepayment} placeholder="0.00" /></Field><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={isBusy || !lines.some(validLine)} onClick={() => void createOrAcceptQuote(false)}>{busy === "quote" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}{quote ? tx("Создать новую смету", "Neuen Kostenvoranschlag erstellen") : tx("Создать смету", "Kostenvoranschlag erstellen")}</Button><Button type="button" variant="outline" disabled={isBusy || !quote} onClick={() => void createOrAcceptQuote(true)}>{busy === "accept" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}{tx("Подтвердить смету", "Kostenvoranschlag annehmen")}</Button></div></div>
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

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <Button type="button" variant="outline" size="sm" disabled={isBusy || index === 0} onClick={() => setStep(STEPS[index - 1].id)}><ChevronLeft className="size-3.5" />{tx("Назад", "Zurück")}</Button>
          {step !== "release" ? <Button type="button" size="sm" disabled={isBusy} onClick={next}>{busy === "save" || busy === "intake" ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{tx("Далее", "Weiter")}<ChevronRight className="size-3.5" /></Button> : null}
        </footer>
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
