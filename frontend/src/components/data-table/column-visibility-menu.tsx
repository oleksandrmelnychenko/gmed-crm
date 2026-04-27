import { Check, ChevronDown, Columns3, Pin, PinOff, RotateCcw, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { ColumnDef } from "./types";
import { useOutsideClose } from "./use-outside-close";

export type ColumnVisibilityMenuProps<T> = {
  columns: readonly ColumnDef<T>[];
  hiddenColumns: readonly string[];
  onChange: (hidden: string[]) => void;
  defaultHidden?: readonly string[];
  frozenColumns?: readonly string[];
  onFrozenColumnsChange?: (frozen: string[]) => void;
  defaultFrozen?: readonly string[];
  maxFrozenColumns?: number;
  groupLabels?: Record<string, string>;
  buttonLabel?: string;
  searchPlaceholder?: string;
  resetLabel?: string;
  showAllLabel?: string;
  hideAllLabel?: string;
  noMatchLabel?: string;
  requiredNoteLabel?: string;
  freezeLabel?: string;
  unfreezeLabel?: string;
  frozenNoteLabel?: string;
  className?: string;
};

export function ColumnVisibilityMenu<T>({
  columns,
  hiddenColumns,
  onChange,
  defaultHidden = [],
  frozenColumns = [],
  onFrozenColumnsChange,
  defaultFrozen = [],
  maxFrozenColumns = 4,
  groupLabels = {},
  buttonLabel = "Columns",
  searchPlaceholder = "Search columns",
  resetLabel = "Reset",
  showAllLabel = "Show all",
  hideAllLabel = "Hide all",
  noMatchLabel = "No match",
  requiredNoteLabel = "required",
  freezeLabel = "Freeze",
  unfreezeLabel = "Unfreeze",
  frozenNoteLabel = "frozen",
  className,
}: ColumnVisibilityMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(menuRef, () => setOpen(false), { enabled: open });

  const totalVisible = columns.filter((c) => !hiddenColumns.includes(c.id)).length;
  const totalCols = columns.length;
  const frozenSet = useMemo(() => new Set(frozenColumns), [frozenColumns]);
  const totalFrozen = frozenColumns.filter((id) => columns.some((column) => column.id === id)).length;

  const grouped = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filteredCols = query
      ? columns.filter(
          (c) =>
            c.label.toLowerCase().includes(query) ||
            c.id.toLowerCase().includes(query),
        )
      : columns;
    const groups = new Map<string, ColumnDef<T>[]>();
    for (const col of filteredCols) {
      const key = col.group ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(col);
    }
    return Array.from(groups.entries());
  }, [columns, search]);

  const toggle = (col: ColumnDef<T>) => {
    if (col.required) return;
    const isHidden = hiddenColumns.includes(col.id);
    const next = isHidden
      ? hiddenColumns.filter((id) => id !== col.id)
      : [...hiddenColumns, col.id];
    onChange(next);
    if (!isHidden && frozenSet.has(col.id)) {
      onFrozenColumnsChange?.(frozenColumns.filter((id) => id !== col.id));
    }
  };

  const toggleFrozen = (col: ColumnDef<T>) => {
    if (!onFrozenColumnsChange) return;
    if (frozenSet.has(col.id)) {
      onFrozenColumnsChange(frozenColumns.filter((id) => id !== col.id));
      return;
    }
    if (frozenColumns.length >= maxFrozenColumns) return;
    onFrozenColumnsChange([...frozenColumns, col.id]);
  };

  const showAll = () => {
    const requiredHidden = hiddenColumns.filter((id) =>
      columns.find((c) => c.id === id)?.required,
    );
    onChange(requiredHidden);
  };
  const hideAll = () => {
    const nextHidden = columns.filter((c) => !c.required).map((c) => c.id);
    onChange(nextHidden);
    if (onFrozenColumnsChange) {
      const requiredIds = new Set(columns.filter((c) => c.required).map((c) => c.id));
      onFrozenColumnsChange(frozenColumns.filter((id) => requiredIds.has(id)));
    }
  };
  const resetToDefault = () => {
    onChange(defaultHidden.slice());
    onFrozenColumnsChange?.(defaultFrozen.slice());
  };

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
        <Columns3 className="size-3.5" />
        <span>
          {buttonLabel} <span className="tabular-nums text-muted-foreground">({totalVisible} / {totalCols})</span>
        </span>
        {onFrozenColumnsChange ? (
          <span className="inline-flex items-center gap-0.5 text-muted-foreground">
            <Pin className="size-3" />
            <span className="tabular-nums">{totalFrozen}</span>
          </span>
        ) : null}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 flex w-80 flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
        >
          <div className="flex items-center gap-2 border-b border-border p-2">
            <Search className="size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-7 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {grouped.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">{noMatchLabel}</div>
            ) : (
              grouped.map(([groupKey, cols]) => (
                <div key={groupKey || "default"} className="mb-2 last:mb-0">
                  {groupKey ? (
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {groupLabels[groupKey] ?? groupKey}
                    </div>
                  ) : null}
                  {cols.map((col) => {
                    const isHidden = hiddenColumns.includes(col.id);
                    const isVisible = !isHidden;
                    const isFrozen = frozenSet.has(col.id);
                    const freezeDisabled =
                      !onFrozenColumnsChange ||
                      (isHidden && !isFrozen) ||
                      (!isFrozen && frozenColumns.length >= maxFrozenColumns);
                    const freezeTitle = isFrozen
                      ? `${unfreezeLabel} ${col.label}`
                      : `${freezeLabel} ${col.label}`;
                    return (
                      <div
                        key={col.id}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                          "hover:bg-muted focus-within:bg-muted",
                        )}
                      >
                        <button
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={isVisible}
                          disabled={col.required}
                          onClick={() => toggle(col)}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none",
                            col.required && "cursor-not-allowed opacity-60",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded border border-border",
                              isVisible && "border-primary bg-primary text-primary-foreground",
                            )}
                          >
                            {isVisible ? <Check className="size-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{col.label}</span>
                          {col.required ? (
                            <span className="text-[10px] uppercase text-muted-foreground">{requiredNoteLabel}</span>
                          ) : null}
                          {isFrozen ? (
                            <span className="text-[10px] uppercase text-muted-foreground">{frozenNoteLabel}</span>
                          ) : null}
                        </button>
                        {onFrozenColumnsChange ? (
                          <button
                            type="button"
                            aria-label={freezeTitle}
                            title={freezeTitle}
                            disabled={freezeDisabled}
                            onClick={() => toggleFrozen(col)}
                            className={cn(
                              "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground",
                              "hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                              isFrozen && "bg-primary/10 text-primary",
                              freezeDisabled && "pointer-events-none opacity-40",
                            )}
                          >
                            {isFrozen ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div className="flex items-center justify-between gap-1 border-t border-border p-1.5">
            <Button type="button" variant="ghost" size="xs" onClick={resetToDefault} title={resetLabel}>
              <RotateCcw className="size-3" />
              <span>{resetLabel}</span>
            </Button>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="xs" onClick={showAll}>
                {showAllLabel}
              </Button>
              <Button type="button" variant="ghost" size="xs" onClick={hideAll}>
                {hideAllLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
