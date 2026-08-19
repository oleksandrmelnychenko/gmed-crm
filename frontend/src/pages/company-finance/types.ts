export type CompanyBalanceSide = "debit" | "credit" | "settled";
export type CompanyCashMovementKind = "inflow" | "outflow";
export type CompanyLiabilityKind = "payable" | "expected";

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
  liability_kind: CompanyLiabilityKind;
  amount_gross: string;
  order_id: string;
  order_number: string;
  patient_id: string;
  patient_pid: string;
  patient_name: string;
  provider_id: string | null;
  provider_name: string | null;
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
};

export type CompanyFinancialPosition = {
  currency: string;
  available_currencies: string[];
  as_of: string;
  period: { from: string; to: string };
  summary: CompanyFinancialSummary;
  patient_positions: CompanyPatientPosition[];
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
