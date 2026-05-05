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
  website: "lead_source_website",
  website_wizard: "lead_source_website_wizard",
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

function runtimeTranslations(translations?: Translations) {
  return translations ?? translateCatalog(getLang());
}

function runtimeLocale() {
  return getLang() === "de" ? "de-DE" : "ru-RU";
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
  return formatEnumLabelFromKeys(
    source,
    LEAD_SOURCE_LABEL_KEYS,
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

export function formatDate(
  value?: string | null,
  locale = runtimeLocale(),
  fallback = runtimeTranslations().common_not_set,
) {
  if (!value) return fallback;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
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
