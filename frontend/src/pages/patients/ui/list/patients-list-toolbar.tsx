import type { RefObject } from "react";
import { Download, Filter, Info, RefreshCw, Search, X } from "lucide-react";

import { ColumnVisibilityMenu } from "@/components/data-table/column-visibility-menu";
import { DensityToggle } from "@/components/data-table/density-toggle";
import { FilterBuilder } from "@/components/data-table/filter-builder";
import { SortBuilder } from "@/components/data-table/sort-builder";
import type {
  ColumnDef,
  DensityLevel,
  FilterPredicate,
  SortStack,
} from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { PatientSummary } from "../../model/list-model";

type ProviderOption = {
  id: string;
  name: string;
  address_city?: string | null;
};

type DoctorOption = {
  id: string;
  name: string;
  title?: string | null;
};

type PatientsListToolbarProps = {
  anyTopFilterActive: boolean;
  columns: ColumnDef<PatientSummary>[];
  defaultFrozenColumns: string[];
  defaultHiddenColumns: string[];
  deferredSearchPlaceholder: string;
  density: DensityLevel;
  doctors: DoctorOption[];
  exportLabel: string;
  filterPredicates: FilterPredicate[];
  filters: {
    activeOnly: string;
    doctorId: string;
    providerId: string;
    search: string;
  };
  frozenColumns: string[];
  groupLabels: Record<string, string>;
  hiddenColumns: string[];
  lastUpdatedText: string | null;
  listBusy: boolean;
  maxFrozenColumns: number;
  onActiveFilterChange: (value: string) => void;
  onClearAll: () => void;
  onDensityChange: (value: DensityLevel) => void;
  onDoctorFilterChange: (value: string) => void;
  onExport: () => void;
  onFiltersChange: (value: FilterPredicate[]) => void;
  onFrozenColumnsChange: (value: string[]) => void;
  onHiddenColumnsChange: (value: string[]) => void;
  onProviderFilterChange: (value: string) => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onSearchEscape: (input: HTMLInputElement) => void;
  onShortcutsOpen: () => void;
  onSortChange: (value: SortStack) => void;
  providers: ProviderOption[];
  refreshLabel: string;
  rows: PatientSummary[];
  searchInputRef: RefObject<HTMLInputElement | null>;
  sortStack: SortStack;
  t: Record<string, string>;
};

export function PatientsListToolbar({
  anyTopFilterActive,
  columns,
  defaultFrozenColumns,
  defaultHiddenColumns,
  deferredSearchPlaceholder,
  density,
  doctors,
  exportLabel,
  filterPredicates,
  filters,
  frozenColumns,
  groupLabels,
  hiddenColumns,
  lastUpdatedText,
  listBusy,
  maxFrozenColumns,
  onActiveFilterChange,
  onClearAll,
  onDensityChange,
  onDoctorFilterChange,
  onExport,
  onFiltersChange,
  onFrozenColumnsChange,
  onHiddenColumnsChange,
  onProviderFilterChange,
  onRefresh,
  onSearchChange,
  onSearchEscape,
  onShortcutsOpen,
  onSortChange,
  providers,
  refreshLabel,
  rows,
  searchInputRef,
  sortStack,
  t,
}: PatientsListToolbarProps) {
  const operatorLabels = {
    contains: t.filter_op_contains ?? "contains",
    does_not_contain: t.filter_op_does_not_contain ?? "does not contain",
    is_empty: t.filter_op_is_empty ?? "is empty",
    is_not_empty: t.filter_op_is_not_empty ?? "is not empty",
    is: t.filter_op_is ?? "is",
    is_not: t.filter_op_is_not ?? "is not",
    is_any_of: t.filter_op_is_any_of ?? "is any of",
    is_none_of: t.filter_op_is_none_of ?? "is none of",
    has_any: t.filter_op_has_any ?? "has any of",
    has_all: t.filter_op_has_all ?? "has all of",
    has_none: t.filter_op_has_none ?? "has none of",
    before: t.filter_op_before ?? "before",
    after: t.filter_op_after ?? "after",
    between: t.filter_op_between ?? "between",
    last_n_days: t.filter_op_last_n_days ?? "last N days",
    equals: t.filter_op_equals ?? "equals",
  };

  return (
    <div className="relative z-30 flex flex-col gap-2 rounded-lg border border-border bg-card/80 p-2 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={filters.search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onSearchEscape(event.target as HTMLInputElement);
              }
            }}
            placeholder={deferredSearchPlaceholder}
            className="h-8 w-full rounded-lg bg-background pl-8 text-[13px]"
          />
        </div>

        <ShadSelect value={filters.providerId} onValueChange={(value) => onProviderFilterChange(value ?? "")}>
          <SelectTrigger size="sm" className="h-8 w-[220px] bg-background text-[13px]">
            <SelectValue>
              {filters.providerId
                ? providers.find((provider) => provider.id === filters.providerId)?.name ?? filters.providerId
                : t.common_provider}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t.providers_all}</SelectItem>
            {providers.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                {provider.name}{provider.address_city ? ` · ${provider.address_city}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </ShadSelect>

        <ShadSelect
          value={filters.doctorId}
          onValueChange={(value) => onDoctorFilterChange(value ?? "")}
          disabled={!filters.providerId}
        >
          <SelectTrigger size="sm" className="h-8 w-[200px] bg-background text-[13px]">
            <SelectValue>
              {filters.doctorId
                ? doctors.find((doctor) => doctor.id === filters.doctorId)?.name ?? filters.doctorId
                : t.common_doctor}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t.providers_all}</SelectItem>
            {doctors.map((doctor) => (
              <SelectItem key={doctor.id} value={doctor.id}>
                {doctor.title ? `${doctor.title} ` : ""}{doctor.name}
              </SelectItem>
            ))}
          </SelectContent>
        </ShadSelect>

        <ShadSelect value={filters.activeOnly} onValueChange={(value) => onActiveFilterChange(value ?? "")}>
          <SelectTrigger size="sm" className="h-8 bg-background text-[13px]">
            <Filter className="mr-1 size-3.5 text-muted-foreground" />
            <SelectValue>
              {filters.activeOnly === "true"
                ? t.common_active
                : filters.activeOnly === "false"
                  ? t.common_inactive
                  : t.providers_all}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t.providers_all}</SelectItem>
            <SelectItem value="true">{t.common_active}</SelectItem>
            <SelectItem value="false">{t.common_inactive}</SelectItem>
          </SelectContent>
        </ShadSelect>

        <div className="ml-auto flex items-center gap-1">
          {lastUpdatedText ? (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {lastUpdatedText}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            title={refreshLabel}
            aria-label={refreshLabel}
            onClick={onRefresh}
          >
            <RefreshCw className={cn("size-3.5", listBusy && "animate-spin")} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            title={exportLabel}
            aria-label={exportLabel}
            onClick={onExport}
          >
            <Download className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            onClick={onShortcutsOpen}
          >
            <Info className="size-3.5" />
          </Button>
          {anyTopFilterActive ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClearAll}>
              <X className="size-3.5" />
              {t.common_reset}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2">
        <FilterBuilder
          columns={columns}
          rows={rows}
          filters={filterPredicates}
          onChange={onFiltersChange}
          translations={{
            addFilter: t.table_filter ?? "Filter",
            clearAll: t.table_sort_clear ?? "Clear",
            searchPlaceholder: t.table_filter_search_fields ?? t.common_search,
            noFields: t.table_filter_no_fields ?? "No available fields",
            remove: t.table_filter_remove ?? "Remove filter",
            valuePlaceholder: t.table_filter_value ?? "Value",
            yes: t.common_yes ?? "Yes",
            no: t.common_no ?? "No",
            operatorLabels,
          }}
        />

        <SortBuilder
          columns={columns}
          value={sortStack}
          onChange={onSortChange}
          translations={{
            addSort: t.table_sort_add ?? "Add sort",
            clearAll: t.table_sort_clear ?? "Clear",
            ascending: t.table_sort_ascending ?? "Asc",
            descending: t.table_sort_descending ?? "Desc",
            emptyHint: t.common_sort,
            moveUp: t.table_sort_move_up ?? "Move up",
            moveDown: t.table_sort_move_down ?? "Move down",
            remove: t.table_sort_remove ?? "Remove",
          }}
        />

        <ColumnVisibilityMenu
          columns={columns}
          hiddenColumns={hiddenColumns}
          onChange={onHiddenColumnsChange}
          defaultHidden={defaultHiddenColumns}
          frozenColumns={frozenColumns}
          onFrozenColumnsChange={onFrozenColumnsChange}
          defaultFrozen={defaultFrozenColumns}
          maxFrozenColumns={maxFrozenColumns}
          groupLabels={groupLabels}
          buttonLabel={t.table_columns ?? "Columns"}
          searchPlaceholder={t.table_columns_search ?? "Search columns"}
          resetLabel={t.common_reset}
          showAllLabel={t.table_columns_show_all ?? "Show all"}
          hideAllLabel={t.table_columns_hide_all ?? "Hide all"}
          noMatchLabel={t.table_filter_no_fields ?? "No match"}
          requiredNoteLabel={t.table_columns_required ?? "required"}
          freezeLabel={t.table_columns_freeze ?? "Freeze"}
          unfreezeLabel={t.table_columns_unfreeze ?? "Unfreeze"}
          frozenNoteLabel={t.table_columns_frozen ?? "frozen"}
        />

        <DensityToggle
          value={density}
          onChange={onDensityChange}
          ariaLabel={t.table_density ?? "Row density"}
          labels={{
            comfortable: t.table_density_comfortable ?? "Comfortable",
            compact: t.table_density_compact ?? "Compact",
            condensed: t.table_density_condensed ?? "Condensed",
          }}
        />
      </div>
    </div>
  );
}
