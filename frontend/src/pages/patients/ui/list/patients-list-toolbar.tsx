import type { RefObject } from "react";
import { Info, Search, X } from "lucide-react";

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
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";
import { ProviderSelectWithTaxonomyFilter } from "@/pages/providers/ui/provider-select-with-taxonomy-filter";

import type { PatientSummary } from "../../model/list-model";

type ProviderOption = {
  id: string;
  name: string;
  address_city?: string | null;
  provider_type?: string | null;
  taxonomy_node_id?: string | null;
  taxonomy_node_ids?: string[];
  taxonomy_path?: Array<{ id?: string | null }>;
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
  filterPredicates: FilterPredicate[];
  filters: {
    activeOnly: string;
    doctorId: string;
    providerId: string;
    search: string;
    insuranceProvider: string;
  };
  frozenColumns: string[];
  groupLabels: Record<string, string>;
  hiddenColumns: string[];
  insuranceOptions: string[];
  lastUpdatedText: string | null;
  maxFrozenColumns: number;
  onActiveFilterChange: (value: string) => void;
  onClearAll: () => void;
  onDensityChange: (value: DensityLevel) => void;
  onDoctorFilterChange: (value: string) => void;
  onFiltersChange: (value: FilterPredicate[]) => void;
  onFrozenColumnsChange: (value: string[]) => void;
  onHiddenColumnsChange: (value: string[]) => void;
  onInsuranceFilterChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSearchEscape: (input: HTMLInputElement) => void;
  onShortcutsOpen: () => void;
  onSortChange: (value: SortStack) => void;
  providers: ProviderOption[];
  rows: PatientSummary[];
  searchInputRef: RefObject<HTMLInputElement | null>;
  sortStack: SortStack;
  taxonomyNodes: ProviderTaxonomyNode[];
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
  filterPredicates,
  filters,
  frozenColumns,
  groupLabels,
  hiddenColumns,
  insuranceOptions,
  lastUpdatedText,
  maxFrozenColumns,
  onActiveFilterChange,
  onClearAll,
  onDensityChange,
  onDoctorFilterChange,
  onFiltersChange,
  onFrozenColumnsChange,
  onHiddenColumnsChange,
  onInsuranceFilterChange,
  onProviderFilterChange,
  onSearchChange,
  onSearchEscape,
  onShortcutsOpen,
  onSortChange,
  providers,
  rows,
  searchInputRef,
  sortStack,
  taxonomyNodes,
  t,
}: PatientsListToolbarProps) {
  const operatorLabels = {
    contains: t.filter_op_contains,
    does_not_contain: t.filter_op_does_not_contain,
    is_empty: t.filter_op_is_empty,
    is_not_empty: t.filter_op_is_not_empty,
    is: t.filter_op_is,
    is_not: t.filter_op_is_not,
    is_any_of: t.filter_op_is_any_of,
    is_none_of: t.filter_op_is_none_of,
    has_any: t.filter_op_has_any,
    has_all: t.filter_op_has_all,
    has_none: t.filter_op_has_none,
    before: t.filter_op_before,
    after: t.filter_op_after,
    between: t.filter_op_between,
    last_n_days: t.filter_op_last_n_days,
    equals: t.filter_op_equals,
  };

  return (
    <div className="relative z-30 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative min-w-[170px] flex-1 sm:max-w-[220px]">
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

        <ProviderSelectWithTaxonomyFilter
          value={filters.providerId}
          providers={providers}
          taxonomyNodes={taxonomyNodes}
          providerPlaceholder={t.providers_all}
          taxonomyPlaceholder={t.providers_category}
          taxonomyAllLabel={t.providers_all}
          containerClassName="sm:grid-cols-[160px_160px]"
          taxonomySelectClassName="h-8 bg-background text-[13px]"
          providerSelectClassName="h-8 bg-background text-[13px]"
          providerLabel={(provider) =>
            provider.address_city ? `${provider.name} - ${provider.address_city}` : provider.name
          }
          onChange={onProviderFilterChange}
        />

        <NativeComboboxSelect
          value={filters.doctorId}

          disabled={!filters.providerId}

          onChange={(event) => onDoctorFilterChange(event.target.value ?? "")} className="h-8 w-[150px] bg-background text-[13px]">
            <option value="">{t.providers_all}</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.title ? `${doctor.title} ` : ""}{doctor.name}
              </option>
            ))}
          </NativeComboboxSelect>

        <NativeComboboxSelect value={filters.activeOnly}
          onChange={(event) => onActiveFilterChange(event.target.value ?? "")} className="h-8 w-[140px] bg-background text-[13px]">
            <option value="">{t.providers_all}</option>
            <option value="true">{t.common_active}</option>
            <option value="false">{t.common_inactive}</option>
          </NativeComboboxSelect>

        {insuranceOptions.length > 0 ? (
          <NativeComboboxSelect
            value={filters.insuranceProvider}
            onChange={(event) => onInsuranceFilterChange(event.target.value ?? "")}
            className="h-8 w-[170px] bg-background text-[13px]"
          >
            <option value="">{t.patients_insurance_provider}</option>
            {insuranceOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </NativeComboboxSelect>
        ) : null}

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
            title={t.patients_shortcuts_title}
            aria-label={t.patients_shortcuts_title}
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
            addFilter: t.table_filter,
            clearAll: t.table_sort_clear,
            searchPlaceholder: t.table_filter_search_fields ?? t.common_search,
            noFields: t.table_filter_no_fields,
            remove: t.table_filter_remove,
            valuePlaceholder: t.table_filter_value,
            yes: t.common_yes,
            no: t.common_no,
            operatorLabels,
          }}
        />

        <SortBuilder
          columns={columns}
          value={sortStack}
          onChange={onSortChange}
          translations={{
            addSort: t.table_sort_add,
            clearAll: t.table_sort_clear,
            ascending: t.table_sort_ascending,
            descending: t.table_sort_descending,
            emptyHint: t.common_sort,
            moveUp: t.table_sort_move_up,
            moveDown: t.table_sort_move_down,
            remove: t.table_sort_remove,
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
          buttonLabel={t.table_columns}
          searchPlaceholder={t.table_columns_search}
          resetLabel={t.common_reset}
          showAllLabel={t.table_columns_show_all}
          hideAllLabel={t.table_columns_hide_all}
          noMatchLabel={t.table_filter_no_fields}
          requiredNoteLabel={t.table_columns_required}
          freezeLabel={t.table_columns_freeze}
          unfreezeLabel={t.table_columns_unfreeze}
          frozenNoteLabel={t.table_columns_frozen}
        />

        <DensityToggle
          value={density}
          onChange={onDensityChange}
          ariaLabel={t.table_density}
          labels={{
            comfortable: t.table_density_comfortable,
            compact: t.table_density_compact,
            condensed: t.table_density_condensed,
          }}
        />
      </div>
    </div>
  );
}
