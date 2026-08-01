import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const DEFAULT_DATA_TABLE_PAGE_SIZE = 50;

export function useDataTablePagination<T>(
  rows: readonly T[],
  resetKey: string,
  pageSize = DEFAULT_DATA_TABLE_PAGE_SIZE,
) {
  const [state, setState] = useState(() => ({ pageIndex: 0, resetKey }));
  const pageIndex = state.resetKey === resetKey ? state.pageIndex : 0;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pagedRows = useMemo(() => {
    const start = safePageIndex * pageSize;
    return rows.slice(start, start + pageSize);
  }, [pageSize, rows, safePageIndex]);

  return {
    pageIndex: safePageIndex,
    pagedRows,
    pageSize,
    totalPages,
    totalRows: rows.length,
    onPageChange(nextPageIndex: number) {
      setState({ pageIndex: nextPageIndex, resetKey });
    },
  };
}

export function DataTablePager({
  pageIndex,
  pageSize = DEFAULT_DATA_TABLE_PAGE_SIZE,
  totalPages,
  totalRows,
  previousLabel,
  nextLabel,
  onPageChange,
  className,
  controlsStart,
}: {
  className?: string;
  controlsStart?: ReactNode;
  nextLabel: string;
  onPageChange: (pageIndex: number) => void;
  pageIndex: number;
  pageSize?: number;
  previousLabel: string;
  totalPages: number;
  totalRows: number;
}) {
  const pageStart = pageIndex * pageSize;

  return (
    <div
      className={cn(
        "flex min-h-8 items-center justify-between gap-2 border-b border-border/60 bg-field px-4 py-0.5",
        className,
      )}
    >
      <span className="font-mono text-xs tabular-nums text-foreground">
        {totalRows === 0
          ? "0 / 0"
          : `${pageStart + 1}-${Math.min(pageStart + pageSize, totalRows)} / ${totalRows}`}
      </span>
      <div className="flex items-center gap-1.5">
        {controlsStart}
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled={pageIndex === 0}
          aria-label={previousLabel}
          title={previousLabel}
          onClick={() => onPageChange(Math.max(0, pageIndex - 1))}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="min-w-12 text-center font-mono text-xs font-medium tabular-nums text-foreground">
          {pageIndex + 1} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled={pageIndex >= totalPages - 1}
          aria-label={nextLabel}
          title={nextLabel}
          onClick={() => onPageChange(Math.min(totalPages - 1, pageIndex + 1))}
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
