import type { Lead } from "@/lib/api/types";

export type LeadListItem = Lead;

export type LeadFilters = {
  search: string;
  status: string;
  leadType: string;
  email: string;
  phone: string;
  source: string;
  country: string;
  includeArchived: string;
};

export type LeadForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  country: string;
  notes: string;
};

export type LeadGateForm = {
  email: string;
  phone: string;
  country: string;
  primaryLanguage: string;
  dateOfBirth: string;
  legalSex: string;
  complianceStatus: string;
  consentHealthcare: boolean;
  consentPrivacyPractices: boolean;
  /** Staff's own comment (`leads.services_internal_note`), never the client's `notes`. */
  internalNote: string;
};

export type FailedLeadResolutionForm = {
  resolution: "archive" | "delete";
  reason: string;
  note: string;
};

export type LeadPermissions = {
  canViewPage: boolean;
  canOpen: boolean;
  canEdit: boolean;
  canCreate: boolean;
  canConvert: boolean;
};

export interface LeadConversionGate {
  canConvertRole: boolean;
  canConvert: boolean;
  disabledReason: string | null;
}
