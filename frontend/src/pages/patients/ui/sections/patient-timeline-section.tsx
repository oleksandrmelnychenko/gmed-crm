import { ChevronRight, History, Search } from "lucide-react";

import { DataTablePager } from "@/components/data-table/data-table-pager";
import { WritableScope } from "@/components/read-only-scope";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { TabsContent } from "@/components/ui/tabs";
import {
  EmptyCell,
  TabLoader,
} from "@/components/ui-shell";
import {
  localizeTimelineCategory,
  localizeTimelineEntityType,
  localizeTimelineSource,
} from "@/lib/timeline-labels";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  resolvePatientTimelineRoute,
  type PatientTimelineItem,
  type PatientTimelineRangeFilter,
} from "../../model/detail-model";
import { patientTimelineItemLabels } from "../../model/timeline-item-labels";

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
  const { lang } = useLang();
  const {
    hasTimelineFilters,
    canOpenDocumentsWorkspace,
    canViewContracts,
    canViewInvoices,
    canOpenComplianceWorkspace,
  } = timelineAccess;
  const timelineEntityTotal = timelineSummary.entityCounts.reduce(
    (total, entry) => total + entry.count,
    0,
  );

  return (
    <TabsContent value="timeline" className="space-y-4 mt-4 min-h-[400px]">
      {tabLoading ? (
        <TabLoader />
      ) : timelineTotal === 0 && timeline.length === 0 && !hasTimelineFilters ? (
        <EmptyCell>
          {l("patients_no_timeline_events_have_been_recorded_for_this_patient_y")}
        </EmptyCell>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          {/* Filters and search are reading: usable on a read-only patient. */}
          <WritableScope>
          <div className="relative z-30 flex flex-wrap items-center gap-2 border-b border-border/70 bg-card px-3 py-3">
            <NativeComboboxSelect
              // Remount when counts arrive so the trigger label re-derives
              // ("Все · 0" would otherwise stick after the async load).
              key={`entity-${timelineTotal}`}
              value={timelineEntityFilter}
              onChange={(event) => onTimelineEntityFilterChange(event.target.value ?? "all")}
              className="h-8 w-full rounded-lg bg-field text-[13px] sm:w-[190px]"
            >
              <option value="all">
                {l("patients_all")} · {timelineEntityTotal}
              </option>
              {timelineSummary.entityCounts.map((entry) => (
                <option key={entry.entityType} value={entry.entityType}>
                  {localizeTimelineEntityType(entry.entityType, l)} · {entry.count}
                </option>
              ))}
            </NativeComboboxSelect>
            <NativeComboboxSelect
              value={timelineRangeFilter}
              onChange={(event) =>
                onTimelineRangeFilterChange((event.target.value as PatientTimelineRangeFilter) ?? "all")
              }
              className="h-8 w-full rounded-lg bg-field text-[13px] sm:w-[150px]"
            >
              {localizedTimelineRangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeComboboxSelect>
            <NativeComboboxSelect
              value={timelineCategoryFilter}
              onChange={(event) => onTimelineCategoryFilterChange(event.target.value ?? "all")}
              className="h-8 w-full rounded-lg bg-field text-[13px] sm:w-[190px]"
            >
              <option value="all">{l("patients_all_categories")}</option>
              {timelineCategoryOptions.map((category) => (
                <option key={category} value={category}>
                  {localizeTimelineCategory(category, l)}
                </option>
              ))}
            </NativeComboboxSelect>
            <NativeComboboxSelect
              value={timelineSourceFilter}
              onChange={(event) => onTimelineSourceFilterChange(event.target.value ?? "all")}
              className="h-8 w-full rounded-lg bg-field text-[13px] sm:w-[180px]"
            >
              <option value="all">{l("patients_all_sources")}</option>
              {timelineSourceOptions.map((source) => (
                <option key={source} value={source}>
                  {localizeTimelineSource(source, l)}
                </option>
              ))}
            </NativeComboboxSelect>
            <div className="relative min-w-0 basis-full sm:min-w-[180px] sm:flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={timelineSearch}
                onChange={(event) => onTimelineSearchChange(event.target.value)}
                placeholder={commonSearch}
                className="h-8 rounded-lg bg-field pl-8 text-[13px]"
              />
            </div>
            {hasTimelineFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="shrink-0"
                onClick={onResetTimelineFilters}
              >
                {l("patients_reset_filters")}
              </Button>
            ) : null}
          </div>
          </WritableScope>
          <DataTablePager
            pageIndex={timelineLimit > 0 ? Math.floor(timelineOffset / timelineLimit) : 0}
            pageSize={timelineLimit}
            totalPages={Math.max(1, Math.ceil(timelineTotal / Math.max(1, timelineLimit)))}
            totalRows={timelineTotal}
            previousLabel={l("patients_previous")}
            nextLabel={l("patients_next")}
            onPageChange={(page) => onTimelineOffsetChange(page * timelineLimit)}
          />

          {filteredTimeline.length === 0 ? (
            <div className="px-4 py-6">
              <EmptyCell>
                {l("patients_no_timeline_events_match_the_current_filters")}
              </EmptyCell>
            </div>
          ) : (
            <div className="space-y-5 bg-muted/40 p-3 sm:p-4">
              {groupedTimeline.map((group) => (
                <section key={group.key} className="space-y-2" aria-label={group.label}>
                  <div className="flex items-center gap-2 px-1">
                    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
                    <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                      {group.label}
                    </h3>
                    <span className="h-px flex-1 bg-border" aria-hidden="true" />
                  </div>
                  {group.items.map((item) => {
                    const route = resolvePatientTimelineRoute(item, {
                      patientId,
                      canOpenDocumentsWorkspace,
                      canViewContracts,
                      canViewInvoices,
                      canOpenComplianceWorkspace,
                    });
                    const labels = patientTimelineItemLabels(
                      item,
                      l,
                      statusLabel,
                      lang === "de" ? "de" : "ru",
                    );

                    return (
                      <button
                        key={`${item.entity_type}-${item.entity_id}`}
                        type="button"
                        onClick={() => {
                          if (route) {
                            onOpenRoute(route);
                          }
                        }}
                        className={cn(
                          "flex w-full min-w-0 items-start gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left shadow-xs transition-colors sm:px-4",
                          route ? "cursor-pointer hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" : "cursor-default",
                        )}
                      >
                        <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground sm:flex">
                          <History className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                            <p className="min-w-0 break-words text-sm font-semibold leading-5 text-foreground">
                              {labels.title}
                            </p>
                            <time dateTime={item.happened_at} className="shrink-0 font-mono text-[11px] leading-5 tabular-nums text-muted-foreground">
                              {formatDateTime(item.happened_at)}
                            </time>
                          </div>
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                            <StatusChip className="text-[11px] leading-4">
                              {localizeTimelineEntityType(item.entity_type, l)}
                            </StatusChip>
                            <StatusChip className={cn("text-[11px] leading-4", statusColors[item.status])}>
                              {labels.status}
                            </StatusChip>
                            {(labels.category || labels.source) ? (
                              <span className="min-w-0 break-words text-xs leading-5 text-muted-foreground">
                                {[labels.category, labels.source].filter(Boolean).join(" · ")}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {route ? <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </TabsContent>
  );
}
