export type InvoiceType = "advance" | "interim" | "final";
export type InvoiceStatus =
  | "draft"
  | "sent"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "cancelled";

type InvoiceLineItem = {
  description: string;
  quantity: string;
  unit_price: string;
  vat_rate: string;
  vat_source?: string | null;
  vat_source_explanation?: string | null;
  tax_profile_id?: string | null;
  tax_profile_key?: string | null;
  tax_profile_name?: string | null;
  tax_profile_vat_rate?: string | null;
  is_cost_passthrough: boolean;
  line_net: string;
  line_vat: string;
  line_gross: string;
  external_document_id?: string | null;
  notes?: string | null;
};

type SupportingDocument = {
  id: string;
  auto_name: string;
  original_filename?: string | null;
  art?: string | null;
  category?: string | null;
};

type InvoicePortalVisibility = {
  visible_to_patient: boolean;
  amounts_visible_to_patient: boolean;
  line_items_visible_to_patient: boolean;
  pdf_visible_to_patient: boolean;
  redaction_reason: string | null;
};

type InvoicePayer = {
  patient_relation_id?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_relationship?: string | null;
  relation_type?: string | null;
  relation_patient_name?: string | null;
  relation_patient_pid?: string | null;
  notes?: string | null;
  updated_at?: string | null;
};

export type InvoiceItem = {
  id: string;
  quote_id: string | null;
  quote_number: string | null;
  order_id: string;
  order_number: string;
  contract_id: string | null;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  invoice_number: string;
  invoice_type: InvoiceType | string;
  status: InvoiceStatus | string;
  issued_at: string;
  due_date: string | null;
  total_net: unknown;
  total_vat: unknown;
  total_gross: unknown;
  paid_amount: unknown;
  balance_due: unknown;
  paid_at: string | null;
  notes: string | null;
  portal_visible?: boolean;
  hide_amounts_from_patient?: boolean;
  line_items_visible_to_patient?: boolean;
  pdf_visible_to_patient?: boolean;
  portal_visibility?: InvoicePortalVisibility;
  visibility_note?: string | null;
  payer?: InvoicePayer;
  created_at: string;
  updated_at: string;
  line_items?: InvoiceLineItem[];
  supporting_documents?: SupportingDocument[];
};

export type InvoiceListResponse = {
  items: InvoiceItem[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
};

export type DunningEvent = {
  id: string;
  invoice_id: string;
  level: "first" | "second" | "collections" | string;
  note: string | null;
  due_date_snapshot: string | null;
  balance_due: unknown;
  sent_at: string;
  created_at: string;
  created_by_name?: string;
  created_by_role?: string;
};

export type AccountingEntry = {
  id: string;
  entry_date: string;
  direction: string;
  category: string;
  description: string;
  amount_net: string;
  amount_vat: string;
  amount_gross: string;
  currency: string;
  invoice_number?: string | null;
  external_invoice_number?: string | null;
  order_number?: string | null;
  patient_pid?: string | null;
  patient_name?: string | null;
};

export type AccountingLedgerPayload = {
  year: number;
  summary: {
    income_gross: string;
    expense_gross: string;
    net_surplus: string;
    service_revenue_gross: string;
    cost_passthrough_revenue_gross: string;
    provider_expense_gross: string;
  };
  monthly: Array<{
    period: string;
    income_gross: string;
    expense_gross: string;
    net_surplus: string;
  }>;
  entries: AccountingEntry[];
};

export type AccountingMonthlyItem = AccountingLedgerPayload["monthly"][number];

export type PatientOption = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
};

export type OrderOption = {
  id: string;
  order_number: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
};

export type QuoteOption = {
  id: string;
  order_id: string;
  order_number: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  quote_number: string;
  total_gross: unknown;
};

export type Filters = {
  search: string;
  patientId: string;
  orderId: string;
  quoteId: string;
  status: string;
  invoiceType: string;
};

export type CreateForm = {
  quoteId: string;
  invoiceType: InvoiceType;
  dueDate: string;
  notes: string;
};

export type StatusForm = {
  status: InvoiceStatus;
  dueDate: string;
  paidAmount: string;
  notes: string;
};

export type DunningForm = {
  note: string;
};

export type VisibilityForm = {
  portalVisible: boolean;
  hideAmountsFromPatient: boolean;
  lineItemsVisibleToPatient: boolean;
  pdfVisibleToPatient: boolean;
  visibilityNote: string;
};

export type PayerForm = {
  payerPatientRelationId: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactRelationship: string;
  notes: string;
};

export type InvoicesPermissions = {
  canView: boolean;
  canCreate: boolean;
  canManage: boolean;
  canAccounting: boolean;
};
