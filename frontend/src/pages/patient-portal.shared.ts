import { getAccessToken } from "@/lib/api";

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

export type PortalRequiredDocumentRuleItem = {
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

export type PortalMissingRequiredDocumentItem = {
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
};

export type PortalAppointmentItem = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  time_end: string | null;
  appointment_type: string;
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

export type PortalFeedbackAverageScores = {
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

export type PortalFeedbackPromoter = {
  patient_id: string;
  patient_pid?: string | null;
  patient_name: string;
  average_nps: number;
  feedback_count: number;
  last_submitted_at?: string | null;
};

export type PortalFeedbackRanking = {
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

export function formatPortalDateTime(value?: string | null) {
  if (!value) return "Not set";

  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatPortalDate(value?: string | null) {
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

export function formatPortalFileSize(value?: number | null) {
  if (!value || value <= 0) return "Not set";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPortalCurrency(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "EUR 0.00";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function privacyRequestLabel(value: string) {
  if (value === "erasure") return "Erase data";
  if (value === "restriction") return "Restrict processing";
  if (value === "third_party_revoke") return "Revoke third-party sharing";
  return value.replaceAll("_", " ");
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

export function feedbackSourceLabel(source: string) {
  if (source === "patient_portal") return "Patient portal";
  if (source === "staff_capture") return "Staff capture";
  return source.replaceAll("_", " ");
}

export function formatPortalAverage(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "Not set";
  return value.toFixed(1);
}

export function npsBandLabel(value: number) {
  if (value >= 9) return "Promoter";
  if (value >= 7) return "Passive";
  return "Detractor";
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

export function invoiceTypeTone(invoiceType: string) {
  if (invoiceType === "advance") return "border-violet-200 bg-violet-50 text-violet-700";
  if (invoiceType === "interim") return "border-sky-200 bg-sky-50 text-sky-700";
  if (invoiceType === "final") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
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

export function appointmentTypeLabel(value: string) {
  if (value === "medical") return "Medical";
  if (value === "non_medical") return "Non-medical";
  if (value === "internal") return "Internal";
  return value.replaceAll("_", " ");
}

export function appointmentTimeOfDayLabel(value?: string | null) {
  if (!value) return "Flexible";
  if (value === "morning") return "Morning";
  if (value === "midday") return "Midday";
  if (value === "afternoon") return "Afternoon";
  if (value === "evening") return "Evening";
  return "Flexible";
}

export function conciergeServiceKindLabel(value: string) {
  if (value === "hotel") return "Hotel";
  if (value === "transfer") return "Transfer";
  if (value === "vip_terminal") return "VIP terminal";
  if (value === "flight") return "Flight";
  if (value === "chauffeur") return "Chauffeur";
  if (value === "translation_support") return "Translation support";
  return "Additional service";
}

export function conciergeServiceStatusTone(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "booked" || status === "confirmed" || status === "in_service") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "cancelled") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function conciergeServiceSourceLabel(value: string) {
  if (value === "patient_portal") return "Portal request";
  if (value === "appointment_bootstrap") return "Care-team flow";
  return "Care-team entry";
}

async function fetchPortalBlob(path: string) {
  const token = getAccessToken();
  const response = await fetch(`/api/v1${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.blob();
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
    throw new Error("Allow pop-ups to preview the PDF.");
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
