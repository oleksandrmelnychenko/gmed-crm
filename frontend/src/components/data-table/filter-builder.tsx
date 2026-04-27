import { ChevronDown, Plus, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { FilterValueInput } from "./filter-value-input";
import {
  OPERATORS_BY_FIELD_TYPE,
  defaultOperatorForFieldType,
  defaultValueForOperator,
  labelForOperator,
  operatorTakesValue,
  type FilterOperatorLabels,
} from "./filter-operator-meta";
import type {
  ColumnDef,
  FilterFieldType,
  FilterOperator,
  FilterOption,
  FilterPredicate,
  FilterValue,
} from "./types";
import { useOutsideClose } from "./use-outside-close";

function generatePredicateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function resolveOptions<T>(
  column: ColumnDef<T>,
  rows: readonly T[],
): FilterOption[] {
  if (!column.filterOptions) return [];
  if (typeof column.filterOptions === "function") return column.filterOptions(rows);
  return column.filterOptions.slice();
}

function valueSummary(
  predicate: FilterPredicate,
  options: readonly FilterOption[],
): string {
  const { operator, value } = predicate;
  if (!operatorTakesValue(operator)) return "";
  if (operator === "between") {
    const range = (value ?? {}) as { from?: string; to?: string };
    if (range.from && range.to) return `${range.from} → ${range.to}`;
    if (range.from) return `after ${range.from}`;
    if (range.to) return `before ${range.to}`;
    return "—";
  }
  if (operator === "last_n_days") {
    const days = typeof value === "object" && value && "days" in value
      ? (value as { days: number }).days
      : 0;
    return `${days}d`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    const labels = value.map((v) => options.find((o) => o.value === v)?.label ?? v);
    if (labels.length <= 2) return labels.join(", ");
    return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value == null || value === "") return "—";
  const opt = options.find((o) => o.value === String(value));
  return opt?.label ?? String(value);
}

export type FilterBuilderTranslations = {
  addFilter?: string;
  clearAll?: string;
  searchPlaceholder?: string;
  noFields?: string;
  remove?: string;
  valuePlaceholder?: string;
  yes?: string;
  no?: string;
  operatorLabels?: FilterOperatorLabels;
};

export type FilterBuilderProps<T> = {
  columns: readonly ColumnDef<T>[];
  rows: readonly T[];
  filters: readonly FilterPredicate[];
  onChange: (next: FilterPredicate[]) => void;
  translations?: FilterBuilderTranslations;
  className?: string;
};

export function FilterBuilder<T>({
  columns,
  rows,
  filters,
  onChange,
  translations,
  className,
}: FilterBuilderProps<T>) {
  const addFilter = translations?.addFilter ?? "Filter";
  const clearAll = translations?.clearAll ?? "Clear all";

  const filterable = useMemo(
    () => columns.filter((c) => Boolean(c.filterType)),
    [columns],
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(pickerRef, () => setPickerOpen(false), { enabled: pickerOpen });

  const [editing, setEditing] = useState<string | null>(null);

  const handleAdd = (column: ColumnDef<T>) => {
    const type: FilterFieldType = column.filterType ?? "text";
    const operator = defaultOperatorForFieldType(type);
    const newPredicate: FilterPredicate = {
      id: generatePredicateId(),
      field: column.id,
      operator,
      value: defaultValueForOperator(operator, type),
    };
    onChange([...filters, newPredicate]);
    setPickerOpen(false);
    setPickerQuery("");
    setEditing(newPredicate.id);
  };

  const handleUpdate = (id: string, patch: Partial<FilterPredicate>) => {
    onChange(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const handleRemove = (id: string) => {
    onChange(filters.filter((f) => f.id !== id));
    if (editing === id) setEditing(null);
  };

  const handleClearAll = () => {
    onChange([]);
    setEditing(null);
  };

  const pickerOptions = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const base = filterable.filter((c) => !filters.some((f) => f.field === c.id));
    if (!q) return base;
    return base.filter(
      (c) => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
    );
  }, [filterable, filters, pickerQuery]);

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {filters.map((predicate) => {
        const column = columns.find((c) => c.id === predicate.field);
        if (!column) return null;
        return (
          <FilterChip
            key={predicate.id}
            column={column}
            rows={rows}
            predicate={predicate}
            isEditing={editing === predicate.id}
            onToggleEdit={() => setEditing(editing === predicate.id ? null : predicate.id)}
            onUpdate={(patch) => handleUpdate(predicate.id, patch)}
            onRemove={() => handleRemove(predicate.id)}
            onClose={() => setEditing(null)}
            translations={translations}
          />
        );
      })}
      <div ref={pickerRef} className="relative">
        <Button
          type="button"
          variant="outline"
          size="xs"
          aria-expanded={pickerOpen}
          aria-haspopup="menu"
          onClick={() => setPickerOpen((v) => !v)}
        >
          <Plus className="size-3" />
          <span>{addFilter}</span>
        </Button>
        {pickerOpen ? (
          <div
            role="menu"
            data-table-filter-picker
            className="absolute left-0 z-[80] mt-1 flex w-64 flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
          >
            <div className="flex items-center gap-1.5 border-b border-border p-2">
              <Search className="size-3.5 text-muted-foreground" />
              <Input
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder={translations?.searchPlaceholder ?? "Search fields"}
                className="h-6 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {pickerOptions.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {translations?.noFields ?? "No available fields"}
                </div>
              ) : (
                pickerOptions.map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    role="menuitem"
                    onClick={() => handleAdd(col)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    <span className="truncate">{col.label}</span>
                    {col.group ? (
                      <span className="ml-auto text-[10px] uppercase text-muted-foreground">{col.group}</span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
      {filters.length > 0 ? (
        <Button type="button" variant="ghost" size="xs" onClick={handleClearAll}>
          {clearAll}
        </Button>
      ) : null}
    </div>
  );
}

type ChipProps<T> = {
  column: ColumnDef<T>;
  rows: readonly T[];
  predicate: FilterPredicate;
  isEditing: boolean;
  onToggleEdit: () => void;
  onUpdate: (patch: Partial<FilterPredicate>) => void;
  onRemove: () => void;
  onClose: () => void;
  translations?: FilterBuilderTranslations;
};

function FilterChip<T>({
  column,
  rows,
  predicate,
  isEditing,
  onToggleEdit,
  onUpdate,
  onRemove,
  onClose,
  translations,
}: ChipProps<T>) {
  const chipRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(chipRef, onClose, { enabled: isEditing });

  const options = resolveOptions(column, rows);
  const operators = OPERATORS_BY_FIELD_TYPE[column.filterType ?? "text"];
  const opLabel = labelForOperator(predicate.operator, translations?.operatorLabels);
  const valSummary = valueSummary(predicate, options);

  const changeOperator = (next: FilterOperator) => {
    onUpdate({
      operator: next,
      value: defaultValueForOperator(next, column.filterType ?? "text"),
    });
  };

  const changeValue = (value: FilterValue) => {
    onUpdate({ value });
  };

  return (
    <div
      ref={chipRef}
      data-filter-field={predicate.field}
      className={cn("relative", isEditing && "z-[90]")}
    >
      <div
        className={cn(
          "inline-flex items-center overflow-hidden rounded-md border border-border bg-muted text-xs",
          isEditing && "ring-2 ring-ring/40",
        )}
      >
        <button
          type="button"
          onClick={onToggleEdit}
          className="flex items-center gap-1 px-2 py-1 hover:bg-muted-foreground/10"
          aria-expanded={isEditing}
        >
          <span className="font-medium">{column.label}</span>
          <span className="text-muted-foreground">{opLabel}</span>
          {valSummary ? <span className="font-medium">{valSummary}</span> : null}
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={translations?.remove ?? "Remove filter"}
          title={translations?.remove ?? "Remove filter"}
          className="flex h-full items-center border-l border-border px-1.5 text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
      {isEditing ? (
        <div
          data-table-filter-editor
          className="absolute left-0 top-full z-[90] mt-1 flex items-center gap-1.5 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          <select
            value={predicate.operator}
            onChange={(e) => changeOperator(e.target.value as FilterOperator)}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          >
            {operators.map((op) => (
              <option key={op} value={op}>
                {labelForOperator(op, translations?.operatorLabels)}
              </option>
            ))}
          </select>
          <FilterValueInput
            column={column}
            rows={rows}
            operator={predicate.operator}
            value={predicate.value}
            onChange={changeValue}
            translations={{
              clear: translations?.clearAll,
              noMatch: translations?.noFields,
              searchPlaceholder: translations?.searchPlaceholder,
              valuePlaceholder: translations?.valuePlaceholder,
              yes: translations?.yes,
              no: translations?.no,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
