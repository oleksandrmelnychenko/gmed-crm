import type {
  ProviderTemplateFormState,
  ProviderTemplateItem,
} from "./types";

export function formatProviderDetailDate(value?: string | null, fallback = "") {
  if (!value) return fallback;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value.includes("T") ? value : `${value}T00:00:00`));
  } catch {
    return value;
  }
}

export function detailFieldValue(value: string | null | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

export function emptyTemplateForm(): ProviderTemplateFormState {
  return {
    label: "",
    description: "",
    doctorId: "",
    art: "provider_template_instruction",
    category: "provider_template",
    defaultAutoName: "",
    defaultStatus: "draft",
    defaultVisibility: "patient_visible",
    isMedical: true,
    isActive: true,
    supportedLanguages: ["de"],
    bodyDe: "",
    bodyEn: "",
    bodyUk: "",
    bodyRu: "",
    notes: "",
    autoSendOnConfirmedAppointment: false,
  };
}

export function templateToFormState(
  template: ProviderTemplateItem,
): ProviderTemplateFormState {
  return {
    label: template.label,
    description: template.description ?? "",
    doctorId: template.doctor_id ?? "",
    art: template.art,
    category: template.category,
    defaultAutoName: template.default_auto_name,
    defaultStatus:
      (template.default_status as ProviderTemplateFormState["defaultStatus"]) ??
      "draft",
    defaultVisibility:
      (template.default_visibility as ProviderTemplateFormState["defaultVisibility"]) ??
      "patient_visible",
    isMedical: template.is_medical,
    isActive: template.is_active,
    supportedLanguages: template.supported_languages,
    bodyDe: template.body_de ?? "",
    bodyEn: template.body_en ?? "",
    bodyUk: template.body_uk ?? "",
    bodyRu: template.body_ru ?? "",
    notes: template.notes ?? "",
    autoSendOnConfirmedAppointment:
      template.auto_send_on_confirmed_appointment ?? false,
  };
}
