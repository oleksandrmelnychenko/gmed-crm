import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, GripVertical, Plus, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { MAX_SORT_STACK } from "./sort-logic";
import type { ColumnDef, SortDir, SortKey, SortStack } from "./types";
import { useOutsideClose } from "./use-outside-close";

export type SortBuilderTranslations = {
  buttonLabel?: string;
  addSort?: string;
  clearAll?: string;
  ascending?: string;
  descending?: string;
  emptyHint?: string;
  moveUp?: string;
  moveDown?: string;
  remove?: string;
};

export type SortBuilderProps<T> = {
  columns: readonly ColumnDef<T>[];
  value: SortStack;
  onChange: (next: SortStack) => void;
  translations?: SortBuilderTranslations;
  className?: string;
};

export function SortBuilder<T>({
  columns,
  value,
  onChange,
  translations,
  className,
}: SortBuilderProps<T>) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(menuRef, () => setOpen(false), { enabled: open });

  const sortable = useMemo(() => columns.filter((c) => c.sortable), [columns]);

  const activeSummary = useMemo(() => {
    if (value.length === 0) return translations?.emptyHint ?? "Sort";
    const first = value[0];
    const firstCol = columns.find((c) => c.id === first.field);
    const firstLabel = firstCol?.label ?? first.field;
    const extra = value.length > 1 ? ` +${value.length - 1}` : "";
    return `${firstLabel} ${first.dir === "asc" ? "↑" : "↓"}${extra}`;
  }, [value, columns, translations?.emptyHint]);

  const availableForIndex = (index: number): ColumnDef<T>[] => {
    const usedOthers = new Set(value.filter((_, i) => i !== index).map((s) => s.field));
    return sortable.filter((c) => !usedOthers.has(c.id));
  };

  const updateAt = (index: number, patch: Partial<SortKey>) => {
    const next = value.slice();
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = value.slice();
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  };

  const moveDown = (index: number) => {
    if (index === value.length - 1) return;
    const next = value.slice();
    [next[index + 1], next[index]] = [next[index], next[index + 1]];
    onChange(next);
  };

  const addSort = () => {
    const used = new Set(value.map((s) => s.field));
    const firstAvailable = sortable.find((c) => !used.has(c.id));
    if (!firstAvailable) return;
    onChange([...value, { field: firstAvailable.id, dir: "asc" }]);
  };

  const clearAll = () => onChange([]);

  return (
    <div ref={menuRef} className={cn("relative inline-block", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <ArrowUpDown className="size-3.5" />
        <span className="tabular-nums">{activeSummary}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </Button>
      {open ? (
        <div
          role="menu"
          data-table-sort-menu
          className="absolute left-0 z-[90] mt-1 flex w-96 max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          {value.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {translations?.emptyHint ?? "No sort applied."}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {value.map((key, index) => (
                <SortRow
                  key={`${key.field}-${index}`}
                  sortKey={key}
                  columns={availableForIndex(index)}
                  canMoveUp={index > 0}
                  canMoveDown={index < value.length - 1}
                  onUpdate={(patch) => updateAt(index, patch)}
                  onRemove={() => removeAt(index)}
                  onMoveUp={() => moveUp(index)}
                  onMoveDown={() => moveDown(index)}
                  translations={translations}
                />
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center justify-between gap-1 border-t border-border pt-1.5">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={value.length >= MAX_SORT_STACK || sortable.length <= value.length}
              onClick={addSort}
            >
              <Plus className="size-3" />
              <span>{translations?.addSort ?? "Add sort"}</span>
            </Button>
            {value.length > 0 ? (
              <Button type="button" variant="ghost" size="xs" onClick={clearAll}>
                {translations?.clearAll ?? "Clear"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type SortRowProps<T> = {
  sortKey: SortKey;
  columns: readonly ColumnDef<T>[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onUpdate: (patch: Partial<SortKey>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  translations?: SortBuilderTranslations;
};

function SortRow<T>({
  sortKey,
  columns,
  canMoveUp,
  canMoveDown,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  translations,
}: SortRowProps<T>) {
  const dirLabel = sortKey.dir === "asc"
    ? translations?.ascending ?? "Asc"
    : translations?.descending ?? "Desc";

  const toggleDir = () => {
    const next: SortDir = sortKey.dir === "asc" ? "desc" : "asc";
    onUpdate({ dir: next });
  };

  return (
    <div className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-muted/50">
      <div className="flex flex-col">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label={translations?.moveUp ?? "Move up"}
          className="flex h-3 w-5 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <GripVertical className="size-3 rotate-90" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label={translations?.moveDown ?? "Move down"}
          className="flex h-3 w-5 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <GripVertical className="size-3 rotate-90" />
        </button>
      </div>
      <select
        value={sortKey.field}
        onChange={(e) => onUpdate({ field: e.target.value })}
        className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
      >
        <option value={sortKey.field}>
          {columns.find((c) => c.id === sortKey.field)?.label ?? sortKey.field}
        </option>
        {columns
          .filter((c) => c.id !== sortKey.field)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
      </select>
      <button
        type="button"
        onClick={toggleDir}
        aria-label={dirLabel}
        title={dirLabel}
        className="inline-flex h-7 w-10 items-center justify-center gap-0.5 rounded-md border border-input bg-background text-xs hover:bg-muted"
      >
        {sortKey.dir === "asc" ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={translations?.remove ?? "Remove"}
        title={translations?.remove ?? "Remove"}
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
