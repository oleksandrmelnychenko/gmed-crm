import type { Lead, LeadDetail } from "@/lib/api/types";
import {
  formatEnumLabelFromKeys,
  getLang,
  t as translateCatalog,
  type TranslationKey,
  type Translations,
} from "@/lib/i18n";

import type {
  FailedLeadResolutionForm,
  LeadConversionGate,
  LeadFilters,
  LeadForm,
  LeadGateForm,
  LeadPermissions,
} from "./types";

export const DEFAULT_FILTERS: LeadFilters = {
  search: "",
  status: "",
  leadType: "",
  email: "",
  phone: "",
  source: "",
  country: "",
  includeArchived: "false",
};

export const STATUS_OPTIONS = [
  "new",
  "in_progress",
  "qualified",
  "not_qualified",
  "converted",
  "archived",
] as const;

export const COMPLIANCE_OPTIONS = [
  "pending",
  "documents_sent",
  "signed",
  "rejected",
] as const;

export const LEGAL_SEX_OPTIONS = [
  "female",
  "male",
  "diverse",
  "no_entry",
] as const;

export const LEAD_TYPE_OPTIONS = [
  "form",
  "questionnaire",
  "console",
] as const;

const LEAD_STATUS_LABEL_KEYS = {
  new: "lead_status_new",
  in_progress: "lead_status_in_progress",
  qualified: "lead_status_qualified",
  not_qualified: "lead_status_not_qualified",
  converted: "lead_status_converted",
  archived: "lead_status_archived",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_COMPLIANCE_LABEL_KEYS = {
  pending: "lead_compliance_pending",
  documents_sent: "lead_compliance_documents_sent",
  signed: "lead_compliance_signed",
  rejected: "lead_compliance_rejected",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_FAILED_OUTCOME_LABEL_KEYS = {
  none: "lead_failed_outcome_none",
  archived: "lead_failed_outcome_archived",
  delete_anonymized: "lead_failed_outcome_delete_anonymized",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_LEGAL_SEX_LABEL_KEYS = {
  female: "lead_legal_sex_female",
  male: "lead_legal_sex_male",
  diverse: "lead_legal_sex_diverse",
  no_entry: "lead_legal_sex_no_entry",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_SOURCE_LABEL_KEYS = {
  manual: "lead_source_manual",
  agent: "lead_source_agent",
  website: "lead_source_website",
  apply: "lead_source_website_wizard",
  website_wizard: "lead_source_website_wizard",
  website_contact: "lead_source_visitor_facade",
  website_contact_form: "lead_source_visitor_facade",
  website_form: "lead_source_visitor_facade",
  contact_form: "lead_source_visitor_facade",
  visitor_facade: "lead_source_visitor_facade",
  referral: "lead_source_referral",
  phone: "lead_source_phone",
  email: "lead_source_email",
  whatsapp: "lead_source_whatsapp",
  partner: "lead_source_partner",
  social_media: "lead_source_social_media",
  google_ads: "lead_source_google_ads",
  facebook: "lead_source_facebook",
  instagram: "lead_source_instagram",
  walk_in: "lead_source_walk_in",
  other: "lead_source_other",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_TYPE_LABEL_KEYS = {
  form: "lead_type_form",
  questionnaire: "lead_type_questionnaire",
  console: "lead_type_console",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_LANGUAGE_LABEL_KEYS = {
  ar: "lead_language_ar",
  de: "lead_language_de",
  en: "lead_language_en",
  EN: "lead_language_en",
  English: "lead_language_en",
  english: "lead_language_en",
  fa: "lead_language_fa",
  pl: "lead_language_pl",
  ru: "lead_language_ru",
  RU: "lead_language_ru",
  Russian: "lead_language_ru",
  russian: "lead_language_ru",
  uk: "lead_language_uk",
  UK: "lead_language_uk",
  Ukrainian: "lead_language_uk",
  ukrainian: "lead_language_uk",
  es: "lead_language_es",
  ES: "lead_language_es",
  Spanish: "lead_language_es",
  spanish: "lead_language_es",
  zh: "lead_language_zh",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_PROGRAM_SERVICE_LABEL_KEYS = {
  standard: "lead_option_program_standard",
  care: "lead_option_program_care",
  reserve: "lead_option_program_reserve",
  driver: "lead_option_service_driver",
  concierge: "lead_option_service_concierge",
  "medical-transport": "lead_option_service_medical_transport",
  medical_transport: "lead_option_service_medical_transport",
  "air-ambulance": "lead_option_service_air_ambulance",
  air_ambulance: "lead_option_service_air_ambulance",
  "business-aviation": "lead_option_service_business_aviation",
  business_aviation: "lead_option_service_business_aviation",
  none: "lead_option_service_none",
  "not-sure": "lead_option_service_not_sure",
  not_sure: "lead_option_service_not_sure",
  cardiology_fast_track: "lead_option_cardiology_fast_track",
  concierge_support: "lead_option_concierge_support",
  dental_reconstruction: "lead_option_dental_reconstruction",
  document_translation: "lead_option_document_translation",
  executive_checkup: "lead_option_executive_checkup",
  executive_screening: "lead_option_executive_screening",
  fertility_support: "lead_option_fertility_support",
  interpreter_support: "lead_option_interpreter_support",
  medical_second_opinion: "lead_option_medical_second_opinion",
  medical_treatment: "lead_option_medical_treatment",
  oncology_second_opinion: "lead_option_oncology_second_opinion",
  orthopedics: "lead_option_orthopedics",
  rehabilitation: "lead_option_rehabilitation",
  spine_program: "lead_option_spine_program",
  urology_second_opinion: "lead_option_urology_second_opinion",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_LOCATION_DETAIL_LABEL_KEYS = {
  germany: "lead_option_location_germany",
  eu_not_germany: "lead_option_location_eu_not_germany",
  outside_eu: "lead_option_location_outside_eu",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_LOCATION_LABEL_KEYS = {
  eu: "lead_option_location_eu",
  outside_eu: "lead_option_location_outside_eu",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_PREFERRED_LOCATION_LABEL_KEYS = {
  no_preference: "lead_option_preferred_no_preference",
  munich: "lead_option_preferred_munich",
  berlin: "lead_option_preferred_berlin",
  hamburg: "lead_option_preferred_hamburg",
  cologne: "lead_option_preferred_cologne",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_MEDICAL_RECORDS_LABEL_KEYS = {
  yes: "lead_option_medical_records_yes",
  no: "lead_option_medical_records_no",
  none: "lead_option_medical_records_none",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_INSURANCE_COVERAGE_LABEL_KEYS = {
  yes: "lead_option_insurance_yes",
  no: "lead_option_insurance_no",
  not_sure: "lead_option_insurance_not_sure",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_VISIT_TIMING_LABEL_KEYS = {
  asap: "lead_option_visit_asap",
  next_few_months: "lead_option_visit_next_few_months",
  not_sure: "lead_option_visit_not_sure",
  within_4_weeks: "lead_option_visit_within_4_weeks",
  within_6_weeks: "lead_option_visit_within_6_weeks",
  within_8_weeks: "lead_option_visit_within_8_weeks",
  spring: "lead_option_visit_spring",
  summer: "lead_option_visit_summer",
  autumn: "lead_option_visit_autumn",
  flexible: "lead_option_visit_flexible",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_STAGE_LABEL_KEYS = {
  ...LEAD_STATUS_LABEL_KEYS,
  qualification: "lead_stage_qualification",
  conversion: "lead_stage_conversion",
  failed: "lead_stage_failed",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_TRANSITION_LABEL_KEYS = {
  created: "lead_transition_created",
  status_change: "lead_transition_status_change",
  status_changed: "lead_transition_status_change",
  failed_resolved: "lead_transition_failed_resolved",
  converted: "lead_transition_converted",
  gate_updated: "lead_transition_gate_updated",
} satisfies Partial<Record<string, TranslationKey>>;

const LEAD_READINESS_CHECK_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  lead_qualified: "lead_readiness_check_lead_qualified",
  compliance_completed: "lead_readiness_check_compliance_completed",
  birth_date_present: "lead_readiness_check_birth_date_present",
  legal_sex_present: "lead_readiness_check_legal_sex_present",
  primary_contact_present: "lead_readiness_check_primary_contact_present",
  privacy_consent: "lead_readiness_check_privacy_consent",
  healthcare_consent: "lead_readiness_check_healthcare_consent",
};

const LEAD_READINESS_REASON_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  "Compliance is not signed yet": "lead_readiness_reason_compliance_not_signed",
  "Birth date is missing": "lead_readiness_reason_birth_date_missing",
  "Legal sex is missing": "lead_readiness_reason_legal_sex_missing",
  "Email or phone is required": "lead_readiness_reason_primary_contact_missing",
  "Privacy practices consent is missing": "lead_readiness_reason_privacy_missing",
  "Healthcare consent is missing": "lead_readiness_reason_healthcare_missing",
  "Lead must be qualified before conversion":
    "lead_readiness_reason_lead_must_be_qualified",
  "Lead is already converted": "lead_readiness_reason_already_converted",
};

function runtimeTranslations(translations?: Translations) {
  return translations ?? translateCatalog(getLang());
}

function runtimeLocale() {
  return getLang() === "de" ? "de-DE" : "ru-RU";
}

const LEAD_DATE_FORMATTERS: Record<string, Intl.DateTimeFormat> = {
  "de-DE": new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }),
  "ru-RU": new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }),
};

function leadDateFormatter(locale: string) {
  return LEAD_DATE_FORMATTERS[locale] ?? LEAD_DATE_FORMATTERS["ru-RU"];
}

export function leadPermissions(role?: string): LeadPermissions {
  return {
    canViewPage: role === "ceo" || role === "patient_manager" || role === "sales",
    canCreate: role === "ceo" || role === "patient_manager" || role === "sales",
    canConvert: role === "ceo" || role === "patient_manager",
  };
}

export function blankLeadForm(): LeadForm {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    source: "",
    country: "",
    notes: "",
  };
}

export function blankFailedLeadResolutionForm(): FailedLeadResolutionForm {
  return {
    resolution: "archive",
    reason: "",
    note: "",
  };
}

export function leadToGateForm(detail: LeadDetail): LeadGateForm {
  return {
    email: detail.email ?? "",
    phone: detail.phone ?? "",
    country: detail.country ?? "",
    primaryLanguage: detail.primary_language ?? "",
    dateOfBirth: detail.date_of_birth ?? "",
    legalSex: detail.legal_sex ?? "",
    complianceStatus: detail.compliance_status ?? "pending",
    consentHealthcare: detail.consent_healthcare,
    consentPrivacyPractices: detail.consent_privacy_practices,
    notes: detail.notes ?? "",
  };
}

export function nonempty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export function yesNo(
  value: boolean | null | undefined,
  translations?: Translations,
): string {
  const tr = runtimeTranslations(translations);
  if (value === true) return tr.common_yes;
  if (value === false) return tr.common_no;
  return tr.common_not_set;
}

export function dashOrValue(
  value?: string | null,
  translations?: Translations,
): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : runtimeTranslations(translations).common_not_set;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildLeadsPath(filters: LeadFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.leadType) params.set("lead_type", filters.leadType);
  if (filters.source.trim()) params.set("source", filters.source.trim());
  if (filters.country.trim()) params.set("country", filters.country.trim());
  if (filters.includeArchived) params.set("include_archived", filters.includeArchived);
  const query = params.toString();
  return query ? `/leads?${query}` : "/leads";
}

export function statusLabel(status: string, translations?: Translations) {
  return formatEnumLabelFromKeys(
    status,
    LEAD_STATUS_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function complianceStatusLabel(
  status: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    status,
    LEAD_COMPLIANCE_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function failedOutcomeLabel(
  outcome: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    outcome,
    LEAD_FAILED_OUTCOME_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function legalSexLabel(
  sex: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    sex,
    LEAD_LEGAL_SEX_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function leadSourceLabel(
  source: string | null | undefined,
  translations?: Translations,
) {
  const normalizedSource = normalizeLeadOrigin(source);
  return formatEnumLabelFromKeys(
    normalizedSource,
    LEAD_SOURCE_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

function normalizeLeadOrigin(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[-\s]+/g, "_") ?? "";
}

export function leadIntakeTypeFromLead(
  lead: Pick<Lead, "lead_type" | "intake_source" | "source" | "flow">,
) {
  const intakeSource = normalizeLeadOrigin(lead.intake_source);
  const source = normalizeLeadOrigin(lead.source);
  const flow = normalizeLeadOrigin(lead.flow);
  const explicitType = normalizeLeadOrigin(lead.lead_type);

  if (
    ["visitor_facade", "website_wizard", "wizard", "questionnaire", "oprosnik"].includes(intakeSource) ||
    ["website_wizard", "visitor_facade", "questionnaire", "oprosnik"].includes(source)
  ) {
    return "questionnaire";
  }
  if (
    ["website_contact", "website_form", "contact_form"].includes(intakeSource) ||
    ["website_contact_form", "contact_form"].includes(source) ||
    flow === "contact"
  ) {
    return "form";
  }
  if (explicitType === "questionnaire" || explicitType === "form") {
    return explicitType;
  }
  return "console";
}

export function leadTypeFromLead(
  lead: Pick<Lead, "lead_type" | "console_promoted_at" | "intake_source" | "source" | "flow">,
) {
  if (lead.console_promoted_at) {
    return "console";
  }

  const explicitType = normalizeLeadOrigin(lead.lead_type);
  if (LEAD_TYPE_OPTIONS.includes(explicitType as (typeof LEAD_TYPE_OPTIONS)[number])) {
    return explicitType;
  }

  const intakeSource = normalizeLeadOrigin(lead.intake_source);
  const source = normalizeLeadOrigin(lead.source);
  const flow = normalizeLeadOrigin(lead.flow);

  if (["manual", "crm_manual", "console"].includes(intakeSource)) {
    return "console";
  }
  if (
    ["website_contact", "website_form", "contact_form"].includes(intakeSource) ||
    ["website_contact_form", "contact_form"].includes(source) ||
    flow === "contact"
  ) {
    return "form";
  }
  if (
    ["visitor_facade", "website_wizard", "wizard", "questionnaire", "oprosnik"].includes(intakeSource) ||
    ["website_wizard", "visitor_facade"].includes(source)
  ) {
    return "questionnaire";
  }
  return "console";
}

export function leadTypeLabel(
  leadOrType:
    | Pick<Lead, "lead_type" | "console_promoted_at" | "intake_source" | "source" | "flow">
    | string
    | null
    | undefined,
  translations?: Translations,
) {
  const type =
    typeof leadOrType === "string" || leadOrType == null
      ? normalizeLeadOrigin(leadOrType)
      : leadTypeFromLead(leadOrType);
  return formatEnumLabelFromKeys(
    type,
    LEAD_TYPE_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function leadLanguageLabel(
  value: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    value,
    LEAD_LANGUAGE_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function leadProgramServiceLabel(
  value: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    value,
    LEAD_PROGRAM_SERVICE_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function knownLeadProgramServiceLabel(
  value: string | null | undefined,
  translations?: Translations,
) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  const labelKey = (LEAD_PROGRAM_SERVICE_LABEL_KEYS as Partial<Record<string, TranslationKey>>)[normalized];
  return labelKey ? runtimeTranslations(translations)[labelKey] : null;
}

export function leadLocationDetailedLabel(
  value: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    value,
    LEAD_LOCATION_DETAIL_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function leadLocationLabel(
  value: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    value,
    LEAD_LOCATION_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function leadPreferredLocationLabel(
  value: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    value,
    LEAD_PREFERRED_LOCATION_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function leadMedicalRecordsLabel(
  value: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    value,
    LEAD_MEDICAL_RECORDS_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function leadInsuranceCoverageLabel(
  value: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    value,
    LEAD_INSURANCE_COVERAGE_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function leadVisitTimingLabel(
  value: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    value,
    LEAD_VISIT_TIMING_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function leadStageLabel(
  stage: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    stage,
    LEAD_STAGE_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function leadTransitionKindLabel(
  kind: string | null | undefined,
  translations?: Translations,
) {
  return formatEnumLabelFromKeys(
    kind,
    LEAD_TRANSITION_LABEL_KEYS,
    runtimeTranslations(translations),
  );
}

export function leadReadinessCheckLabel(
  check: { key?: string | null; label?: string | null },
  translations?: Translations,
) {
  const tr = runtimeTranslations(translations);
  const labelKey = check.key ? LEAD_READINESS_CHECK_LABEL_KEYS[check.key] : undefined;
  return labelKey ? tr[labelKey] : dashOrValue(check.label, tr);
}

export function leadReadinessReasonLabel(
  reason: string,
  translations?: Translations,
) {
  const tr = runtimeTranslations(translations);
  const labelKey = LEAD_READINESS_REASON_LABEL_KEYS[reason];
  return labelKey ? tr[labelKey] : reason;
}

export function formatDate(
  value?: string | null,
  locale = runtimeLocale(),
  fallback = runtimeTranslations().common_not_set,
) {
  if (!value) return fallback;
  try {
    return leadDateFormatter(locale).format(new Date(value));
  } catch {
    return value;
  }
}

export function computeLeadConversionGate(
  lead: Pick<Lead, "qualification_status" | "conversion_ready">,
  permissions: { canConvert: boolean },
): LeadConversionGate {
  const canConvertRole =
    permissions.canConvert && lead.qualification_status === "qualified";
  const conversionReady = lead.conversion_ready ?? true;
  const canConvert = canConvertRole && conversionReady;
  const disabledReason =
    canConvertRole && !conversionReady
      ? translateCatalog(getLang()).lead_process_readiness_description
      : null;
  return { canConvertRole, canConvert, disabledReason };
}

export function filterLeadsByContact(
  leads: readonly Lead[],
  filters: { email: string; phone: string },
): Lead[] {
  const emailNeedle = filters.email.trim().toLowerCase();
  const phoneNeedle = filters.phone.trim().toLowerCase();

  if (!emailNeedle && !phoneNeedle) return [...leads];

  return leads.filter((lead) => {
    const leadEmail = (lead.email ?? "").toLowerCase();
    const leadPhone = (lead.phone ?? "").toLowerCase();
    const emailMatches = !emailNeedle || leadEmail.includes(emailNeedle);
    const phoneMatches = !phoneNeedle || leadPhone.includes(phoneNeedle);
    return emailMatches && phoneMatches;
  });
}
