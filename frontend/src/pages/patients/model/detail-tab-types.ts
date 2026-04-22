export type CaseItem = {
  id: string;
  case_id: string;
  status: string;
  hauptanfragegrund?: string | null;
  created_at: string;
};

export type OrderItem = {
  id: string;
  order_number: string;
  phase: string;
  status: string;
  needs_description?: string | null;
  created_at: string;
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
  filename: string;
  category?: string | null;
  status?: string | null;
  uploaded_by_name?: string | null;
  created_at: string;
};

export type DocumentStatus = "draft" | "active" | "archived";

export type DocumentVisibility =
  | "internal"
  | "released_internal"
  | "released_external"
  | "patient_visible";

export type DocumentAlertRule = {
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
