import {
  memo,
  useEffect,
  useReducer,
  type FormEvent,
} from "react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Section,
  StatCard,
  StatusBadge,
  tokens,
} from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  appointmentFilterControlClassName,
  appointmentPreviewInfoCardClassName,
  appointmentTextareaControlClassName,
} from "@/pages/appointments/appearance/surface-appearance";
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

type AppointmentReportActions = {
  canSubmitInterpreterReport: boolean;
  canResubmitRejectedReport: boolean;
  showReportReviewActions: boolean;
  canApproveReport: boolean;
  canRejectReport: boolean;
};

type AppointmentReportSectionProps = {
  detail: AppointmentDetail;
  detailReport: ReportSummary | null;
  reportReviewMeta: string;
  reportActions: AppointmentReportActions;
  onRefresh: () => void;
  onError: (message: string) => void;
};

type ReportSectionState = {
  form: ReportFormState;
  rejectReason: string;
  busyAction: string;
  editorOpen: boolean;
};

type ReportSectionPatch =
  | Partial<ReportSectionState>
  | ((current: ReportSectionState) => Partial<ReportSectionState>);

function createReportSectionState(): ReportSectionState {
  return {
    form: blankReportForm(),
    rejectReason: "",
    busyAction: "",
    editorOpen: false,
  };
}

function reportSectionReducer(
  state: ReportSectionState,
  patch: ReportSectionPatch,
): ReportSectionState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function useAppointmentReportSectionContent({
  detail,
  detailReport,
  reportReviewMeta,
  reportActions,
  onRefresh,
  onError,
}: AppointmentReportSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [reportState, dispatchReportState] = useReducer(
    reportSectionReducer,
    undefined,
    createReportSectionState,
  );
  const { form, rejectReason, busyAction, editorOpen } = reportState;
  const {
    canSubmitInterpreterReport,
    canResubmitRejectedReport,
    showReportReviewActions,
    canApproveReport,
    canRejectReport,
  } = reportActions;

  useEffect(() => {
    dispatchReportState({
      form:
        detailReport && detailReport.approval_status === "rejected"
          ? {
              hours: detailReport.hours,
              reportText: detailReport.report_text ?? "",
            }
          : blankReportForm(),
      rejectReason: "",
      busyAction: "",
      editorOpen: false,
    });
  }, [detail.id, detailReport]);

  async function handleReportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatchReportState({ busyAction: "report-submit" });
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/report`, {
        method: "POST",
        body: JSON.stringify({
          hours: Number(form.hours),
          report_text: form.reportText.trim() || null,
        }),
      });
      dispatchReportState({
        form: blankReportForm(),
        editorOpen: false,
      });
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText("appointments_failed_to_submit_report"),
      );
    } finally {
      dispatchReportState({ busyAction: "" });
    }
  }

  async function handleApproveReport() {
    dispatchReportState({ busyAction: "report-approve" });
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/report/approve`, {
        method: "POST",
      });
      dispatchReportState({ editorOpen: false });
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText("appointments_failed_to_approve_report"),
      );
    } finally {
      dispatchReportState({ busyAction: "" });
    }
  }

  async function handleRejectReport() {
    dispatchReportState({ busyAction: "report-reject" });
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/report/reject`, {
        method: "POST",
        body: JSON.stringify({ notes: rejectReason.trim() || null }),
      });
      dispatchReportState({
        rejectReason: "",
        editorOpen: false,
      });
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText("appointments_failed_to_reject_report"),
      );
    } finally {
      dispatchReportState({ busyAction: "" });
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
    ? appointmentText("appointments_review_decision")
    : canResubmitRejectedReport
      ? appointmentText("appointments_revise_report")
      : appointmentText("appointments_submit_report");
  const reportOpenButtonLabel = showReportReviewActions
    ? appointmentText("appointments_open_review")
    : appointmentText("appointments_open_report");

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
                {appointmentText("appointments_not_submitted")}
              </CountBadge>
            )}
            {canOpenReportEditor ? (
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 rounded-lg"
                onClick={() => dispatchReportState({ editorOpen: true })}
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
                label={appointmentText("appointments_interpreter")}
                value={
                  detailReport.interpreter_name ??
                  appointmentText("appointments_not_set")
                }
                description={`${t.appointments_report_submitted_prefix} ${formatDateTimeLabel(detailReport.created_at)}`}
              />
              <StatCard
                label={t.appointments_time}
                value={appointmentText("appointments_report_hours_value", {
                  hours: detailReport.hours,
                })}
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
                  appointmentText("appointments_no_review_metadata_recorded_yet")
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
                      {appointmentText("appointments_catalog_key")}
                      : {detailReport.billing_service_key}
                    </span>
                  ) : null}
                  {detailReport.billing_leistung_id ? (
                    <span>
                      {appointmentText("appointments_order_line")}
                      : {detailReport.billing_leistung_id}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className={cn("py-4", appointmentPreviewInfoCardClassName)}>
              <p className={tokens.text.label}>
                {appointmentText("appointments_report_text")}
              </p>
              {detailReport.report_text ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {detailReport.report_text}
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {appointmentText("appointments_no_free_text_report_submitted")}
                </p>
              )}
            </div>
          </>
        ) : (
          <EmptyCell>
            {appointmentText("appointments_no_interpreter_report_has_been_submitted_for_this_appoin")}
          </EmptyCell>
        )}
      </Section>

      {canOpenReportEditor ? (
        <AppointmentEditorSheet
          open={editorOpen}
          onOpenChange={(open) => dispatchReportState({ editorOpen: open })}
          title={reportEditorTitle}
          description={
            showReportReviewActions
              ? appointmentText("appointments_review_the_hours_and_report_directly_in_the_context_of_t")
              : appointmentText("appointments_manage_hours_and_free_text_report_directly_in_this_appoi")
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
                onClick={() => dispatchReportState({ editorOpen: false })}
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
                  {appointmentText("appointments_return_for_revision")}
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
                  {appointmentText("appointments_approve_hours_and_report")}
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
                    ? appointmentText("appointments_resubmit_report")
                    : t.common_save}
                </Button>
              ) : null}
            </>
          }
        >
          {canResubmitRejectedReport ? (
            <Banner tone="warning" withIcon>
              {appointmentText("appointments_the_latest_report_was_returned_update_the_hours_or_text")}
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
                    dispatchReportState((current) => ({
                      form: {
                        ...current.form,
                        hours: event.target.value,
                      },
                    }))
                  }
                  className={appointmentFilterControlClassName}
                  required
                />
              </Field>
              <Field label={tr.patients_notes}>
                <textarea
                  value={form.reportText}
                  onChange={(event) =>
                    dispatchReportState((current) => ({
                      form: {
                        ...current.form,
                        reportText: event.target.value,
                      },
                    }))
                  }
                  className={appointmentTextareaControlClassName}
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
                  {appointmentText("appointments_report")}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                  {detailReport?.report_text ||
                    appointmentText("appointments_no_free_text_report_submitted")}
                </p>
              </div>
              <Field label={tr.patients_notes}>
                <textarea
                  value={rejectReason}
                  onChange={(event) =>
                    dispatchReportState({ rejectReason: event.target.value })
                  }
                  className={appointmentTextareaControlClassName}
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

function AppointmentReportSection(...args: Parameters<typeof useAppointmentReportSectionContent>) {
  return useAppointmentReportSectionContent(...args);
}

export const MemoizedAppointmentReportSection = memo(AppointmentReportSection);
