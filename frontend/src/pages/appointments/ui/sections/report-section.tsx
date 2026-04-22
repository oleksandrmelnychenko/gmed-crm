import {
  memo,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Banner,
  CountBadge,
  EmptyCell,
  inputClass,
  Section,
  StatCard,
  StatusBadge,
  textareaClass,
  tokens,
} from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  blankReportForm,
} from "@/pages/appointments/model/form-factories";
import {
  appointmentText,
  interpreterReportBillingSyncLabel,
  reportApprovalLabel,
} from "@/pages/appointments/model/labels";
import {
  formatAppointmentDateTimeLabel as formatDateTimeLabel,
} from "@/pages/appointments/model/runtime-formatters";
import type {
  AppointmentDetail,
  ReportFormState,
  ReportSummary,
} from "@/pages/appointments/model/types";
import {
  interpreterReportBillingSyncBadgeClassName,
} from "@/pages/appointments/appearance/status-appearance";
import {
  AppointmentEditorSheet,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";

function withEllipsis(value: string) {
  return value.endsWith("...") || value.endsWith("…") ? value : `${value}…`;
}

type AppointmentReportSectionProps = {
  detail: AppointmentDetail;
  detailReport: ReportSummary | null;
  reportReviewMeta: string;
  canSubmitInterpreterReport: boolean;
  canResubmitRejectedReport: boolean;
  showReportReviewActions: boolean;
  canApproveReport: boolean;
  canRejectReport: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
};

function AppointmentReportSection({
  detail,
  detailReport,
  reportReviewMeta,
  canSubmitInterpreterReport,
  canResubmitRejectedReport,
  showReportReviewActions,
  canApproveReport,
  canRejectReport,
  onRefresh,
  onError,
}: AppointmentReportSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [form, setForm] = useState<ReportFormState>(() => blankReportForm());
  const [rejectReason, setRejectReason] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    setForm(
      detailReport && detailReport.approval_status === "rejected"
        ? {
            hours: detailReport.hours,
            reportText: detailReport.report_text ?? "",
          }
        : blankReportForm(),
    );
    setRejectReason("");
    setBusyAction("");
    setEditorOpen(false);
  }, [detail.id, detailReport]);

  async function handleReportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("report-submit");
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/report`, {
        method: "POST",
        body: JSON.stringify({
          hours: Number(form.hours),
          report_text: form.reportText.trim() || null,
        }),
      });
      setForm(blankReportForm());
      setEditorOpen(false);
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Bericht konnte nicht eingereicht werden.",
              "Не удалось отправить отчёт.",
              "Failed to submit report",
            ),
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handleApproveReport() {
    setBusyAction("report-approve");
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/report/approve`, {
        method: "POST",
      });
      setEditorOpen(false);
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Bericht konnte nicht freigegeben werden.",
              "Не удалось согласовать отчёт.",
              "Failed to approve report",
            ),
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handleRejectReport() {
    setBusyAction("report-reject");
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/report/reject`, {
        method: "POST",
        body: JSON.stringify({ notes: rejectReason.trim() || null }),
      });
      setRejectReason("");
      setEditorOpen(false);
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Bericht konnte nicht zurückgewiesen werden.",
              "Не удалось отклонить отчёт.",
              "Failed to reject report",
            ),
      );
    } finally {
      setBusyAction("");
    }
  }

  const reportStatusTone =
    detailReport?.approval_status === "approved"
      ? "success"
      : detailReport?.approval_status === "rejected"
        ? "error"
        : "warning";
  const canOpenReportEditor = canSubmitInterpreterReport || showReportReviewActions;
  const reportEditorTitle = showReportReviewActions
    ? appointmentText(
        "Review-Entscheidung",
        "Решение по проверке",
        "Review decision",
      )
    : canResubmitRejectedReport
      ? appointmentText(
          "Bericht überarbeiten",
          "Доработать отчёт",
          "Revise report",
        )
      : appointmentText(
          "Bericht einreichen",
          "Отправить отчёт",
          "Submit report",
        );
  const reportOpenButtonLabel = showReportReviewActions
    ? appointmentText("Review öffnen", "Открыть review", "Open review")
    : appointmentText("Bericht öffnen", "Открыть отчёт", "Open report");

  return (
    <div className="space-y-4">
      <Section
        title={t.appointments_interpreter_report_title}
        accessory={
          <div className="flex items-center gap-2">
            {detailReport ? (
              <StatusBadge tone={reportStatusTone}>
                {reportApprovalLabel(detailReport.approval_status)}
              </StatusBadge>
            ) : (
              <CountBadge>
                {appointmentText("Nicht eingereicht", "Не отправлен", "Not submitted")}
              </CountBadge>
            )}
            {canOpenReportEditor ? (
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 rounded-lg"
                onClick={() => setEditorOpen(true)}
              >
                {reportOpenButtonLabel}
              </Button>
            ) : null}
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">
          {t.appointments_interpreter_report_subtitle}
        </p>

        {detailReport ? (
          <>
            <div className="grid gap-3 xl:grid-cols-3">
              <StatCard
                label={appointmentText("Dolmetscher", "Переводчик", "Interpreter")}
                value={
                  detailReport.interpreter_name ??
                  appointmentText("Nicht festgelegt", "Не указано", "Not set")
                }
                description={`${t.appointments_report_submitted_prefix} ${formatDateTimeLabel(detailReport.created_at)}`}
              />
              <StatCard
                label={t.appointments_time}
                value={`${detailReport.hours} h`}
                description={
                  detailReport.approval_status === "approved"
                    ? interpreterReportBillingSyncLabel(
                        detailReport.billing_sync_status,
                        t,
                      )
                    : detailReport.approval_status === "rejected"
                      ? t.appointments_report_needs_interpreter_revision
                      : t.appointments_report_waiting_teamlead_review
                }
              />
              <StatCard
                label={tr.patients_notes}
                value={
                  detailReport.approved_by_name ??
                  (detailReport.approval_status === "pending"
                    ? t.common_pending
                    : t.appointments_report_no_reviewer_recorded)
                }
                description={
                  reportReviewMeta ||
                  appointmentText(
                    "Noch keine Review-Metadaten.",
                    "Метаданные проверки пока отсутствуют.",
                    "No review metadata recorded yet.",
                  )
                }
              />
            </div>

            {detailReport.notes ? (
              <Banner
                tone={detailReport.approval_status === "rejected" ? "error" : "warning"}
                withIcon
              >
                <span className="font-medium">
                  {t.appointments_report_reviewer_notes}:
                </span>{" "}
                {detailReport.notes}
              </Banner>
            ) : null}

            {detailReport.approval_status === "approved" ? (
              <div
                className={cn(
                  "rounded-xl border px-4 py-3 text-sm",
                  interpreterReportBillingSyncBadgeClassName(
                    detailReport.billing_sync_status,
                  ),
                )}
              >
                <p className="font-medium">{t.appointments_report_billing_sync}</p>
                <p className="mt-1">
                  {interpreterReportBillingSyncLabel(
                    detailReport.billing_sync_status,
                    t,
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs opacity-80">
                  {detailReport.billing_service_key ? (
                    <span>
                      {appointmentText(
                        "Katalogschlüssel",
                        "Ключ каталога",
                        "Catalog key",
                      )}
                      : {detailReport.billing_service_key}
                    </span>
                  ) : null}
                  {detailReport.billing_leistung_id ? (
                    <span>
                      {appointmentText(
                        "Auftragsposition",
                        "Строка заказа",
                        "Order line",
                      )}
                      : {detailReport.billing_leistung_id}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className={cn("rounded-xl px-4 py-4", tokens.surface.card)}>
              <p className={tokens.text.label}>
                {appointmentText("Berichtstext", "Текст отчёта", "Report text")}
              </p>
              {detailReport.report_text ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {detailReport.report_text}
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {appointmentText(
                    "Kein Freitext-Bericht eingereicht.",
                    "Свободный текст отчёта не отправлен.",
                    "No free-text report submitted.",
                  )}
                </p>
              )}
            </div>
          </>
        ) : (
          <EmptyCell>
            {appointmentText(
              "Für diesen Termin liegt noch kein Dolmetscherbericht vor.",
              "Для этого приёма пока нет отчёта переводчика.",
              "No interpreter report has been submitted for this appointment yet.",
            )}
          </EmptyCell>
        )}
      </Section>

      {canOpenReportEditor ? (
        <AppointmentEditorSheet
          open={editorOpen}
          onOpenChange={setEditorOpen}
          title={reportEditorTitle}
          description={
            showReportReviewActions
              ? appointmentText(
                  "Prüfen Sie Stunden und Bericht direkt im Kontext dieses Termins.",
                  "Проверьте часы и текст отчёта прямо в контексте этого приёма.",
                  "Review the hours and report directly in the context of this appointment.",
                )
              : appointmentText(
                  "Pflegen Sie Stunden und Freitextbericht direkt im rechten Bearbeitungsbereich dieses Termins.",
                  "Заполняйте часы и текстовый отчёт прямо в правой панели редактирования этого приёма.",
                  "Manage hours and free-text report directly in this appointment's right-side editor.",
                )
          }
          onSubmit={
            canSubmitInterpreterReport ? handleReportSubmit : (event) => event.preventDefault()
          }
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg"
                onClick={() => setEditorOpen(false)}
              >
                {t.common_cancel}
              </Button>
              {showReportReviewActions && canRejectReport ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                  disabled={busyAction === "report-reject"}
                  onClick={handleRejectReport}
                >
                  {busyAction === "report-reject" ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {appointmentText(
                    "Zur Überarbeitung zurückgeben",
                    "Вернуть на доработку",
                    "Return for revision",
                  )}
                </Button>
              ) : null}
              {showReportReviewActions && canApproveReport ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg"
                  disabled={busyAction === "report-approve"}
                  onClick={handleApproveReport}
                >
                  {busyAction === "report-approve" ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {appointmentText(
                    "Stunden und Bericht freigeben",
                    "Согласовать часы и отчёт",
                    "Approve hours and report",
                  )}
                </Button>
              ) : null}
              {canSubmitInterpreterReport ? (
                <Button
                  type="submit"
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg"
                  disabled={busyAction === "report-submit" || !form.hours}
                >
                  {busyAction === "report-submit" ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {canResubmitRejectedReport
                    ? appointmentText(
                        "Bericht erneut einreichen",
                        "Повторно отправить отчёт",
                        "Resubmit report",
                      )
                    : t.common_save}
                </Button>
              ) : null}
            </>
          }
        >
          {canResubmitRejectedReport ? (
            <Banner tone="warning" withIcon>
              {appointmentText(
                "Der letzte Bericht wurde zurückgegeben. Passen Sie Stunden oder Text an und reichen Sie ihn erneut zur Freigabe ein.",
                "Последний отчёт вернули на доработку. Обновите часы или текст и отправьте его повторно на согласование.",
                "The latest report was returned. Update the hours or text and resubmit it for approval.",
              )}
            </Banner>
          ) : null}

          {canSubmitInterpreterReport ? (
            <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
              <Field label={t.appointments_time}>
                <Input
                  type="number"
                  min="0"
                  step="0.25"
                  value={form.hours}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      hours: event.target.value,
                    }))
                  }
                  className={cn(inputClass, "h-10 rounded-xl")}
                  required
                />
              </Field>
              <Field label={tr.patients_notes}>
                <textarea
                  value={form.reportText}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      reportText: event.target.value,
                    }))
                  }
                  className={textareaClass}
                  rows={5}
                  placeholder={withEllipsis(tr.patients_notes)}
                />
              </Field>
            </div>
          ) : null}

          {showReportReviewActions ? (
            <>
              <div className={cn("rounded-xl px-4 py-3", tokens.surface.mutedCard)}>
                <p className={tokens.text.label}>
                  {appointmentText("Bericht", "Отчёт", "Report")}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                  {detailReport?.report_text ||
                    appointmentText(
                      "Kein Freitext-Bericht eingereicht.",
                      "Свободный текст отчёта не отправлен.",
                      "No free-text report submitted.",
                    )}
                </p>
              </div>
              <Field label={tr.patients_notes}>
                <textarea
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  className={textareaClass}
                  rows={4}
                  placeholder={withEllipsis(tr.patients_notes)}
                />
              </Field>
            </>
          ) : null}
        </AppointmentEditorSheet>
      ) : null}
    </div>
  );
}

export const MemoizedAppointmentReportSection = memo(AppointmentReportSection);
