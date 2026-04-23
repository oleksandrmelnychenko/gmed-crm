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
  groupLabels: Record<string, string>;
  hiddenColumns: string[];
  lastUpdatedText: string | null;
  listBusy: boolean;
  onActiveFilterChange: (value: string) => void;
  onClearAll: () => void;
  onDensityChange: (value: DensityLevel) => void;
  onDoctorFilterChange: (value: string) => void;
  onExport: () => void;
  onFiltersChange: (value: FilterPredicate[]) => void;
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
  defaultHiddenColumns,
  deferredSearchPlaceholder,
  density,
  doctors,
  exportLabel,
  filterPredicates,
  filters,
  groupLabels,
  hiddenColumns,
  lastUpdatedText,
  listBusy,
  onActiveFilterChange,
  onClearAll,
  onDensityChange,
  onDoctorFilterChange,
  onExport,
  onFiltersChange,
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
  return (
    <div className="flex flex-wrap items-center gap-1.5">
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
          className="h-8 w-[280px] rounded-lg bg-card pl-8 text-[13px]"
        />
      </div>

      <FilterBuilder
        columns={columns}
        rows={rows}
        filters={filterPredicates}
        onChange={onFiltersChange}
      />

      <SortBuilder columns={columns} value={sortStack} onChange={onSortChange} />

      <ColumnVisibilityMenu
        columns={columns}
        hiddenColumns={hiddenColumns}
        onChange={onHiddenColumnsChange}
        defaultHidden={defaultHiddenColumns}
        groupLabels={groupLabels}
      />

      <DensityToggle value={density} onChange={onDensityChange} />

      <ShadSelect value={filters.providerId} onValueChange={(value) => onProviderFilterChange(value ?? "")}>
        <SelectTrigger size="sm" className="h-8 w-[220px] bg-card text-[13px]">
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
        <SelectTrigger size="sm" className="h-8 w-[200px] bg-card text-[13px]">
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
        <SelectTrigger size="sm" className="h-8 bg-card text-[13px]">
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
  );
}
