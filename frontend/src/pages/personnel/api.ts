/**
 * Personnel files (Personalakte, § 8 BVV): wire types and calls of
 * `crates/server/src/routes/personnel/`. See
 * docs/personnel-files-plan-2026-09-30_ua.md.
 */

import { apiFetch, apiFetchFile, downloadApiFile } from "@/lib/api";

import { fileNameQuery, type ArchiveTarget } from "./model";

export type PersonnelSalutation = "frau" | "herr" | "none";
/** `generated`: a sheet GMED made itself (the GwG instruction, /sops). */
export type PersonnelDocumentSource = "upload" | "scan" | "import" | "generated";

export type PersonnelCategory = {
  code: string;
  file_label: string;
  monthly: boolean;
  is_health: boolean;
  expected_monthly: boolean;
  retention_years: number;
  retention_from: "document" | "employment_end";
  legal_basis: string;
};

export type PersonnelSettings = {
  late_days: number;
  deletion_enabled: boolean;
  tsa_url: string;
};

export type PersonnelLinkableUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type PersonnelEmployee = {
  id: string;
  user_id: string | null;
  user_name: string | null;
  salutation: PersonnelSalutation;
  first_name: string;
  last_name: string;
  display_name: string;
  personnel_number: string | null;
  employment_start: string | null;
  employment_end: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PersonnelEmployeeRow = PersonnelEmployee & {
  document_count: number;
  last_archived_at: string | null;
  /** Category codes of expected monthly documents missing for `previous_month`. */
  missing_previous_month: string[];
};

export type PersonnelEmployeeList = {
  employees: PersonnelEmployeeRow[];
  previous_month: string;
  pending_intake: number;
};

export type PersonnelDocument = {
  id: string;
  employee_id: string;
  category: string;
  category_label: string;
  is_health: boolean;
  period: string | null;
  document_date: string | null;
  title: string | null;
  archive_file_name: string;
  original_file_name: string;
  mime_type: string;
  file_size: number;
  sha256: string;
  source: PersonnelDocumentSource;
  received_at: string | null;
  version_root_id: string;
  supersedes_id: string | null;
  version_number: number;
  correction_reason: string | null;
  archived_at: string;
  archived_by_name: string | null;
  chain_seq: number;
  chain_hash: string;
  legal_hold: boolean;
  deleted_at: string | null;
  deleted_by_name: string | null;
  delete_reason: string | null;
  retention_until: string | null;
  is_current: boolean;
  archived_late: boolean;
};

export type PersonnelEmployeeFile = {
  employee: PersonnelEmployee;
  documents: PersonnelDocument[];
  health_hidden: boolean;
  late_days: number;
};

export type PersonnelEvent = {
  id: string;
  document_id: string | null;
  archive_file_name: string | null;
  action: string;
  details: unknown;
  actor_name: string | null;
  created_at: string;
};

/** A document on the linked account's interpreter profile that can be copied into the file. */
export type PersonnelProfileDocument = {
  document_id: string;
  document_kind: string;
  suggested_category: string;
  title: string;
  original_file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  document_date: string | null;
  uploaded_at: string | null;
  imported: boolean;
};

export type PersonnelOwnFile = {
  employee: Pick<
    PersonnelEmployee,
    | "id"
    | "salutation"
    | "first_name"
    | "last_name"
    | "display_name"
    | "personnel_number"
    | "employment_start"
    | "employment_end"
  >;
  documents: PersonnelDocument[];
};

export type PersonnelIntakeItem = {
  id: string;
  original_file_name: string;
  mime_type: string;
  file_size: number;
  source: string;
  received_at: string;
  uploaded_by_name: string | null;
};

export type CompletenessCellCode = "not_employed" | "open" | "present" | "late" | "missing";

export type PersonnelCompleteness = {
  from: string;
  to: string;
  late_days: number;
  months: string[];
  categories: { code: string; file_label: string }[];
  employees: {
    id: string;
    display_name: string;
    is_active: boolean;
    cells: Record<string, Record<string, CompletenessCellCode>>;
  }[];
};

export type PersonnelIntegrityRun = {
  id: string;
  trigger: "scheduled" | "manual";
  started_by_name: string | null;
  started_at: string;
  finished_at: string | null;
  employees_checked: number;
  documents_checked: number;
  failures: { employee_id: string | null; document_id: string | null; problem: string }[];
  status: "running" | "passed" | "failed" | "error";
};

export type PersonnelAnchor = {
  id: string;
  anchor_date: string;
  anchor_hash: string;
  employee_count: number;
  document_count: number;
  tsa_status: "pending" | "stamped" | "failed" | "disabled";
  tsa_url: string | null;
  tsa_gen_time: string | null;
  tsa_attempts: number;
  tsa_last_error: string | null;
  has_token: boolean;
};

export type PersonnelIntegrity = {
  runs: PersonnelIntegrityRun[];
  anchors: PersonnelAnchor[];
  tsa_configured: boolean;
};

export type PersonnelRetentionDue = {
  deletion_enabled: boolean;
  documents: (PersonnelDocument & { employee_name: string })[];
};

export type PersonnelEmployeeInput = {
  salutation?: PersonnelSalutation;
  first_name?: string;
  last_name?: string;
  personnel_number?: string;
  employment_start?: string;
  employment_end?: string;
  user_id?: string;
  notes?: string;
};

export type PersonnelExportInput = {
  employee_ids?: string[];
  from?: string;
  to?: string;
  include_versions?: boolean;
};

const fresh = { forceFresh: true } as const;
const jsonPost = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const jsonPatch = (body: unknown) => ({ method: "PATCH", body: JSON.stringify(body) });
// Uploads of up to 25 MB and the export ZIP need more than the default timeout.
const LONG_TIMEOUT_MS = 180_000;

export const personnelApi = {
  categories: () => apiFetch<PersonnelCategory[]>("/personnel/categories", fresh),
  updateCategory: (code: string, retentionYears: number) =>
    apiFetch<PersonnelCategory>(
      `/personnel/categories/${encodeURIComponent(code)}`,
      jsonPatch({ retention_years: retentionYears }),
    ),
  settings: () => apiFetch<PersonnelSettings>("/personnel/settings", fresh),
  updateSettings: (patch: Partial<PersonnelSettings>) =>
    apiFetch<PersonnelSettings>("/personnel/settings", jsonPatch(patch)),
  linkableUsers: () => apiFetch<PersonnelLinkableUser[]>("/personnel/linkable-users", fresh),

  employees: () => apiFetch<PersonnelEmployeeList>("/personnel/employees", fresh),
  createEmployee: (input: PersonnelEmployeeInput) =>
    apiFetch<PersonnelEmployee>("/personnel/employees", jsonPost(input)),
  updateEmployee: (id: string, input: PersonnelEmployeeInput) =>
    apiFetch<PersonnelEmployee>(`/personnel/employees/${id}`, jsonPatch(input)),
  employee: (id: string) => apiFetch<PersonnelEmployeeFile>(`/personnel/employees/${id}`, fresh),
  events: (id: string, limit = 200) =>
    apiFetch<PersonnelEvent[]>(`/personnel/employees/${id}/events?limit=${limit}`, fresh),

  previewFileName: (employeeId: string, target: ArchiveTarget, mimeType?: string) =>
    apiFetch<{ file_name: string; version_number: number }>(
      `/personnel/employees/${employeeId}/file-name?${fileNameQuery(target, mimeType)}`,
      fresh,
    ),
  uploadDocument: (employeeId: string, target: ArchiveTarget, file: File) => {
    const form = new FormData();
    form.set("file", file, file.name);
    if (target.supersedesId) {
      form.set("supersedes_id", target.supersedesId);
      form.set("correction_reason", target.correctionReason ?? "");
    } else {
      form.set("category", target.category);
      if (target.period) form.set("period", target.period);
      if (target.documentDate) form.set("document_date", target.documentDate);
    }
    if (target.title?.trim()) form.set("title", target.title.trim());
    return apiFetch<PersonnelDocument>(`/personnel/employees/${employeeId}/documents`, {
      method: "POST",
      body: form,
      timeoutMs: LONG_TIMEOUT_MS,
    });
  },
  documentFile: (documentId: string, inline: boolean) =>
    apiFetchFile(`/personnel/documents/${documentId}/file?inline=${inline}`, {
      cache: "no-store",
      timeoutMs: LONG_TIMEOUT_MS,
    }),
  downloadDocument: (document: Pick<PersonnelDocument, "id" | "archive_file_name">) =>
    downloadApiFile(
      `/personnel/documents/${document.id}/file?inline=false`,
      document.archive_file_name,
      { cache: "no-store", timeoutMs: LONG_TIMEOUT_MS },
    ),
  setLegalHold: (documentId: string, legalHold: boolean, reason?: string) =>
    apiFetch<{ id: string; legal_hold: boolean }>(
      `/personnel/documents/${documentId}/legal-hold`,
      jsonPost({ legal_hold: legalHold, reason: reason?.trim() || undefined }),
    ),
  deleteDocument: (documentId: string, reason: string) =>
    apiFetch<{ id: string; deleted: boolean }>(
      `/personnel/documents/${documentId}/delete`,
      jsonPost({ reason }),
    ),
  retentionDue: () => apiFetch<PersonnelRetentionDue>("/personnel/retention/due", fresh),
  ownFile: () => apiFetch<PersonnelOwnFile>("/personnel/me", fresh),

  profileDocuments: (employeeId: string) =>
    apiFetch<PersonnelProfileDocument[]>(`/personnel/employees/${employeeId}/profile-documents`, fresh),
  importProfileDocument: (employeeId: string, documentId: string, target: ArchiveTarget) =>
    apiFetch<PersonnelDocument>(
      `/personnel/employees/${employeeId}/profile-documents/import`,
      jsonPost({
        document_id: documentId,
        category: target.category,
        period: target.period || undefined,
        document_date: target.documentDate || undefined,
        title: target.title?.trim() || undefined,
      }),
    ),

  intake: () => apiFetch<PersonnelIntakeItem[]>("/personnel/intake", fresh),
  uploadIntake: (file: File) => {
    const form = new FormData();
    form.set("file", file, file.name);
    form.set("source", "upload");
    return apiFetch<PersonnelIntakeItem>("/personnel/intake", {
      method: "POST",
      body: form,
      timeoutMs: LONG_TIMEOUT_MS,
    });
  },
  intakeFile: (itemId: string) =>
    apiFetchFile(`/personnel/intake/${itemId}/file`, {
      cache: "no-store",
      timeoutMs: LONG_TIMEOUT_MS,
    }),
  archiveIntake: (itemId: string, employeeId: string, target: ArchiveTarget) =>
    apiFetch<PersonnelDocument>(
      `/personnel/intake/${itemId}/archive`,
      jsonPost({
        employee_id: employeeId,
        category: target.category,
        period: target.period || undefined,
        document_date: target.documentDate || undefined,
        title: target.title?.trim() || undefined,
        supersedes_id: target.supersedesId || undefined,
        correction_reason: target.supersedesId ? target.correctionReason : undefined,
      }),
    ),
  discardIntake: (itemId: string, reason: string) =>
    apiFetch<unknown>(`/personnel/intake/${itemId}/discard`, jsonPost({ reason })),

  completeness: (from: string, to: string) =>
    apiFetch<PersonnelCompleteness>(
      `/personnel/completeness?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      fresh,
    ),
  exportArchive: (input: PersonnelExportInput, fallbackFilename: string) =>
    downloadApiFile("/personnel/export", fallbackFilename, {
      method: "POST",
      body: JSON.stringify(input),
      timeoutMs: 600_000,
    }),

  integrity: () => apiFetch<PersonnelIntegrity>("/personnel/integrity", fresh),
  runIntegrity: () =>
    apiFetch<PersonnelIntegrityRun>("/personnel/integrity/run", {
      method: "POST",
      timeoutMs: 600_000,
    }),
  anchorNow: () =>
    apiFetch<PersonnelAnchor>("/personnel/integrity/anchor", {
      method: "POST",
      timeoutMs: 120_000,
    }),
  downloadAnchorToken: (anchor: Pick<PersonnelAnchor, "id" | "anchor_date">) =>
    downloadApiFile(
      `/personnel/integrity/anchors/${anchor.id}/token`,
      `Zeitstempel_${anchor.anchor_date.replaceAll("-", "")}.tsr`,
      { cache: "no-store" },
    ),
};
