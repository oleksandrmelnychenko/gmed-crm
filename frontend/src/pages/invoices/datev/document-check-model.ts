import { importFieldsFromPreview, importTotalsMatch, invoiceSourceCanSave, normalizeInvoiceFile, type InvoiceImportFields, type InvoiceImportPreview } from "../model/import-model";

export const MAX_CHECK_FILES = 10;
const INFORMATIONAL_WARNINGS = new Set(["template_not_found", "generic_extraction_review_required", "amount_net_derived_from_totals", "due_date_calculated_from_invoice_date"]);
export type CheckIssue = "required_fields" | "invoice_date" | "currency" | "totals" | "incomplete" | "structure" | "source_difference" | "parser_warning" | "matching_invoice";
export type CheckStatus = "queued" | "processing" | "parsed" | "review" | "duplicate" | "error" | "cancelled";
export type CheckFailure = "file" | "unavailable" | "busy" | "access" | "parse";
export type CheckSummary = {
  fields: InvoiceImportFields;
  source_format: NonNullable<InvoiceImportPreview["source_format"]> | "unknown";
  syntax: "ubl" | "cii" | null;
  structured_validation: "basic_checks" | null;
  structured_import_allowed: boolean | null;
  warnings: string[];
  issues: CheckIssue[];
};
export type DocumentCheck = {
  id: string;
  file: File;
  status: CheckStatus;
  sha256?: string;
  checkedAt?: string;
  duplicateOf?: string;
  relatedId?: string;
  summary?: CheckSummary;
  failure?: CheckFailure;
};

export function checkableInvoiceFile(file: File): File | null {
  const normalized = normalizeInvoiceFile(file);
  const limit = normalized.type === "application/xml" ? 5 : 25;
  return ["application/pdf", "image/png", "image/jpeg", "application/xml"].includes(normalized.type)
    && normalized.size > 0 && normalized.size <= limit * 1024 * 1024 ? normalized : null;
}

function validInvoiceDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function invoiceCheckSummary(file: File, preview: InvoiceImportPreview): CheckSummary {
  const fields = importFieldsFromPreview(preview);
  const issues: CheckIssue[] = [];
  if (Object.entries(fields).some(([key, value]) => key !== "due_date" && !value.trim())) issues.push("required_fields");
  if (!validInvoiceDate(fields.invoice_date)) issues.push("invoice_date");
  if (!/^[A-Z]{3}$/.test(fields.currency.trim().toUpperCase())) issues.push("currency");
  if (!importTotalsMatch(fields)) issues.push("totals");
  if (!preview.extraction_complete) issues.push("incomplete");
  if (!invoiceSourceCanSave(file, preview)) issues.push("structure");
  if (preview.source_differences?.length) issues.push("source_difference");
  if (preview.warnings.some((warning) => !INFORMATIONAL_WARNINGS.has(warning))) issues.push("parser_warning");
  return {
    fields, source_format: preview.source_format ?? "unknown", syntax: preview.structured?.syntax ?? null,
    structured_validation: preview.structured?.validation ?? null,
    structured_import_allowed: preview.structured?.import_allowed ?? null,
    warnings: [...preview.warnings], issues,
  };
}

export function matchingInvoice(summary: CheckSummary, existing: DocumentCheck[]) {
  const key = (fields: InvoiceImportFields) => {
    const values = [fields.supplier_name, fields.external_invoice_number, fields.currency].map((value) => value.trim().toLocaleLowerCase("de-DE").replace(/\s+/g, " "));
    return values.every(Boolean) ? JSON.stringify(values) : null;
  };
  const current = key(summary.fields);
  return current ? existing.find((row) => row.summary && key(row.summary.fields) === current) : undefined;
}

// Deliberately omit source text, recipients, patient suggestions and file bytes.
export function documentCheckReport(rows: DocumentCheck[], generatedAt = new Date().toISOString()) {
  return {
    schema_version: "1.0", report_type: "gmed_invoice_import_preflight", generated_at: generatedAt,
    datev_connection_verified: false, datev_compatibility_verified: false, accounting_writes_performed: false,
    scope: "Session-only GMed import checks. No DATEV API call, no invoice created. Originals require manual review. Duplicate checks cover this session only. Structured XML checks are basic checks, not full schema or EN16931 validation.",
    documents: rows.map(({ id, file, status, sha256, checkedAt, duplicateOf, relatedId, summary, failure }) => ({
      id, filename: file.name, size_bytes: file.size, status, sha256, checked_at: checkedAt,
      duplicate_of: duplicateOf, related_id: relatedId, failure, ...summary,
    })),
  };
}
