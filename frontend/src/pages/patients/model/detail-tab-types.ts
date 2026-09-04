export type CaseItem = {
  id: string;
  case_id: string;
  status: string;
  hauptanfragegrund?: string | null;
  created_at: string;
  updated_at?: string | null;
  zuweiser?: string | null;
  manager_name?: string | null;
};

export type OrderItem = {
  id: string;
  order_number: string;
  phase: string;
  status: string;
  needs_description?: string | null;
  created_at: string;
  total_estimated?: string | number | null;
  total_actual?: string | number | null;
  currency?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  signed_patient?: boolean;
  signed_agency?: boolean;
  signed_at?: string | null;
};

export type AppointmentItem = {
  id: string;
  title: string;
  date: string;
  time_start?: string | null;
  apt_type: string;
  care_path_kind: string;
  status: string;
  provider_name?: string | null;
  doctor_name?: string | null;
};

export type RelationItem = {
  id: string;
  related_patient_id?: string | null;
  related_patient_pid?: string | null;
  related_name: string;
  related_display_name?: string | null;
  relation_type: string;
  is_emergency_contact: boolean;
  phone?: string | null;
  notes?: string | null;
  created_at: string;
};

export type PatientLookupItem = {
  id: string;
  patient_id: string;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

export type DocumentItem = {
  id: string;
  document_number?: string | null;
  generated_template_id?: string | null;
  order_id?: string | null;
  version_root_document_id?: string | null;
  replaces_document_id?: string | null;
  version_number?: number | null;
  file_size?: number | null;
  is_medical?: boolean;
  mime_type?: string | null;
  filename: string;
  category?: string | null;
  status?: string | null;
  uploaded_by_name?: string | null;
  document_direction?: string | null;
  document_variant?: string | null;
  document_language?: string | null;
  access_category?: string | null;
  document_date?: string | null;
  source_person?: string | null;
  source_institution?: string | null;
  addressee_person?: string | null;
  addressee_institution?: string | null;
  financial_status?: string | null;
  payment_due_date?: string | null;
  payment_date?: string | null;
  payment_method?: string | null;
  created_at: string;
};

export type DocumentStatus = "draft" | "active" | "archived";

export type DocumentVisibility =
  | "internal"
  | "released_internal"
  | "released_external"
  | "patient_visible";

type DocumentAlertRule = {
  key: string;
  label: string;
  fulfilled: boolean;
  matching_documents: Array<{
    id: string;
    filename: string;
    art: string;
    category?: string | null;
    status: string;
  }>;
};

export type DocumentAlerts = {
  configured_rule_count: number;
  document_pack_complete: boolean;
  stored_document_pack_complete: boolean;
  out_of_sync: boolean;
  required_documents: DocumentAlertRule[];
  missing_documents: Array<{ key: string; label: string }>;
  missing_count: number;
};

export type ContractItem = {
  id: string;
  contract_number: string;
  status: string;
  signed_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  created_at: string;
};

export type InvoiceItem = {
  id: string;
  patient_id?: string;
  invoice_number: string;
  invoice_type: string;
  status: string;
  issued_at: string;
  due_date?: string | null;
  total_gross?: string | null;
  paid_amount?: string | null;
  balance_due?: string | null;
  order_number?: string | null;
  quote_number?: string | null;
  portal_visible?: boolean;
  hide_amounts_from_patient?: boolean;
  line_items_visible_to_patient?: boolean;
  pdf_visible_to_patient?: boolean;
  portal_visibility?: {
    visible_to_patient: boolean;
    amounts_visible_to_patient: boolean;
    line_items_visible_to_patient: boolean;
    pdf_visible_to_patient: boolean;
    redaction_reason: string | null;
  };
  payer?: {
    contact_name?: string | null;
    contact_relationship?: string | null;
  };
};

type PatientFinancialBreakdownByOrder = {
  order_id: string | null;
  package_id: string | null;
  invoice_id: string;
  invoice_number: string;
  status: string;
  revenue_net: string;
  revenue_vat: string;
  revenue_gross: string;
  paid_amount: string;
  open_balance: string;
};

type PatientFinancialBreakdownByService = {
  service_type: string;
  revenue_net: string;
  revenue_gross: string;
};

export type PatientFinancialSummary = {
  patient_id: string;
  currency: string;
  revenue_net: string;
  revenue_vat: string;
  revenue_gross: string;
  paid_amount: string;
  open_balance: string;
  overdue_amount: string;
  expenses_net: string | null;
  expenses_vat: string | null;
  expenses_gross: string | null;
  margin_net: string | null;
  margin_percent: string | null;
  margin_visible: boolean;
  reconciliation_required?: boolean;
  filters?: {
    from?: string | null;
    to?: string | null;
    order_id?: string | null;
    package_id?: string | null;
    include_pass_through?: boolean;
  };
  breakdown_by_order: PatientFinancialBreakdownByOrder[];
  breakdown_by_service_type: PatientFinancialBreakdownByService[];
  issues: string[];
};

export type PatientFinancialLedgerEntry = {
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
};

export type PatientFinancialLedger = {
  patient_id: string;
  margin_visible: boolean;
  entries: PatientFinancialLedgerEntry[];
};

export type PatientAccountStatementItem = {
  id: string;
  kind: "invoice" | "prepayment" | "external_expense" | "service";
  entry_date: string;
  order_id?: string | null;
  order_number?: string | null;
  document_number?: string | null;
  description: string;
  status: string;
  payment_state: string;
  paid_by?: "patient" | "agency" | "unpaid" | null;
  service_delivered?: boolean;
  amounts_visible: boolean;
  amount_gross?: string | null;
  cash_paid?: string | null;
  prepayment_applied?: string | null;
  prepayment_allocated?: string | null;
  prepayment_available?: string | null;
  patient_receivable?: string | null;
  allocated_receivable?: string | null;
  remaining_receivable?: string | null;
  provider_liability?: string | null;
  amount_due?: string | null;
  quantity?: string | null;
  invoiced_quantity?: string | null;
  currency?: string | null;
  due_date?: string | null;
};

export type PatientAccountMovement = {
  id: string;
  kind:
    | "invoice"
    | "payment"
    | "payment_reversal"
    | "refund"
    | "refund_reversal"
    | "balance_adjustment"
    | "balance_adjustment_reversal"
    | "external_receivable"
    | "external_allocation"
    | "external_allocation_reversal";
  direction: "debit" | "credit";
  entry_date: string;
  occurred_at: string;
  order_id?: string | null;
  order_number?: string | null;
  document_number?: string | null;
  description: string;
  debit: string;
  credit: string;
  balance_after: string;
  currency: string;
};

export type PatientBalanceAdjustment = {
  id: string;
  patient_id: string;
  order_id?: string | null;
  order_number?: string | null;
  transaction_type: "adjustment" | "reversal";
  reverses_adjustment_id?: string | null;
  reversed_by_adjustment_id?: string | null;
  is_reversed: boolean;
  direction: "debit" | "credit";
  category: "opening_balance" | "fee" | "goodwill" | "correction" | "other";
  amount: string;
  currency: string;
  effective_on: string;
  reason: string;
  note?: string | null;
  portal_visible: boolean;
  created_by: string;
  created_by_name: string;
  created_by_role: string;
  created_at: string;
};

export type PatientBalanceAdjustmentResponse = {
  items: PatientBalanceAdjustment[];
};

export type PatientAccountStatement = {
  patient_id: string;
  currency: string;
  available_currencies: string[];
  scope: "staff" | "patient_portal";
  amounts_complete: boolean;
  summary: {
    invoiced_gross: string;
    cash_paid: string;
    prepayment_applied: string;
    available_prepayment: string;
    invoice_due: string;
    external_receivable: string | null;
    total_due: string | null;
    reconciliation_required: boolean;
    opening_balance: string;
    debit_total: string;
    credit_total: string;
    calculated_balance: string;
    closing_balance: string | null;
    balance_side: "debit" | "credit" | "settled" | "reconciliation_required";
    unreconciled_external_debit: string;
  };
  redaction: {
    hidden_invoice_amount_count: number;
    external_expense_count: number;
    services_hidden: boolean;
  };
  movements: PatientAccountMovement[];
  items: PatientAccountStatementItem[];
};

export type PatientServicePackageItem = {
  patient_service_package_id: string;
  package_id: string;
  order_id?: string | null;
  order_number?: string | null;
  package_name: string;
  status: string;
  package_price_version_id?: string | null;
  base_price_net_snapshot?: string;
  base_price_vat_snapshot?: string;
  base_price_gross_snapshot?: string;
  currency_snapshot?: string;
  tax_profile_id_snapshot?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
  assigned_at?: string;
  notes?: string | null;
  payer_contact_name?: string | null;
  payer_contact_relationship?: string | null;
  package_item_id?: string | null;
  service_key?: string | null;
  agency_service_name?: string | null;
  description?: string | null;
  included_quantity: string;
  unit_label?: string | null;
  used_quantity: string;
  remaining_quantity: string;
  overage_quantity: string;
  pending_overage_quantity?: string;
  approved_overage_quantity?: string;
  declined_overage_quantity?: string;
  pending_consumption_count?: number;
  latest_consumed_at?: string | null;
  requires_patient_approval: boolean;
};

export type DunningEvent = {
  id: string;
  invoice_id: string;
  level: "first" | "second" | "collections";
  note?: string | null;
  due_date_snapshot?: string | null;
  balance_due: string;
  sent_at: string;
  created_at: string;
  created_by_name: string;
  created_by_role: string;
};

export type WorkflowChecklistItem = {
  id: string;
  checklist_key: string;
  item_key: string;
  item_text: string;
  owner_role: string;
  owner_user_id?: string | null;
  owner_name?: string | null;
  owner_user_role?: string | null;
  priority: string;
  due_date?: string | null;
  linked_task_id?: string | null;
  linked_task_status?: string | null;
  is_completed: boolean;
  completed_at?: string | null;
  sort_order: number;
  created_at: string;
};

export type WorkflowChecklistResponse = {
  scope_type: string;
  scope_id: string;
  open_count: number;
  completed_count: number;
  items: WorkflowChecklistItem[];
};
