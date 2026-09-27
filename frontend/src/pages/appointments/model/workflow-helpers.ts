import { berlinLocalInputToIso } from "@/lib/app-time-zone";
import { toDateTimeLocalInput } from "@/pages/appointments/model/date-time";
import { appointmentText } from "@/pages/appointments/model/labels";
import {
  activePatientAssigneeIds,
  canRemindAboutAppointment,
} from "@/pages/appointments/model/staff-roles";
import type {
  AppointmentDetail,
  ConciergeServiceDraftState,
  ConciergeServiceEntry,
  HandoffStakeholder,
  PatientAssignment,
} from "@/pages/appointments/model/types";

/** A `datetime-local` value (Berlin wall clock) as a UTC instant for the API. */
export function toRfc3339(localDateTime: string) {
  return berlinLocalInputToIso(localDateTime) ?? "";
}

export function parsePositiveIntegerInput(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function buildTaskDefaultDueDate(detail: AppointmentDetail) {
  if (detail.time_start) {
    return `${detail.date}T${detail.time_start.slice(0, 5)}`;
  }
  return `${detail.date}T09:00`;
}

export function buildServiceDraft(
  service: ConciergeServiceEntry,
): ConciergeServiceDraftState {
  return {
    providerId: service.provider_id ?? "",
    taxonomyNodeId: service.taxonomy_node_id ?? "",
    assignedConciergeId: service.assigned_concierge_id ?? "",
    title: service.title,
    status: service.status,
    billingStatus: service.billing_status,
    bookingReference: service.booking_reference ?? "",
    vendorName: service.vendor_name ?? "",
    vendorContact: service.vendor_contact ?? "",
    startsAt: toDateTimeLocalInput(service.starts_at),
    endsAt: toDateTimeLocalInput(service.ends_at),
    actualCost: service.actual_cost ?? "",
    currency: service.currency || "EUR",
    serviceNotes: service.service_notes ?? "",
    billingNotes: service.billing_notes ?? "",
  };
}

export function appointmentAnchorDateTime(detail: AppointmentDetail) {
  const time = detail.time_end ?? detail.time_start ?? "09:00";
  return `${detail.date}T${time.slice(0, 5)}`;
}

export function buildHandoffStakeholders(
  detail: AppointmentDetail,
  assignments: PatientAssignment[],
  tr?: Record<string, string>,
): HandoffStakeholder[] {
  const patientBadge = tr?.patients_title ?? appointmentText("appointments_patient");
  const ownerBadge = tr?.patients_assign_owner ?? appointmentText("appointments_handoff_appointment_owner");
  const interpreterBadge = appointmentText("appointments_schedule_scope_interpreter");
  const items = new Map<string, HandoffStakeholder>();
  const activeAssignments = assignments.filter(
    (item) => item.user_active && !item.revoked_at,
  );

  for (const assignment of activeAssignments) {
    items.set(assignment.user_id, {
      id: assignment.user_id,
      name: assignment.user_name,
      role: assignment.user_role,
      badges: [patientBadge],
      canReceiveReminder: false,
    });
  }

  if (detail.owner_user_id && detail.owner_name) {
    const existing = items.get(detail.owner_user_id);
    if (existing) {
      existing.badges = Array.from(new Set([...existing.badges, ownerBadge]));
    } else {
      items.set(detail.owner_user_id, {
        id: detail.owner_user_id,
        name: detail.owner_name,
        role: detail.owner_role ?? "",
        badges: [ownerBadge],
        canReceiveReminder: false,
      });
    }
  }

  if (detail.interpreter_id && detail.interpreter_name) {
    const existing = items.get(detail.interpreter_id);
    if (existing) {
      existing.badges = Array.from(
        new Set([...existing.badges, interpreterBadge]),
      );
    } else {
      items.set(detail.interpreter_id, {
        id: detail.interpreter_id,
        name: detail.interpreter_name,
        role: "interpreter",
        badges: [interpreterBadge],
        canReceiveReminder: false,
      });
    }
  }

  const assigneeIds = activePatientAssigneeIds(activeAssignments);
  for (const item of items.values()) {
    item.canReceiveReminder = canRemindAboutAppointment(item, detail, assigneeIds);
  }

  return Array.from(items.values()).sort((left, right) =>
    `${left.role}:${left.name}`.localeCompare(`${right.role}:${right.name}`),
  );
}
