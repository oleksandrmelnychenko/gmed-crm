import type {
  AppointmentPermissions,
  AppointmentWorkspaceTab,
} from "./types";

export type AppointmentDetailResourceGroup =
  | "checklist"
  | "reminders"
  | "report"
  | "tasks"
  | "services"
  | "communications";

export const APPOINTMENT_DETAIL_RESOURCE_GROUPS: AppointmentDetailResourceGroup[] =
  [
    "checklist",
    "reminders",
    "report",
    "tasks",
    "services",
    "communications",
  ];

const DESKTOP_TAB_RESOURCE_GROUPS: Record<
  AppointmentWorkspaceTab,
  AppointmentDetailResourceGroup[]
> = {
  overview: [],
  timeline: [],
  coordination: ["reminders", "tasks", "communications"],
  clinical: ["checklist", "reminders", "tasks", "report"],
  workflow: ["checklist", "reminders", "tasks", "report"],
  services: ["reminders", "report", "tasks", "services"],
  notes: [],
};

const DETAIL_RESOURCE_GROUP_PERMISSIONS: Record<
  AppointmentDetailResourceGroup,
  (permissions: AppointmentPermissions) => boolean
> = {
  checklist: (permissions) => permissions.canManageChecklist,
  reminders: (permissions) => permissions.canViewReminders,
  report: (permissions) => permissions.canViewReport,
  tasks: (permissions) => permissions.canViewTasks,
  services: (permissions) => permissions.canViewConciergeServices,
  communications: (permissions) => permissions.canViewCommunications,
};

export function getRequiredAppointmentDetailResourceGroups(
  detailTab: AppointmentWorkspaceTab,
  isMobile: boolean,
  permissions: AppointmentPermissions,
) {
  const groups = isMobile
    ? APPOINTMENT_DETAIL_RESOURCE_GROUPS
    : DESKTOP_TAB_RESOURCE_GROUPS[detailTab];

  return groups.filter((group) =>
    DETAIL_RESOURCE_GROUP_PERMISSIONS[group](permissions),
  );
}
