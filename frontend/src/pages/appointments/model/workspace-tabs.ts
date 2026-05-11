import type { AppointmentWorkspaceTab } from "./types";

const APPOINTMENT_WORKSPACE_TABS = [
  "overview",
  "timeline",
  "coordination",
  "clinical",
  "workflow",
  "services",
  "notes",
] as const satisfies readonly AppointmentWorkspaceTab[];

const DEFAULT_APPOINTMENT_WORKSPACE_TAB: AppointmentWorkspaceTab =
  "overview";

export function normalizeAppointmentWorkspaceTab(
  value: string | null | undefined,
): AppointmentWorkspaceTab {
  return APPOINTMENT_WORKSPACE_TABS.includes(
    value as AppointmentWorkspaceTab,
  )
    ? (value as AppointmentWorkspaceTab)
    : DEFAULT_APPOINTMENT_WORKSPACE_TAB;
}
