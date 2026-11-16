import { memo, useState, type ReactNode } from "react";
import {
  CalendarX2,
  ChevronDown,
  ClipboardList,
  Clock3,
  LoaderCircle,
  MapPin,
  Pencil,
  Stethoscope,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Banner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { OverflowMenu, type OverflowMenuItem } from "@/components/ui/overflow-menu";
import { StatusChip } from "@/components/ui/status-chip";
import { toast } from "@/components/ui/toast";
import { formatAppDate } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { hasCapability } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { updateAppointmentStatus } from "@/pages/appointments/data/appointment-mutations";
import {
  billingReversalRequestFromError,
  requestAppointmentBillingReversal,
} from "@/pages/appointments/model/billing-reversal-request";
import {
  isClosedAppointmentStatus,
  visibleInterpreterResponse,
} from "@/pages/appointments/model/completion-rules";
import {
  useAppointmentLabels,
} from "@/pages/appointments/model/labels";
import {
  currentRecurringLineageHistory,
  recurrenceLineageBadge,
  recurrenceLineageText,
  recurringLineageRelationLabel,
  recurringLineageSplitLabel,
  useRecurrenceLabels,
} from "@/pages/appointments/model/recurrence";
import { useAppointmentFormatters } from "@/pages/appointments/model/runtime-formatters";
import { useAppointmentErrorMessages } from "@/pages/appointments/model/error-message";
import type { AppointmentDetail } from "@/pages/appointments/model/types";
import {
  appointmentStatusBadgeClassName,
  appointmentTypeBadgeClassName,
} from "@/pages/appointments/appearance/status-appearance";

function AppointmentOverviewSection({
  detail,
  canEdit = false,
  canDelete = false,
  canCancel = false,
  onEdit,
  onDelete,
  onCancelled,
  onOpenDetail,
}: {
  detail: AppointmentDetail;
  canEdit?: boolean;
  canDelete?: boolean;
  /** The caller may change the status (`appointments.status`). */
  canCancel?: boolean;
  onEdit?: () => void;
  onDelete?: () => Promise<void>;
  /** After this appointment was cancelled (it stays, as "cancelled"). */
  onCancelled?: () => void;
  onOpenDetail: (id: string) => void;
}) {
  const {
    appointmentText,
    appointmentTypeLabel,
    carePathKindLabel,
    recurrenceFrequencyLabel,
    responseLabel,
    statusLabel,
  } = useAppointmentLabels();
  const { formatAppointmentDateLabel } = useAppointmentFormatters();
  const { appointmentActionErrorMessage } = useAppointmentErrorMessages();
  const { t } = useLang();
  const { user } = useAuth();
  const canSeeOrder = hasCapability(user, "orders.view");
  const canSeePatients = hasCapability(user, "patients.view");
  const tr = t as unknown as Record<string, string>;
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  // Cancelling keeps the appointment as "cancelled" (the patient still sees
  // it as such); deleting removes it. This one visit only: a whole series is
  // cancelled from the status block under "Workflow".
  const cancelLabel = detail.recurrence_frequency
    ? appointmentText("appointments_cancel_this_occurrence")
    : appointmentText("appointments_cancel_confirmation_action");
  async function handleCancelAppointment() {
    setCancelBusy(true);
    try {
      await updateAppointmentStatus(detail.id, "cancelled", "single");
      setCancelConfirmOpen(false);
      toast.success(appointmentText("appointments_cancelled_notice"));
      onCancelled?.();
    } catch (error) {
      setCancelConfirmOpen(false);
      // A visit with a billed interpreter report: offer the cancellation with
      // billing reversal instead of an error (decision 2026-09-29).
      const reversal = billingReversalRequestFromError(error, detail.id, "single", () =>
        onCancelled?.(),
      );
      if (reversal) {
        requestAppointmentBillingReversal(reversal);
        return;
      }
      toast.error(
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_change_status"),
        ),
      );
    } finally {
      setCancelBusy(false);
    }
  }
  const deletionLocked = detail.status === "in_progress" || detail.status === "completed";
  const deleteTitle = deletionLocked
    ? appointmentText("appointments_delete_locked")
    : appointmentText("appointments_delete_action");
  const detailLineageBadge = recurrenceLineageBadge(detail, t);
  const interpreterResponse = visibleInterpreterResponse(
    detail.status,
    detail.interpreter_response,
  );
  const canEditNow = Boolean(canEdit && onEdit && !isClosedAppointmentStatus(detail.status));
  const canCancelNow = canCancel && !detail.is_blocked && !isClosedAppointmentStatus(detail.status);
  const menuItems: OverflowMenuItem[] = [];
  if (canCancelNow) {
    menuItems.push({
      key: "cancel",
      testId: "appointment-cancel-action",
      icon: cancelBusy ? <LoaderCircle className="animate-spin" /> : <CalendarX2 />,
      label: cancelLabel,
      disabled: cancelBusy,
      onSelect: () => setCancelConfirmOpen(true),
    });
  }
  if (canDelete && onDelete) {
    menuItems.push({
      key: "delete",
      icon: <Trash2 className="!text-destructive" />,
      label: appointmentText("appointments_delete_action"),
      note: deletionLocked ? deleteTitle : undefined,
      title: deleteTitle,
      disabled: deletionLocked || deleteBusy,
      className: "text-destructive",
      onSelect: () => setDeleteConfirmOpen(true),
    });
  }
  // A place equal to the clinic's name says nothing new.
  const location = detail.location?.trim() ?? "";
  const showLocation =
    !location ||
    location.toLocaleLowerCase() !== (detail.provider_name ?? "").trim().toLocaleLowerCase();
  const canOpenPatientCard = detail.can_open_patient !== false && canSeePatients;
  const patientText = [detail.patient_pid, detail.patient_name].filter(Boolean).join(" · ");
  const chipClassName = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-5";

  return (
    <section className="rounded-xl border border-border/70 bg-card" data-testid="appointment-overview">
      <div className="space-y-3 px-3.5 py-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-64">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
              <h2 className="min-w-0 max-w-full break-words text-lg font-semibold leading-tight tracking-tight text-foreground">
                {detail.title}
              </h2>
              <span className={cn(chipClassName, appointmentStatusBadgeClassName(detail.status))}>
                {statusLabel(detail.status)}
              </span>
              <span className={cn(chipClassName, appointmentTypeBadgeClassName(detail.type))}>
                {appointmentTypeLabel(detail.type, tr)}
              </span>
              {detail.care_path_kind ? (
                <StatusChip>{carePathKindLabel(detail.care_path_kind)}</StatusChip>
              ) : null}
              {detail.recurrence_frequency ? (
                <StatusChip tone="info">
                  {recurrenceFrequencyLabel(detail.recurrence_frequency)}{" "}
                  {t.appointments_recurring_series}
                </StatusChip>
              ) : null}
              {detailLineageBadge ? (
                <StatusChip tone="warning">{detailLineageBadge}</StatusChip>
              ) : null}
              {interpreterResponse ? (
                <StatusChip>
                  {appointmentText("appointments_interpreter")}{" "}
                  {responseLabel(interpreterResponse)}
                </StatusChip>
              ) : null}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                <UserRound aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                {canOpenPatientCard ? (
                  <StaffLink
                    to={`/patients/${detail.patient_id}`}
                    className="min-w-0 break-words font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    {patientText}
                  </StaffLink>
                ) : (
                  <span className="min-w-0 break-words font-medium text-foreground">{patientText}</span>
                )}
              </span>
              {/* The order number instead of the appointment's technical id. */}
              {detail.order_number && canSeeOrder ? (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <ClipboardList aria-hidden="true" className="size-3.5 shrink-0" />
                  {appointmentText("appointments_order")}
                  {detail.order_id ? (
                    <StaffLink
                      to={`/orders/${detail.order_id}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {detail.order_number}
                    </StaffLink>
                  ) : (
                    <span className="font-medium text-foreground">{detail.order_number}</span>
                  )}
                </span>
              ) : null}
            </div>
          </div>
          {canEditNow || menuItems.length > 0 ? (
            <div className="flex shrink-0 items-center gap-2">
              {/* A completed or cancelled appointment cannot be changed (the server refuses it). */}
              {canEditNow ? (
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg" onClick={onEdit}>
                  <Pencil className="size-3.5" />
                  {t.common_edit}
                </Button>
              ) : null}
              {menuItems.length > 0 ? (
                <OverflowMenu label={t.common_actions} items={menuItems} />
              ) : null}
            </div>
          ) : null}
        </div>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-x-6 gap-y-3 border-t border-border/60 pt-3">
          <OverviewFact icon={Clock3} label={t.appointments_date}>
            <span className="block text-[15px] font-semibold leading-snug tabular-nums text-foreground">
              {formatAppointmentDateLabel(detail.date)}
            </span>
            {detail.time_start ? (
              <span className="block text-sm tabular-nums text-foreground">
                {detail.time_start}
                {detail.time_end ? ` - ${detail.time_end}` : ""}
              </span>
            ) : null}
          </OverviewFact>
          <OverviewFact icon={Stethoscope} label={t.common_provider}>
            <span className={cn("text-sm", detail.provider_name ? "font-medium text-foreground" : "text-muted-foreground")}>
              {detail.provider_name || tr.common_not_set}
            </span>
          </OverviewFact>
          {showLocation ? (
            <OverviewFact icon={MapPin} label={t.appointments_location}>
              <span className={cn("text-sm", location ? "font-medium text-foreground" : "text-muted-foreground")}>
                {location || tr.common_not_set}
              </span>
            </OverviewFact>
          ) : null}
        </dl>
        {detail.is_blocked ? (
          <Banner tone="warning">{t.appointments_overview_concierge_limited_warning}</Banner>
        ) : null}
        {!detail.is_blocked && detail.recurrence_frequency ? (
          <RecurringSeriesDetails detail={detail} onOpenDetail={onOpenDetail} />
        ) : null}
      </div>
      <DirtyDismissConfirmDialog
        open={cancelConfirmOpen}
        title={appointmentText("appointments_cancel_confirmation_title")}
        message={appointmentText(
          detail.recurrence_frequency
            ? "appointments_cancel_occurrence_confirmation_message"
            : "appointments_cancel_single_confirmation_message",
          { title: detail.title },
        )}
        cancelLabel={appointmentText("appointments_cancel_confirmation_keep")}
        confirmLabel={appointmentText("appointments_cancel_confirmation_action")}
        destructive
        confirmDisabled={cancelBusy}
        onCancel={() => {
          if (!cancelBusy) setCancelConfirmOpen(false);
        }}
        onConfirm={() => {
          if (!cancelBusy) void handleCancelAppointment();
        }}
      />
      <DirtyDismissConfirmDialog
        open={deleteConfirmOpen}
        title={appointmentText("appointments_delete_title")}
        message={
          detail.recurrence_frequency
            ? appointmentText("appointments_delete_recurring_warning")
            : appointmentText("appointments_delete_warning")
        }
        cancelLabel={t.common_cancel}
        confirmDisabled={deleteBusy}
        destructive
        confirmLabel={
          deleteBusy
            ? appointmentText("appointments_deleting")
            : appointmentText("appointments_delete_action")
        }
        onCancel={() => {
          if (!deleteBusy) setDeleteConfirmOpen(false);
        }}
        onConfirm={() => {
          if (deleteBusy || !onDelete) return;
          setDeleteBusy(true);
          void onDelete()
            .then(() => setDeleteConfirmOpen(false))
            .catch((error: unknown) => {
              toast.error(
                appointmentActionErrorMessage(
                  error,
                  appointmentText("appointments_failed_to_delete"),
                ),
              );
            })
            .finally(() => setDeleteBusy(false));
        }}
      />
    </section>
  );
}

function RecurringSeriesDetails({
  detail,
  onOpenDetail,
}: {
  detail: AppointmentDetail;
  onOpenDetail: (id: string) => void;
}) {
  const { recurrenceCadenceLabel } = useRecurrenceLabels();
  const { recurrenceFrequencyLabel } = useAppointmentLabels();
  const { t } = useLang();
  const recurrenceFrequency = detail.recurrence_frequency;
  const detailLineageText = recurrenceLineageText(detail, t);
  const detailCurrentLineageHistory = currentRecurringLineageHistory(detail);
  const detailRelatedLineageCount = Math.max(
    0,
    detail.recurring_lineage_history.length - 1,
  );
  if (!recurrenceFrequency) return null;

  return (
    <details className="group overflow-hidden rounded-lg border border-border/70 bg-card">
      <summary className="grid cursor-pointer list-none gap-2 px-3 py-2.5 transition hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex size-6 shrink-0 items-center justify-center text-foreground">
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
              </span>
              <p className="min-w-0 max-w-full break-words text-[13px] font-semibold tracking-tight text-foreground">
                {t.appointments_recurring_series}
              </p>
              <span className="rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
                {detail.recurrence_index + 1}/{detail.recurrence_series_size}
              </span>
              <span className="rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                {recurrenceCadenceLabel(detail)}
              </span>
            </div>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-8 text-xs text-muted-foreground">
              <span>
                {t.appointments_occurrence}:{" "}
                <span className="font-medium text-foreground">
                  #{detail.recurrence_index + 1}
                </span>
              </span>
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-[10px] font-medium text-sky-700">
                {recurrenceFrequencyLabel(recurrenceFrequency)}
              </span>
              {detail.recurrence_until ||
              detail.recurrence_count ||
              detail.recurrence_series_size ? (
                <>
                  <span className="size-1 rounded-full bg-muted-foreground/35" />
                  <span>
                    {detail.recurrence_end_mode === "until"
                      ? `${t.appointments_until} ${detail.recurrence_until}`
                      : `${t.appointments_total_planned_occurrences}: ${
                          detail.recurrence_series_size ||
                          detail.recurrence_count
                        }`}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap justify-start gap-1.5 lg:max-w-[560px] lg:justify-end lg:pr-1">
            {detailCurrentLineageHistory ? (
              <>
                <SeriesSummaryBadge
                  label={t.appointments_lineage_total_short}
                  value={detailCurrentLineageHistory.total_occurrences}
                  tone="sky"
                />
                <SeriesSummaryBadge
                  label={t.appointments_lineage_active_short}
                  value={detailCurrentLineageHistory.active_occurrences}
                  tone="emerald"
                />
                <SeriesSummaryBadge
                  label={t.appointments_lineage_completed_short}
                  value={detailCurrentLineageHistory.completed_occurrences}
                  tone="violet"
                />
                <SeriesSummaryBadge
                  label={t.appointments_lineage_cancelled_short}
                  value={detailCurrentLineageHistory.cancelled_occurrences}
                  tone="rose"
                />
              </>
            ) : null}
            <SeriesSummaryBadge
              label={t.appointments_lineage_related_series}
              value={detailRelatedLineageCount}
            />
          </div>
        </div>
      </summary>

      <div className="space-y-2 border-t border-border/60 bg-muted/10 p-3">
        {detailLineageText ? (
          <div className="rounded-lg border border-border/60 bg-card px-3 py-2 text-xs leading-snug text-muted-foreground">
            {detailLineageText}
          </div>
        ) : null}

        {detail.recurring_scope_preview.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
            <div className="flex items-center gap-2 border-b border-border/60 bg-muted/25 px-3 py-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground">
                {t.appointments_active_series_path}
              </span>
            </div>
            {detail.recurring_scope_preview.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2 last:border-b-0",
                  item.id === detail.id && "bg-orange-50/40",
                )}
              >
                <span className="w-[40px] shrink-0 font-mono text-xs font-semibold text-foreground">
                  #{item.recurrence_index + 1}
                </span>
                <span className="w-[110px] shrink-0 font-mono text-xs tabular-nums text-foreground">
                  {formatAppDate(item.date) || item.date}
                </span>
                {item.id === detail.id ? (
                  <span className="shrink-0 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 font-mono text-[10px] font-medium text-orange-700">
                    {t.appointments_current_occurrence}
                  </span>
                ) : null}
                {item.open_checklist_count > 0 ? (
                  <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-800">
                    {item.open_checklist_count}{" "}
                    {item.open_checklist_count === 1
                      ? t.appointments_open_checklist
                      : t.appointments_open_checklists}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {detail.recurring_lineage_history.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
            <div className="flex items-center gap-2 border-b border-border/60 bg-muted/25 px-3 py-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground">
                {t.appointments_lineage_history}
              </span>
            </div>
            {detail.recurring_lineage_history.map((item) => (
              <div
                key={item.series_id}
                className={cn(
                  "flex w-full flex-wrap items-center gap-2.5 border-b border-border/50 px-3 py-2 last:border-b-0 sm:flex-nowrap",
                  item.relation === "current" && "bg-orange-50/40",
                )}
              >
                <span className="w-[130px] shrink-0 rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 text-center font-mono text-[10px] font-medium text-muted-foreground">
                  {recurringLineageRelationLabel(item, t)}
                </span>
                <span className="min-w-0 shrink-0 truncate text-xs font-medium text-foreground">
                  {recurringLineageSplitLabel(item, t)}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {item.first_date} {t.uiText.common_to_separator} {item.last_date}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {item.total_occurrences} {t.appointments_lineage_total_short} ·{" "}
                  {item.active_occurrences} {t.appointments_lineage_active_short}
                </span>
                {item.series_id !== detail.id ? (
                  <button
                    type="button"
                    className="ml-auto shrink-0 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 font-mono text-[10px] font-medium text-orange-700 transition hover:bg-orange-100"
                    onClick={() => onOpenDetail(item.series_id)}
                  >
                    {t.appointments_open_branch_root}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function OverviewFact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {label}
      </dt>
      <dd className="mt-0.5 min-w-0 break-words leading-snug">{children}</dd>
    </div>
  );
}

const SERIES_BADGE_TONES = {
  neutral: "border-border/60 bg-muted/25 text-muted-foreground",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
} as const;

function SeriesSummaryBadge({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: keyof typeof SERIES_BADGE_TONES;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
        SERIES_BADGE_TONES[tone],
      )}
    >
      {label}: <span className="ml-1 font-semibold">{value}</span>
    </span>
  );
}

export const MemoizedAppointmentOverviewSection = memo(
  AppointmentOverviewSection,
);
