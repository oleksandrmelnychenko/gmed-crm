import { useEffect, useState } from "react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Banner,
  CountBadge,
  EmptyCell,
  ListItem,
  Section,
  StatusBadge,
} from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { appointmentSectionCardClassName } from "@/pages/appointments/appearance/surface-appearance";
import {
  appointmentText,
  reportApprovalLabel,
} from "@/pages/appointments/model/labels";
import {
  formatAppointmentDateTimeLabel,
  formatAppointmentSlotLabel,
} from "@/pages/appointments/model/runtime-formatters";
import type { OwnInterpreterReport } from "@/pages/appointments/model/types";

function reportTone(status: string) {
  if (status === "approved") return "success" as const;
  if (status === "rejected") return "error" as const;
  return "warning" as const;
}

/**
 * The interpreter's own reports, read-only: hours, the visit's date and time,
 * the review decision with its note and the report text. A report on a visit
 * the interpreter was taken off stays listed; only visits it can still open
 * offer the appointment (where a returned report is revised).
 */
export function OwnInterpreterReportsList({
  reports,
  onOpenAppointment,
}: {
  reports: OwnInterpreterReport[];
  onOpenAppointment: (appointmentId: string) => void;
}) {
  const { t } = useLang();

  if (reports.length === 0) {
    return <EmptyCell>{t.appointments_own_reports_empty}</EmptyCell>;
  }

  return (
    <div className="space-y-2.5">
      {reports.map((report) => (
        <ListItem key={report.id} className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {formatAppointmentSlotLabel({
                  date: report.appointment_date,
                  time_start: report.appointment_time_start,
                  time_end: report.appointment_time_end,
                })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {appointmentText("appointments_report_hours_value", { hours: report.hours })}
                {" · "}
                {t.appointments_report_submitted_prefix}{" "}
                {formatAppointmentDateTimeLabel(report.created_at)}
              </p>
            </div>
            <StatusBadge tone={reportTone(report.approval_status)}>
              {reportApprovalLabel(report.approval_status)}
            </StatusBadge>
          </div>

          {report.notes ? (
            <Banner tone={report.approval_status === "rejected" ? "error" : "warning"}>
              <span className="font-medium">{t.appointments_report_reviewer_notes}:</span>{" "}
              {report.notes}
            </Banner>
          ) : null}

          {report.report_text ? (
            <p className="whitespace-pre-wrap text-sm text-foreground">{report.report_text}</p>
          ) : null}

          {report.appointment_access ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => onOpenAppointment(report.appointment_id)}
            >
              {t.appointments_own_reports_open_appointment}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="own-report-read-only">
              {t.appointments_own_reports_read_only}
            </p>
          )}
        </ListItem>
      ))}
    </div>
  );
}

/** Loads the interpreter's own reports for the "Hours and reports" view. */
export function OwnInterpreterReportsPanel({
  onOpenAppointment,
}: {
  onOpenAppointment: (appointmentId: string) => void;
}) {
  const { t } = useLang();
  const [reports, setReports] = useState<OwnInterpreterReport[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<OwnInterpreterReport[]>("/appointments/my-reports", { forceFresh: true })
      .then((items) => {
        if (!cancelled) setReports(items);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className={appointmentSectionCardClassName("p-4")}>
      <Section
        title={t.appointments_own_reports_title}
        accessory={reports ? <CountBadge>{reports.length}</CountBadge> : null}
      >
        <p className="text-sm text-muted-foreground">{t.appointments_own_reports_hint}</p>
        {loadError ? (
          <Banner tone="error">{t.appointments_own_reports_load_error}</Banner>
        ) : reports === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
          </div>
        ) : (
          <OwnInterpreterReportsList reports={reports} onOpenAppointment={onOpenAppointment} />
        )}
      </Section>
    </section>
  );
}
