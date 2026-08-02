import type { RefObject } from "react";
import { Info, Search, X } from "lucide-react";

import { ColumnVisibilityMenu } from "@/components/data-table/column-visibility-menu";
import { FilterBuilder } from "@/components/data-table/filter-builder";
import { SortBuilder } from "@/components/data-table/sort-builder";
import type {
  ColumnDef,
  FilterPredicate,
  SortStack,
} from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { ToolbarField } from "@/components/data-table/toolbar-field";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";
import { ProviderSelectWithTaxonomyFilter } from "@/pages/providers/ui/provider-select-with-taxonomy-filter";

import type { PatientSummary } from "../../model/list-model";
import { getPatientInsuranceLabel } from "../../model/list-formatters";

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
  canFilterLifecycle: boolean;
  columns: ColumnDef<PatientSummary>[];
  defaultFrozenColumns: string[];
  defaultHiddenColumns: string[];
  deferredSearchPlaceholder: string;
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
  maxFrozenColumns: number;
  onActiveFilterChange: (value: string) => void;
  onClearAll: () => void;
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
  canFilterLifecycle,
  columns,
  defaultFrozenColumns,
  defaultHiddenColumns,
  deferredSearchPlaceholder,
  doctors,
  filterPredicates,
  filters,
  frozenColumns,
  groupLabels,
  hiddenColumns,
  insuranceOptions,
  maxFrozenColumns,
  onActiveFilterChange,
  onClearAll,
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
    <div className="relative z-30 border-b border-border/70 bg-card px-3 py-2">
      <div className="flex flex-nowrap items-end gap-1.5 overflow-x-auto">
        <ToolbarField label={t.common_search} className="min-w-[170px] flex-1 sm:max-w-[220px]">
        <div className="relative">
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
            className="h-8 w-full rounded-md bg-field pl-8 text-xs"
          />
        </div>
        </ToolbarField>

        <ToolbarField label={`${t.common_provider} / ${t.providers_category}`}>
        <ProviderSelectWithTaxonomyFilter
          value={filters.providerId}
          providers={providers}
          taxonomyNodes={taxonomyNodes}
          providerPlaceholder={t.providers_all}
          taxonomyPlaceholder={t.providers_category}
          taxonomyAllLabel={t.providers_all}
          containerClassName="grid w-[320px] shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5"
          taxonomySelectClassName="h-8 min-w-0 rounded-md bg-field text-xs"
          providerSelectClassName="h-8 min-w-0 rounded-md bg-field text-xs"
          providerLabel={(provider) =>
            provider.address_city ? `${provider.name} - ${provider.address_city}` : provider.name
          }
          onChange={onProviderFilterChange}
        />
        </ToolbarField>

        <ToolbarField label={t.orders_filter_doctor}>
        <NativeComboboxSelect
          value={filters.doctorId}

          disabled={!filters.providerId}

          onChange={(event) => onDoctorFilterChange(event.target.value ?? "")} className="h-8 w-[150px] shrink-0 rounded-md bg-field text-xs">
            <option value="">{t.providers_all}</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.title ? `${doctor.title} ` : ""}{doctor.name}
              </option>
            ))}
          </NativeComboboxSelect>
        </ToolbarField>

        <ToolbarField label={t.users_status}>
        <NativeComboboxSelect value={filters.activeOnly}
          onChange={(event) => onActiveFilterChange(event.target.value ?? "")} className="h-8 w-[140px] shrink-0 rounded-md bg-field text-xs">
            <option value="">{t.providers_all}</option>
            <option value="true">{t.common_active}</option>
            <option value="false">{t.common_inactive}</option>
            {canFilterLifecycle ? (
              <option value="prospective">{t.patients_lifecycle_prospective}</option>
            ) : null}
          </NativeComboboxSelect>
        </ToolbarField>

        {insuranceOptions.length > 0 ? (
          <ToolbarField label={t.patients_insurance_type}>
          <NativeComboboxSelect
            value={filters.insuranceProvider}
            onChange={(event) => onInsuranceFilterChange(event.target.value ?? "")}
            className="h-8 w-[170px] shrink-0 rounded-md bg-field text-xs"
          >
            <option value="">{t.patients_insurance_type}</option>
            {insuranceOptions.map((type) => (
              <option key={type} value={type}>
                {getPatientInsuranceLabel(type, t)}
              </option>
            ))}
          </NativeComboboxSelect>
          </ToolbarField>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1">
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
        </div>
      </div>
    </div>
  );
}
