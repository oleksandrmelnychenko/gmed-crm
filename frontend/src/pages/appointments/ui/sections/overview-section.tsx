import { memo, useState } from "react";
import {
  ChevronDown,
  Clock3,
  MapPin,
  Pencil,
  Stethoscope,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  appointmentText,
  appointmentTypeLabel,
  carePathKindLabel,
  responseLabel,
  statusLabel,
} from "@/pages/appointments/model/labels";
import {
  currentRecurringLineageHistory,
  recurrenceCadenceLabel,
  recurrenceFrequencyLabel,
  recurrenceLineageBadge,
  recurrenceLineageText,
  recurringLineageRelationLabel,
  recurringLineageSplitLabel,
} from "@/pages/appointments/model/recurrence";
import { formatAppointmentSlotLabel } from "@/pages/appointments/model/runtime-formatters";
import { appointmentActionErrorMessage } from "@/pages/appointments/model/error-message";
import type { AppointmentDetail } from "@/pages/appointments/model/types";
import {
  appointmentStatusBadgeClassName,
  appointmentTypeBadgeClassName,
} from "@/pages/appointments/appearance/status-appearance";

function AppointmentOverviewSection({
  detail,
  canEdit = false,
  canDelete = false,
  onEdit,
  onDelete,
  onOpenDetail,
}: {
  detail: AppointmentDetail;
  canEdit?: boolean;
  canDelete?: boolean;
  onEdit?: () => void;
  onDelete?: () => Promise<void>;
  onOpenDetail: (id: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deletionLocked = detail.status === "in_progress" || detail.status === "completed";
  const deleteTitle = deletionLocked
    ? appointmentText("appointments_delete_locked")
    : appointmentText("appointments_delete_action");
  const detailLineageBadge = recurrenceLineageBadge(detail, t);
  const patientInitials = detail.patient_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <section className="space-y-2.5 rounded-xl border border-border/50 bg-card/40 p-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-[12px] font-semibold text-white">
          {patientInitials || "AP"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 max-w-full break-words text-xl font-semibold tracking-tight text-foreground">
              {detail.title}
            </h2>
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10.5px] font-semibold",
                appointmentStatusBadgeClassName(detail.status),
              )}
            >
              {statusLabel(detail.status)}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] font-mono text-muted-foreground">
            {detail.patient_pid} · {detail.patient_name}
          </p>
          <p className="text-[11px] font-mono text-muted-foreground/80">
            {detail.id}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:max-w-[40%] sm:justify-end">
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10.5px] font-semibold",
              appointmentTypeBadgeClassName(detail.type),
            )}
          >
            {appointmentTypeLabel(detail.type, tr)}
          </span>
          {detail.care_path_kind ? (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10.5px] font-semibold text-violet-700">
              {carePathKindLabel(detail.care_path_kind)}
            </span>
          ) : null}
          {canEdit && onEdit ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 rounded-lg"
              onClick={onEdit}
              aria-label={t.common_edit}
              title={t.common_edit}
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
          {canDelete && onDelete ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 rounded-lg text-rose-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
              disabled={deletionLocked || deleteBusy}
              onClick={() => setDeleteConfirmOpen(true)}
              aria-label={deleteTitle}
              title={deleteTitle}
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {detail.recurrence_frequency ? (
          <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[10.5px] font-semibold text-orange-700">
            {recurrenceFrequencyLabel(detail.recurrence_frequency)}{" "}
            {t.appointments_recurring_series}
          </span>
        ) : null}
        {detailLineageBadge ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10.5px] font-semibold text-amber-700">
            {detailLineageBadge}
          </span>
        ) : null}
        {detail.interpreter_response ? (
          <span className="rounded-full border border-border/60 bg-muted/25 px-2.5 py-1 text-[10.5px] font-semibold text-muted-foreground">
            {appointmentText("appointments_interpreter")}{" "}
            {responseLabel(detail.interpreter_response)}
          </span>
        ) : null}
      </div>
      <div className="mt-4 rounded-lg border border-border/70 bg-card px-2 py-1.5">
        <div className="grid gap-x-6 gap-y-1 lg:grid-cols-[1.6fr_1fr_1fr]">
          <OverviewInfoTile
            icon={Clock3}
            label={t.appointments_date}
            value={formatAppointmentSlotLabel(detail)}
            mono
          />
          <OverviewInfoTile
            icon={Stethoscope}
            label={t.common_provider}
            value={detail.provider_name || tr.common_not_set}
            muted={!detail.provider_name}
          />
          <OverviewInfoTile
            icon={MapPin}
            label={t.appointments_location}
            value={detail.location || tr.common_not_set}
            muted={!detail.location}
          />
        </div>
      </div>
      {detail.is_blocked ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          {t.appointments_overview_concierge_limited_warning}
        </div>
      ) : null}
      {!detail.is_blocked && detail.recurrence_frequency ? (
        <RecurringSeriesDetails detail={detail} onOpenDetail={onOpenDetail} />
      ) : null}
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
    <details className="group mt-4 overflow-hidden rounded-lg border border-border/70 bg-card">
      <summary className="grid cursor-pointer list-none gap-2 px-3 py-2.5 transition hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-700 ring-1 ring-orange-200 transition-colors">
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
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
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
                  {item.date}
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
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {t.appointments_lineage_history}
              </span>
            </div>
            {detail.recurring_lineage_history.map((item) => (
              <div
                key={item.series_id}
                className={cn(
                  "flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2 last:border-b-0",
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

function OverviewInfoTile({
  icon: Icon,
  label,
  value,
  mono = false,
  muted = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1" title={value}>
      <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
        {label}
      </span>
      <span className="h-px min-w-5 flex-1 self-center bg-border/70" />
      <span
        className={cn(
          "min-w-0 max-w-[70%] truncate whitespace-nowrap text-right text-sm font-semibold leading-snug",
          mono && "font-mono text-xs tabular-nums",
          muted ? "font-normal text-muted-foreground" : "text-foreground",
        )}
      >
        {value}
      </span>
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
