import type { FiltersState, LinkedDocumentItem } from "./types";

export function buildAppointmentsQuery(filters: FiltersState): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.appointmentType)
    params.set("appointment_type", filters.appointmentType);
  if (filters.carePathKind) params.set("care_path_kind", filters.carePathKind);
  if (filters.status) params.set("status", filters.status);
  if (filters.patientId) params.set("patient_id", filters.patientId);
  if (filters.providerId) params.set("provider_id", filters.providerId);
  if (filters.doctorId) params.set("doctor_id", filters.doctorId);
  if (filters.ownerUserId) params.set("owner_user_id", filters.ownerUserId);
  if (filters.interpreterId)
    params.set("interpreter_id", filters.interpreterId);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  return params.size ? `/appointments?${params.toString()}` : "/appointments";
}

export function buildConflictQuery(
  patientId: string,
  appointmentId: string,
  date: string,
  timeStart: string,
  timeEnd: string,
  interpreterId: string,
): string {
  const params = new URLSearchParams({ patient_id: patientId, date });
  if (appointmentId) params.set("appointment_id", appointmentId);
  if (timeStart) params.set("time_start", timeStart);
  if (timeEnd) params.set("time_end", timeEnd);
  if (interpreterId) params.set("interpreter_id", interpreterId);
  return `/appointments/meta/conflicts?${params.toString()}`;
}

export function formatDocumentFileSize(
  size: number | null | undefined,
): string {
  if (!size || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  const index = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length - 1,
  );
  const value = size / 1024 ** index;
  const precision = index === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(precision)} ${units[index]}`;
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortLinkedDocuments(
  items: LinkedDocumentItem[],
): LinkedDocumentItem[] {
  return items.toSorted((left, right) => {
    const updatedDiff =
      toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
    if (updatedDiff !== 0) return updatedDiff;

    const createdDiff =
      toTimestamp(right.created_at) - toTimestamp(left.created_at);
    if (createdDiff !== 0) return createdDiff;

    if (right.version_number !== left.version_number) {
      return right.version_number - left.version_number;
    }

    return (left.auto_name || "").localeCompare(right.auto_name || "");
  });
}
