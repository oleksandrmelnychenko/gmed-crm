import { moneyInputText, normalizeMoneyInput } from "@/lib/money";

const IMPORT_AMOUNT_KEYS = new Set(["amount_net", "amount_vat", "amount_gross"]);

export type InvoiceImportFields = {
  supplier_name: string;
  external_invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount_net: string;
  amount_vat: string;
  amount_gross: string;
  currency: string;
};

export type InvoiceImportScope = "company" | "patient_order";

export type InvoiceImportPreview = {
  schema_version: string;
  requires_review: true;
  document_kind?: "invoice" | "receipt" | "cost_estimate" | "fee_agreement" | "booking_confirmation" | null;
  fields: Partial<Record<keyof InvoiceImportFields, string | null>>;
  warnings: string[];
  text: string;
  extraction_complete: boolean;
  source_format?: "xml" | "embedded_xml" | "pdf_text" | "ocr";
  structured?: {
    syntax: "ubl" | "cii";
    profile: string | null;
    document_type: string | null;
    validation: "basic_checks";
    import_allowed: boolean;
    filename?: string;
  };
  recipient?: { name: string | null };
  source_differences?: { field: keyof InvoiceImportFields; structured: string; visible: string }[];
  tax_breakdown?: {
    category: string | null;
    label?: string | null;
    rate: string | null;
    amount: string | null;
    base: string | null;
  }[];
  line_items?: Record<string, unknown>[];
  field_sources?: Partial<Record<keyof InvoiceImportFields, {
    method: "document_without_vat" | "invoice_date_plus_days";
    text: string;
    days?: number;
  }>>;
  payment?: {
    method?: "direct_debit";
    collection_date?: string | null;
    terms?: string[];
    text?: string;
    amount_due?: string | null;
    prepaid?: string | null;
    rounding?: string | null;
  };
};

export function isInvoiceXml(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xml");
}

export function normalizeInvoiceFile(file: File): File {
  return isInvoiceXml(file) && file.type !== "application/xml"
    ? new File([file], file.name, { type: "application/xml", lastModified: file.lastModified }) : file;
}

export function invoiceSourceCanSave(file: File | null, preview: InvoiceImportPreview | null): boolean {
  if (!file || preview?.structured?.import_allowed === false) return false;
  return !isInvoiceXml(file) || (preview?.source_format === "xml" && preview.structured?.import_allowed === true);
}

export function blankImportFields(): InvoiceImportFields {
  return { supplier_name: "", external_invoice_number: "", invoice_date: "", due_date: "",
    amount_net: "", amount_vat: "", amount_gross: "", currency: "" };
}

/** Whether a form field still holds what was recognized (amounts compared by value, "42.50" = "42,50"). */
export function importFieldIsRecognized(key: keyof InvoiceImportFields, value: string, preview: InvoiceImportPreview): boolean {
  const recognized = preview.fields[key];
  if (typeof recognized !== "string") return false;
  if (!IMPORT_AMOUNT_KEYS.has(key)) return value === recognized;
  const cents = importMoneyCents(value);
  return cents !== null ? cents === importMoneyCents(recognized) : value === recognized;
}

export function importFieldsFromPreview(preview: InvoiceImportPreview): InvoiceImportFields {
  return Object.fromEntries(Object.keys(blankImportFields()).map((key) => {
    const value = preview.fields[key as keyof InvoiceImportFields];
    if (typeof value !== "string") return [key, ""];
    // Recognized amounts ("119.00") shown as staff type money ("119,00",
    // owner 2026-11-11); anything unreadable stays as recognized.
    return [key, IMPORT_AMOUNT_KEYS.has(key) && importMoneyCents(value) !== null
      ? moneyInputText(importMoneyCents(value)! / 100)
      : value];
  })) as InvoiceImportFields;
}

// Form amounts are typed in the German money format like every money field
// (owner 2026-11-11): "1.234,56", "1234,56" or "1234.56"; English grouping,
// signs and more than two decimals are refused.
export function importMoneyCents(value: string): number | null {
  const normalized = normalizeMoneyInput(value) ?? "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 99_999_999_999_999 ? cents : null;
}

export function importTotalsMatch(fields: InvoiceImportFields): boolean {
  const net = importMoneyCents(fields.amount_net);
  const vat = importMoneyCents(fields.amount_vat);
  const gross = importMoneyCents(fields.amount_gross);
  return net !== null && vat !== null && gross !== null && net + vat === gross;
}
