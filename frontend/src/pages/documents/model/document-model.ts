import type {
  DocumentItem,
  DocumentStatus,
  DocumentTemplate,
  DocumentVisibility,
  EditFormState,
  FiltersState,
  GenerateFormState,
  PatientOption,
  UploadFormState,
} from "./types";
import { formatUnknownValue, type Translations } from "@/lib/i18n";

export const STATUS_OPTIONS: DocumentStatus[] = ["draft", "active", "archived"];
export const VISIBILITY_OPTIONS: DocumentVisibility[] = [
  "internal",
  "released_internal",
  "released_external",
  "patient_visible",
];

export function canManageDocuments(role?: string) {
  return role === "ceo" || role === "patient_manager" || role === "it_admin";
}

export function canUploadDocuments(role?: string) {
  return [
    "ceo",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
    "it_admin",
  ].includes(role ?? "");
}

export function canManageDocumentIntake(role?: string) {
  return ["ceo", "patient_manager", "teamlead_interpreter", "it_admin"].includes(
    role ?? "",
  );
}

export function canViewDocuments(role?: string) {
  return [
    "ceo",
    "ceo_assistant",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
    "concierge",
    "billing",
    "it_admin",
  ].includes(role ?? "");
}

export function canRequestTranslations(role?: string) {
  return [
    "ceo",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
    "concierge",
    "it_admin",
  ].includes(role ?? "");
}

export function canUpdateTranslations(role?: string) {
  return [
    "ceo",
    "patient_manager",
    "teamlead_interpreter",
    "concierge",
    "it_admin",
  ].includes(role ?? "");
}

export function canViewDocumentShares(role?: string) {
  return ["ceo", "ceo_assistant", "patient_manager", "it_admin"].includes(role ?? "");
}

export function buildDocumentsPath(filters: FiltersState) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.patientId) params.set("patient_id", filters.patientId);
  if (filters.orderId) params.set("order_id", filters.orderId);
  if (filters.appointmentId) params.set("appointment_id", filters.appointmentId);
  if (filters.status) params.set("status", filters.status);
  if (filters.visibility) params.set("visibility", filters.visibility);
  if (filters.art.trim()) params.set("art", filters.art.trim());
  if (filters.category) params.set("category", filters.category);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (filters.klinik.trim()) params.set("klinik", filters.klinik.trim());
  if (filters.ursprung.trim()) params.set("ursprung", filters.ursprung.trim());
  if (filters.documentDirection)
    params.set("document_direction", filters.documentDirection);
  if (filters.documentVariant) params.set("document_variant", filters.documentVariant);
  if (filters.accessCategory) params.set("access_category", filters.accessCategory);
  if (filters.financialStatus) params.set("financial_status", filters.financialStatus);
  return params.size ? `/documents?${params.toString()}` : "/documents";
}

export function patientOptionLabel(patient: PatientOption) {
  return `${patient.patient_id} · ${[patient.first_name, patient.last_name].filter(Boolean).join(" ")}`;
}

export function patientDocumentAddresseeLabel(
  patientId: string,
  patients: PatientOption[],
) {
  const patient = patients.find((item) => item.id === patientId);
  if (!patient) return "";
  const patientName = [patient.first_name, patient.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return patientName || patient.patient_id || "";
}

export type StandardDocumentNameInput = {
  category?: string | null;
  art?: string | null;
  isMedical?: boolean | null;
  documentDate?: string | Date | null;
  source?: string | null;
  addressee?: string | null;
};

const DOCUMENT_ART_LABELS: Record<string, string> = {
  appointment_confirmation: "Terminbestätigung",
  consent_data_release: "Einverständniserklärung",
  consent_data_release_child: "Einverständniserklärung (Kind)",
  consent_data_release_single: "Einverständniserklärung (alleiniges Sorgerecht)",
  cost_coverage_declaration: "Kostenübernahmeerklärung",
  cost_estimate: "Kostenschätzung",
  framework_contract: "Rahmendienstleistungsvertrag",
  medication_summary: "Medikamentenübersicht",
  patient_sticker: "Patientenetikett",
  single_order: "Einzelauftrag",
  treatment_plan: "Behandlungsplan",
  visa_invitation: "Einladungsschreiben (Visum)",
  visa_invitation_letter: "Einladungsschreiben (Visum)",
};

function normalizeDocumentLookup(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cleanDocumentNamePart(value?: string | null) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .trim();
}

function formatDocumentDate(value?: string | Date | null) {
  if (!value) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return [
      String(value.getDate()).padStart(2, "0"),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getFullYear()).padStart(4, "0"),
    ].join(".");
  }
  const trimmed = value.trim();
  if (!trimmed) return "";
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;
  const localMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (localMatch) {
    const year =
      localMatch[3].length === 2 ? `20${localMatch[3]}` : localMatch[3];
    return `${localMatch[1].padStart(2, "0")}.${localMatch[2].padStart(2, "0")}.${year}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatDocumentDate(parsed);
}

function medicalDocumentCode(input: StandardDocumentNameInput) {
  const haystack = normalizeDocumentLookup(
    [input.category, input.art, input.source].filter(Boolean).join(" "),
  );
  if (haystack.match(/\b(kardio|cardio|kardiol|cardiol|herz)/)) {
    return "KARDIO";
  }
  if (haystack.match(/\b(gastro|gastroenterolog|magen|darm)\b/)) {
    return "GASTRO";
  }
  if (haystack.match(/\b(uro|urolog)\b/)) return "URO";
  if (haystack.match(/\b(lab|labor|laborergebnis|laboranalyse)\b/)) return "LAB";
  if (haystack.match(/\b(patho|patholog|histo|histolog)\b/)) {
    return "PATHO-HISTO";
  }
  if (haystack.match(/\b(radio|radiolog|sono|sonographie|ct|mrt|rontgen|pet)\b/)) {
    return "RAD";
  }
  return "MED";
}

function standardDocumentCategoryCode(input: StandardDocumentNameInput) {
  const category = normalizeDocumentLookup(input.category);
  const art = normalizeDocumentLookup(input.art);
  if (
    input.isMedical ||
    ["medical", "medical_report", "lab_analysis", "conclusion"].includes(category)
  ) {
    return medicalDocumentCode(input);
  }
  if (art.match(/\b(visa|invitation|einladung|behoerde|amt)\b/)) return "AMT";
  if (art.match(/\b(cost|kosten|invoice|rechnung|coverage|uebernahme)\b/)) {
    return "FIN";
  }
  if (art.match(/\b(contract|vertrag|order|auftrag)\b/)) return "VERTRAG";
  if (["finance", "financial", "invoice"].includes(category)) return "FIN";
  if (["identity", "personal", "personlich"].includes(category)) return "PERS";
  if (["insurance", "versicherung"].includes(category)) return "VERS";
  if (["other", "sonstige"].includes(category)) return "SONST";
  if (
    [
      "administrative",
      "admin",
      "clinic_correspondence",
      "clinic_form",
      "consent",
      "portal_upload",
    ].includes(category)
  ) {
    return "ADMIN";
  }
  if (["official", "agency", "behoerde", "amtlich", "vedomstvennye"].includes(category)) {
    return "AMT";
  }
  if (category === "contract") return "VERTRAG";
  if (category === "translation") return "UEB";
  if (category === "generated") return "GEN";
  const compact = (input.category ?? "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 8)
    .toUpperCase();
  return compact || "DOK";
}

function formatDocumentArt(value?: string | null) {
  const trimmed = cleanDocumentNamePart(value);
  if (!trimmed) return "";
  const normalizedKey = normalizeDocumentLookup(trimmed).replace(/[^a-z0-9]+/g, "_");
  const mapped = DOCUMENT_ART_LABELS[normalizedKey];
  if (mapped) return mapped;
  if (trimmed.includes("_")) {
    return trimmed
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return trimmed;
}

export function buildStandardDocumentName(input: StandardDocumentNameInput) {
  const categoryCode = standardDocumentCategoryCode(input);
  const date = formatDocumentDate(input.documentDate);
  const documentType = formatDocumentArt(input.art);
  const typeAndDate = cleanDocumentNamePart(
    [documentType, date ? `vom ${date}` : ""].filter(Boolean).join(" "),
  );
  return [
    categoryCode,
    typeAndDate,
    cleanDocumentNamePart(input.source),
    cleanDocumentNamePart(input.addressee),
  ]
    .filter(Boolean)
    .join("-");
}

export function formatConfidenceLabel(
  value: string,
  tr: Pick<
    Translations,
    | "common_unknown"
    | "common_unknown_value"
    | "documents_confidence_high"
    | "documents_confidence_medium"
    | "documents_confidence_low"
  >,
): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high") return tr.documents_confidence_high;
  if (normalized === "medium") return tr.documents_confidence_medium;
  if (normalized === "low") return tr.documents_confidence_low;
  return formatUnknownValue(value, tr);
}

export function normalizeTemplateLanguage(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (
    ["de", "de-de", "de_at", "de-at", "de_ch", "de-ch"].includes(normalized)
  ) {
    return "de";
  }
  if (["uk", "uk-ua", "ua", "ukrainian"].includes(normalized)) return "uk";
  if (["en", "en-gb", "en-us", "english"].includes(normalized)) return "en";
  if (["ru", "ru-ru", "russian"].includes(normalized)) return "ru";
  return null;
}

export function resolveTemplateLanguage(
  patientId: string,
  template: DocumentTemplate | null,
  patients: PatientOption[],
) {
  if (!template) return "de";
  const patient = patients.find((item) => item.id === patientId);
  const supportedLanguages = new Set(template.supported_languages);
  for (const language of patient?.languages ?? []) {
    const normalized = normalizeTemplateLanguage(language);
    if (normalized && supportedLanguages.has(normalized)) {
      return normalized;
    }
  }
  return template.supported_languages[0] ?? "de";
}

export function templateForDocument(
  templates: DocumentTemplate[],
  detail: DocumentItem | null,
) {
  if (!detail) return null;
  const generatedTemplateId =
    detail.generated_template_id?.trim() ||
    (detail.ursprung?.startsWith("template:")
      ? detail.ursprung.slice("template:".length).trim()
      : "");
  if (generatedTemplateId) {
    const exactTemplate = templates.find(
      (template) => template.id === generatedTemplateId,
    );
    if (exactTemplate) return exactTemplate;
  }
  return (
    templates.find(
      (template) =>
        (template.template_kind ?? "builtin") === "builtin" &&
        template.art === detail.art && template.category === detail.category,
    ) ?? null
  );
}

export function emptyUploadForm(patientId = ""): UploadFormState {
  return {
    file: null,
    patientId,
    orderId: "",
    appointmentId: "",
    autoName: "",
    art: "",
    category: "",
    status: "active",
    visibility: "internal",
    isMedical: false,
    klinik: "",
    ursprung: "",
    documentDirection: "incoming",
    documentVariant: "original",
    documentLanguage: "",
    accessCategory: "internal",
    documentDate: new Date().toISOString().slice(0, 10),
    sourcePerson: "",
    sourceInstitution: "",
    addresseePerson: "",
    addresseeInstitution: "GMED",
    financialStatus: "",
    paymentDueDate: "",
    paymentDate: "",
    paymentMethod: "",
    notes: "",
  };
}

export function emptyGenerateForm(patientId = ""): GenerateFormState {
  return {
    templateId: "",
    patientId,
    orderId: "",
    appointmentId: "",
    replaceDocumentId: "",
    autoName: "",
    status: "draft",
    visibility: "patient_visible",
    language: "de",
    titleOverride: "",
    introduction: "",
    closingNote: "",
    klinik: "",
    ursprung: "",
    documentDirection: "outgoing",
    documentVariant: "original",
    documentLanguage: "de",
    accessCategory: "patient",
    documentDate: new Date().toISOString().slice(0, 10),
    sourcePerson: "",
    sourceInstitution: "GMED",
    addresseePerson: "",
    addresseeInstitution: "",
    notes: "",
    financialStatus: "",
    paymentDueDate: "",
    paymentDate: "",
    paymentMethod: "",
    textBlockKeys: [],
    bindings: {},
  };
}

export function detailToEditForm(detail: DocumentItem): EditFormState {
  return {
    patientId: detail.patient_id ?? "",
    orderId: detail.order_id ?? "",
    appointmentId: detail.appointment_id ?? "",
    autoName: detail.auto_name,
    art: detail.art,
    category: detail.category ?? "",
    status: (detail.status as DocumentStatus) ?? "active",
    visibility: (detail.visibility as DocumentVisibility) ?? "internal",
    isMedical: detail.is_medical,
    klinik: detail.klinik ?? "",
    ursprung: detail.ursprung ?? "",
    documentDirection: detail.document_direction ?? "incoming",
    documentVariant: detail.document_variant ?? "original",
    documentLanguage: detail.document_language ?? "",
    accessCategory:
      detail.access_category ?? (detail.is_medical ? "medical" : "internal"),
    documentDate: detail.document_date ?? "",
    sourcePerson: detail.source_person ?? "",
    sourceInstitution: detail.source_institution ?? "",
    addresseePerson: detail.addressee_person ?? "",
    addresseeInstitution: detail.addressee_institution ?? "",
    financialStatus: detail.financial_status ?? "",
    paymentDueDate: detail.payment_due_date ?? "",
    paymentDate: detail.payment_date ?? "",
    paymentMethod: detail.payment_method ?? "",
    notes: detail.notes ?? "",
  };
}
