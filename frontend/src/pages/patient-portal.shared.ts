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

export async function downloadPortalDocument(id: string, filename: string) {
  const token = getAccessToken();
  const response = await fetch(`/api/v1/me/documents/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "document";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadPortalUpload(id: string, filename: string) {
  const token = getAccessToken();
  const response = await fetch(`/api/v1/me/documents/uploads/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "document";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
