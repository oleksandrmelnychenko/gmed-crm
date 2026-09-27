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

export function canSelectAppointmentOwner(
  currentUserRole: string | undefined,
  currentUserId: string | undefined,
  target: StaffLike,
) {
  switch (currentUserRole) {
    case "ceo":
    case "patient_manager":
      return [
        "ceo",
        "patient_manager",
        "teamlead_interpreter",
        "interpreter",
        "concierge",
        "it_admin",
      ].includes(target.role);
    case "teamlead_interpreter":
      return (
        target.id === currentUserId ||
        target.role === "interpreter" ||
        target.role === "teamlead_interpreter"
      );
    case "concierge":
      return target.id === currentUserId && target.role === "concierge";
    case "it_admin":
      return target.id === currentUserId && target.role === "it_admin";
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
 * Who may be reminded about an appointment (mirrors the server): IT
 * administration never, billing not for a non-medical (concierge) booking.
 */
export function isAppointmentReminderRecipient(role: string, appointmentType: string) {
  if (role === "it_admin") return false;
  if (role === "billing") return appointmentType !== "non_medical";
  return true;
}

export type ReminderAppointmentLike = {
  type: string;
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
 * booked interpreter); the CEO, the CEO assistant and billing (by the rule
 * above) always.
 */
export function canRemindAboutAppointment(
  member: StaffLike,
  appointment: ReminderAppointmentLike,
  patientAssigneeIds: ReadonlySet<string>,
) {
  if (!isAppointmentReminderRecipient(member.role, appointment.type)) return false;
  const ownerOrAssignee =
    member.id === appointment.owner_user_id || patientAssigneeIds.has(member.id);
  switch (member.role) {
    case "ceo":
    case "ceo_assistant":
    case "billing":
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
