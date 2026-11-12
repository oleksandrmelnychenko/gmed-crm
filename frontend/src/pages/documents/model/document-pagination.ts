import type { Lang } from "@/lib/i18n";
import { formatCount, type PluralWords } from "@/lib/i18n/plural";

export const DEFAULT_DOCUMENT_PAGE_SIZE = 25;

export const DOCUMENT_PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

const DOCUMENT_WORDS: PluralWords = {
  ru: ["документ", "документа", "документов"],
  de: ["Dokument", "Dokumente"],
};

/** "3 документа" / "3 Dokumente" under a document list (QA 2026-11-12 A-12). */
export function formatDocumentCount(lang: Lang, count: number) {
  return formatCount(lang, count, DOCUMENT_WORDS);
}

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
