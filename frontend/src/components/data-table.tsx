import { useEffect, useRef, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  type LucideIcon,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Shared data-table toolkit: popovers, pagination, KPI inline stat.
// Used by patients.tsx / providers.tsx / any page with a sortable+filterable table.

export type ColumnFilterKind = "text" | "select" | "daterange" | "none";

export type SortDir = "asc" | "desc";

export function useOutsideClose(
  ref: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", handle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", handle);
      window.removeEventListener("keydown", onKey);
    };
  }, [ref, onClose]);
}

export function PopoverShell({
  children,
  refEl,
}: {
  children: ReactNode;
  refEl: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={refEl}
      onClick={(e) => e.stopPropagation()}
      className="absolute left-0 top-full z-30 mt-1 w-[240px] rounded-lg border border-border bg-popover p-2 shadow-md"
    >
      {children}
    </div>
  );
}

export function PopoverFooter({
  onClear,
  onClose,
  clearDisabled,
  tr,
}: {
  onClear: () => void;
  onClose: () => void;
  clearDisabled: boolean;
  tr: Record<string, string>;
}) {
  return (
    <div className="mt-2 flex items-center justify-between">
      <button
        type="button"
        onClick={onClear}
        disabled={clearDisabled}
        className="text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
      >
        {tr.common_reset}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="text-[12px] text-foreground hover:text-[var(--brand)]"
      >
        {tr.common_confirm}
      </button>
    </div>
  );
}

export function ColumnFilterPopover({
  value,
  onChange,
  onClear,
  onClose,
  placeholder,
  tr,
}: {
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
  onClose: () => void;
  placeholder: string;
  tr: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, onClose);
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="absolute left-0 top-full z-30 mt-1 w-[220px] rounded-lg border border-border bg-popover p-2 shadow-md"
    >
      <Input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-[13px] rounded-md bg-card normal-case tracking-normal"
      />
      <PopoverFooter
        onClear={onClear}
        onClose={onClose}
        clearDisabled={value.trim() === ""}
        tr={tr}
      />
    </div>
  );
}

export function ColumnFilterSelectPopover({
  value,
  onChange,
  onClear,
  onClose,
  options,
  tr,
}: {
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
  onClose: () => void;
  options: { value: string; label: string }[];
  tr: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, onClose);
  return (
    <PopoverShell refEl={ref}>
      <div className="flex flex-col gap-0.5">
        {options.map((opt) => {
          const checked = value === opt.value;
          return (
            <button
              key={opt.value || "__all__"}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex items-center justify-between rounded-md px-2 py-1.5 text-[13px] text-left transition-colors",
                checked
                  ? "bg-[var(--brand-soft)] text-[var(--brand)] font-medium"
                  : "hover:bg-muted",
              )}
            >
              <span>{opt.label}</span>
              {checked ? <span className="text-[var(--brand)]">✓</span> : null}
            </button>
          );
        })}
      </div>
      <PopoverFooter onClear={onClear} onClose={onClose} clearDisabled={value === ""} tr={tr} />
    </PopoverShell>
  );
}

export function ColumnFilterDateRangePopover({
  value,
  onChange,
  onClear,
  onClose,
  tr,
}: {
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
  onClose: () => void;
  tr: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, onClose);
  const [from, to] = value.split("..");
  const update = (nextFrom: string, nextTo: string) => {
    if (!nextFrom && !nextTo) onChange("");
    else onChange(`${nextFrom}..${nextTo}`);
  };
  return (
    <PopoverShell refEl={ref}>
      <div className="flex flex-col gap-2">
        <Input
          type="date"
          value={from ?? ""}
          onChange={(e) => update(e.target.value, to ?? "")}
          className="h-9 text-[13px] rounded-md bg-card"
        />
        <Input
          type="date"
          value={to ?? ""}
          onChange={(e) => update(from ?? "", e.target.value)}
          className="h-9 text-[13px] rounded-md bg-card"
        />
      </div>
      <PopoverFooter onClear={onClear} onClose={onClose} clearDisabled={value === ""} tr={tr} />
    </PopoverShell>
  );
}

export function KpiInlineStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone: "sky" | "emerald" | "amber" | "slate";
}) {
  const toneClass = {
    sky: "bg-sky-100 text-sky-700",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    slate: "bg-slate-100 text-slate-700",
  }[tone];

  return (
    <div className="flex min-w-[170px] items-center gap-3">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-2xl",
          toneClass,
        )}
      >
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0">
        <span className="text-[12px] text-muted-foreground">{label}</span>
        <p className="mt-1 text-[20px] font-semibold tracking-tight text-foreground leading-none">
          {value}
        </p>
      </div>
    </div>
  );
}

function buildPageSequence(current: number, total: number): (number | "…")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i);
  }
  const pages: (number | "…")[] = [];
  const windowSize = 1;
  const first = 0;
  const last = total - 1;

  pages.push(first);
  if (current - windowSize > first + 1) pages.push("…");
  for (
    let i = Math.max(first + 1, current - windowSize);
    i <= Math.min(last - 1, current + windowSize);
    i++
  ) {
    pages.push(i);
  }
  if (current + windowSize < last - 1) pages.push("…");
  pages.push(last);
  return pages;
}

export function PaginationControls({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const { t } = useLang();
  if (totalPages <= 1) return <div />;

  const pageBtnClass =
    "size-7 inline-flex items-center justify-center rounded-md text-[12.5px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none";

  const pagesToShow = buildPageSequence(page, totalPages);

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className={pageBtnClass}
        disabled={page === 0}
        onClick={() => onPage(0)}
        title={t.pagination_first}
      >
        <ChevronsLeft className="size-3.5" />
      </button>
      <button
        type="button"
        className={pageBtnClass}
        disabled={page === 0}
        onClick={() => onPage(Math.max(0, page - 1))}
        title={t.pagination_previous}
      >
        <ChevronLeft className="size-3.5" />
      </button>
      {pagesToShow.map((entry, idx) =>
        entry === "…" ? (
          <span key={`gap-${idx}`} className="px-1 text-muted-foreground">
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            onClick={() => onPage(entry)}
            className={cn(
              "size-7 inline-flex items-center justify-center rounded-md text-[12.5px] transition-colors",
              entry === page
                ? "bg-[var(--brand)] text-white font-medium"
                : "text-foreground hover:bg-muted",
            )}
          >
            {entry + 1}
          </button>
        ),
      )}
      <button
        type="button"
        className={pageBtnClass}
        disabled={page >= totalPages - 1}
        onClick={() => onPage(Math.min(totalPages - 1, page + 1))}
        title={t.pagination_next}
      >
        <ChevronRight className="size-3.5" />
      </button>
      <button
        type="button"
        className={pageBtnClass}
        disabled={page >= totalPages - 1}
        onClick={() => onPage(totalPages - 1)}
        title={t.pagination_last}
      >
        <ChevronsRight className="size-3.5" />
      </button>
    </div>
  );
}
