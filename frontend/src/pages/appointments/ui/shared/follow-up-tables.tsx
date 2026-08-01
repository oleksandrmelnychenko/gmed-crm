import { useMemo, type ReactNode } from "react";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { CountBadge, EmptyCell } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  appointmentText,
  roleLabel,
  taskPriorityLabel,
  taskStatusLabel,
} from "@/pages/appointments/model/labels";
import { formatAppointmentDateTimeLabel } from "@/pages/appointments/model/runtime-formatters";
import type { ReminderEntry, TaskEntry } from "@/pages/appointments/model/types";

function taskStatusChipClass(status: string) {
  switch (status) {
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "in_progress":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "cancelled":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function taskPriorityChipClass(priority: string) {
  switch (priority) {
    case "urgent":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "high":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "low":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-border/60 bg-muted/25 text-foreground";
  }
}

function followUpTableToolbarStart(
  title: string | undefined,
  count: number,
  extra?: ReactNode,
) {
  if (!title && !extra) return undefined;
  return (
    <>
      {title ? (
        <>
          <span className="shrink-0 self-center text-[13px] font-semibold tracking-tight text-foreground">
            {title}
          </span>
          <CountBadge>{count}</CountBadge>
        </>
      ) : null}
      {extra}
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
    </>
  );
}

export function AppointmentRemindersTable({
  reminders,
  title,
  emptyText,
  toolbarExtra,
  rowActions,
  rowActionsWidth,
}: {
  reminders: readonly ReminderEntry[];
  title?: string;
  emptyText: string;
  toolbarExtra?: ReactNode;
  rowActions?: (item: ReminderEntry) => ReactNode;
  rowActionsWidth?: number;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const columns = useMemo<ColumnDef<ReminderEntry>[]>(
    () => [
      {
        id: "title",
        label: tr.appointments_title_col ?? tr.appointments_title,
        accessor: (item) => item.title,
        filterType: "text",
        sortable: true,
        required: true,
        width: 300,
        render: (item) => (
          <span
            className={cn(
              "block truncate text-xs font-medium text-foreground",
              item.is_completed && "text-muted-foreground line-through",
            )}
            title={item.title}
          >
            {item.title}
          </span>
        ),
      },
      {
        id: "user",
        label: tr.patients_owner ?? tr.users_role,
        accessor: (item) => item.user_name,
        filterType: "text",
        sortable: true,
        width: 190,
        render: (item) => (
          <span className="block truncate font-mono text-xs text-foreground">
            {item.user_name}
          </span>
        ),
      },
      {
        id: "remind_at",
        label: tr.appointments_date,
        accessor: (item) => item.remind_at,
        filterType: "date",
        sortable: true,
        width: 170,
        render: (item) => (
          <span className="font-mono text-xs tabular-nums text-foreground">
            {formatAppointmentDateTimeLabel(item.remind_at)}
          </span>
        ),
      },
      {
        id: "status",
        label: tr.users_status,
        accessor: (item) =>
          item.is_completed ? tr.common_completed : tr.common_pending,
        filterType: "enum",
        filterOptions: [
          { value: tr.common_completed, label: tr.common_completed },
          { value: tr.common_pending, label: tr.common_pending },
        ],
        sortable: true,
        width: 140,
        render: (item) => (
          <Badge
            variant="outline"
            className={cn(
              "rounded-full font-mono text-[10px]",
              item.is_completed
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700",
            )}
          >
            {item.is_completed ? tr.common_completed : tr.common_pending}
          </Badge>
        ),
      },
      {
        id: "description",
        label: tr.contracts_notes,
        accessor: (item) => item.description ?? "",
        filterType: "text",
        width: 300,
        render: (item) => (
          <span
            className="block truncate text-xs text-foreground"
            title={item.description ?? undefined}
          >
            {item.description?.trim() || tr.common_not_set}
          </span>
        ),
      },
    ],
    [tr],
  );

  return (
    <DataTableSurface
      rows={reminders}
      columns={columns}
      rowId={(item) => item.id}
      dictionary={tr}
      emptyState={<EmptyCell>{emptyText}</EmptyCell>}
      toolbarStart={followUpTableToolbarStart(title, reminders.length, toolbarExtra)}
      rowActions={rowActions}
      rowActionsWidth={rowActionsWidth}
    />
  );
}

export function AppointmentTasksTable({
  tasks,
  title,
  emptyText,
  toolbarExtra,
  rowActions,
  rowActionsWidth,
}: {
  tasks: readonly TaskEntry[];
  title?: string;
  emptyText: string;
  toolbarExtra?: ReactNode;
  rowActions?: (item: TaskEntry) => ReactNode;
  rowActionsWidth?: number;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const columns = useMemo<ColumnDef<TaskEntry>[]>(
    () => [
      {
        id: "title",
        label: tr.appointments_title_col ?? tr.appointments_title,
        accessor: (item) => item.title,
        filterType: "text",
        sortable: true,
        required: true,
        width: 300,
        render: (item) => (
          <span
            className={cn(
              "block truncate text-xs font-medium text-foreground",
              item.status === "completed" && "text-muted-foreground line-through",
            )}
            title={item.title}
          >
            {item.title}
          </span>
        ),
      },
      {
        id: "assignee",
        label: tr.patients_owner ?? tr.users_role,
        accessor: (item) =>
          `${item.assigned_to_name} · ${roleLabel(item.assigned_to_role)}`,
        filterType: "text",
        sortable: true,
        width: 230,
        render: (item) => (
          <span className="block truncate font-mono text-xs text-foreground">
            {item.assigned_to_name} · {roleLabel(item.assigned_to_role)}
          </span>
        ),
      },
      {
        id: "status",
        label: tr.users_status,
        accessor: (item) => taskStatusLabel(item.status),
        filterType: "enum",
        filterOptions: (rows) =>
          [...new Set(rows.map((item) => taskStatusLabel(item.status)))].map(
            (label) => ({ value: label, label }),
          ),
        sortable: true,
        width: 140,
        render: (item) => (
          <Badge
            variant="outline"
            className={cn(
              "rounded-full font-mono text-[10px]",
              taskStatusChipClass(item.status),
            )}
          >
            {taskStatusLabel(item.status)}
          </Badge>
        ),
      },
      {
        id: "priority",
        label: appointmentText("patients_priority"),
        accessor: (item) => taskPriorityLabel(item.priority),
        filterType: "enum",
        filterOptions: (rows) =>
          [...new Set(rows.map((item) => taskPriorityLabel(item.priority)))].map(
            (label) => ({ value: label, label }),
          ),
        sortable: true,
        width: 130,
        render: (item) => (
          <Badge
            variant="outline"
            className={cn(
              "rounded-full font-mono text-[10px]",
              taskPriorityChipClass(item.priority),
            )}
          >
            {taskPriorityLabel(item.priority)}
          </Badge>
        ),
      },
      {
        id: "due_date",
        label: tr.orders_due ?? tr.appointments_date,
        accessor: (item) => item.due_date ?? "",
        filterType: "date",
        sortable: true,
        width: 170,
        render: (item) =>
          item.due_date ? (
            <span className="font-mono text-xs tabular-nums text-foreground">
              {formatAppointmentDateTimeLabel(item.due_date)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{tr.common_not_set}</span>
          ),
      },
      {
        id: "description",
        label: tr.contracts_notes,
        accessor: (item) => item.description ?? "",
        filterType: "text",
        width: 300,
        render: (item) => (
          <span
            className="block truncate text-xs text-foreground"
            title={item.description ?? undefined}
          >
            {item.description?.trim() || tr.common_not_set}
          </span>
        ),
      },
    ],
    [tr],
  );

  return (
    <DataTableSurface
      rows={tasks}
      columns={columns}
      rowId={(item) => item.id}
      dictionary={tr}
      emptyState={<EmptyCell>{emptyText}</EmptyCell>}
      toolbarStart={followUpTableToolbarStart(title, tasks.length, toolbarExtra)}
      rowActions={rowActions}
      rowActionsWidth={rowActionsWidth}
    />
  );
}
