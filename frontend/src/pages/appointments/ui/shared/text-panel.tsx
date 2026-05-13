import { memo } from "react";

import { useLang } from "@/lib/i18n";
import { appointmentText } from "@/pages/appointments/model/labels";

type AppointmentTextPanelProps = {
  title: string;
  text: string | null;
};

function AppointmentTextPanel({
  title,
  text,
}: AppointmentTextPanelProps) {
  const { t } = useLang();

  return (
    <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
      <p className="text-[11.5px] font-medium leading-tight text-muted-foreground">
        {title}
      </p>
      <p className="mt-2 text-sm leading-6 text-foreground">
        {text?.trim() ||
          appointmentText("appointments_no_notes_captured_yet") ||
          t.patients_notes}
      </p>
    </div>
  );
}

export const MemoizedAppointmentTextPanel = memo(AppointmentTextPanel);
