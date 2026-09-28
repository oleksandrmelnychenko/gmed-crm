import { hasCapability } from "@/lib/permissions";

const APPOINTMENT_TASK_ASSIGNABLE_ROLES = new Set([
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
]);

export function isAppointmentTaskAssignableRole(role: string) {
  return APPOINTMENT_TASK_ASSIGNABLE_ROLES.has(role);
}

type StaffLike = {
  id: string;
  role: string;
};

/**
 * Whether a role can own (curate) an appointment (mirrors the server): the
 * owner must be able to open the appointment and work on it, i.e. hold
 * `appointments.view` and `appointments.edit` (CEO, patient manager,
 * interpreter team lead, concierge; each opens the appointments it owns).
 * IT administration, billing, interpreters and the CEO assistant cannot.
 */
export function isAppointmentOwnerRole(role: string) {
  return (
    hasCapability(role, "appointments.view") &&
    hasCapability(role, "appointments.edit")
  );
}

export function canSelectAppointmentOwner(
  currentUserRole: string | undefined,
  currentUserId: string | undefined,
  target: StaffLike,
) {
  if (!isAppointmentOwnerRole(target.role)) return false;
  switch (currentUserRole) {
    case "ceo":
    case "patient_manager":
      return true;
    case "teamlead_interpreter":
      return (
        target.id === currentUserId || target.role === "teamlead_interpreter"
      );
    case "concierge":
      return target.id === currentUserId && target.role === "concierge";
    default:
      return false;
  }
}

export function filterAppointmentOwnerOptions<T extends StaffLike>(
  staff: readonly T[],
  currentUserRole?: string,
  currentUserId?: string,
) {
  return staff.filter((member) =>
    canSelectAppointmentOwner(currentUserRole, currentUserId, member),
  );
}

/**
 * Who may be reminded about an appointment at all (mirrors the server): only
 * roles that can open appointments (`appointments.view`). IT administration
 * and billing never; billing learns about visits through the billing handoff.
 */
export function isAppointmentReminderRecipient(role: string) {
  return hasCapability(role, "appointments.view");
}

export type ReminderAppointmentLike = {
  status: string;
  interpreter_id: string | null;
  interpreter_response?: string | null;
  owner_user_id: string | null;
};

/** Users with an active (not revoked) assignment to the appointment's patient. */
export function activePatientAssigneeIds(
  assignments: readonly { user_id: string; revoked_at?: string | null }[],
): Set<string> {
  return new Set(
    assignments.filter((item) => !item.revoked_at).map((item) => item.user_id),
  );
}

/**
 * Whether a reminder about this appointment can go to the staff member
 * (mirrors the server): the recipient must be able to open the appointment
 * and complete the reminder. An interpreter only while booked on it (not
 * declined, the visit not cancelled); patient managers, concierges and team
 * leads as its owner or as assignees of the patient (a team lead also as the
 * booked interpreter); the CEO and the CEO assistant always.
 */
export function canRemindAboutAppointment(
  member: StaffLike,
  appointment: ReminderAppointmentLike,
  patientAssigneeIds: ReadonlySet<string>,
) {
  if (!isAppointmentReminderRecipient(member.role)) return false;
  const ownerOrAssignee =
    member.id === appointment.owner_user_id || patientAssigneeIds.has(member.id);
  switch (member.role) {
    case "ceo":
    case "ceo_assistant":
      return true;
    case "interpreter":
      return (
        member.id === appointment.interpreter_id &&
        appointment.status !== "cancelled" &&
        appointment.interpreter_response !== "declined"
      );
    case "teamlead_interpreter":
      return member.id === appointment.interpreter_id || ownerOrAssignee;
    case "patient_manager":
    case "concierge":
      return ownerOrAssignee;
    default:
      return false;
  }
}
