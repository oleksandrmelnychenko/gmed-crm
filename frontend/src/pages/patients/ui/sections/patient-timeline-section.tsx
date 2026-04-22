import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  Section as FormSection,
  StatCard,
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
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";

type LocalizeFn = (de: string, ru: string, en: string) => string;
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
  hasTimelineFilters: boolean;
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDateTime: DateTimeFormatter;
  timelineEntityDotClass: (entityType: string) => string;
  timelineItemSurfaceClass: (status: string) => string;
  canOpenDocumentsWorkspace: boolean;
  canViewContracts: boolean;
  canViewInvoices: boolean;
  canOpenComplianceWorkspace: boolean;
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
  timelineHasNextPage,
  timelineEntityFilter,
  timelineCategoryFilter,
  timelineSourceFilter,
  timelineRangeFilter,
  timelineSearch,
  localizedTimelineRangeOptions,
  timelineCategoryOptions,
  timelineSourceOptions,
  hasTimelineFilters,
  statusColors,
  statusLabel,
  formatDateTime,
  timelineEntityDotClass,
  timelineItemSurfaceClass,
  canOpenDocumentsWorkspace,
  canViewContracts,
  canViewInvoices,
  canOpenComplianceWorkspace,
  onTimelineEntityFilterChange,
  onTimelineCategoryFilterChange,
  onTimelineSourceFilterChange,
  onTimelineRangeFilterChange,
  onTimelineSearchChange,
  onTimelineOffsetChange,
  onResetTimelineFilters,
  onOpenRoute,
}: PatientTimelineTabProps) {
  return (
    <TabsContent value="timeline" className="space-y-4 mt-4 min-h-[400px]">
      {tabLoading ? (
        <TabLoader />
      ) : timeline.length === 0 ? (
        <EmptyCell>
          {l("Für diesen Patienten wurden noch keine Timeline-Ereignisse erfasst.", "Для этого пациента пока не зарегистрировано событий таймлайна.", "No timeline events have been recorded for this patient yet.")}
        </EmptyCell>
      ) : (
        <>
          <WorkspaceSectionIntro
            title={l("Timeline-Cockpit", "Панель таймлайна", "Timeline cockpit")}
            description={l(
              "Alle patientenbezogenen Ereignisse mit URL-synchronisierten Filtern für Navigation, Back/Forward und Deep Links.",
              "Все события по пациенту с фильтрами, синхронизированными с URL, для навигации, back/forward и deep-link.",
              "All patient events with URL-synced filters for navigation, back/forward and deep links.",
            )}
            accessory={<CountBadge>{filteredTimeline.length}</CountBadge>}
          />

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={l("Ereignisse gesamt", "Всего событий", "Total events")}
              value={timelineSummary.total}
              description={l("Alle erfassten Touchpoints im Patienten-Workflow.", "Все зафиксированные точки касания в процессе ведения пациента.", "All recorded patient workflow touchpoints.")}
            />
            <StatCard
              label={l("Offene Punkte", "Открытые пункты", "Open items")}
              value={timelineSummary.open}
              description={l("Ereignisse, die noch operative Nachverfolgung erfordern.", "События, которые ещё требуют операционного сопровождения.", "Events that still require operational follow-through.")}
            />
            <StatCard
              label={l("Letzte 30 Tage", "Последние 30 дней", "Last 30 days")}
              value={timelineSummary.recent}
              description={l("Aktuelle Bewegung über Behandlung, Billing und Dokumente.", "Недавняя активность по лечению, счетам и документам.", "Recent movement across care, billing and documents.")}
            />
            <StatCard
              label={l("Aktive Bereiche", "Активные направления", "Domains active")}
              value={timelineSummary.entityCounts.length}
              description={l("Eindeutige Workstreams, die diesen Patienten bereits berühren.", "Уникальные направления работы, уже затрагивающие этого пациента.", "Unique workstreams already touching this patient.")}
            />
          </div>

          <FormSection
            title={l("Timeline-Filter", "Фильтры таймлайна", "Timeline filters")}
            accessory={<CountBadge>{filteredTimeline.length} {l("Treffer", "совпадений", "matches")}</CountBadge>}
          >
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={timelineEntityFilter === "all" ? "default" : "outline"}
                className="h-6 rounded-full px-2.5 text-[11px]"
                onClick={() => onTimelineEntityFilterChange("all")}
              >
                {l("Alle", "Все", "All")}
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
              <ShadSelect value={timelineRangeFilter} onValueChange={(value) => onTimelineRangeFilterChange((value as PatientTimelineRangeFilter) ?? "all")}>
                <SelectTrigger className={cn("w-full", formInputClassName)}>
                  <SelectValue>
                    {localizedTimelineRangeOptions.find((option) => option.value === timelineRangeFilter)?.label ?? ""}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {localizedTimelineRangeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
              <ShadSelect value={timelineCategoryFilter} onValueChange={(value) => onTimelineCategoryFilterChange(value ?? "all")}>
                <SelectTrigger className={cn("w-full", formInputClassName)}>
                  <SelectValue>
                    {timelineCategoryFilter === "all"
                      ? l("Alle Kategorien", "Все категории", "All categories")
                      : localizeTimelineCategory(timelineCategoryFilter, l)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{l("Alle Kategorien", "Все категории", "All categories")}</SelectItem>
                  {timelineCategoryOptions.map((category) => (
                    <SelectItem key={category} value={category}>
                      {localizeTimelineCategory(category, l)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
              <ShadSelect value={timelineSourceFilter} onValueChange={(value) => onTimelineSourceFilterChange(value ?? "all")}>
                <SelectTrigger className={cn("w-full", formInputClassName)}>
                  <SelectValue>
                    {timelineSourceFilter === "all"
                      ? l("Alle Quellen", "Все источники", "All sources")
                      : localizeTimelineSource(timelineSourceFilter, l)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{l("Alle Quellen", "Все источники", "All sources")}</SelectItem>
                  {timelineSourceOptions.map((source) => (
                    <SelectItem key={source} value={source}>
                      {localizeTimelineSource(source, l)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
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
                  {l("Filter zurücksetzen", "Сбросить фильтры", "Reset filters")}
                </Button>
              ) : null}
            </div>
          </FormSection>

          {filteredTimeline.length === 0 ? (
            <EmptyCell>
              {l("Keine Zeitachsen-Ereignisse entsprechen den aktuellen Filtern.", "Текущим фильтрам не соответствует ни одно событие таймлайна.", "No timeline events match the current filters.")}
            </EmptyCell>
          ) : (
            <FormSection
              title={l("Ereignisse", "События", "Events")}
              accessory={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {l("Angezeigt", "Показаны", "Showing")} {timelineTotal === 0 ? 0 : timelineOffset + 1}-
                    {timelineTotal === 0 ? 0 : Math.min(timelineOffset + timeline.length, timelineTotal)}{" "}
                    {l("von", "из", "of")} {timelineTotal}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={timelineOffset === 0}
                    onClick={() => onTimelineOffsetChange(Math.max(0, timelineOffset - timelineLimit))}
                  >
                    {l("Zurück", "Назад", "Previous")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={!timelineHasNextPage}
                    onClick={() => onTimelineOffsetChange(timelineOffset + timelineLimit)}
                  >
                    {l("Weiter", "Далее", "Next")}
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
