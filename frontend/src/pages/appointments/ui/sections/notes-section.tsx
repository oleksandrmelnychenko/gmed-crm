import { memo } from "react";

import { useLang } from "@/lib/i18n";
import { appointmentSectionCardClassName } from "@/pages/appointments/appearance/surface-appearance";
import type { AppointmentDetail } from "@/pages/appointments/model/types";
import { MemoizedAppointmentTextPanel } from "@/pages/appointments/ui/shared/text-panel";
import { EmptyState } from "@/pages/appointments/ui/shared/workspace-primitives";

type AppointmentNotesSectionProps = {
  detail: AppointmentDetail;
  canViewNotes: boolean;
  emptyText: string;
  hideWhenUnavailable?: boolean;
};

function AppointmentNotesSection({
  detail,
  canViewNotes,
  emptyText,
  hideWhenUnavailable = false,
}: AppointmentNotesSectionProps) {
  const { t } = useLang();

  if (!canViewNotes || detail.is_blocked) {
    if (hideWhenUnavailable) return null;
    return (
      <section className={appointmentSectionCardClassName("p-5")}>
        <EmptyState text={emptyText} />
      </section>
    );
  }

  return (
    <section className={appointmentSectionCardClassName("p-5")}>
      <h3 className="text-sm font-semibold text-slate-950">
        {t.patients_notes}
      </h3>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <MemoizedAppointmentTextPanel
          title={t.phase_discovery}
          text={detail.preparation_notes}
        />
        <MemoizedAppointmentTextPanel
          title={t.phase_followup}
          text={detail.followup_notes}
        />
        <MemoizedAppointmentTextPanel
          title={t.patients_notes}
          text={detail.notes}
        />
      </div>
    </section>
  );
}

export const MemoizedAppointmentNotesSection = memo(AppointmentNotesSection);
