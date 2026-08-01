import { Search } from "lucide-react";

import { DataTablePager } from "@/components/data-table/data-table-pager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import {
  EmptyCell,
  TabLoader,
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
  timelineEntityDotClass,
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
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
          <div className="relative z-30 flex flex-nowrap items-center gap-1.5 overflow-x-auto border-b border-border/70 bg-card px-3 py-2">
            <NativeComboboxSelect
              // Remount when counts arrive so the trigger label re-derives
              // ("Все · 0" would otherwise stick after the async load).
              key={`entity-${timelineTotal}`}
              value={timelineEntityFilter}
              onChange={(event) => onTimelineEntityFilterChange(event.target.value ?? "all")}
              className="h-8 w-[190px] shrink-0 rounded-lg bg-field text-[13px]"
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
              className="h-8 w-[150px] shrink-0 rounded-lg bg-field text-[13px]"
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
              className="h-8 w-[190px] shrink-0 rounded-lg bg-field text-[13px]"
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
              className="h-8 w-[180px] shrink-0 rounded-lg bg-field text-[13px]"
            >
              <option value="all">{l("patients_all_sources")}</option>
              {timelineSourceOptions.map((source) => (
                <option key={source} value={source}>
                  {localizeTimelineSource(source, l)}
                </option>
              ))}
            </NativeComboboxSelect>
            <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
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
            <div className="space-y-0">
              {groupedTimeline.map((group) => (
                <div key={group.key}>
                  <div className="flex items-center gap-2 border-b border-border/60 bg-muted/25 px-3 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {group.label}
                    </span>
                  </div>
                  {group.items.map((item) => {
                    const route = resolvePatientTimelineRoute(item, {
                      patientId,
                      canOpenDocumentsWorkspace,
                      canViewContracts,
                      canViewInvoices,
                      canOpenComplianceWorkspace,
                    });

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
                          "flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2 text-left transition-colors last:border-b-0",
                          route ? "cursor-pointer hover:bg-muted/30" : "cursor-default",
                        )}
                      >
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            timelineEntityDotClass(item.entity_type),
                          )}
                        />
                        <Badge
                          variant="outline"
                          className={cn(
                            "min-w-[92px] shrink-0 justify-center whitespace-nowrap rounded-full font-mono text-[10px]",
                            timelineEntityTypeBadgeClass(item.entity_type),
                          )}
                        >
                          {localizeTimelineEntityType(item.entity_type, l)}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            "min-w-[110px] shrink-0 justify-center whitespace-nowrap rounded-full font-mono text-[10px]",
                            statusColors[item.status] ?? "border-border/60 bg-muted/25 text-muted-foreground",
                          )}
                        >
                          {statusLabel(item.status)}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                          {item.title}
                        </span>
                        <span className="hidden shrink-0 truncate text-xs text-muted-foreground lg:block lg:max-w-[260px]">
                          {localizeTimelineCategory(item.category, l)}
                          {item.source_label
                            ? ` · ${localizeTimelineSource(item.source_label, l)}`
                            : ""}
                        </span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                          {formatDateTime(item.happened_at)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </TabsContent>
  );
}
