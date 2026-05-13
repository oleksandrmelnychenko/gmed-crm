import type { Translations } from "@/lib/i18n";
import { appointmentText, recurrenceFrequencyLabel } from "@/pages/appointments/model/labels";
import type {
  AppointmentDetail,
  AppointmentRecurringActionScope,
  AppointmentRecurrenceFrequency,
  RecurringLineageHistoryItem,
} from "@/pages/appointments/model/types";

export function recurrenceCadenceLabel(item: {
  recurrence_frequency: AppointmentRecurrenceFrequency | null;
  recurrence_interval: number | null;
}) {
  if (!item.recurrence_frequency) {
    return appointmentText("appointments_one_time_appointment");
  }
  const interval = item.recurrence_interval ?? 1;
  if (item.recurrence_frequency === "daily") {
    return appointmentText(
      interval === 1
        ? "appointments_recurrence_daily_one"
        : "appointments_recurrence_daily_many",
      { interval },
    );
  }
  if (item.recurrence_frequency === "weekly") {
    return appointmentText(
      interval === 1
        ? "appointments_recurrence_weekly_one"
        : "appointments_recurrence_weekly_many",
      { interval },
    );
  }
  return appointmentText(
    interval === 1
      ? "appointments_recurrence_monthly_one"
      : "appointments_recurrence_monthly_many",
    { interval },
  );
}

export function recurrenceLineageText(
  detail: AppointmentDetail,
  t: Translations | Record<string, string>,
) {
  if (
    !detail.recurrence_frequency ||
    !detail.recurrence_parent_series_id ||
    detail.recurrence_split_from_index === null
  ) {
    return "";
  }
  const occurrenceNumber = detail.recurrence_split_from_index + 1;
  return detail.recurrence_split_from_appointment_id === detail.id
    ? `${t.appointments_lineage_tail_root} ${occurrenceNumber} ${t.appointments_lineage_previous_plan}`
    : `${t.appointments_lineage_tail_member} ${occurrenceNumber} ${t.appointments_lineage_previous_plan}`;
}

export function recurrenceLineageBadge(
  detail: AppointmentDetail,
  t: Translations | Record<string, string>,
) {
  if (!detail.recurrence_frequency || !detail.recurrence_parent_series_id) {
    return "";
  }
  return detail.recurrence_split_from_appointment_id === detail.id
    ? t.appointments_lineage_child
    : t.appointments_lineage_related;
}

export function recurringStatusTargetsForScope(
  detail: AppointmentDetail,
  scope: AppointmentRecurringActionScope,
) {
  const items = detail.recurring_scope_preview ?? [];
  if (!detail.recurrence_frequency) return [];
  if (scope === "single") {
    return items.filter((item) => item.id === detail.id);
  }
  if (scope === "following") {
    return items.filter(
      (item) => item.recurrence_index >= detail.recurrence_index,
    );
  }
  return items;
}

export function recurringOccurrenceLabel(
  item: {
    date: string;
    recurrence_index: number;
    open_checklist_count: number;
  },
  t: Translations | Record<string, string>,
) {
  const checklistLabel =
    item.open_checklist_count === 1
      ? t.appointments_open_checklist
      : t.appointments_open_checklists;
  return `Occurrence ${item.recurrence_index + 1} on ${item.date} (${item.open_checklist_count} ${checklistLabel})`;
}

export function recurringLineageRelationLabel(
  item: RecurringLineageHistoryItem,
  t: Translations | Record<string, string>,
) {
  switch (item.relation) {
    case "ancestor":
      return item.depth <= 1
        ? t.appointments_lineage_parent
        : `${t.appointments_lineage_ancestor} +${item.depth}`;
    case "current":
      return t.appointments_lineage_current;
    case "descendant":
      return item.depth <= 1
        ? t.appointments_lineage_child
        : `${t.appointments_lineage_descendant} +${item.depth}`;
    default:
      return t.appointments_lineage_related;
  }
}

export function recurringLineageSplitLabel(
  item: RecurringLineageHistoryItem,
  t: Translations | Record<string, string>,
) {
  if (item.split_from_index === null) return t.appointments_lineage_current;
  return `${t.appointments_lineage_split_from_occurrence} ${item.split_from_index + 1}`;
}

export function currentRecurringLineageHistory(detail: AppointmentDetail) {
  return (
    detail.recurring_lineage_history.find(
      (item) =>
        item.relation === "current" ||
        item.series_id === detail.recurrence_series_id,
    ) ?? null
  );
}

export { recurrenceFrequencyLabel };
