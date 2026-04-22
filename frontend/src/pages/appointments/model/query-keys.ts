import type { AppointmentWorkspaceTab } from "./types";

export const appointmentsQueryKeys = {
  all: ["appointments"] as const,
  list: (scope: string) => ["appointments", "list", scope] as const,
  detail: (appointmentId: string) =>
    ["appointments", "detail", appointmentId] as const,
  detailTab: (appointmentId: string, tab: AppointmentWorkspaceTab) =>
    ["appointments", "detail", appointmentId, tab] as const,
  linkedRecord: (
    appointmentId: string,
    recordType: "patient" | "provider" | "cases" | "documents",
  ) => ["appointments", "linked-record", appointmentId, recordType] as const,
};
