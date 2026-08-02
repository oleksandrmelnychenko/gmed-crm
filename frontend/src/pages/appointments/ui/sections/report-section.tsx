import {
  memo,
  useEffect,
  useMemo,
  useReducer,
  type FormEvent,
} from "react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Input } from "@/components/ui/input";
import {
  Banner,
  CountBadge,
  EmptyCell,
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
import { appointmentActionErrorMessage } from "@/pages/appointments/model/error-message";
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
import { parseValidInterpreterReportHours } from "@/pages/appointments/model/report-validation";
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
  formError: string;
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
    formError: "",
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
  const { form, rejectReason, busyAction, editorOpen, formError } = reportState;
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
      formError: "",
    });
  }, [detail.id, detailReport]);

  async function handleReportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hours = parseValidInterpreterReportHours(form.hours);
    if (hours === null) {
      dispatchReportState({ formError: t.appointments_report_hours_validation });
      return;
    }

    dispatchReportState({ busyAction: "report-submit" });
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/report`, {
        method: "POST",
        body: JSON.stringify({
          hours,
          report_text: form.reportText.trim() || null,
        }),
      });
      dispatchReportState({
        form: blankReportForm(),
        editorOpen: false,
        formError: "",
      });
      onRefresh();
    } catch (error) {
      onError(
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_submit_report"),
        ),
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
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_approve_report"),
        ),
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
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_reject_report"),
        ),
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

  const reportColumns = useMemo<ColumnDef<ReportSummary>[]>(
    () => [
      {
        id: "interpreter",
        label: appointmentText("appointments_interpreter"),
        accessor: (report) => report.interpreter_name,
        required: true,
        width: 220,
        render: (report) => (
          <span className="block truncate font-mono text-xs text-foreground">
            {report.interpreter_name || appointmentText("appointments_not_set")}
          </span>
        ),
      },
      {
        id: "hours",
        label: t.appointments_time,
        accessor: (report) => Number(report.hours) || 0,
        width: 110,
        render: (report) => (
          <span className="block text-right font-mono text-xs tabular-nums text-foreground">
            {appointmentText("appointments_report_hours_value", { hours: report.hours })}
          </span>
        ),
      },
      {
        id: "status",
        label: tr.users_status,
        accessor: (report) => reportApprovalLabel(report.approval_status),
        width: 170,
        render: (report) => (
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
              report.approval_status === "approved"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : report.approval_status === "rejected"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-amber-200 bg-amber-50 text-amber-700",
            )}
          >
            {reportApprovalLabel(report.approval_status)}
          </span>
        ),
      },
      {
        id: "submitted_at",
        label: t.appointments_report_submitted_prefix,
        accessor: (report) => report.created_at,
        width: 170,
        render: (report) => (
          <span className="font-mono text-xs tabular-nums text-foreground">
            {formatDateTimeLabel(report.created_at)}
          </span>
        ),
      },
      {
        id: "reviewer",
        label: tr.patients_notes,
        accessor: (report) =>
          report.approved_by_name ??
          (report.approval_status === "pending"
            ? t.common_pending
            : t.appointments_report_no_reviewer_recorded),
        width: 260,
        render: (report) => {
          const value =
            report.approved_by_name ??
            (report.approval_status === "pending"
              ? t.common_pending
              : t.appointments_report_no_reviewer_recorded);
          const meta =
            reportReviewMeta ||
            appointmentText("appointments_no_review_metadata_recorded_yet");
          return (
            <span className="block truncate text-xs text-foreground" title={`${value} · ${meta}`}>
              {value} · {meta}
            </span>
          );
        },
      },
    ],
    [reportReviewMeta, t, tr],
  );
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
        {detailReport ? (
          <>
            <DataTableSurface
              rows={[detailReport]}
              columns={reportColumns}
              rowId={() => detailReport.id ?? "report"}
              dictionary={tr}
              toolbarStart={
                <>
                  <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                    {t.appointments_interpreter_report_title}
                  </span>
                  <StatusBadge tone={reportStatusTone}>
                    {reportApprovalLabel(detailReport.approval_status)}
                  </StatusBadge>
                  {canOpenReportEditor ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 shrink-0 gap-1.5 rounded-lg"
                      onClick={() => dispatchReportState({ editorOpen: true })}
                    >
                      {reportOpenButtonLabel}
                    </Button>
                  ) : null}
                  <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
                </>
              }
            />

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
          <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
            <div className="relative z-30 flex flex-nowrap items-center gap-1.5 overflow-x-auto border-b border-border/70 bg-card px-3 py-2">
              <span className="flex shrink-0 items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                {t.appointments_interpreter_report_title}
              </span>
              <CountBadge>{appointmentText("appointments_not_submitted")}</CountBadge>
              {canOpenReportEditor ? (
                <>
                  <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 rounded-lg"
                    onClick={() => dispatchReportState({ editorOpen: true })}
                  >
                    {reportOpenButtonLabel}
                  </Button>
                </>
              ) : null}
            </div>
            <div className="px-4 py-6">
              <EmptyCell>
                {appointmentText("appointments_no_interpreter_report_has_been_submitted_for_this_appoin")}
              </EmptyCell>
            </div>
          </div>
        )}

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
          footerError={formError || undefined}
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
                  disabled={
                    busyAction === "report-submit" ||
                    parseValidInterpreterReportHours(form.hours) === null
                  }
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
                  min="0.25"
                  max="24"
                  step="0.25"
                  value={form.hours}
                  onChange={(event) =>
                    dispatchReportState((current) => ({
                      form: {
                        ...current.form,
                        hours: event.target.value,
                      },
                      formError: "",
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
