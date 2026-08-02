import { memo, useMemo } from "react";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { useLang } from "@/lib/i18n";
import { appointmentText } from "@/pages/appointments/model/labels";
import { appointmentSectionCardClassName } from "@/pages/appointments/appearance/surface-appearance";
import type { AppointmentDetail } from "@/pages/appointments/model/types";
import { EmptyState } from "@/pages/appointments/ui/shared/workspace-primitives";

type AppointmentNotesSectionProps = {
  detail: AppointmentDetail;
  canViewNotes: boolean;
  emptyText: string;
  hideWhenUnavailable?: boolean;
};

type NoteRow = {
  key: string;
  label: string;
  text: string | null | undefined;
};

function AppointmentNotesSection({
  detail,
  canViewNotes,
  emptyText,
  hideWhenUnavailable = false,
}: AppointmentNotesSectionProps) {
  const { t } = useLang();

  const rows = useMemo<NoteRow[]>(
    () => [
      { key: "discovery", label: t.phase_discovery, text: detail.preparation_notes },
      { key: "followup", label: t.phase_followup, text: detail.followup_notes },
      { key: "notes", label: t.patients_notes, text: detail.notes },
    ],
    [detail.followup_notes, detail.notes, detail.preparation_notes, t],
  );

  const columns = useMemo<ColumnDef<NoteRow>[]>(
    () => [
      {
        id: "kind",
        label: t.providers_type,
        accessor: (row) => row.label,
        sortable: true,
        required: true,
        width: 170,
        render: (row) => (
          <span className="inline-flex rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
            {row.label}
          </span>
        ),
      },
      {
        id: "text",
        label: t.patients_notes,
        accessor: (row) => row.text ?? "",
        searchable: true,
        width: 640,
        render: (row) =>
          row.text?.trim() ? (
            <span className="block whitespace-pre-line text-xs leading-5 text-foreground">
              {row.text}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {appointmentText("appointments_no_notes_captured_yet")}
            </span>
          ),
      },
    ],
    [t],
  );

  if (!canViewNotes || detail.is_blocked) {
    if (hideWhenUnavailable) return null;
    return (
      <section className={appointmentSectionCardClassName("p-5")}>
        <EmptyState text={emptyText} />
      </section>
    );
  }

  return (
    <DataTableSurface
      rows={rows}
      columns={columns}
      rowId={(row) => row.key}
      dictionary={t as unknown as Record<string, string>}
      emptyState={<EmptyState text={emptyText} />}
      toolbarStart={
        <>
          <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            {t.patients_notes}
          </span>
          <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
        </>
      }
    />
  );
}

export const MemoizedAppointmentNotesSection = memo(AppointmentNotesSection);
