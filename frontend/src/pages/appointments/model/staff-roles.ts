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
