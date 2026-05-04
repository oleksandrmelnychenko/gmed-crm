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
  return role === "ceo" || role === "patient_manager";
}

export function canUploadDocuments(role?: string) {
  return [
    "ceo",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
  ].includes(role ?? "");
}

export function canManageDocumentIntake(role?: string) {
  return ["ceo", "patient_manager", "teamlead_interpreter"].includes(
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
  ].includes(role ?? "");
}

export function canRequestTranslations(role?: string) {
  return [
    "ceo",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
    "concierge",
  ].includes(role ?? "");
}

export function canUpdateTranslations(role?: string) {
  return [
    "ceo",
    "patient_manager",
    "teamlead_interpreter",
    "concierge",
  ].includes(role ?? "");
}

export function canViewDocumentShares(role?: string) {
  return ["ceo", "ceo_assistant", "patient_manager"].includes(role ?? "");
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
  return params.size ? `/documents?${params.toString()}` : "/documents";
}

export function patientOptionLabel(patient: PatientOption) {
  return `${patient.patient_id} · ${[patient.first_name, patient.last_name].filter(Boolean).join(" ")}`;
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
  for (const language of patient?.languages ?? []) {
    const normalized = normalizeTemplateLanguage(language);
    if (normalized && template.supported_languages.includes(normalized)) {
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
    notes: "",
    textBlockKeys: [],
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
    notes: detail.notes ?? "",
  };
}
