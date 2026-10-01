/**
 * Pure helpers of the personnel files pages (months, version groups,
 * completeness cells, filters, upload checks). No React, no API calls.
 */

import { appDateKey, formatAppDate } from "@/lib/app-time-zone";

/** Where a new document goes: a fresh document or a correction of `supersedesId`. */
export type ArchiveTarget = {
  category: string;
  /** "YYYY-MM" for monthly categories. */
  period?: string;
  /** "YYYY-MM-DD" for the other categories. */
  documentDate?: string;
  title?: string;
  supersedesId?: string;
  correctionReason?: string;
};

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

const MONTH_KEY = /^(\d{4})-(\d{2})$/;

export function isMonthKey(value: string | null | undefined): value is string {
  const match = value ? MONTH_KEY.exec(value) : null;
  return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= 12);
}

/** "YYYY-MM" of the Berlin calendar month containing `date`. */
export function monthKeyOf(date: Date | number = new Date()): string {
  return appDateKey(date).slice(0, 7);
}

/** `month` shifted by `delta` months ("2026-01", -1 → "2025-12"). */
export function addMonths(month: string, delta: number): string {
  const match = MONTH_KEY.exec(month);
  if (!match) return month;
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
  const year = Math.floor(index / 12);
  const monthNumber = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
}

/** "2026-05" → "05.2026"; other values unchanged. */
export function formatMonth(month: string | null | undefined): string {
  if (!month) return "";
  const match = MONTH_KEY.exec(month);
  return match ? `${match[2]}.${match[1]}` : month;
}

/**
 * The months from `from` to `to` inclusive, oldest first; empty when the
 * range is reversed or invalid. Capped at `limit` months (newest kept).
 */
export function monthRange(from: string, to: string, limit = 60): string[] {
  if (!isMonthKey(from) || !isMonthKey(to) || from > to) return [];
  const months: string[] = [];
  for (let month = to; month >= from && months.length < limit; month = addMonths(month, -1)) {
    months.push(month);
  }
  return months.reverse();
}

/** Choices for a month select, newest first: `forward` months ahead to `back` months ago. */
export function monthOptions(anchor: string, back: number, forward = 0): string[] {
  return monthRange(addMonths(anchor, -back), addMonths(anchor, forward), back + forward + 1)
    .reverse();
}

/** Default range of the completeness matrix: the last six months including the current one. */
export function defaultMonthRange(now: Date | number = new Date()): { from: string; to: string } {
  const to = monthKeyOf(now);
  return { from: addMonths(to, -5), to };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

type VersionedDocument = {
  id: string;
  category: string;
  version_root_id: string;
  version_number: number;
  period: string | null;
  document_date: string | null;
  archived_at: string;
};

/** The newest version of one document and its older versions (newest first). */
export type DocumentVersionGroup<T extends VersionedDocument> = {
  rootId: string;
  current: T;
  history: T[];
};

/** "YYYY-MM" or "YYYY-MM-DD": the key documents are ordered by (newest first). */
export function documentSortKey(document: Pick<VersionedDocument, "period" | "document_date">) {
  return document.period ?? document.document_date ?? "";
}

/**
 * Groups versions by `version_root_id`. Groups are ordered by period or date
 * of the document (newest first), then by archive time of the newest version.
 */
export function groupDocumentVersions<T extends VersionedDocument>(
  documents: readonly T[],
): DocumentVersionGroup<T>[] {
  const byRoot = new Map<string, T[]>();
  for (const document of documents) {
    const rootId = document.version_root_id || document.id;
    byRoot.set(rootId, [...(byRoot.get(rootId) ?? []), document]);
  }
  const groups = [...byRoot.entries()].map(([rootId, versions]) => {
    const sorted = [...versions].sort((a, b) => b.version_number - a.version_number);
    return { rootId, current: sorted[0], history: sorted.slice(1) };
  });
  return groups.sort((a, b) => {
    const byPeriod = documentSortKey(b.current).localeCompare(documentSortKey(a.current));
    if (byPeriod !== 0) return byPeriod;
    return b.current.archived_at.localeCompare(a.current.archived_at);
  });
}

/**
 * Version groups by category in the order of `categoryOrder` (the API order);
 * categories without documents are left out, unknown ones come last.
 */
export function groupByCategory<T extends VersionedDocument>(
  groups: readonly DocumentVersionGroup<T>[],
  categoryOrder: readonly string[],
): { category: string; groups: DocumentVersionGroup<T>[] }[] {
  const byCategory = new Map<string, DocumentVersionGroup<T>[]>();
  for (const group of groups) {
    const code = group.current.category;
    byCategory.set(code, [...(byCategory.get(code) ?? []), group]);
  }
  const rank = (code: string) => {
    const index = categoryOrder.indexOf(code);
    return index === -1 ? categoryOrder.length : index;
  };
  return [...byCategory.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([category, entries]) => ({ category, groups: entries }));
}

/** "05.2026" for a monthly document, "DD.MM.YYYY" otherwise. */
export function formatDocumentPeriod(
  document: Pick<VersionedDocument, "period" | "document_date">,
): string {
  if (document.period) return formatMonth(document.period);
  return document.document_date ? formatAppDate(document.document_date) : "";
}

/** Whether the retention period of a document has ended on `today` ("YYYY-MM-DD"). */
export function isRetentionOver(
  document: { retention_until: string | null },
  today: string = appDateKey(),
): boolean {
  return Boolean(document.retention_until && document.retention_until < today);
}

/** Delete is offered only past retention, without legal hold, with the right and the switch on. */
export function canOfferDeletion(
  document: { retention_until: string | null; legal_hold: boolean; deleted_at: string | null },
  options: { canRetention: boolean; deletionEnabled: boolean; today?: string },
): boolean {
  return (
    options.canRetention &&
    options.deletionEnabled &&
    !document.deleted_at &&
    !document.legal_hold &&
    isRetentionOver(document, options.today)
  );
}

/** Query string of `GET /personnel/employees/{id}/file-name`. */
export function fileNameQuery(target: ArchiveTarget, mimeType?: string): string {
  const params = new URLSearchParams();
  if (target.supersedesId) {
    params.set("supersedes_id", target.supersedesId);
  } else {
    if (target.category) params.set("category", target.category);
    if (target.period) params.set("period", target.period);
    if (target.documentDate) params.set("document_date", target.documentDate);
  }
  if (mimeType) params.set("mime_type", mimeType);
  return params.toString();
}

/** Whether the target has everything the server needs (category with month or date, or a reasoned correction). */
export function isArchiveTargetComplete(target: ArchiveTarget, monthly: boolean | undefined): boolean {
  if (target.supersedesId) return Boolean(target.correctionReason?.trim());
  if (!target.category) return false;
  return monthly ? isMonthKey(target.period) : Boolean(target.documentDate);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export const PERSONNEL_MAX_FILE_BYTES = 25 * 1024 * 1024;

const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/** `accept` of the file inputs (§ 8 BVV formats only). */
export const PERSONNEL_FILE_ACCEPT = [
  ...Object.keys(EXTENSION_MIME).map((extension) => `.${extension}`),
  ...new Set(Object.values(EXTENSION_MIME)),
].join(",");

/** The archive MIME type of a chosen file, by extension first; null when not accepted. */
export function personnelMimeType(file: { name: string; type?: string }): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byExtension = EXTENSION_MIME[extension];
  if (byExtension) return byExtension;
  const declared = (file.type ?? "").toLowerCase();
  return Object.values(EXTENSION_MIME).includes(declared) ? declared : null;
}

export function validatePersonnelFile(
  file: { name: string; type?: string; size: number },
): "unsupported" | "too_large" | null {
  if (!personnelMimeType(file)) return "unsupported";
  if (file.size <= 0 || file.size > PERSONNEL_MAX_FILE_BYTES) return "too_large";
  return null;
}

/** Whether browsers can show the file inline (they cannot render TIFF). */
export function canPreviewInline(mimeType: string): boolean {
  return ["application/pdf", "image/jpeg", "image/png", "image/bmp"].includes(mimeType);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export type EmployeeStatusFilter = "active" | "former" | "all";

type FilterableEmployee = {
  display_name: string;
  personnel_number: string | null;
  user_name: string | null;
  is_active: boolean;
};

export function filterEmployees<T extends FilterableEmployee>(
  rows: readonly T[],
  status: EmployeeStatusFilter,
  search: string,
): T[] {
  const needle = search.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (status === "active" && !row.is_active) return false;
    if (status === "former" && row.is_active) return false;
    if (!needle) return true;
    return [row.display_name, row.personnel_number, row.user_name]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle);
  });
}

/** "DD.MM.YYYY – DD.MM.YYYY", "since DD.MM.YYYY" (via `sinceLabel`) or "". */
export function formatEmploymentPeriod(
  start: string | null,
  end: string | null,
  sinceLabel: string,
): string {
  if (start && end) return `${formatAppDate(start)} – ${formatAppDate(end)}`;
  if (start) return `${sinceLabel} ${formatAppDate(start)}`;
  if (end) return `– ${formatAppDate(end)}`;
  return "";
}

export type EmployeeForm = {
  salutation: "frau" | "herr" | "none";
  first_name: string;
  last_name: string;
  personnel_number: string;
  employment_start: string;
  employment_end: string;
  user_id: string;
  notes: string;
};

export const EMPTY_EMPLOYEE_FORM: EmployeeForm = {
  salutation: "none",
  first_name: "",
  last_name: "",
  personnel_number: "",
  employment_start: "",
  employment_end: "",
  user_id: "",
  notes: "",
};

export function employeeFormOf(employee: {
  salutation: EmployeeForm["salutation"];
  first_name: string;
  last_name: string;
  personnel_number: string | null;
  employment_start: string | null;
  employment_end: string | null;
  user_id: string | null;
  notes: string | null;
}): EmployeeForm {
  return {
    salutation: employee.salutation,
    first_name: employee.first_name,
    last_name: employee.last_name,
    personnel_number: employee.personnel_number ?? "",
    employment_start: employee.employment_start ?? "",
    employment_end: employee.employment_end ?? "",
    user_id: employee.user_id ?? "",
    notes: employee.notes ?? "",
  };
}

/**
 * The request body for a create (`original` absent: every filled field) or an
 * update (only changed fields; an emptied optional field is sent as "" to clear it).
 */
export function employeeRequestBody(
  form: EmployeeForm,
  original?: EmployeeForm,
): Partial<EmployeeForm> {
  const body: Record<string, string> = {};
  for (const key of Object.keys(form) as (keyof EmployeeForm)[]) {
    const value = key === "notes" ? form[key] : form[key].trim();
    if (original) {
      const before = key === "notes" ? original[key] : original[key].trim();
      if (value !== before) body[key] = value;
    } else if (value) {
      body[key] = value;
    }
  }
  return body as Partial<EmployeeForm>;
}

/** The employment end may not precede its start. */
export function employmentRangeValid(form: Pick<EmployeeForm, "employment_start" | "employment_end">) {
  return !form.employment_start || !form.employment_end || form.employment_start <= form.employment_end;
}

// ---------------------------------------------------------------------------
// Completeness and journal
// ---------------------------------------------------------------------------

export type CompletenessCode = "not_employed" | "open" | "present" | "late" | "missing";

export const COMPLETENESS_CODES: readonly CompletenessCode[] = [
  "present",
  "late",
  "missing",
  "open",
  "not_employed",
];

const COMPLETENESS_CELL_CLASS: Record<CompletenessCode, string> = {
  present: "border-emerald-200 bg-emerald-50 text-emerald-700",
  late: "border-amber-200 bg-amber-50 text-amber-800",
  missing: "border-rose-200 bg-rose-50 text-rose-700",
  open: "border-sky-200 bg-sky-50 text-sky-700",
  not_employed: "border-border/60 bg-muted/30 text-muted-foreground/60",
};

/** Cell colour of a completeness status; unknown codes look like "not employed". */
export function completenessCellClass(code: string | null | undefined): string {
  return COMPLETENESS_CELL_CLASS[(code ?? "") as CompletenessCode] ?? COMPLETENESS_CELL_CLASS.not_employed;
}

/** Short cell symbol, readable without colour. */
export function completenessCellSymbol(code: string | null | undefined): string {
  switch (code) {
    case "present":
      return "✓";
    case "late":
      return "!";
    case "missing":
      return "✗";
    case "open":
      return "…";
    default:
      return "–";
  }
}

/** Counts of missing and late cells, for the matrix summary. */
export function countCompleteness(
  employees: readonly { cells: Record<string, Record<string, string>> }[],
): Record<CompletenessCode, number> {
  const counts: Record<CompletenessCode, number> = {
    present: 0,
    late: 0,
    missing: 0,
    open: 0,
    not_employed: 0,
  };
  for (const employee of employees) {
    for (const month of Object.values(employee.cells)) {
      for (const code of Object.values(month)) {
        if (code in counts) counts[code as CompletenessCode] += 1;
      }
    }
  }
  return counts;
}

export const PERSONNEL_EVENT_ACTIONS = [
  "employee_created",
  "employee_updated",
  "document_archived",
  "document_version",
  "document_downloaded",
  "own_file_viewed",
  "own_document_downloaded",
  "legal_hold_set",
  "legal_hold_released",
  "document_deleted",
  "export_created",
  "intake_received",
  "intake_discarded",
  "integrity_failed",
  "category_updated",
  "settings_updated",
] as const;

/** i18n key of a journal action; unknown actions fall back to the raw code. */
export function eventActionKey(action: string): string | null {
  return (PERSONNEL_EVENT_ACTIONS as readonly string[]).includes(action)
    ? `personnel_event_${action}`
    : null;
}

export const PERSONNEL_TABS = [
  "employees",
  "completeness",
  "intake",
  "export",
  "integrity",
  "settings",
] as const;

export type PersonnelTab = (typeof PERSONNEL_TABS)[number];

/** The tab named in `?tab=` when the user may see it, else the first allowed one. */
export function resolvePersonnelTab(
  requested: string | null,
  allowed: readonly PersonnelTab[],
): PersonnelTab {
  const match = allowed.find((tab) => tab === requested);
  return match ?? allowed[0] ?? "employees";
}
