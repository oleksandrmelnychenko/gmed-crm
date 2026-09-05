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
  tax_breakdown?: { category: string | null; rate: string | null; amount: string | null; base: string | null }[];
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

export function importFieldsFromPreview(preview: InvoiceImportPreview): InvoiceImportFields {
  return Object.fromEntries(Object.keys(blankImportFields()).map((key) => [
    key, typeof preview.fields[key as keyof InvoiceImportFields] === "string"
      ? preview.fields[key as keyof InvoiceImportFields] : "",
  ])) as InvoiceImportFields;
}

// Form amounts accept a decimal comma/dot, without guessing thousands groups.
export function importMoneyCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
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
