import { apiFetch } from "@/lib/api";
import type {
  AppointmentCommunicationEntry,
  ChecklistItem,
  ConciergeServiceEntry,
  ReportSummary,
  ReminderEntry,
  TaskEntry,
} from "@/pages/appointments/model/types";
import type { AppointmentDetailResourceGroup } from "@/pages/appointments/model/detail-resource-needs";

type AppointmentDetailResourceMap = {
  checklist: ChecklistItem[];
  reminders: ReminderEntry[];
  report: ReportSummary | null;
  tasks: TaskEntry[];
  services: ConciergeServiceEntry[];
  communications: AppointmentCommunicationEntry[];
};

export type AppointmentDetailResourcePayload = {
  [Group in AppointmentDetailResourceGroup]: {
    group: Group;
    value: AppointmentDetailResourceMap[Group];
  };
}[AppointmentDetailResourceGroup];

export async function fetchAppointmentDetailResourceGroup(
  group: AppointmentDetailResourceGroup,
  appointmentId: string,
): Promise<AppointmentDetailResourcePayload> {
  switch (group) {
    case "checklist":
      return {
        group,
        value: await apiFetch<ChecklistItem[]>(
          `/appointments/${appointmentId}/checklist`,
        ),
      };
    case "reminders":
      return {
        group,
        value: await apiFetch<ReminderEntry[]>(
          `/appointments/${appointmentId}/reminders`,
        ),
      };
    case "report":
      return {
        group,
        value: await apiFetch<ReportSummary | null>(
          `/appointments/${appointmentId}/report`,
        ),
      };
    case "tasks":
      return {
        group,
        value: await apiFetch<TaskEntry[]>(
          `/tasks?appointment_id=${appointmentId}`,
        ).catch(() => []),
      };
    case "services":
      return {
        group,
        value: await apiFetch<ConciergeServiceEntry[]>(
          `/concierge-services?appointment_id=${appointmentId}`,
        ).catch(() => []),
      };
    case "communications":
      return {
        group,
        value: await apiFetch<AppointmentCommunicationEntry[]>(
          `/appointments/${appointmentId}/communications`,
        ).catch(() => []),
      };
    default: {
      const exhaustiveGroup: never = group;
      throw new Error(`Unsupported detail resource group: ${exhaustiveGroup}`);
    }
  }
}
