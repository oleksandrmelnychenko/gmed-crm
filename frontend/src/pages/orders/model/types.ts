import type { SpecializationItem } from "@/pages/providers/model/types";

export type OrderPhase = "discovery" | "intake" | "execution" | "closure" | "followup";
export type OrderStatus = "active" | "paused" | "completed" | "cancelled";
type LeistungStatus = "draft" | "delivered" | "approved" | "cancelled";
export type ExternalInvoiceStatus =
  | "expected"
  | "received"
  | "approved"
  | "paid"
  | "overdue"
  | "cancelled";

export type OrderSummary = {
  id: string;
  order_number: string;
  patient_id: string | null;
  lead_id?: string | null;
  patient_name: string;
  patient_pid: string;
  phase: OrderPhase | string;
  status: OrderStatus | string;
  total_estimated?: unknown;
  signed_patient?: boolean;
  signed_agency?: boolean;
  prepayment_required?: boolean;
  date_from?: string | null;
  date_to?: string | null;
  created_at: string;
};

export type Leistung = {
  id: string;
  client_reference?: string | null;
  description: string;
  quantity: unknown;
  unit_price: unknown;
  currency: string;
  vat_rate: unknown;
  is_cost_passthrough: boolean;
  status: LeistungStatus | string;
  delivered_at?: string | null;
  approved_at?: string | null;
  notes: string | null;
  provider_id: string | null;
  provider_name: string | null;
  provider_taxonomy_node_id?: string | null;
  provider_taxonomy_node_code?: string | null;
  provider_taxonomy_node_name_de?: string | null;
  provider_taxonomy_node_name_ru?: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  source_interpreter_report_id?: string | null;
  source_medical_appointment_id?: string | null;
  agency_service_id?: string | null;
  agency_service_key?: string | null;
  agency_service_name?: string | null;
  external_document_id?: string | null;
  external_document_auto_name?: string | null;
  external_document_filename?: string | null;
};

type ExternalInvoice = {
  id: string;
  provider_id: string | null;
  provider_name: string | null;
  provider_taxonomy_node_id?: string | null;
  provider_taxonomy_node_code?: string | null;
  provider_taxonomy_node_name_de?: string | null;
  provider_taxonomy_node_name_ru?: string | null;
  external_invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  amount_net: unknown;
  amount_vat: unknown;
  amount_gross: unknown;
  currency: string;
  status: ExternalInvoiceStatus | string;
  received_at?: string | null;
  paid_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderDetail = {
  id: string;
  order_number: string;
  patient_id: string | null;
  lead_id?: string | null;
  source_lead_id?: string | null;
  contract_id?: string | null;
  patient_name: string;
  patient_pid: string | null;
  phase: OrderPhase | string;
  status: OrderStatus | string;
  needs_description: string | null;
  date_from?: string | null;
  date_to?: string | null;
  signed_patient?: boolean | null;
  signed_agency?: boolean | null;
  total_estimated: unknown;
  total_actual: unknown;
  leistungen: Leistung[];
  external_invoices?: ExternalInvoice[];
  process_gates?: OrderProcessGates | null;
  planning_preparation?: OrderPlanningPreparation | null;
  execution_flow?: OrderExecutionFlow | null;
  followup_flow?: OrderFollowupFlow | null;
  lifecycle?: OrderLifecycle | null;
  created_at: string;
  updated_at: string;
};

export type OrderProcessGates = {
  execution_ready: boolean;
  debt_hold: boolean;
  overdue_invoice_count: number;
  outstanding_balance?: string | null;
  debt_management?: OrderDebtManagement | null;
  billing_release_status: string;
  billing_release_note: string | null;
  billing_released_by: string | null;
  billing_released_at: string | null;
  package_coverage_status: string;
  package_coverage_note: string | null;
  package_coverage_decided_by: string | null;
  package_coverage_decided_at: string | null;
  financial_gate_ready: boolean;
  contract_gate_ready: boolean;
  signed_patient: boolean;
  signed_agency: boolean;
  payment_gate_required: boolean;
  payment_gate_ready: boolean;
  advance_invoice_count: number;
  paid_advance_invoice_count: number;
  blocking_reasons: string[];
};

type OrderDebtManagement = {
  status: string;
  effective_status: string;
  workflow_required: boolean;
  blocking: boolean;
  blocking_reason: string | null;
  note: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  next_review_at: string | null;
  last_contact_at: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
  overdue_invoice_count: number;
  outstanding_balance: string;
  created_at: string;
  updated_at: string;
};

export type OrderPlanningPreparation = {
  planning_ready: boolean;
  treatment_plan_status: string;
  treatment_plan_note: string | null;
  non_medical_required: boolean;
  interpreter_required: boolean;
  preparation_documents_status: string;
  interpreter_briefing_status: string;
  treatment_plan_ready: boolean;
  medical_bookings_ready: boolean;
  medical_total: number;
  medical_confirmed: number;
  non_medical_bookings_ready: boolean;
  non_medical_total: number;
  non_medical_confirmed: number;
  interpreter_assignment_ready: boolean;
  interpreter_confirmation_ready: boolean;
  interpreter_assigned: number;
  interpreter_confirmed: number;
  interpreter_briefing_ready: boolean;
  preparation_documents_ready: boolean;
  plan_finalized_at: string | null;
  plan_finalized_by: string | null;
  plan_finalized_by_name: string | null;
  preparation_documents_sent_at: string | null;
  preparation_documents_sent_by: string | null;
  preparation_documents_sent_by_name: string | null;
  interpreter_briefed_at: string | null;
  interpreter_briefed_by: string | null;
  interpreter_briefed_by_name: string | null;
  blocking_reasons: string[];
};

export type OrderExecutionFlow = {
  closure_ready: boolean;
  arrival_status: string;
  medical_execution_status: string;
  non_medical_execution_status: string;
  interpreter_service_status: string;
  issue_status: string;
  deviation_note: string | null;
  execution_summary: string | null;
  non_medical_required: boolean;
  interpreter_required: boolean;
  arrival_ready: boolean;
  medical_execution_ready: boolean;
  non_medical_execution_ready: boolean;
  interpreter_execution_ready: boolean;
  issue_ready: boolean;
  execution_checklist_ready: boolean;
  medical_completed: number;
  non_medical_completed: number;
  interpreter_completed: number;
  interpreter_confirmed_completed: number;
  approved_interpreter_reports: number;
  delivered_leistungen: number;
  concierge_completed: number;
  execution_documents: number;
  open_execution_checklist_count: number;
  arrival_recorded_at: string | null;
  medical_completed_at: string | null;
  non_medical_completed_at: string | null;
  interpreter_completed_at: string | null;
  issues_resolved_at: string | null;
  blocking_reasons: string[];
};

export type OrderFollowupFlow = {
  followup_ready: boolean;
  doctor_followup_status: string;
  followup_1w_status: string;
  followup_1m_status: string;
  followup_6m_status: string;
  package_end_date: string | null;
  suggested_package_end_date: string | null;
  package_end_status: string;
  results_handoff_status: string;
  followup_summary: string | null;
  doctor_followup_ready: boolean;
  followup_1w_ready: boolean;
  followup_1m_ready: boolean;
  followup_6m_ready: boolean;
  package_end_required: boolean;
  package_end_ready: boolean;
  results_handoff_ready: boolean;
  followup_activity_ready: boolean;
  closure_anchor_at: string | null;
  recommended_followup_1w_at: string | null;
  recommended_followup_1m_at: string | null;
  recommended_followup_6m_at: string | null;
  recommended_package_end_followup_at: string | null;
  followup_appointments_total: number;
  doctor_followup_visits: number;
  doctor_followup_tasks: number;
  followup_1w_visits: number;
  followup_1m_visits: number;
  followup_6m_visits: number;
  followup_1w_reminders: number;
  followup_1m_reminders: number;
  followup_6m_reminders: number;
  package_end_tasks: number;
  package_end_reminders: number;
  results_portal_shares: number;
  blocking_reasons: string[];
};

type LifecycleEvent = {
  from_stage: string | null;
  to_stage: string;
  transition_kind: string;
  note: string | null;
  created_at: string;
};

type OrderLifecycleTransition = {
  phase: string;
  blocked: boolean;
  reasons: string[];
};

type OrderLifecycle = {
  current_stage: string;
  stage_entered_at: string | null;
  next_stage: string | null;
  allowed_transitions: OrderLifecycleTransition[];
  history: LifecycleEvent[];
};

export type WorkflowChecklistItem = {
  id: string;
  checklist_key: string;
  item_key: string;
  item_text: string;
  owner_role: string;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_user_role: string | null;
  priority: string;
  due_date: string | null;
  linked_task_id: string | null;
  linked_task_status: string | null;
  is_completed: boolean;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
};

export type WorkflowChecklistResponse = {
  scope_type: string;
  scope_id: string;
  open_count: number;
  completed_count: number;
  blocked_reason?: string | null;
  items: WorkflowChecklistItem[];
};

export type WorkflowChecklistFormState = {
  itemText: string;
  ownerUserId: string;
  priority: string;
  dueDate: string;
};

export type OrderProcessGateFormState = {
  debtStatus: string;
  debtNote: string;
  debtOwnerUserId: string;
  debtNextReviewAt: string;
  debtLastContactAt: string;
  debtResolutionNote: string;
  billingReleaseStatus: string;
  billingReleaseNote: string;
  packageCoverageStatus: string;
  packageCoverageNote: string;
};

export type OrderPlanningFormState = {
  treatmentPlanStatus: string;
  treatmentPlanNote: string;
  nonMedicalRequired: boolean;
  interpreterRequired: boolean;
  preparationDocumentsStatus: string;
  interpreterBriefingStatus: string;
};

export type OrderExecutionFormState = {
  arrivalStatus: string;
  medicalExecutionStatus: string;
  nonMedicalExecutionStatus: string;
  interpreterServiceStatus: string;
  issueStatus: string;
  deviationNote: string;
  executionSummary: string;
};

export type OrderFollowupFormState = {
  doctorFollowupStatus: string;
  followup1wStatus: string;
  followup1mStatus: string;
  followup6mStatus: string;
  packageEndDate: string;
  packageEndStatus: string;
  resultsHandoffStatus: string;
  followupSummary: string;
};

export type PatientAssignmentOption = {
  user_id: string;
  user_name: string;
  user_role: string;
  user_active: boolean;
  revoked_at: string | null;
};

export type PatientOption = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
};

export type ProviderOption = {
  id: string;
  name: string;
  provider_type: string;
  address_city: string | null;
  fachbereich: string | null;
  taxonomy_node_id?: string | null;
  taxonomy_node_code?: string | null;
  taxonomy_node_name_de?: string | null;
  taxonomy_node_name_ru?: string | null;
  taxonomy_path?: Array<{
    id: string;
    code: string;
    name_de: string | null;
    name_ru: string | null;
  }>;
  taxonomy_node_ids?: string[];
};

export type DoctorOption = {
  id: string;
  name: string;
  fachbereich: string | null;
  specializations?: SpecializationItem[];
};

export type ProviderDetailResponse = {
  doctors?: DoctorOption[];
};

export type CreateResponse = {
  id: string;
};

export type PassportComplianceStatus = "valid" | "expiring" | "expired" | "unknown";

type PatientRecheckCheck = {
  key: string;
  label: string;
  passed: boolean;
  blocking_for: string;
  status?: PassportComplianceStatus;
  expiry?: string | null;
  days_until_expiry?: number | null;
};

type PatientRecheckDocumentAlerts = {
  missing_documents: Array<{ key: string; label: string }>;
  missing_count: number;
  out_of_sync: boolean;
  stored_document_pack_complete?: boolean;
};

type PatientRecheckContract = {
  id: string;
  contract_number: string;
  status: string;
  signed_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
};

export type PatientOrderRecheck = {
  requires_recheck: boolean;
  can_create_order: boolean;
  reason?: string | null;
  base_data_ready: boolean;
  compliance_ready: boolean;
  identity_ready: boolean;
  document_pack_ready: boolean;
  contract_ready: boolean;
  debt_hold: boolean;
  passport_status?: PassportComplianceStatus;
  passport_expired?: boolean;
  passport_expiring?: boolean;
  passport_expiry?: string | null;
  passport_days_until_expiry?: number | null;
  overdue_invoice_count: number;
  outstanding_balance?: string | null;
  debt_management?: {
    blocking: boolean;
    blocking_reason: string | null;
    overdue_invoice_count: number;
    outstanding_balance: string;
    latest_workflow?: {
      order_id: string;
      order_number: string;
      status: string;
      effective_status: string;
      blocking: boolean;
      note: string | null;
      owner_user_id: string | null;
      owner_name: string | null;
      next_review_at: string | null;
      last_contact_at: string | null;
      resolution_note: string | null;
      resolved_at: string | null;
      resolved_by: string | null;
      resolved_by_name: string | null;
      updated_at: string | null;
      overdue_invoice_count: number;
      outstanding_balance: string;
    } | null;
  } | null;
  base_data_missing_fields: string[];
  blocking_reasons: string[];
  checks: PatientRecheckCheck[];
  document_alerts: PatientRecheckDocumentAlerts;
  latest_framework_contract: PatientRecheckContract | null;
};

export type OrderDebtQueueItem = {
  order_id: string;
  order_number: string;
  phase: string;
  order_status: string;
  patient_id: string;
  patient_code: string;
  patient_name: string;
  status: string;
  effective_status: string;
  blocking_reason: string | null;
  note: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  next_review_at: string | null;
  last_contact_at: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  updated_at: string | null;
  overdue_invoice_count: number;
  outstanding_balance: string;
};

export type OrdersFilters = {
  search: string;
  phase: string;
  status: string;
  patientId: string;
  providerId: string;
  providerTaxonomyNodeId: string;
  doctorId: string;
};

export type CreateOrderFormState = {
  patientId: string;
  needsDescription: string;
};

export type LeistungFormState = {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  providerId: string;
  doctorId: string;
  externalDocumentId: string;
  notes: string;
  isCostPassthrough: boolean;
};

export type SupportingDocumentOption = {
  id: string;
  order_id?: string | null;
  auto_name: string;
  original_filename?: string | null;
  art?: string | null;
  category?: string | null;
  has_stored_file?: boolean;
  file_deleted_at?: string | null;
};

export type ExternalInvoiceFormState = {
  providerId: string;
  externalInvoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amountNet: string;
  amountVat: string;
  amountGross: string;
  currency: string;
  status: ExternalInvoiceStatus;
  notes: string;
};

export type OrdersPermissions = {
  canViewPage: boolean;
  canCreate: boolean;
  canManagePhase: boolean;
  canAddLeistung: boolean;
  canApproveLeistung: boolean;
  canManageExternalInvoices: boolean;
};
