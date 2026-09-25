
export type ContractStatus = "draft" | "sent" | "signed" | "expired" | "terminated";
/** Statuses staff can set on a quote. */
export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";
/**
 * Set only by the server: a newer quote of the same order closed this one, so
 * nothing more can be invoiced from it. Terminal.
 */
export type QuoteSystemStatus = "superseded";

export type ContractItem = {
  id: string;
  patient_id: string | null;
  lead_id?: string | null;
  patient_name: string;
  patient_pid: string;
  contract_number: string;
  status: ContractStatus | string;
  signed_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  terminated_at?: string | null;
  termination_reason?: string | null;
  terminated_by_name?: string | null;
  conditions: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type QuoteLineItem = {
  description: string;
  quantity: string;
  unit_price: string;
  vat_rate: string;
  is_cost_passthrough: boolean;
  line_net: string;
  line_vat: string;
  line_gross: string;
  provider_id?: string | null;
  doctor_id?: string | null;
  notes?: string | null;
};

export type QuoteItem = {
  currency?: string;
  id: string;
  order_id: string;
  order_number: string;
  contract_id: string | null;
  patient_id: string | null;
  lead_id?: string | null;
  patient_name: string;
  patient_pid: string;
  quote_number: string;
  status: QuoteStatus | QuoteSystemStatus | string;
  total_net: unknown;
  total_vat: unknown;
  total_gross: unknown;
  valid_until: string | null;
  paid_amount: unknown;
  paid_at: string | null;
  notes: string | null;
  version_count?: number;
  current_version_number?: number;
  /** The newer quote of the order that closed this one. */
  superseded_by_quote_id?: string | null;
  superseded_by_quote_number?: string | null;
  superseded_at?: string | null;
  /** Earlier quotes of the order this quote closed (detail only). */
  superseded_quotes?: Array<{ id: string; quote_number: string }>;
  created_at: string;
  updated_at: string;
  line_items?: QuoteLineItem[];
};

export type QuoteVersionItem = {
  id: string;
  quote_id: string;
  version_number: number;
  order_id: string;
  quote_number: string;
  status: QuoteStatus | string;
  total_net: unknown;
  total_vat: unknown;
  total_gross: unknown;
  valid_until: string | null;
  paid_amount: unknown;
  paid_at: string | null;
  notes: string | null;
  change_reason: string | null;
  line_item_count: number;
  created_at: string;
  created_by_name: string;
  created_by_role: string;
};

export type QuoteLineItemRow = QuoteLineItem & {
  id: string;
};

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
  phase: string;
  status: string;
  total_estimated?: unknown;
};

export type ContractFilters = {
  search: string;
  patientId: string;
  status: string;
};

export type QuoteFilters = {
  search: string;
  patientId: string;
  orderId: string;
  status: string;
};

export type ContractFormState = {
  patientId: string;
  status: ContractStatus;
  signedAt: string;
  conditionsText: string;
};

export type ContractStatusFormState = {
  status: ContractStatus;
  signedAt: string;
  conditionsText: string;
};

export type QuoteFormState = {
  orderId: string;
  validUntil: string;
  notes: string;
};

export type QuoteStatusFormState = {
  status: QuoteStatus;
  paidAmount: string;
  notes: string;
};

export type AgencyServiceItem = {
  description_items?: import("@/lib/service-description").ServiceDescriptionItem[] | null;
  id: string;
  service_key: string;
  service_name: string;
  description: string | null;
  unit_label: string;
  unit_price: unknown;
  currency: string;
  vat_rate: unknown;
  is_active: boolean;
  /** Flat fee ("Pauschale") that becomes due in full when the contract is terminated. */
  due_in_full_on_termination?: boolean;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string | null;
  updated_at: string | null;
  usage_count?: number;
  price_versions?: AgencyServicePriceVersion[];
};

export type AgencyServicePriceVersion = {
  id: string;
  name?: string | null;
  unit_price: unknown;
  currency: string;
  vat_rate: unknown;
  valid_from: string;
  valid_to: string | null;
  created_at: string | null;
};

export type AgencyServiceFilters = {
  search: string;
  activeOnly: string;
};

export type AgencyServiceFormState = {
  descriptionItems?: import("@/lib/service-description").ServiceDescriptionItem[];
  id: string;
  serviceKey: string;
  serviceName: string;
  description: string;
  unitLabel: string;
  unitPrice: string;
  currency: string;
  vatRate: string;
  isActive: boolean;
  dueInFullOnTermination: boolean;
  validFrom: string;
  validTo: string;
};

export type ContractsPermissions = {
  canViewPage: boolean;
  canCreateContract: boolean;
  canManageContract: boolean;
  canCreateQuote: boolean;
  canManageQuote: boolean;
  canManageCatalog: boolean;
  canTerminateContract: boolean;
};
