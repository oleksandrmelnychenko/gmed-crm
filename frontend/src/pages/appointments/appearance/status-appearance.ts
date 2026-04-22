import type {
  AppointmentCommunicationStatus,
  AppointmentKind,
  AppointmentStatus,
} from "@/pages/appointments/model/types";

export function interpreterReportBillingSyncBadgeClassName(
  status: string | null | undefined,
) {
  switch (status) {
    case "synced":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "missing_catalog":
    case "missing_order":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "pending_sync":
      return "border-sky-200 bg-sky-50 text-sky-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export function appointmentStatusBadgeClassName(status: AppointmentStatus) {
  switch (status) {
    case "planned":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "confirmed":
      return "bg-sky-100 text-sky-700 border-sky-200";
    case "in_progress":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "completed":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "cancelled":
      return "bg-rose-100 text-rose-700 border-rose-200";
  }
}

export function appointmentTypeBadgeClassName(type: AppointmentKind) {
  switch (type) {
    case "medical":
      return "bg-violet-100 text-violet-700 border-violet-200";
    case "non_medical":
      return "bg-teal-100 text-teal-700 border-teal-200";
    case "internal":
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

export function appointmentCommunicationStatusBadgeClassName(
  status: AppointmentCommunicationStatus,
) {
  switch (status) {
    case "answered":
    case "closed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "cancelled":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "planned":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}
