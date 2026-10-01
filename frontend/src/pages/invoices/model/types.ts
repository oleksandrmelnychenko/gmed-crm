import type { InvoiceCreditTransfer, InvoiceCreditTransferTarget } from "./overpayment";

export type InvoiceType = "advance" | "interim" | "final";
export type InvoiceStatus =
  | "draft"
  | "sent"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "cancelled";

/**
 * Status shown to users: the stored status, or `credited` (RU "Сторнирован",
 * DE "Storniert") for an issued invoice fully covered by credit notes.
 */
export type InvoiceDisplayStatus = InvoiceStatus | "credited";

/** Cancellation document (Stornorechnung) of a released, cancelled invoice. */
export type InvoiceStornoDocument = {
  id: string;
  document_number: string;
  issued_on: string;
  reason: string;
  original_invoice_number: string;
  original_invoice_date: string;
  currency: string;
  amount_net: string;
  amount_vat: string;
  amount_gross: string;
  vat_breakdown: { vat_rate: string; net: string; vat: string; gross: string }[];
  stored_document?: { file_name: string; generated_at: string | null } | null;
};

export type InvoiceDunningBlockEntry = {
  id: string;
  reason: string;
  blocked_at: string | null;
  blocked_by_name: string | null;
  cleared_at: string | null;
  cleared_by_name: string | null;
  clear_reason: string | null;
};

/** Dunning block (Mahnsperre): the active block and its history. */
export type InvoiceDunningBlockState = {
  active: InvoiceDunningBlockEntry | null;
  history: InvoiceDunningBlockEntry[];
};

export type InvoiceLineItem = {
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
  source_order_leistung_id?: string | null;
  quote_line_index?: number;
  quoted_quantity?: string;
  invoiced_quantity?: string;
  remaining_quantity?: string;
  fully_invoiced?: boolean;
};

export type InvoicePrepaymentOption = {
  invoice_id: string;
  invoice_number: string;
  total_gross: unknown;
  paid_amount: unknown;
  allocated_amount: unknown;
  available_amount: unknown;
};

export type InvoicePrepaymentAllocation = {
  id: string;
  advance_invoice_id: string;
  advance_invoice_number: string;
  amount_gross: unknown;
  created_at: string;
};

export type InvoicePaymentTransaction = {
  id: string;
  invoice_id: string;
  transaction_type: "payment" | "reversal";
  reverses_transaction_id: string | null;
  corrects_transaction_id?: string | null;
  corrected_by_transaction_id?: string | null;
  reversed_by_transaction_id: string | null;
  is_reversed: boolean;
  amount_gross: unknown;
  effective_amount_gross: unknown;
  payment_method: string;
  payment_reference: string | null;
  received_on: string;
  note?: string | null;
  created_by?: string;
  created_by_name?: string;
  created_by_role?: string;
  created_at: string;
};

export type InvoicePaymentHistoryResponse = {
  items: InvoicePaymentTransaction[];
};

/** One credited invoice line of a credit note. */
export type InvoiceCreditNoteLine = {
  invoice_line_index: number;
  description: string;
  quantity: string | null;
  unit_price: string | null;
  vat_rate: string;
  is_cost_passthrough: boolean;
  line_net: string;
  line_vat: string;
  line_gross: string;
};

export type InvoiceCreditNoteVatRate = {
  vat_rate: string;
  net: string;
  vat: string;
  gross: string;
};

export type InvoiceCreditNoteTransaction = {
  id: string;
  invoice_id: string;
  transaction_type: "credit_note" | "reversal";
  reverses_transaction_id: string | null;
  reversed_by_transaction_id: string | null;
  is_reversed: boolean;
  document_number: string;
  reason: string;
  amounts_visible: boolean;
  amount_net: unknown;
  amount_vat: unknown;
  amount_gross: unknown;
  effective_amount_gross: unknown;
  currency: string;
  issued_on: string;
  portal_visible: boolean;
  /** `legacy_pro_rata` credit notes predate line credits and carry no lines. */
  credit_mode?: "lines" | "vat_rate" | "legacy_pro_rata";
  line_items?: InvoiceCreditNoteLine[] | null;
  vat_breakdown?: InvoiceCreditNoteVatRate[] | null;
  pdf_available?: boolean;
  created_by_name?: string;
  created_at: string;
};

/** What an invoice line can still be credited (staff invoice detail). */
export type InvoiceCreditableLine = {
  line_index: number;
  description: string;
  quantity: string | null;
  unit_price: string | null;
  vat_rate: string;
  is_cost_passthrough: boolean;
  line_net: string;
  line_vat: string;
  line_gross: string;
  credited_gross: string;
  remaining_gross: string;
  remaining_vat?: string;
};

export type InvoiceCreditNoteHistoryResponse = {
  items: InvoiceCreditNoteTransaction[];
};

export type InvoiceRefundTransaction = {
  id: string;
  invoice_id: string;
  transaction_type: "refund" | "reversal";
  reverses_transaction_id: string | null;
  reversed_by_transaction_id: string | null;
  is_reversed: boolean;
  amount_gross: unknown;
  effective_amount_gross: unknown;
  payment_method: string;
  payment_reference: string | null;
  refunded_on: string;
  reason: string;
  note?: string | null;
  created_by?: string;
  created_by_name?: string;
  created_by_role?: string;
  created_at: string;
};

export type InvoiceRefundHistoryResponse = {
  items: InvoiceRefundTransaction[];
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
  /** Another patient record pays (e.g. a parent who is a patient too). */
  patient_id?: string | null;
  patient_name?: string | null;
  patient_pid?: string | null;
  /** `contracting_party`, or `cost_bearer` for a deliberately different recipient. */
  role?: PayerRole | null;
  patient_relation_id?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_relationship?: string | null;
  relation_type?: string | null;
  relation_patient_name?: string | null;
  relation_patient_pid?: string | null;
  address_street?: string | null;
  address_zip?: string | null;
  address_city?: string | null;
  address_country?: string | null;
  notes?: string | null;
  updated_at?: string | null;
};

/** Rechnungsempfänger printed on the invoice: the payer when set, else the patient. */
export type InvoiceRecipient = {
  name: string;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
  is_payer: boolean;
  has_postal_address: boolean;
  /** Street, postcode, city and a country the e-invoice can encode. */
  has_complete_address?: boolean;
  missing_address_parts?: string[];
  email?: string | null;
  kind?: "patient" | "relation" | "payer_patient" | "contact" | string;
  /** Frozen at release (§ 14 UStG, GoBD): later documents use this recipient. */
  frozen?: boolean;
  /** Leistungsempfänger printed when the invoice goes to someone else. */
  service_recipient_name?: string | null;
};

export type PayerRole = "contracting_party" | "cost_bearer";

/** A warning the release of a draft will raise about its recipient. */
export type InvoiceReleaseWarning = {
  code:
    | "recipient_address_incomplete"
    | "minor_patient_recipient"
    | "recipient_not_contracting_party"
    | "advance_recipient_mismatch"
    | string;
  missing?: string[];
  advance_invoice_numbers?: (string | null)[];
};

export type InvoiceReleaseChecks = {
  warnings: InvoiceReleaseWarning[];
  contracting_party?: {
    kind: string;
    debtor_name: string;
    patient_is_minor: boolean;
  } | null;
  recipient_is_contracting_party?: boolean;
};

/** The archived PDF of an issued invoice (GoBD): rendered once, served unchanged. */
export type InvoiceStoredDocument = {
  file_name: string;
  sha256: string;
  /** `release`, or `first_download` for invoices issued before documents were kept. */
  generation_trigger: "release" | "first_download" | string;
  generated_at: string;
};

/** A relative of the patient that can be chosen as the invoice payer. */
export type PayerRelationOption = {
  id: string;
  related_name: string;
  relation_type: string;
  related_patient_pid?: string | null;
  related_patient_name?: string | null;
  has_address: boolean;
  /** Receives the patient's invoices unless an order names another payer. */
  is_default_payer?: boolean;
};

export type InvoiceItem = {
  currency?: string;
  id: string;
  quote_id: string | null;
  quote_number: string | null;
  order_id: string | null;
  order_number: string | null;
  contract_id: string | null;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  /** Assigned when the invoice is released; drafts have none. */
  invoice_number: string | null;
  invoice_type: InvoiceType | string;
  status: InvoiceStatus | string;
  display_status?: InvoiceDisplayStatus | string;
  /** List view: the active dunning block; detail: block state with history. */
  dunning_block?: InvoiceDunningBlockState | { reason: string; blocked_at: string | null } | null;
  storno_document?: InvoiceStornoDocument | null;
  issued_at: string;
  /** Set once the invoice was issued; drafts (also cancelled ones) have none. */
  released_at?: string | null;
  due_date: string | null;
  total_net: unknown;
  total_vat: unknown;
  total_gross: unknown;
  credited_amount?: unknown;
  adjusted_total_gross?: unknown;
  paid_amount: unknown;
  prepayment_applied_amount?: unknown;
  balance_due: unknown;
  /** Paid advance of the order not applied yet that would cover this invoice. */
  advance_credit_available?: unknown;
  /** Balance due net of `advance_credit_available`. */
  amount_to_pay?: unknown;
  credit_balance?: unknown;
  refundable_cash_amount?: unknown;
  credit_transfers?: InvoiceCreditTransfer[];
  credit_transfer_targets?: InvoiceCreditTransferTarget[];
  paid_at: string | null;
  notes: string | null;
  portal_visible?: boolean;
  hide_amounts_from_patient?: boolean;
  line_items_visible_to_patient?: boolean;
  pdf_visible_to_patient?: boolean;
  portal_visibility?: InvoicePortalVisibility;
  visibility_note?: string | null;
  payer?: InvoicePayer;
  recipient?: InvoiceRecipient | null;
  /** Drafts: what the release will check about the recipient. */
  release_checks?: InvoiceReleaseChecks | null;
  stored_document?: InvoiceStoredDocument | null;
  payer_relation_options?: PayerRelationOption[];
  created_at: string;
  updated_at: string;
  line_items?: InvoiceLineItem[];
  supporting_documents?: SupportingDocument[];
  available_prepayments?: InvoicePrepaymentOption[];
  prepayment_allocations?: InvoicePrepaymentAllocation[];
  creditable_lines?: InvoiceCreditableLine[];
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
  /** New payment deadline the letter sets. */
  payment_due_date?: string | null;
  /** The stored letter (Zahlungserinnerung, 1. or 2. Mahnung). */
  letter?: { file_name: string; generated_at: string | null } | null;
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
  invoice_id?: string | null;
  external_invoice_id?: string | null;
  source_document_id?: string | null;
  source_document_name?: string | null;
  order_id?: string | null;
  patient_id?: string | null;
  invoice_number?: string | null;
  external_invoice_number?: string | null;
  order_number?: string | null;
  patient_pid?: string | null;
  patient_name?: string | null;
};

export type AccountingLedgerPayload = {
  currency?: string;
  available_currencies?: string[];
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
  currency?: string;
  id: string;
  order_id: string;
  order_number: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  quote_number: string;
  status?: string;
  active_invoice_types?: string[];
  /** The order's required prepayment: the default amount of an advance invoice. */
  order_prepayment_amount?: string | null;
  order_prepayment_required?: boolean;
  total_gross: unknown;
  line_items: InvoiceLineItem[];
};

export type Filters = {
  search: string;
  patientId: string;
  orderId: string;
  quoteId: string;
  status: string;
  invoiceType: string;
};

/** What an advance invoice bills: the order's required prepayment or selected positions. */
export type AdvanceBasis = "prepayment" | "positions";

export type CreateForm = {
  advanceBasis: AdvanceBasis;
  quoteId: string;
  invoiceType: InvoiceType;
  dueDate: string;
  notes: string;
  selectedLineIndexes: number[];
  lineQuantities: Record<string, string>;
};

export type StatusForm = {
  status: InvoiceStatus;
  dueDate: string;
  notes: string;
  /** Storno reason (cancelling a released invoice) or dunning block reason
   * (overdue back to sent). */
  reason: string;
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
  /** Patient number of a payer who is another patient record. */
  payerPatientPid: string;
  payerRole: PayerRole | "";
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactRelationship: string;
  addressStreet: string;
  addressZip: string;
  addressCity: string;
  addressCountry: string;
  notes: string;
};

export type InvoicesPermissions = {
  canView: boolean;
  canCreate: boolean;
  canManage: boolean;
  canAccounting: boolean;
  /** Set the payer of a draft invoice (`invoices.payer`). */
  canEditPayer: boolean;
};
