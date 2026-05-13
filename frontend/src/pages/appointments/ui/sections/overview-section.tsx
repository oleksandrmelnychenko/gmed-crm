import { memo } from "react";
import {
  ChevronDown,
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
        <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-[40%] sm:justify-end">
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
        <details className="group relative mt-4 pl-9">
          <summary className="relative grid cursor-pointer list-none gap-2 rounded-lg p-3 pr-4 transition hover:bg-muted/25 group-open:bg-muted/25 group-open:ring-1 group-open:ring-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <div className="absolute -left-9 bottom-0 top-0 flex w-8 items-start justify-center pt-3">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-700 ring-1 ring-orange-200 transition-colors">
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
              </span>
            </div>

            <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="max-w-full truncate text-[15px] font-semibold leading-5 text-foreground">
                    {t.appointments_recurring_series}
                  </p>
                  <span className="size-1 rounded-full bg-muted-foreground/35" />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {detail.recurrence_index + 1}/{detail.recurrence_series_size}
                  </span>
                  <span className="size-1 rounded-full bg-muted-foreground/35" />
                  <span className="text-xs text-muted-foreground">
                    {recurrenceCadenceLabel(detail)}
                  </span>
                </div>
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {t.appointments_occurrence}:{" "}
                    <span className="font-medium text-foreground">
                      #{detail.recurrence_index + 1}
                    </span>
                  </span>
                  <span className="size-1 rounded-full bg-muted-foreground/35" />
                  <span>
                    {recurrenceFrequencyLabel(detail.recurrence_frequency)}
                  </span>
                  {detail.recurrence_until || detail.recurrence_count ? (
                    <>
                      <span className="size-1 rounded-full bg-muted-foreground/35" />
                      <span>
                        {detail.recurrence_until
                          ? `${t.appointments_until} ${detail.recurrence_until}`
                          : `${t.appointments_total_planned_occurrences}: ${detail.recurrence_count}`}
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
                    />
                    <SeriesSummaryBadge
                      label={t.appointments_lineage_active_short}
                      value={detailCurrentLineageHistory.active_occurrences}
                    />
                    <SeriesSummaryBadge
                      label={t.appointments_lineage_completed_short}
                      value={detailCurrentLineageHistory.completed_occurrences}
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

          <div aria-hidden="true" className="ml-20 flex h-3 items-center px-3">
            <span className="h-px w-12 bg-gradient-to-r from-transparent via-border/70 to-border/70" />
            <span className="size-1.5 rounded-full bg-border" />
            <span className="h-px flex-1 bg-gradient-to-r from-border/70 to-transparent" />
          </div>

          <div className="mb-2 ml-20 rounded-lg p-2">
            {detailLineageText ? (
              <div className="mb-2 rounded-md px-3 py-2 text-xs leading-snug text-muted-foreground ring-1 ring-border/40">
                {detailLineageText}
              </div>
            ) : null}

            {detail.recurring_scope_preview.length > 0 ? (
              <div className="rounded-md px-3 py-2 ring-1 ring-border/40">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold text-muted-foreground">
                    {t.appointments_active_series_path}
                  </p>
                  <span className="text-[11px] text-muted-foreground">
                    {detail.recurring_scope_preview.length}
                  </span>
                </div>
                <div className="mt-2 grid gap-1.5">
                  {detail.recurring_scope_preview.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                        item.id === detail.id
                          ? "text-foreground ring-1 ring-orange-200"
                          : "text-muted-foreground ring-1 ring-border/40",
                      )}
                    >
                      <span className="font-semibold">
                        #{item.recurrence_index + 1}
                      </span>
                      <span>{item.date}</span>
                      {item.id === detail.id ? (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-orange-700 ring-1 ring-orange-200">
                          {t.appointments_current_occurrence}
                        </span>
                      ) : null}
                      {item.open_checklist_count > 0 ? (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
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
              <div className="mt-2 rounded-md px-3 py-2 ring-1 ring-border/40">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold text-muted-foreground">
                    {t.appointments_lineage_history}
                  </p>
                  <span className="text-[11px] text-muted-foreground">
                    {detail.recurring_lineage_history.length}{" "}
                    {t.appointments_lineage_related_series}
                  </span>
                </div>
                <div className="mt-2 grid gap-1.5">
                  {detail.recurring_lineage_history.map((item) => (
                    <div
                      key={item.series_id}
                      className={cn(
                        "flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                        item.relation === "current"
                          ? "text-foreground ring-1 ring-orange-200"
                          : "text-muted-foreground ring-1 ring-border/40",
                      )}
                    >
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border/60">
                        {recurringLineageRelationLabel(item, t)}
                      </span>
                      <span className="font-medium text-foreground">
                        {recurringLineageSplitLabel(item, t)}
                      </span>
                      <span>
                        {item.first_date} {t.uiText.common_to_separator} {item.last_date}
                      </span>
                      <span>
                        {item.total_occurrences} {t.appointments_lineage_total_short}
                      </span>
                      <span>
                        {item.active_occurrences} {t.appointments_lineage_active_short}
                      </span>
                      {item.series_id !== detail.id ? (
                        <button
                          type="button"
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-orange-700 ring-1 ring-orange-200 transition hover:text-orange-800"
                          onClick={() => onOpenDetail(item.series_id)}
                        >
                          {t.appointments_open_branch_root}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </details>
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

function SeriesSummaryBadge({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <span className="rounded-full border-0 bg-white px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
      {label}: <span className="ml-1 font-semibold text-foreground">{value}</span>
    </span>
  );
}

export const MemoizedAppointmentOverviewSection = memo(
  AppointmentOverviewSection,
);
