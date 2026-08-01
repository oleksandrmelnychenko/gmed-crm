export const DEFAULT_DOCUMENT_PAGE_SIZE = 25;

export const DOCUMENT_PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

export type DocumentPage<T> = {
  end: number;
  pageIndex: number;
  rows: T[];
  start: number;
  totalPages: number;
};

export function buildDocumentPage<T>(
  rows: readonly T[],
  requestedPageIndex: number,
  requestedPageSize: number,
): DocumentPage<T> {
  const pageSize =
    Number.isInteger(requestedPageSize) && requestedPageSize > 0
      ? requestedPageSize
      : DEFAULT_DOCUMENT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageIndex = Math.min(
    Math.max(0, Number.isInteger(requestedPageIndex) ? requestedPageIndex : 0),
    totalPages - 1,
  );
  const offset = pageIndex * pageSize;

  return {
    end: Math.min(offset + pageSize, rows.length),
    pageIndex,
    rows: rows.slice(offset, offset + pageSize),
    start: rows.length === 0 ? 0 : offset + 1,
    totalPages,
  };
}
