import { apiFetchFile } from "@/lib/api";
import {
  formatEnumLabelFromKeys,
  getLang,
  t as translateCatalog,
  type TranslationKey,
} from "@/lib/i18n";

export type PortalDocumentItem = {
  id: string;
  patient_id: string | null;
  order_id: string | null;
  appointment_id: string | null;
  auto_name: string;
  original_filename: string | null;
  art: string;
  category: string | null;
  status: string;
  visibility: string;
  is_medical: boolean;
  mime_type: string | null;
  file_size: number | null;
  klinik: string | null;
  ursprung: string | null;
  notes: string | null;
  share_id: string;
  channel: string | null;
  requires_confirmation: boolean;
  confirmed: boolean;
  confirmed_at: string | null;
  shared_at: string;
  shared_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type PortalUploadedDocumentItem = {
  id: string;
  patient_id: string | null;
  order_id: string | null;
  appointment_id: string | null;
  order_number?: string | null;
  appointment_title?: string | null;
  auto_name: string;
  original_filename: string | null;
  art: string;
  category: string | null;
  status: string;
  visibility: string;
  is_medical: boolean;
  mime_type: string | null;
  file_size: number | null;
  klinik: string | null;
  ursprung: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type PortalRequiredDocumentRuleItem = {
  key: string;
  label: string;
  fulfilled: boolean;
  matching_documents: Array<{
    id: string;
    filename: string;
    art: string;
    category: string | null;
    status: string;
  }>;
};

type PortalMissingRequiredDocumentItem = {
  key: string;
  label: string;
};

export type PortalDocumentAlertsSummary = {
  configured_rule_count: number;
  document_pack_complete: boolean;
  stored_document_pack_complete: boolean;
  out_of_sync: boolean;
  required_documents: PortalRequiredDocumentRuleItem[];
  missing_documents: PortalMissingRequiredDocumentItem[];
  missing_count: number;
};

export type PortalInvoiceLineItem = {
  description: string;
  quantity: string;
  unit_price: string;
  vat_rate: string;
  is_cost_passthrough: boolean;
  line_net: string;
  line_vat: string;
  line_gross: string;
  notes?: string | null;
};

type InvoicePortalVisibility = {
  visible_to_patient: boolean;
  amounts_visible_to_patient: boolean;
  line_items_visible_to_patient: boolean;
  pdf_visible_to_patient: boolean;
  redaction_reason: string | null;
};

export type PortalInvoiceItem = {
  id: string;
  quote_id: string | null;
  quote_number: string | null;
  order_id: string;
  order_number: string;
  patient_id: string;
  invoice_number: string;
  invoice_type: string;
  status: string;
  issued_at: string;
  due_date: string | null;
  total_net: unknown;
  total_vat: unknown;
  total_gross: unknown;
  paid_amount: unknown;
  balance_due: unknown;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  payment_proof_count?: number;
  last_payment_proof_at?: string | null;
  line_items?: PortalInvoiceLineItem[];
  portal_visibility?: InvoicePortalVisibility;
};

export type PortalRecommendationItem = {
  recommendation_id: string;
  id: string;
  patient_id: string;
  title: string;
  description: string | null;
  recommendation_type: string;
  source_doctor_id: string | null;
  source_doctor_name: string | null;
  source_appointment_id: string | null;
  source_appointment_title: string | null;
  source_document_id: string | null;
  source_document_name: string | null;
  source_order_id: string | null;
  source_order_number: string | null;
  due_at: string | null;
  priority: string;
  status: string;
  portal_visible: boolean;
  patient_decision: string | null;
  decision_note: string | null;
  decided_at: string | null;
  appointment_request_id: string | null;
  appointment_request_status: string | null;
  created_by: string | null;
  created_by_name: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type PortalNextActionItem = {
  id: string;
  kind: string;
  entity_type: string;
  entity_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  action_label: string;
  action_url: string;
  amount?: string | null;
  currency?: string | null;
  metadata?: Record<string, unknown>;
};

export type PortalNextActionsResponse = {
  items: PortalNextActionItem[];
  total: number;
};

export type PortalTranslationRequestItem = {
  id: string;
  document_id: string;
  patient_id: string | null;
  requested_language: string;
  status: string;
  note: string | null;
  source_language: string | null;
  source_text: string | null;
  translated_text: string | null;
  request_source: string;
  requested_by: string;
  requested_by_name: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  assigned_at?: string | null;
  translated_by: string | null;
  translated_by_name: string | null;
  translated_document_id?: string | null;
  translated_document_name?: string | null;
  requested_at: string;
  completed_at: string | null;
  translated_at: string | null;
  updated_at: string;
  document_name: string | null;
  original_filename: string | null;
  document_art: string | null;
  document_category: string | null;
};

export type PortalAppointmentItem = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  time_end: string | null;
  appointment_type: string;
  care_path_kind: string;
  status: string;
  location: string | null;
  category: string | null;
  provider_name: string | null;
  doctor_name: string | null;
  created_at: string;
};

export type PortalAppointmentRequestItem = {
  id: string;
  patient_id: string;
  patient_pid?: string | null;
  patient_name?: string | null;
  order_id: string | null;
  order_number?: string | null;
  appointment_type: string;
  care_path_kind: string;
  preferred_date_from: string | null;
  preferred_date_to: string | null;
  preferred_time_of_day: string | null;
  requested_provider_id: string | null;
  requested_provider_name: string | null;
  requested_doctor_id: string | null;
  requested_doctor_name: string | null;
  specialty: string | null;
  location: string | null;
  reason: string | null;
  notes: string | null;
  status: string;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  requested_at: string;
  converted_appointment_id: string | null;
  converted_appointment_title: string | null;
  converted_appointment_date: string | null;
};

export type PortalFollowupMilestoneItem = {
  order_id: string;
  order_number: string;
  phase: string;
  status: string;
  followup_ready: boolean;
  doctor_followup_status: string;
  followup_1w_status: string;
  followup_1m_status: string;
  followup_6m_status: string;
  package_end_date: string | null;
  suggested_package_end_date: string | null;
  package_end_status: string;
  results_handoff_status: string;
  followup_summary: string | null;
  closure_anchor_at: string | null;
  recommended_followup_1w_at: string | null;
  recommended_followup_1m_at: string | null;
  recommended_followup_6m_at: string | null;
  recommended_package_end_followup_at: string | null;
  followup_appointments_total: number;
  package_end_reminders: number;
  package_end_tasks: number;
  results_portal_shares: number;
};

export type PortalConciergeServiceItem = {
  id: string;
  appointment_id: string | null;
  appointment_title: string | null;
  provider_id: string | null;
  provider_name: string | null;
  assigned_concierge_name: string | null;
  service_kind: string;
  title: string;
  status: string;
  booking_reference: string | null;
  vendor_name: string | null;
  vendor_contact: string | null;
  starts_at: string | null;
  ends_at: string | null;
  cost_estimate: string | null;
  currency: string;
  service_notes: string | null;
  request_source: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  can_cancel: boolean;
};

export type PortalPrivacyRequest = {
  id: string;
  request_type: string;
  source: string;
  status: string;
  reason: string | null;
  due_at: string | null;
  retention_until?: string | null;
  requested_at: string;
  reviewed_at: string | null;
  executed_at: string | null;
};

export type PortalFeedbackItem = {
  id: string;
  patient_id: string;
  patient_pid?: string | null;
  patient_name?: string | null;
  appointment_id?: string | null;
  appointment_title?: string | null;
  appointment_date?: string | null;
  provider_id?: string | null;
  provider_name?: string | null;
  doctor_id?: string | null;
  doctor_name?: string | null;
  patient_manager_id?: string | null;
  patient_manager_name?: string | null;
  interpreter_id?: string | null;
  interpreter_name?: string | null;
  concierge_id?: string | null;
  concierge_name?: string | null;
  source: string;
  status: string;
  overall_score: number;
  patient_manager_score?: number | null;
  interpreter_score?: number | null;
  concierge_score?: number | null;
  treatment_score?: number | null;
  doctor_score?: number | null;
  organization_score?: number | null;
  service_score?: number | null;
  infrastructure_score?: number | null;
  price_value_score?: number | null;
  treatment_success?: string | null;
  complication_reported?: boolean;
  nps_score: number;
  comments?: string | null;
  improvement_notes?: string | null;
  internal_note?: string | null;
  review_note?: string | null;
  submitted_by_name?: string | null;
  reviewed_by_name?: string | null;
  submitted_at: string;
  reviewed_at?: string | null;
};

type PortalFeedbackAverageScores = {
  overall?: number | null;
  patient_manager?: number | null;
  interpreter?: number | null;
  concierge?: number | null;
  treatment?: number | null;
  doctor?: number | null;
  organization?: number | null;
  service?: number | null;
  infrastructure?: number | null;
  price_value?: number | null;
};

type PortalFeedbackPromoter = {
  patient_id: string;
  patient_pid?: string | null;
  patient_name: string;
  average_nps: number;
  feedback_count: number;
  last_submitted_at?: string | null;
};

type PortalFeedbackRanking = {
  user_id?: string;
  provider_id?: string;
  name: string;
  average_score: number;
  feedback_count: number;
};

export type PortalFeedbackSummary = {
  total_feedback: number;
  reviewed_feedback: number;
  patient_portal_count: number;
  staff_capture_count: number;
  nps_score: number;
  promoters: number;
  passives: number;
  detractors: number;
  average_scores: PortalFeedbackAverageScores;
  treatment_success_yes_rate?: number | null;
  treatment_success_partial_rate?: number | null;
  complication_rate?: number | null;
  top_promoters: PortalFeedbackPromoter[];
  interpreter_ranking: PortalFeedbackRanking[];
  clinic_ranking: PortalFeedbackRanking[];
};

function portalText(key: string) {
  return translateCatalog(getLang()).uiText[key] ?? key;
}

type PortalLocale = "de-DE" | "en-GB" | "ru-RU";

function portalLocale(): PortalLocale {
  const lang = getLang();
  if (lang === "de") return "de-DE";
  if (lang === "ru") return "ru-RU";
  return "en-GB";
}

const PORTAL_DATE_TIME_FORMATTERS: Record<PortalLocale, Intl.DateTimeFormat> = {
  "de-DE": new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
  "en-GB": new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
  "ru-RU": new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
};

const PORTAL_DATE_FORMATTERS: Record<PortalLocale, Intl.DateTimeFormat> = {
  "de-DE": new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }),
  "en-GB": new Intl.DateTimeFormat("en-GB", {
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

const PORTAL_CURRENCY_FORMATTERS: Record<PortalLocale, Intl.NumberFormat> = {
  "de-DE": new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  "en-GB": new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  "ru-RU": new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

function portalTranslations() {
  return translateCatalog(getLang());
}

function portalEnumLabel(
  value: string | null | undefined,
  labelKeys: Partial<Record<string, TranslationKey>>,
) {
  return formatEnumLabelFromKeys(value, labelKeys, portalTranslations());
}

const PORTAL_STATUS_LABEL_KEYS = {
  active: "portal_status_active",
  approved: "portal_status_approved",
  archived: "portal_status_archived",
  booked: "portal_status_booked",
  cancelled: "portal_status_cancelled",
  closed: "portal_status_closed",
  completed: "portal_status_completed",
  confirmed: "portal_status_confirmed",
  converted: "portal_status_converted",
  declined: "portal_status_declined",
  draft: "portal_status_draft",
  executed: "portal_status_executed",
  expired: "portal_status_expired",
  in_progress: "portal_status_in_progress",
  in_service: "portal_status_in_service",
  not_started: "portal_status_not_started",
  open: "portal_status_open",
  overdue: "portal_status_overdue",
  paid: "portal_status_paid",
  partially_paid: "portal_status_partially_paid",
  pending: "portal_status_pending",
  planned: "portal_status_planned",
  ready: "portal_status_ready",
  rejected: "portal_status_rejected",
  released: "portal_status_released",
  retention_hold: "portal_status_retention_hold",
  reviewed: "portal_status_reviewed",
  scheduled: "portal_status_scheduled",
  sent: "portal_status_sent",
  signed: "portal_status_signed",
  superseded: "portal_status_superseded",
  terminated: "portal_status_terminated",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_DOCUMENT_VALUE_LABEL_KEYS = {
  administrative: "portal_document_label_administrative",
  analyses: "portal_document_label_analyses",
  analysis: "portal_document_label_analyses",
  blood_results: "portal_document_label_analyses",
  clinical: "portal_document_label_clinical",
  clinic_correspondence: "portal_document_label_correspondence",
  clinic_letter: "portal_document_label_correspondence",
  conclusions: "portal_document_label_conclusions",
  contract: "portal_document_label_contract",
  correspondence: "portal_document_label_correspondence",
  discharge_report: "portal_document_label_discharge_report",
  general: "portal_document_label_general",
  identity: "portal_document_label_identity",
  imaging: "portal_document_label_imaging",
  insurance: "portal_document_label_insurance_document",
  insurance_document: "portal_document_label_insurance_document",
  invoice: "portal_document_label_invoice",
  invoice_pdf: "portal_document_label_invoice",
  invoices: "portal_document_label_invoice",
  lab: "portal_document_label_lab",
  medical: "portal_document_label_medical",
  medical_report: "portal_document_label_medical_report",
  payment_proof: "portal_document_label_payment_proof",
  report: "portal_document_label_medical_report",
  translated_letter: "portal_document_label_translation",
  translations: "portal_document_label_translation",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_DOCUMENT_SOURCE_LABEL_KEYS = {
  patient_portal: "portal_document_source_patient_portal",
  portal_release: "portal_document_source_portal_release",
  provider: "portal_document_source_provider",
  staff_workspace: "portal_document_source_staff_workspace",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_INVOICE_TYPE_LABEL_KEYS = {
  advance: "portal_invoice_type_advance",
  final: "portal_invoice_type_final",
  interim: "portal_invoice_type_interim",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_PRIVACY_REQUEST_LABEL_KEYS = {
  erasure: "portal_privacy_request_erasure",
  restriction: "portal_privacy_request_restriction",
  third_party_revoke: "portal_privacy_request_third_party_revoke",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_PRIVACY_SOURCE_LABEL_KEYS = {
  patient_portal: "portal_privacy_source_patient_portal",
  staff_workspace: "portal_privacy_source_staff_workspace",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_RECOMMENDATION_TYPE_LABEL_KEYS = {
  consultation: "portal_recommendation_type_consultation",
  document: "portal_recommendation_type_document",
  follow_up: "portal_recommendation_type_follow_up",
  imaging: "portal_recommendation_type_imaging",
  lab_test: "portal_recommendation_type_lab_test",
  medication_review: "portal_recommendation_type_medication_review",
  other: "portal_recommendation_type_other",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_RECOMMENDATION_PRIORITY_LABEL_KEYS = {
  high: "portal_recommendation_priority_high",
  low: "portal_recommendation_priority_low",
  normal: "portal_recommendation_priority_normal",
  urgent: "portal_recommendation_priority_urgent",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_RECOMMENDATION_DECISION_LABEL_KEYS = {
  already_done: "portal_recommendation_decision_already_done",
  declined: "portal_recommendation_decision_declined",
  need_consultation: "portal_recommendation_decision_need_consultation",
  schedule: "portal_recommendation_decision_schedule",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_APPOINTMENT_TYPE_LABEL_KEYS = {
  internal: "portal_appointment_type_internal",
  medical: "portal_appointment_type_medical",
  non_medical: "portal_appointment_type_non_medical",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_CARE_PATH_LABEL_KEYS = {
  control: "portal_care_path_control",
  followup: "portal_care_path_followup",
  preventive: "portal_care_path_preventive",
  regular: "portal_care_path_regular",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_TIME_OF_DAY_LABEL_KEYS = {
  afternoon: "portal_time_of_day_afternoon",
  evening: "portal_time_of_day_evening",
  flexible: "portal_time_of_day_flexible",
  midday: "portal_time_of_day_midday",
  morning: "portal_time_of_day_morning",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_ORDER_PHASE_LABEL_KEYS = {
  closure: "portal_order_phase_closure",
  discovery: "portal_order_phase_discovery",
  execution: "portal_order_phase_execution",
  followup: "portal_order_phase_followup",
  intake: "portal_order_phase_intake",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_CONCIERGE_KIND_LABEL_KEYS = {
  chauffeur: "portal_concierge_kind_chauffeur",
  flight: "portal_concierge_kind_flight",
  hotel: "portal_concierge_kind_hotel",
  other: "portal_concierge_kind_other",
  transfer: "portal_concierge_kind_transfer",
  translation_support: "portal_concierge_kind_translation_support",
  vip_terminal: "portal_concierge_kind_vip_terminal",
} satisfies Partial<Record<string, TranslationKey>>;

const PORTAL_CONCIERGE_SOURCE_LABEL_KEYS = {
  appointment_bootstrap: "portal_concierge_source_appointment_bootstrap",
  patient_portal: "portal_concierge_source_patient_portal",
  staff_capture: "portal_concierge_source_staff",
  staff_workspace: "portal_concierge_source_staff",
} satisfies Partial<Record<string, TranslationKey>>;

const PATIENT_INVOICE_SERVICE_TYPE_LABEL_KEYS = {
  cost_passthrough: "patient_invoice_service_type_cost_passthrough",
  medical: "patient_invoice_service_type_medical",
  non_medical: "patient_invoice_service_type_non_medical",
  other: "patient_invoice_service_type_other",
} satisfies Partial<Record<string, TranslationKey>>;

const PATIENT_INVOICE_LEDGER_DIRECTION_LABEL_KEYS = {
  expense: "patient_invoice_ledger_direction_expense",
  income: "patient_invoice_ledger_direction_income",
  revenue: "patient_invoice_ledger_direction_revenue",
} satisfies Partial<Record<string, TranslationKey>>;

const PATIENT_INVOICE_LEDGER_CATEGORY_LABEL_KEYS = {
  cost_passthrough_revenue: "patient_invoice_ledger_category_cost_passthrough_revenue",
  provider_expense: "patient_invoice_ledger_category_provider_expense",
  service_revenue: "patient_invoice_ledger_category_service_revenue",
} satisfies Partial<Record<string, TranslationKey>>;

export function portalNotSetLabel() {
  return portalTranslations().common_not_set;
}

export function portalStatusLabel(value?: string | null) {
  return portalEnumLabel(value, PORTAL_STATUS_LABEL_KEYS);
}

export function documentCategoryLabel(value?: string | null) {
  return portalEnumLabel(value, PORTAL_DOCUMENT_VALUE_LABEL_KEYS);
}

export function invoiceTypeLabel(value: string) {
  return portalEnumLabel(value, PORTAL_INVOICE_TYPE_LABEL_KEYS);
}

export function portalDocumentValueLabel(value?: string | null) {
  return portalEnumLabel(value, PORTAL_DOCUMENT_VALUE_LABEL_KEYS);
}

export function portalDocumentSourceLabel(
  source?: string | null,
  clinic?: string | null,
) {
  if (!source) {
    return clinic || portalTranslations().portal_document_source_portal_release;
  }
  return portalEnumLabel(source, PORTAL_DOCUMENT_SOURCE_LABEL_KEYS);
}

export function portalOrderPhaseLabel(value?: string | null) {
  return portalEnumLabel(value, PORTAL_ORDER_PHASE_LABEL_KEYS);
}

export function privacyRequestSourceLabel(value?: string | null) {
  return portalEnumLabel(value, PORTAL_PRIVACY_SOURCE_LABEL_KEYS);
}

export function patientInvoiceServiceTypeLabel(value?: string | null) {
  return portalEnumLabel(value, PATIENT_INVOICE_SERVICE_TYPE_LABEL_KEYS);
}

export function patientInvoiceLedgerDirectionLabel(value?: string | null) {
  return portalEnumLabel(value, PATIENT_INVOICE_LEDGER_DIRECTION_LABEL_KEYS);
}

export function patientInvoiceLedgerCategoryLabel(value?: string | null) {
  return portalEnumLabel(value, PATIENT_INVOICE_LEDGER_CATEGORY_LABEL_KEYS);
}

export function formatPortalDateTime(value?: string | null) {
  if (!value) return portalNotSetLabel();

  try {
    return PORTAL_DATE_TIME_FORMATTERS[portalLocale()].format(new Date(value));
  } catch {
    return value;
  }
}

export function formatPortalDate(value?: string | null) {
  if (!value) return portalNotSetLabel();

  try {
    return PORTAL_DATE_FORMATTERS[portalLocale()].format(new Date(value));
  } catch {
    return value;
  }
}

export function formatPortalFileSize(value?: number | null) {
  if (!value || value <= 0) return portalNotSetLabel();
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPortalCurrency(value: unknown) {
  if (value === null || value === undefined) return portalNotSetLabel();
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  const formatter = PORTAL_CURRENCY_FORMATTERS[portalLocale()];
  if (!Number.isFinite(numeric)) return formatter.format(0);
  return formatter.format(numeric);
}

export function privacyRequestLabel(value: string) {
  return portalEnumLabel(value, PORTAL_PRIVACY_REQUEST_LABEL_KEYS);
}

export function privacyStatusTone(status: string) {
  if (status === "executed" || status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "approved") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "retention_hold") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export function feedbackStatusTone(status: string) {
  if (status === "reviewed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "archived") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function formatPortalAverage(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return portalNotSetLabel();
  return value.toFixed(1);
}

export function npsBandLabel(value: number) {
  const translations = portalTranslations();
  if (value >= 9) return translations.portal_nps_band_promoter;
  if (value >= 7) return translations.portal_nps_band_passive;
  return translations.portal_nps_band_detractor;
}

export function documentTone(item: PortalDocumentItem) {
  if (item.confirmed) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (item.requires_confirmation) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-sky-200 bg-sky-50 text-sky-700";
}

export function uploadedDocumentTone(item: PortalUploadedDocumentItem) {
  if (item.art === "payment_proof") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (item.is_medical) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export function invoiceStatusTone(status: string) {
  if (status === "paid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "partially_paid") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "sent") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "overdue" || status === "cancelled") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export function recommendationStatusTone(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "declined" || status === "cancelled") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (status === "superseded") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

export function recommendationTypeLabel(value?: string | null) {
  return portalEnumLabel(value, PORTAL_RECOMMENDATION_TYPE_LABEL_KEYS);
}

export function recommendationPriorityLabel(value?: string | null) {
  return portalEnumLabel(value, PORTAL_RECOMMENDATION_PRIORITY_LABEL_KEYS);
}

export function recommendationDecisionLabel(value?: string | null) {
  return portalEnumLabel(value, PORTAL_RECOMMENDATION_DECISION_LABEL_KEYS);
}

export function nextActionTone(kind: string, priority?: string | null) {
  if (priority === "urgent" || priority === "high") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (kind === "invoice_payment" || kind === "package_approval") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (kind === "document_confirmation") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export function translationRequestTone(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "cancelled") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "in_progress") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function appointmentStatusTone(status: string) {
  if (status === "confirmed" || status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "planned" || status === "in_progress") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "cancelled") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export function appointmentRequestStatusTone(status: string) {
  if (status === "converted") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "approved") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "rejected" || status === "cancelled") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function followupStatusTone(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "scheduled") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "pending") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export function appointmentTypeLabel(value?: string | null) {
  return portalEnumLabel(value, PORTAL_APPOINTMENT_TYPE_LABEL_KEYS);
}

export function appointmentCarePathKindLabel(value?: string | null) {
  return portalEnumLabel(value, PORTAL_CARE_PATH_LABEL_KEYS);
}

export function appointmentTimeOfDayLabel(value?: string | null) {
  return portalEnumLabel(value || "flexible", PORTAL_TIME_OF_DAY_LABEL_KEYS);
}

export function conciergeServiceKindLabel(value?: string | null) {
  return portalEnumLabel(value, PORTAL_CONCIERGE_KIND_LABEL_KEYS);
}

export function conciergeServiceStatusTone(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "booked" || status === "confirmed" || status === "in_service") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "cancelled") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function conciergeServiceSourceLabel(value?: string | null) {
  return portalEnumLabel(value, PORTAL_CONCIERGE_SOURCE_LABEL_KEYS);
}

async function fetchPortalBlob(path: string) {
  const { blob } = await apiFetchFile(path);
  return blob;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "document";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function openBlobPreview(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const previewWindow = window.open(url, "_blank", "noopener,noreferrer");
  if (!previewWindow) {
    URL.revokeObjectURL(url);
    throw new Error(portalText("patients_portal_allow_pop_ups_to_preview_the_pdf"));
  }

  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadPortalDocument(id: string, filename: string) {
  const blob = await fetchPortalBlob(`/me/documents/${id}/download`);
  downloadBlob(blob, filename);
}

export async function downloadPortalUpload(id: string, filename: string) {
  const blob = await fetchPortalBlob(`/me/documents/uploads/${id}/download`);
  downloadBlob(blob, filename);
}

export async function downloadPortalInvoicePdf(id: string, filename: string) {
  const blob = await fetchPortalBlob(`/me/invoices/${id}/pdf`);
  downloadBlob(blob, filename || "invoice.pdf");
}

export async function openPortalInvoicePdf(id: string) {
  const blob = await fetchPortalBlob(`/me/invoices/${id}/pdf`);
  openBlobPreview(blob);
}
