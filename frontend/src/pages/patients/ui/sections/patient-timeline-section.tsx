import { Activity, Clock3, Layers3, ListChecks } from "lucide-react";

import { AdminInlineMetric } from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  TabLoader,
  inputClass as formInputClassName,
} from "@/components/ui-shell";
import {
  localizeTimelineCategory,
  localizeTimelineEntityType,
  localizeTimelineSource,
  timelineEntityTypeBadgeClass,
} from "@/lib/timeline-labels";
import { cn } from "@/lib/utils";

import {
  resolvePatientTimelineRoute,
  type PatientTimelineItem,
  type PatientTimelineRangeFilter,
} from "../../model/detail-model";
import { FormSection } from "../shared/patient-form-primitives";
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";

type LocalizeFn = (key: string) => string;
type StatusLabelFn = (status: string) => string;
type DateTimeFormatter = (value?: string | null, fallback?: string) => string;

type TimelineGroup = {
  key: string;
  label: string;
  items: PatientTimelineItem[];
};

type TimelineSummary = {
  total: number;
  open: number;
  recent: number;
  entityCounts: Array<{
    entityType: string;
    count: number;
  }>;
};

type TimelineRangeOption = {
  value: PatientTimelineRangeFilter;
  label: string;
};

type PatientTimelineTabProps = {
  l: LocalizeFn;
  commonSearch: string;
  tabLoading: boolean;
  timeline: PatientTimelineItem[];
  filteredTimeline: PatientTimelineItem[];
  groupedTimeline: TimelineGroup[];
  timelineSummary: TimelineSummary;
  timelineTotal: number;
  timelineOffset: number;
  timelineLimit: number;
  timelineHasNextPage: boolean;
  timelineEntityFilter: string;
  timelineCategoryFilter: string;
  timelineSourceFilter: string;
  timelineRangeFilter: PatientTimelineRangeFilter;
  timelineSearch: string;
  localizedTimelineRangeOptions: TimelineRangeOption[];
  timelineCategoryOptions: string[];
  timelineSourceOptions: string[];
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDateTime: DateTimeFormatter;
  timelineEntityDotClass: (entityType: string) => string;
  timelineItemSurfaceClass: (status: string) => string;
  timelineAccess: {
    hasTimelineFilters: boolean;
    canOpenDocumentsWorkspace: boolean;
    canViewContracts: boolean;
    canViewInvoices: boolean;
    canOpenComplianceWorkspace: boolean;
  };
  patientId?: string | null;
  onTimelineEntityFilterChange: (value: string) => void;
  onTimelineCategoryFilterChange: (value: string) => void;
  onTimelineSourceFilterChange: (value: string) => void;
  onTimelineRangeFilterChange: (value: PatientTimelineRangeFilter) => void;
  onTimelineSearchChange: (value: string) => void;
  onTimelineOffsetChange: (value: number) => void;
  onResetTimelineFilters: () => void;
  onOpenRoute: (route: string) => void;
};

type TimelineStatsOverviewProps = {
  l: LocalizeFn;
  timelineSummary: TimelineSummary;
};

function TimelineStatsOverview({
  l,
  timelineSummary,
}: TimelineStatsOverviewProps) {
  return (
    <div className="grid gap-y-4 overflow-hidden rounded-xl border border-border px-3 pb-4 pt-4 md:grid-cols-2 xl:grid-cols-4 [&>article:not(:last-child):not(:nth-child(4n))_.admin-inline-metric-separator]:xl:block">
      <AdminInlineMetric
        icon={Activity}
        label={l("patients_total_events")}
        value={timelineSummary.total}
        description={l("patients_all_touchpoints")}
        tone="sky"
      />
      <AdminInlineMetric
        icon={ListChecks}
        label={l("patients_open_items")}
        value={timelineSummary.open}
        description={l("patients_need_follow_up")}
        tone="amber"
      />
      <AdminInlineMetric
        icon={Clock3}
        label={l("patients_last_30_days")}
        value={timelineSummary.recent}
        description={l("patients_recent_movement")}
        tone="emerald"
      />
      <AdminInlineMetric
        icon={Layers3}
        label={l("patients_domains_active")}
        value={timelineSummary.entityCounts.length}
        description={l("patients_profile_workstreams")}
        tone="slate"
      />
    </div>
  );
}

export function PatientTimelineTab({
  l,
  commonSearch,
  tabLoading,
  timeline,
  filteredTimeline,
  groupedTimeline,
  timelineSummary,
  timelineTotal,
  timelineOffset,
  timelineLimit,
  timelineHasNextPage,
  timelineEntityFilter,
  timelineCategoryFilter,
  timelineSourceFilter,
  timelineRangeFilter,
  timelineSearch,
  localizedTimelineRangeOptions,
  timelineCategoryOptions,
  timelineSourceOptions,
  statusColors,
  statusLabel,
  formatDateTime,
  timelineEntityDotClass,
  timelineItemSurfaceClass,
  timelineAccess,
  patientId,
  onTimelineEntityFilterChange,
  onTimelineCategoryFilterChange,
  onTimelineSourceFilterChange,
  onTimelineRangeFilterChange,
  onTimelineSearchChange,
  onTimelineOffsetChange,
  onResetTimelineFilters,
  onOpenRoute,
}: PatientTimelineTabProps) {
  const {
    hasTimelineFilters,
    canOpenDocumentsWorkspace,
    canViewContracts,
    canViewInvoices,
    canOpenComplianceWorkspace,
  } = timelineAccess;

  return (
    <TabsContent value="timeline" className="space-y-4 mt-4 min-h-[400px]">
      {tabLoading ? (
        <TabLoader />
      ) : timeline.length === 0 ? (
        <EmptyCell>
          {l("patients_no_timeline_events_have_been_recorded_for_this_patient_y")}
        </EmptyCell>
      ) : (
        <>
          <WorkspaceSectionIntro
            title={l("patients_timeline_cockpit")}
            description={l("patients_all_patient_events_with_url_synced_filters_for_navigatio")}
            accessory={<CountBadge>{filteredTimeline.length}</CountBadge>}
          />

          <TimelineStatsOverview l={l} timelineSummary={timelineSummary} />

          <FormSection
            title={l("patients_timeline_filters")}
            accessory={<CountBadge>{filteredTimeline.length} {l("patients_matches")}</CountBadge>}
          >
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={timelineEntityFilter === "all" ? "default" : "outline"}
                className="h-6 rounded-full px-2.5 text-[11px]"
                onClick={() => onTimelineEntityFilterChange("all")}
              >
                {l("patients_all")}
                <span className="text-muted-foreground/60 text-[6px] leading-none align-middle">●</span>
                {timelineTotal}
              </Button>
              {timelineSummary.entityCounts.map((entry) => (
                <Button
                  key={entry.entityType}
                  type="button"
                  size="sm"
                  variant={timelineEntityFilter === entry.entityType ? "default" : "outline"}
                  className="h-6 rounded-full px-2.5 text-[11px]"
                  onClick={() => onTimelineEntityFilterChange(entry.entityType)}
                >
                  {localizeTimelineEntityType(entry.entityType, l)}
                  <span className="text-muted-foreground/60 text-[6px] leading-none align-middle">●</span>
                  {entry.count}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-[180px_220px_240px_minmax(0,1fr)_auto]">
              <NativeComboboxSelect value={timelineRangeFilter}
                onChange={(event) => onTimelineRangeFilterChange((event.target.value as PatientTimelineRangeFilter) ?? "all")} className={cn("w-full", formInputClassName)}>
                  {localizedTimelineRangeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeComboboxSelect>
              <NativeComboboxSelect value={timelineCategoryFilter}
                onChange={(event) => onTimelineCategoryFilterChange(event.target.value ?? "all")} className={cn("w-full", formInputClassName)}>
                  <option value="all">{l("patients_all_categories")}</option>
                  {timelineCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {localizeTimelineCategory(category, l)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              <NativeComboboxSelect value={timelineSourceFilter}
                onChange={(event) => onTimelineSourceFilterChange(event.target.value ?? "all")} className={cn("w-full", formInputClassName)}>
                  <option value="all">{l("patients_all_sources")}</option>
                  {timelineSourceOptions.map((source) => (
                    <option key={source} value={source}>
                      {localizeTimelineSource(source, l)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              <Input
                value={timelineSearch}
                onChange={(event) => onTimelineSearchChange(event.target.value)}
                placeholder={commonSearch}
                className={formInputClassName}
              />
              {hasTimelineFilters ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-lg"
                  onClick={onResetTimelineFilters}
                >
                  {l("patients_reset_filters")}
                </Button>
              ) : null}
            </div>
          </FormSection>

          {filteredTimeline.length === 0 ? (
            <EmptyCell>
              {l("patients_no_timeline_events_match_the_current_filters")}
            </EmptyCell>
          ) : (
            <FormSection
              title={l("patients_events")}
              accessory={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {l("patients_showing_2")} {timelineTotal === 0 ? 0 : timelineOffset + 1}-
                    {timelineTotal === 0 ? 0 : Math.min(timelineOffset + timeline.length, timelineTotal)}{" "}
                    {l("documents_of")} {timelineTotal}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={timelineOffset === 0}
                    onClick={() => onTimelineOffsetChange(Math.max(0, timelineOffset - timelineLimit))}
                  >
                    {l("patients_previous")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={!timelineHasNextPage}
                    onClick={() => onTimelineOffsetChange(timelineOffset + timelineLimit)}
                  >
                    {l("patients_next")}
                  </Button>
                </div>
              }
            >
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
                        {group.items.map((item, idx) => {
                          const route = resolvePatientTimelineRoute(item, {
                            patientId,
                            canOpenDocumentsWorkspace,
                            canViewContracts,
                            canViewInvoices,
                            canOpenComplianceWorkspace,
                          });

                          return (
                            <div
                              key={`${item.entity_type}-${item.entity_id}`}
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
                                    timelineEntityDotClass(item.entity_type),
                                  )}
                                />
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  if (route) {
                                    onOpenRoute(route);
                                  }
                                }}
                                className={cn(
                                  "rounded-2xl border px-4 py-3 text-left transition-colors",
                                  timelineItemSurfaceClass(item.status),
                                  route
                                    ? "hover:border-border hover:bg-muted/30 cursor-pointer"
                                    : "cursor-default",
                                )}
                              >
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge
                                        variant="outline"
                                        className={cn("rounded-full text-[10px]", timelineEntityTypeBadgeClass(item.entity_type))}
                                      >
                                        {localizeTimelineEntityType(item.entity_type, l)}
                                      </Badge>
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          "rounded-full text-[10px]",
                                          statusColors[item.status] ?? "border-border/60 bg-muted/25 text-muted-foreground",
                                        )}
                                      >
                                        {statusLabel(item.status)}
                                      </Badge>
                                      <span className="text-xs text-muted-foreground">
                                        {localizeTimelineCategory(item.category, l)}
                                      </span>
                                      {item.source_label ? (
                                        <span className="text-xs text-muted-foreground/80">
                                          · {localizeTimelineSource(item.source_label, l)}
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="mt-2 text-sm font-semibold text-foreground">{item.title}</p>
                                  </div>

                                  <div className="shrink-0">
                                    <p className="text-xs font-medium text-muted-foreground/80">
                                      {formatDateTime(item.happened_at)}
                                    </p>
                                  </div>
                                </div>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </FormSection>
          )}
        </>
      )}
    </TabsContent>
  );
}
