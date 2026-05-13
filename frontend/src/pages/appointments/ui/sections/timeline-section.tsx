import { memo, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CountBadge, EmptyCell, Section } from "@/components/ui-shell";
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
  appointmentTimelineSurfaceClassName,
  appointmentTimelineToneBadgeClassName,
  appointmentTimelineToneLabel,
} from "@/pages/appointments/appearance/timeline-appearance";

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

  const filters = [
    "all",
    "workflow",
    "communication",
    "interpreter",
    "clinical",
    "followup",
    "concierge",
  ] as const;
  const matchesLabel = appointmentText("appointments_matches");
  const eventsLabel = appointmentText("appointments_events");
  const emptyLabel = appointmentText("appointments_no_timeline_events_have_been_recorded_for_this_appointme");
  const noMatchesLabel = appointmentText("appointments_no_timeline_events_match_the_current_filter");

  return (
    <Section
      title={appointmentText("appointments_timeline_2")}
      accessory={
        <CountBadge>
          {visibleTimelineEvents.length} {eventsLabel}
        </CountBadge>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {filters.map((filter) => (
          <Button
            key={filter}
            type="button"
            size="sm"
            variant={timelineFilter === filter ? "default" : "outline"}
            className="h-6 rounded-full px-2.5 text-[11px]"
            onClick={() => setTimelineFilter(filter)}
          >
            {filter === "all"
              ? appointmentText("appointments_all")
              : appointmentTimelineKindLabel(filter)}
            <span className="text-muted-foreground/60 text-[6px] leading-none align-middle">
              ●
            </span>
            {filter === "all" ? timelineEvents.length : timelineCounts[filter]}
          </Button>
        ))}
      </div>

      {timelineEvents.length === 0 ? (
        <EmptyCell>{emptyLabel}</EmptyCell>
      ) : visibleTimelineEvents.length === 0 ? (
        <EmptyCell>{noMatchesLabel}</EmptyCell>
      ) : (
        <div className="rounded-2xl border border-border/50 bg-card px-4 py-3 sm:px-5">
          <div className="space-y-5">
            {groupedTimeline.map((group) => (
              <div key={group.key} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded-full border border-border/60 bg-muted/35 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {group.label}
                  </span>
                  <span className="h-px flex-1 bg-border/60" />
                </div>

                <div className="space-y-0">
                  {group.items.map((item, idx) => (
                    <div
                      key={item.id}
                      className={cn(
                        "grid grid-cols-[16px_minmax(0,1fr)] gap-3",
                        idx < group.items.length - 1 && "pb-3",
                      )}
                    >
                      <div className="relative flex justify-center">
                        {idx < group.items.length - 1 ? (
                          <span className="absolute top-3 bottom-[-0.75rem] w-px bg-gradient-to-b from-border/90 via-border/60 to-transparent" />
                        ) : null}
                        <span
                          className={cn(
                            "relative mt-1.5 size-2 rounded-full border border-card shadow-[0_0_0_2px_rgba(255,255,255,0.92)]",
                            appointmentTimelineKindDotClassName(item.kind),
                          )}
                        />
                      </div>

                      <div
                        className={cn(
                          "rounded-2xl border px-4 py-3",
                          appointmentTimelineSurfaceClassName(item.tone),
                        )}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                                  appointmentTimelineKindBadgeClassName(item.kind),
                                )}
                              >
                                {appointmentTimelineKindLabel(item.kind)}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                                  appointmentTimelineToneBadgeClassName(item.tone),
                                )}
                              >
                                {appointmentTimelineToneLabel(item.tone)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm font-semibold text-foreground">
                              {item.title}
                            </p>
                            {item.detail ? (
                              <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                                {item.detail}
                              </p>
                            ) : null}
                          </div>

                          <div className="shrink-0">
                            <p className="text-xs font-medium text-muted-foreground/80">
                              {formatAppointmentDateTimeLabel(item.occurredAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {visibleTimelineEvents.length} {matchesLabel}
      </p>
    </Section>
  );
}

export const MemoizedAppointmentTimelineSection = memo(
  AppointmentTimelineSection,
);
