import { memo, useMemo, useState } from "react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { EmptyCell } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { appointmentText } from "@/pages/appointments/model/labels";
import {
  appointmentRuntimeLocale,
  formatAppointmentDateTimeLabel,
} from "@/pages/appointments/model/runtime-formatters";
import type {
  AppointmentTimelineEvent,
  AppointmentTimelineKind,
} from "@/pages/appointments/model/types";
import {
  appointmentTimelineDateGroupKey,
  appointmentTimelineDateGroupLabel,
  appointmentTimelineKindBadgeClassName,
  appointmentTimelineKindDotClassName,
  appointmentTimelineKindLabel,
  appointmentTimelineToneBadgeClassName,
  appointmentTimelineToneLabel,
} from "@/pages/appointments/appearance/timeline-appearance";

const TIMELINE_FILTERS = [
  "workflow",
  "communication",
  "interpreter",
  "clinical",
  "followup",
  "concierge",
] as const;

function AppointmentTimelineSection({
  timelineEvents,
}: {
  timelineEvents: AppointmentTimelineEvent[];
}) {
  const { lang } = useLang();
  const [timelineFilter, setTimelineFilter] = useState<
    "all" | AppointmentTimelineKind
  >("all");

  const timelineCounts = useMemo(() => {
    const counts: Record<AppointmentTimelineKind, number> = {
      workflow: 0,
      communication: 0,
      interpreter: 0,
      clinical: 0,
      followup: 0,
      concierge: 0,
    };
    for (const item of timelineEvents) {
      counts[item.kind] += 1;
    }
    return counts;
  }, [timelineEvents]);

  const visibleTimelineEvents = useMemo(
    () =>
      timelineFilter === "all"
        ? timelineEvents
        : timelineEvents.filter((item) => item.kind === timelineFilter),
    [timelineEvents, timelineFilter],
  );

  const groupedTimeline = useMemo(() => {
    const groups: Array<{
      key: string;
      label: string;
      items: AppointmentTimelineEvent[];
    }> = [];
    const byKey = new Map<
      string,
      { key: string; label: string; items: AppointmentTimelineEvent[] }
    >();

    for (const item of visibleTimelineEvents) {
      const key = appointmentTimelineDateGroupKey(item.occurredAt);
      const existing = byKey.get(key);
      if (existing) {
        existing.items.push(item);
        continue;
      }

      const group = {
        key,
        label: appointmentTimelineDateGroupLabel(item.occurredAt, {
          lang,
          locale: appointmentRuntimeLocale(),
        }),
        items: [item],
      };
      byKey.set(key, group);
      groups.push(group);
    }

    return groups;
  }, [lang, visibleTimelineEvents]);

  const emptyLabel = appointmentText(
    "appointments_no_timeline_events_have_been_recorded_for_this_appointme",
  );
  const noMatchesLabel = appointmentText(
    "appointments_no_timeline_events_match_the_current_filter",
  );

  if (timelineEvents.length === 0) {
    return <EmptyCell>{emptyLabel}</EmptyCell>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
      <div className="relative z-30 flex flex-nowrap items-center gap-1.5 overflow-x-auto border-b border-border/70 bg-card px-3 py-2">
        <NativeComboboxSelect
          key={`kind-${timelineEvents.length}`}
          value={timelineFilter}
          onChange={(event) =>
            setTimelineFilter(
              (event.target.value as "all" | AppointmentTimelineKind) ?? "all",
            )
          }
          className="h-8 w-[220px] shrink-0 rounded-lg bg-field text-[13px]"
        >
          <option value="all">
            {appointmentText("appointments_all")} · {timelineEvents.length}
          </option>
          {TIMELINE_FILTERS.map((filter) => (
            <option key={filter} value={filter}>
              {appointmentTimelineKindLabel(filter)} · {timelineCounts[filter]}
            </option>
          ))}
        </NativeComboboxSelect>
      </div>

      {visibleTimelineEvents.length === 0 ? (
        <div className="px-4 py-6">
          <EmptyCell>{noMatchesLabel}</EmptyCell>
        </div>
      ) : (
        <div className="space-y-0">
          {groupedTimeline.map((group) => (
            <div key={group.key}>
              <div className="flex items-center gap-2 border-b border-border/60 bg-muted/25 px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {group.label}
                </span>
              </div>
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className="flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2 last:border-b-0"
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      appointmentTimelineKindDotClassName(item.kind),
                    )}
                  />
                  <span
                    className={cn(
                      "w-[110px] shrink-0 rounded-full border px-2 py-0.5 text-center font-mono text-[10px] font-medium",
                      appointmentTimelineKindBadgeClassName(item.kind),
                    )}
                  >
                    {appointmentTimelineKindLabel(item.kind)}
                  </span>
                  <span
                    className={cn(
                      "w-[110px] shrink-0 rounded-full border px-2 py-0.5 text-center font-mono text-[10px] font-medium",
                      appointmentTimelineToneBadgeClassName(item.tone),
                    )}
                  >
                    {appointmentTimelineToneLabel(item.tone)}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
                    title={item.detail ?? undefined}
                  >
                    {item.title}
                  </span>
                  {item.detail ? (
                    <span
                      className="hidden shrink-0 truncate text-xs text-muted-foreground lg:block lg:max-w-[320px]"
                      title={item.detail}
                    >
                      {item.detail}
                    </span>
                  ) : null}
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatAppointmentDateTimeLabel(item.occurredAt)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const MemoizedAppointmentTimelineSection = memo(
  AppointmentTimelineSection,
);
