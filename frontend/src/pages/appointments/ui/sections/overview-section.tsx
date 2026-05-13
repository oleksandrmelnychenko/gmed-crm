import { memo } from "react";
import {
  Clock3,
  MapPin,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

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
import type { AppointmentDetail } from "@/pages/appointments/model/types";
import {
  appointmentStatusBadgeClassName,
  appointmentTypeBadgeClassName,
} from "@/pages/appointments/appearance/status-appearance";

function AppointmentOverviewSection({
  detail,
  onOpenDetail,
}: {
  detail: AppointmentDetail;
  onOpenDetail: (id: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const detailLineageText = recurrenceLineageText(detail, t);
  const detailLineageBadge = recurrenceLineageBadge(detail, t);
  const detailCurrentLineageHistory = currentRecurringLineageHistory(detail);
  const detailRelatedLineageCount = Math.max(
    0,
    detail.recurring_lineage_history.length - 1,
  );
  const patientInitials = detail.patient_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-[12px] font-semibold text-white">
          {patientInitials || "AP"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
              {detail.title}
            </h2>
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em]",
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
        <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-[40%] sm:justify-end">
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em]",
              appointmentTypeBadgeClassName(detail.type),
            )}
          >
            {appointmentTypeLabel(detail.type, tr)}
          </span>
          {detail.care_path_kind ? (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-violet-700">
              {carePathKindLabel(detail.care_path_kind)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {detail.recurrence_frequency ? (
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-sky-700">
            {recurrenceFrequencyLabel(detail.recurrence_frequency)}{" "}
            {t.appointments_recurring_series}
          </span>
        ) : null}
        {detailLineageBadge ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-amber-700">
            {detailLineageBadge}
          </span>
        ) : null}
        {detail.interpreter_response ? (
          <span className="rounded-full border border-border/60 bg-muted/25 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {(tr.role_interpreter ??
              appointmentText("appointments_interpreter"))}{" "}
            {responseLabel(detail.interpreter_response)}
          </span>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
          <OverviewInfoLine icon={Clock3} label={formatAppointmentSlotLabel(detail)} />
        </div>
        <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
          <OverviewInfoLine
            icon={MapPin}
            label={detail.location || tr.common_not_set}
          />
        </div>
        <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
          <OverviewInfoLine
            icon={Stethoscope}
            label={detail.provider_name || tr.common_not_set}
          />
        </div>
      </div>
      {detail.is_blocked ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {t.appointments_overview_concierge_limited_warning}
        </div>
      ) : null}
      {!detail.is_blocked && detail.recurrence_frequency ? (
        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {t.appointments_recurring_series}:{" "}
          {t.appointments_occurrence.toLowerCase()} {detail.recurrence_index + 1}/
          {detail.recurrence_series_size}. {recurrenceCadenceLabel(detail)}
          {detail.recurrence_until
            ? ` ${t.appointments_until} ${detail.recurrence_until}.`
            : detail.recurrence_count
              ? ` ${t.appointments_total_planned_occurrences}: ${detail.recurrence_count}.`
              : "."}{" "}
          {t.appointments_scope_bulk_status_hint}{" "}
          {t.appointments_scope_following_hint}
          {detailLineageText ? (
            <span className="mt-2 block rounded-xl border border-sky-300/70 bg-white/70 px-3 py-2 text-xs font-medium text-sky-900">
              {detailLineageText}
            </span>
          ) : null}
          {detailCurrentLineageHistory ? (
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <div className="rounded-xl border border-sky-300/70 bg-white/70 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                  {t.appointments_lineage_current_branch}
                </p>
                <p className="mt-1 text-lg font-semibold text-sky-950">
                  {detailCurrentLineageHistory.total_occurrences}
                </p>
                <p className="text-[11px] text-sky-800">
                  {t.appointments_lineage_total_occurrences}
                </p>
              </div>
              <div className="rounded-xl border border-sky-300/70 bg-white/70 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                  {t.common_active}
                </p>
                <p className="mt-1 text-lg font-semibold text-sky-950">
                  {detailCurrentLineageHistory.active_occurrences}
                </p>
                <p className="text-[11px] text-sky-800">
                  {t.appointments_lineage_still_operational}
                </p>
              </div>
              <div className="rounded-xl border border-sky-300/70 bg-white/70 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                  {t.dash_completed}
                </p>
                <p className="mt-1 text-lg font-semibold text-sky-950">
                  {detailCurrentLineageHistory.completed_occurrences}
                </p>
                <p className="text-[11px] text-sky-800">
                  {t.appointments_lineage_completed_occurrences}
                </p>
              </div>
              <div className="rounded-xl border border-sky-300/70 bg-white/70 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                  {t.appointments_lineage_related_branches}
                </p>
                <p className="mt-1 text-lg font-semibold text-sky-950">
                  {detailRelatedLineageCount}
                </p>
                <p className="text-[11px] text-sky-800">
                  {t.appointments_lineage_related_branches_meta}
                </p>
              </div>
            </div>
          ) : null}
          {detail.recurring_scope_preview.length > 0 ? (
            <div className="mt-3 rounded-xl border border-sky-300/70 bg-white/70 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-900">
                {t.appointments_active_series_path}
              </p>
              <div className="mt-2 space-y-1.5">
                {detail.recurring_scope_preview.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
                      item.id === detail.id
                        ? "bg-sky-100 text-sky-950"
                        : "bg-sky-50 text-sky-900",
                    )}
                  >
                    <span className="font-semibold">
                      #{item.recurrence_index + 1}
                    </span>
                    <span>{item.date}</span>
                    {item.id === detail.id ? (
                      <span className="rounded-full border border-sky-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                        {t.appointments_current_occurrence}
                      </span>
                    ) : null}
                    {item.open_checklist_count > 0 ? (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                        {item.open_checklist_count}{" "}
                        {item.open_checklist_count === 1
                          ? t.appointments_open_checklist
                          : t.appointments_open_checklists}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {detail.recurring_lineage_history.length > 0 ? (
            <div className="mt-3 rounded-xl border border-sky-300/70 bg-white/70 p-3">
              <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-900">
                    {t.appointments_lineage_history}
                  </p>
                  <p className="text-xs text-sky-800">
                    {t.appointments_lineage_history_hint}
                  </p>
                </div>
                <span className="text-[11px] font-medium text-sky-800">
                  {detail.recurring_lineage_history.length}{" "}
                  {t.appointments_lineage_related_series}
                </span>
              </div>
              <div className="mt-3 grid gap-2">
                {detail.recurring_lineage_history.map((item) => (
                  <div
                    key={item.series_id}
                    className={cn(
                      "rounded-xl border px-3 py-2",
                      item.relation === "current"
                        ? "border-sky-400 bg-sky-100/80 text-sky-950"
                        : "border-sky-200 bg-sky-50 text-sky-900",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-sky-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                        {recurringLineageRelationLabel(item, t)}
                      </span>
                      <span className="text-xs font-medium">
                        {recurringLineageSplitLabel(item, t)}
                      </span>
                      <span className="text-xs text-sky-700">
                        {item.first_date} {t.uiText.common_to_separator} {item.last_date}
                      </span>
                      {item.series_id !== detail.id ? (
                        <button
                          type="button"
                          className="rounded-full border border-sky-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-900 transition hover:bg-sky-100"
                          onClick={() => onOpenDetail(item.series_id)}
                        >
                          {t.appointments_open_branch_root}
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-sky-900">
                      <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5">
                        {item.total_occurrences}{" "}
                        {t.appointments_lineage_total_short}
                      </span>
                      <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5">
                        {item.active_occurrences}{" "}
                        {t.appointments_lineage_active_short}
                      </span>
                      <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5">
                        {item.completed_occurrences}{" "}
                        {t.appointments_lineage_completed_short}
                      </span>
                      <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5">
                        {item.cancelled_occurrences}{" "}
                        {t.appointments_lineage_cancelled_short}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function OverviewInfoLine({
  icon: Icon,
  label,
}: {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-2 text-foreground">
      <Icon className="size-4 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </div>
  );
}

export const MemoizedAppointmentOverviewSection = memo(
  AppointmentOverviewSection,
);
