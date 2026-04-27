import type { Lead, LeadDetail } from "@/lib/api/types";

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

export function yesNo(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "-";
}

export function dashOrValue(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "-";
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

export function statusLabel(status: string) {
  return status
    .split("_")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

export function formatDate(value?: string | null) {
  if (!value) return "Not set";
  try {
    return new Intl.DateTimeFormat("en-GB", {
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
      ? "Missing required data — open the lead to see what's blocking conversion."
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
