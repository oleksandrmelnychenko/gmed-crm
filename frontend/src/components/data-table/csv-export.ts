import type { ColumnDef } from "./types";

function escapeCsvCell(value: unknown): string {
  if (value == null) return "";
  const str = Array.isArray(value) ? value.join(", ") : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsv<T>(
  rows: readonly T[],
  columns: readonly ColumnDef<T>[],
): string {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(",");
  const body = rows
    .map((row) => columns.map((col) => escapeCsvCell(col.accessor(row))).join(","))
    .join("\n");
  return body ? `${header}\n${body}` : header;
}

export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportCsv<T>(
  rows: readonly T[],
  columns: readonly ColumnDef<T>[],
  filename: string,
): void {
  downloadCsv(filename, buildCsv(rows, columns));
}
