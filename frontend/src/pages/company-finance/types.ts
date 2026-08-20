export type CompanyBalanceSide = "debit" | "credit" | "settled";
export type CompanyCashMovementKind = "inflow" | "outflow";
export type CompanyLiabilityKind = "payable" | "expected" | "settled";
export type CompanyProviderSettlementStatus =
  | "unpaid"
  | "partial"
  | "paid"
  | "paid_by_patient";

export type CompanyFinancialSummary = {
  patient_receivables_calculated: string;
  patient_credits: string;
  provider_payables: string;
  expected_provider_costs: string;
  unreconciled_external_receivables: string;
  reconciliation_required: boolean;
  reconciliation_patient_count: number;
  calculated_net_position: string;
  confirmed_net_position: string | null;
  cash_inflow: string;
  cash_outflow: string;
  net_cash_flow: string;
};

export type CompanyPatientPosition = {
  patient_id: string;
  patient_pid: string;
  patient_name: string;
  is_active: boolean;
  invoice_due: string;
  external_receivable: string;
  manual_balance: string;
  available_prepayment: string;
  calculated_balance: string;
  balance_side: CompanyBalanceSide;
  reconciliation_required: boolean;
};

export type CompanyProviderLiability = {
  id: string;
  external_invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  status: string;
  paid_by: "patient" | "agency" | "unpaid";
  liability_kind: CompanyLiabilityKind;
  amount_gross: string;
  company_paid_gross: string;
  remaining_gross: string;
  settlement_status: CompanyProviderSettlementStatus;
  latest_payment_on: string | null;
  payment_count: number;
  order_id: string;
  order_number: string;
  patient_id: string;
  patient_pid: string;
  patient_name: string;
  provider_id: string | null;
  provider_name: string | null;
};

export type CompanyProviderPosition = {
  provider_id: string | null;
  provider_name: string | null;
  invoice_total_gross: string;
  company_paid_gross: string;
  payable_remaining_gross: string;
  expected_remaining_gross: string;
  invoice_count: number;
  open_invoice_count: number;
  partial_invoice_count: number;
  settled_invoice_count: number;
  latest_payment_on: string | null;
};

export type CompanyProviderFinancialSummary = CompanyProviderPosition & {
  provider_id: string;
  provider_name: string;
  currency: string;
};

export type CompanyProviderPaymentTransaction = {
  id: string;
  external_invoice_id: string;
  financial_account_id: string;
  financial_account_name: string;
  transaction_type: "payment" | "reversal";
  reverses_transaction_id: string | null;
  amount_gross: string;
  currency: string;
  paid_on: string;
  payment_method: "bank_transfer" | "cash" | "card" | "other";
  reference: string | null;
  note: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
};

export type CompanyProviderSettlement = {
  external_invoice_id: string;
  external_invoice_number: string;
  amount_gross: string;
  currency: string;
  status: string;
  paid_by: "patient" | "agency" | "unpaid";
  company_paid_gross: string;
  remaining_provider_liability_gross: string;
  settlement_status: CompanyProviderSettlementStatus;
  latest_payment_on: string | null;
  payment_count: number;
  transactions: CompanyProviderPaymentTransaction[];
};

export type CompanyProviderStatementMovement = {
  id: string;
  movement_date: string;
  movement_type: "invoice" | "payment" | "reversal";
  external_invoice_id: string;
  external_invoice_number: string;
  amount_charged: string;
  amount_paid: string;
  running_balance: string;
  order_id: string;
  order_number: string;
  patient_id: string;
  patient_pid: string;
  patient_name: string;
  financial_account_name: string | null;
  reference: string | null;
};

export type CompanyProviderStatement = {
  provider_id: string;
  provider_name: string;
  currency: string;
  period: { from: string; to: string };
  summary: {
    opening_balance: string;
    charged_gross: string;
    paid_gross: string;
    reversed_gross: string;
    expected_gross: string;
    closing_balance: string;
  };
  movements: CompanyProviderStatementMovement[];
  generated_at: string;
};

export type CompanyCashMovement = {
  id: string;
  entry_date: string;
  movement: CompanyCashMovementKind;
  category: string;
  description: string;
  amount_net: string;
  amount_vat: string;
  amount_gross: string;
  signed_amount: string;
  invoice_number: string | null;
  external_invoice_number: string | null;
  order_id: string | null;
  order_number: string | null;
  patient_id: string | null;
  patient_pid: string | null;
  patient_name: string | null;
  financial_account_id: string | null;
  financial_account_name: string | null;
};

export type CompanyFinancialAccount = {
  id: string;
  name: string;
  account_type: "bank" | "cash" | "card" | "other";
  currency: string;
  iban: string | null;
  opening_balance: string;
  opening_balance_on: string;
  movement_balance: string;
  adjustment_balance: string;
  transfer_balance: string;
  current_balance: string;
  movement_count: number;
  transfer_count: number;
  latest_movement_on: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CompanyFinancialAccountAdjustment = {
  id: string;
  financial_account_id: string;
  account_name: string;
  transaction_type: "adjustment" | "reversal";
  reverses_adjustment_id: string | null;
  direction: "inflow" | "outflow";
  amount: string;
  currency: string;
  effective_on: string;
  reason: string;
  note: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
};

export type CompanyFinancialAccountTransfer = {
  id: string;
  transaction_type: "transfer" | "reversal";
  reverses_transfer_id: string | null;
  source_account_id: string;
  source_account_name: string;
  target_account_id: string;
  target_account_name: string;
  amount: string;
  currency: string;
  effective_on: string;
  reference: string | null;
  note: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
};

export type CompanyFinancialAccountsPayload = {
  currency: string;
  available_currencies: string[];
  items: CompanyFinancialAccount[];
  adjustments: CompanyFinancialAccountAdjustment[];
  transfers: CompanyFinancialAccountTransfer[];
  unassigned_movement_count: number;
  unassigned_signed_amount: string;
  generated_at: string;
};

export type CompanyFinancialPosition = {
  currency: string;
  available_currencies: string[];
  as_of: string;
  period: { from: string; to: string };
  summary: CompanyFinancialSummary;
  patient_positions: CompanyPatientPosition[];
  provider_positions: CompanyProviderPosition[];
  provider_liabilities: CompanyProviderLiability[];
  cash_movements: CompanyCashMovement[];
  cash_movement_count: number;
  cash_movements_truncated: boolean;
  generated_at: string;
};

export type CompanyFinancialFilters = {
  from: string;
  to: string;
  currency: string;
  movement: "all" | CompanyCashMovementKind;
  search: string;
};

export type CompanyConciergeExpenseStatus =
  | "pending_review"
  | "posted"
  | "rejected"
  | "reversed";

export type CompanyConciergeExpensePaidBy = "patient" | "agency" | "unpaid";

export type CompanyConciergeServiceSummary = {
  id: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  title: string;
  status: string;
  currency: string;
  provider_id: string | null;
  provider_name: string | null;
};

export type CompanyConciergeExpenseActor = {
  id: string | null;
  display_name: string | null;
};

export type CompanyConciergeExpenseHistoryEvent = {
  action: "submitted" | "posted" | "rejected" | "reversed";
  actor: CompanyConciergeExpenseActor;
  reason: string | null;
  created_at: string | null;
};

export type CompanyConciergeExpenseItem = {
  id: string;
  concierge_service_id: string;
  patient_id: string;
  order_id: string | null;
  order_number: string | null;
  order_leistung_id: string | null;
  order_leistung_name: string | null;
  vendor: string;
  expense_date: string;
  amount_net: string;
  amount_vat: string;
  amount_gross: string;
  currency: string;
  paid_by: CompanyConciergeExpensePaidBy;
  service_delivered: boolean;
  note: string | null;
  status: CompanyConciergeExpenseStatus;
  submitted_by: CompanyConciergeExpenseActor;
  submitted_at: string | null;
  receipt: {
    document_id: string;
    original_filename: string | null;
    mime_type: string | null;
    file_size: number | null;
    download_url: string;
  };
  external_invoice: {
    id: string;
    status: string | null;
    paid_by: string | null;
    service_delivered: boolean | null;
    provider_payment_transaction_id: string | null;
    settlement_status: string | null;
  } | null;
  balance_consequence: {
    posting_pending: boolean;
    patient_receivable_gross: string;
    company_paid_gross: string;
    provider_liability_gross: string;
    intended_patient_receivable_gross: string;
    intended_company_paid_gross: string;
    intended_provider_liability_gross: string;
  };
  history: CompanyConciergeExpenseHistoryEvent[];
};

export type CompanyConciergeExpenseReviewRow = CompanyConciergeExpenseItem & {
  service: CompanyConciergeServiceSummary;
};

export type CompanyConciergeExpenseOrderService = {
  id: string;
  name: string;
  description: string | null;
  provider_id: string | null;
};

export type CompanyConciergeExpenseOrder = {
  id: string;
  order_number: string;
  currency: string;
  status: string;
  leistungen: CompanyConciergeExpenseOrderService[];
};

export type CompanyConciergeExpenseContext = {
  patient: {
    id: string;
    display_name: string;
    pid: string;
  };
  service: {
    id: string;
    title: string;
    currency: string;
    provider_id: string | null;
  };
  mapped_order: CompanyConciergeExpenseOrder | null;
  eligible_orders: CompanyConciergeExpenseOrder[];
};

export type CompanyConciergeExpensePaymentMethod =
  | "bank_transfer"
  | "cash"
  | "card"
  | "other";

export type CompanyConciergeExpensePostPayload = {
  request_id: string;
  order_id: string;
  order_leistung_id: string | null;
  financial_account_id: string | null;
  paid_on: string | null;
  payment_method: CompanyConciergeExpensePaymentMethod | null;
  payment_reference: string | null;
};

export type CompanyConciergeExpenseMutationResponse = {
  item: CompanyConciergeExpenseItem;
  idempotent_replay: boolean;
};

export type CompanyConciergeExpenseListResponse = {
  items: CompanyConciergeExpenseItem[];
};

export type CompanyConciergeExpenseReviewQueuePage = {
  items: CompanyConciergeExpenseReviewRow[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
};

export type CompanyConciergeExpenseQueuePayload = {
  rows: CompanyConciergeExpenseReviewRow[];
  total_count: number;
  loaded_count: number;
  complete: boolean;
};
