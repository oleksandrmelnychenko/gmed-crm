import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Check, X } from "lucide-react";
import { useMemo, useState, type ChangeEvent } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  operatorExpectsArray,
  operatorExpectsDateRange,
  operatorExpectsDays,
  operatorExpectsSingleDate,
  operatorTakesValue,
} from "./filter-operator-meta";
import type {
  ColumnDef,
  FilterFieldType,
  FilterOperator,
  FilterOption,
  FilterValue,
} from "./types";

type Props<T> = {
  column: ColumnDef<T>;
  rows: readonly T[];
  operator: FilterOperator;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
  translations?: FilterValueInputTranslations;
};

type FilterValueInputTranslations = {
  clear?: string;
  no?: string;
  noMatch?: string;
  searchPlaceholder?: string;
  valuePlaceholder?: string;
  yes?: string;
};

function resolveOptions<T>(column: ColumnDef<T>, rows: readonly T[]): FilterOption[] {
  if (!column.filterOptions) return [];
  if (typeof column.filterOptions === "function") return column.filterOptions(rows);
  return column.filterOptions.slice();
}

export function FilterValueInput<T>({
  column,
  rows,
  operator,
  value,
  onChange,
  translations,
}: Props<T>) {
  if (!operatorTakesValue(operator)) return null;

  const fieldType: FilterFieldType = column.filterType ?? "text";

  if (operatorExpectsDateRange(operator)) {
    const range = (value ?? {}) as { from?: string; to?: string };
    return (
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          value={range.from ?? ""}
          onChange={(e) => onChange({ ...range, from: e.target.value || undefined })}
          className="h-7 w-32 text-xs"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <Input
          type="date"
          value={range.to ?? ""}
          onChange={(e) => onChange({ ...range, to: e.target.value || undefined })}
          className="h-7 w-32 text-xs"
        />
      </div>
    );
  }

  if (operatorExpectsDays(operator)) {
    const days = typeof value === "object" && value && "days" in value
      ? (value as { days: number }).days
      : 0;
    return (
      <Input
        type="number"
        min={1}
        value={days || ""}
        onChange={(e) => onChange({ days: Number(e.target.value) || 0 })}
        className="h-7 w-20 text-xs"
      />
    );
  }

  if (operatorExpectsSingleDate(operator) && fieldType === "date") {
    return (
      <Input
        type="date"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-32 text-xs"
      />
    );
  }

  if (operatorExpectsArray(operator)) {
    const options = resolveOptions(column, rows);
    const selected = Array.isArray(value) ? value : [];
    return (
      <MultiSelect
        options={options}
        selected={selected}
        onChange={(next) => onChange(next)}
        translations={translations}
      />
    );
  }

  if (fieldType === "enum" && (operator === "is" || operator === "is_not")) {
    const options = resolveOptions(column, rows);
    const selected = typeof value === "string" ? value : "";
    return (
      <NativeComboboxSelect
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
      >
        <option value="">—</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </NativeComboboxSelect>
    );
  }

  if (fieldType === "boolean") {
    const current = value === true || value === "true";
    return (
      <div className="inline-flex rounded-md border border-input bg-background p-0.5">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={cn(
            "rounded px-2 py-0.5 text-xs",
            current && "bg-muted text-foreground",
            !current && "text-muted-foreground",
          )}
        >
          {translations?.yes ?? "Yes"}
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={cn(
            "rounded px-2 py-0.5 text-xs",
            !current && "bg-muted text-foreground",
            current && "text-muted-foreground",
          )}
        >
          {translations?.no ?? "No"}
        </button>
      </div>
    );
  }

  const onTextChange = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value);
  return (
    <Input
      value={typeof value === "string" ? value : ""}
      onChange={onTextChange}
      className="h-7 w-44 text-xs"
      placeholder={translations?.valuePlaceholder ?? "value"}
    />
  );
}

type MultiSelectProps = {
  options: readonly FilterOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  translations?: FilterValueInputTranslations;
};

function MultiSelect({ options, selected, onChange, translations }: MultiSelectProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter((s) => s !== v));
    else onChange([...selected, v]);
  };

  return (
    <div className="flex flex-col rounded-md border border-input bg-background">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={translations?.searchPlaceholder ?? "search"}
          className="h-6 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
        />
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            title={translations?.clear ?? "Clear"}
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
      <div className="max-h-48 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {translations?.noMatch ?? "No match"}
          </div>
        ) : (
          filtered.map((opt) => {
            const isOn = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded border border-border",
                    isOn && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {isOn ? <Check className="size-3" /> : null}
                </span>
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
