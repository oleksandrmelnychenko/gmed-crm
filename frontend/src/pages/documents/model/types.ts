export type DocumentStatus = "draft" | "active" | "archived";
export type DocumentVisibility =
  | "internal"
  | "released_internal"
  | "released_external"
  | "patient_visible";
export type DocumentDirection = "incoming" | "outgoing";
export type DocumentVariant = "original" | "translation";
export type DocumentAccessCategory =
  | "internal"
  | "patient"
  | "provider"
  | "authority"
  | "financial"
  | "medical"
  | "other";
export type DocumentFinancialStatus =
  | "open"
  | "in_progress"
  | "paid"
  | "overdue"
  | "billed_to_patient"
  | "reimbursed";
export type DocumentPaymentMethod =
  | "cash"
  | "bank_transfer"
  | "card"
  | "other";

type DocumentClassificationSuggestion = {
  art: string;
  category: string;
  is_medical: boolean;
  confidence: string;
  rationale: string;
};

export type DocumentItem = {
  id: string;
  patient_id: string | null;
  lead_id?: string | null;
  lead_name?: string | null;
  has_active_patient_portal_user: boolean;
  order_id: string | null;
  appointment_id: string | null;
  provider_context_ids?: string[];
  patient_pid: string | null;
  patient_name: string | null;
  order_number: string | null;
  appointment_title: string | null;
  auto_name: string;
  original_filename: string | null;
  art: string;
  category: string | null;
  status: string;
  visibility: string;
  is_medical: boolean;
  mime_type: string | null;
  file_size: number | null;
  has_stored_file: boolean;
  klinik: string | null;
  ursprung: string | null;
  document_direction: DocumentDirection | null;
  document_variant: DocumentVariant | null;
  document_language: string | null;
  access_category: DocumentAccessCategory | null;
  document_date: string | null;
  source_person: string | null;
  source_institution: string | null;
  addressee_person: string | null;
  addressee_institution: string | null;
  financial_status: DocumentFinancialStatus | null;
  payment_due_date: string | null;
  payment_date: string | null;
  payment_method: DocumentPaymentMethod | null;
  generated_template_id: string | null;
  generated_bindings?: Record<string, unknown> | null;
  generated_manual_text?: string | null;
  notes: string | null;
  signed_at?: string | null;
  signed_by?: string | null;
  compliance_kind?: string | null;
  uploaded_by_name: string | null;
  version_root_document_id: string;
  replaces_document_id: string | null;
  superseded_by_document_id: string | null;
  version_number: number;
  version_count: number;
  is_latest_version: boolean;
  file_deleted_at: string | null;
  file_deleted_by: string | null;
  file_deleted_by_name: string | null;
  file_delete_reason: string | null;
  created_at: string;
  updated_at: string;
  share_count: number;
  shared_to_current: boolean;
  data_sensitivity: string;
  needs_categorization: boolean;
  classification_suggestion: DocumentClassificationSuggestion | null;
};

export type DocumentShare = {
  id: string;
  shared_with_provider_id: string | null;
  shared_with_user_id: string | null;
  provider_name: string | null;
  target_user_name: string | null;
  target_user_role: string | null;
  shared_by_name: string | null;
  channel: string | null;
  message: string | null;
  requires_confirmation: boolean;
  confirmed: boolean;
  confirmed_at: string | null;
  shared_at: string;
  revoked_at: string | null;
};

export type TranslationRequest = {
  id: string;
  document_id: string;
  patient_id: string | null;
  requested_language: string;
  status: string;
  note: string | null;
  source_language: string | null;
  source_text: string | null;
  translated_text: string | null;
  request_source: string;
  requested_by: string;
  requested_by_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_at: string | null;
  translated_by: string | null;
  translated_by_name: string | null;
  translated_document_id: string | null;
  translated_document_name: string | null;
  requested_at: string;
  completed_at: string | null;
  translated_at: string | null;
  updated_at: string;
  document_name?: string | null;
  document_art?: string | null;
  document_category?: string | null;
  patient_pid?: string | null;
  patient_name?: string | null;
};

export type TranslationWorkspaceDraft = {
  assignedTo: string | null;
  note: string;
  sourceLanguage: string;
  sourceText: string;
  translatedText: string;
};

export type DocumentTextExtraction = {
  status: string;
  method: string | null;
  message_key?: string | null;
  message: string | null;
  extracted_text: string | null;
  has_text: boolean;
  extracted_at: string | null;
  extracted_by: string | null;
  extracted_by_name: string | null;
};

export type StaffOption = { id: string; name: string; role: string };
export type CategoryOption = {
  key: string;
  label: string;
  label_de?: string;
  label_en?: string;
  is_medical?: boolean;
  description?: string | null;
  portal_group?: string;
  sort_order?: number;
  patient_visible?: boolean;
  parent_key?: string | null;
  level?: "category" | "subcategory" | "type" | string;
  short_code?: string | null;
  access_category?: DocumentAccessCategory | null;
  aliases?: string[];
  breadcrumb_label?: string;
  breadcrumb_label_de?: string;
};
export type CategoriesResponse = { categories: CategoryOption[]; arts: string[] };
export type PatientOption = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
  languages?: string[];
};
export type ProviderOption = {
  id: string;
  name: string;
  address_street?: string | null;
  address_city: string | null;
  address_country?: string | null;
  phone?: string | null;
  email?: string | null;
  provider_type?: string | null;
  taxonomy_node_id?: string | null;
  taxonomy_node_ids?: string[];
  taxonomy_path?: Array<{ id?: string | null }>;
};
export type OrderOption = { id: string; order_number: string; patient_pid: string };
export type AppointmentOption = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
};
export type FrameworkContractOption = {
  id: string;
  contract_number: string;
  status: string;
  signed_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  created_at: string;
};

export type FiltersState = {
  search: string;
  patientId: string;
  orderId: string;
  appointmentId: string;
  status: string;
  visibility: string;
  art: string;
  category: string;
  dateFrom: string;
  dateTo: string;
  klinik: string;
  ursprung: string;
  documentDirection: string;
  documentVariant: string;
  accessCategory: string;
  financialStatus: string;
};

export type UploadFormState = {
  file: File | null;
  patientId: string;
  orderId: string;
  appointmentId: string;
  autoName: string;
  art: string;
  category: string;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  isMedical: boolean;
  klinik: string;
  ursprung: string;
  documentDirection: DocumentDirection;
  documentVariant: DocumentVariant;
  documentLanguage: string;
  accessCategory: DocumentAccessCategory;
  documentDate: string;
  sourcePerson: string;
  sourceInstitution: string;
  addresseePerson: string;
  addresseeInstitution: string;
  financialStatus: DocumentFinancialStatus | "";
  paymentDueDate: string;
  paymentDate: string;
  paymentMethod: DocumentPaymentMethod | "";
  notes: string;
};

export type EditFormState = {
  patientId: string;
  orderId: string;
  appointmentId: string;
  autoName: string;
  art: string;
  category: string;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  isMedical: boolean;
  klinik: string;
  ursprung: string;
  documentDirection: DocumentDirection;
  documentVariant: DocumentVariant;
  documentLanguage: string;
  accessCategory: DocumentAccessCategory;
  documentDate: string;
  sourcePerson: string;
  sourceInstitution: string;
  addresseePerson: string;
  addresseeInstitution: string;
  financialStatus: DocumentFinancialStatus | "";
  paymentDueDate: string;
  paymentDate: string;
  paymentMethod: DocumentPaymentMethod | "";
  notes: string;
};

export type ShareFormState = {
  targetType: "user" | "provider";
  userId: string;
  providerId: string;
  channel: string;
  message: string;
  requiresConfirmation: boolean;
};

export type DocumentTemplate = {
  id: string;
  template_kind?: "builtin" | "provider";
  provider_id?: string | null;
  provider_name?: string | null;
  doctor_id?: string | null;
  doctor_name?: string | null;
  label: string;
  description: string;
  art: string;
  category: string;
  default_auto_name: string;
  default_status: DocumentStatus;
  default_visibility: DocumentVisibility;
  is_medical: boolean;
  supported_languages: string[];
  text_block_keys: string[];
};

export type TemplateTextBlock = {
  key: string;
  label: string;
  description: string;
};

export type TemplateCatalogResponse = {
  templates: DocumentTemplate[];
  text_blocks: TemplateTextBlock[];
};

/**
 * Manual "binding socket" overrides for generated agency/legal documents.
 * Keys mirror the backend `bindings` field names (snake_case); the two
 * `*_text` keys are multiline editors parsed into arrays on submit.
 */
export type DocumentBindingForm = Record<string, string>;

export type GenerateFormState = {
  templateId: string;
  patientId: string;
  orderId: string;
  appointmentId: string;
  replaceDocumentId: string;
  autoName: string;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  language: string;
  titleOverride: string;
  introduction: string;
  closingNote: string;
  klinik: string;
  ursprung: string;
  documentDirection: DocumentDirection;
  documentVariant: DocumentVariant;
  documentLanguage: string;
  accessCategory: DocumentAccessCategory;
  documentDate: string;
  sourcePerson: string;
  sourceInstitution: string;
  addresseePerson: string;
  addresseeInstitution: string;
  financialStatus: DocumentFinancialStatus | "";
  paymentDueDate: string;
  paymentDate: string;
  paymentMethod: DocumentPaymentMethod | "";
  notes: string;
  textBlockKeys: string[];
  manualText: string;
  manualTextDirty: boolean;
  bindings: DocumentBindingForm;
};

export type GenerateDocumentResponse = {
  id: string;
  auto_name: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  language?: string;
  generated_template_id?: string;
  version_number?: number;
  preview_html?: string;
};

export type UploadDocumentResponse = {
  id: string;
  patient_id?: string | null;
  lead_id?: string | null;
  art: string;
  category: string | null;
  is_medical: boolean;
  needs_categorization: boolean;
  classification_suggestion?: DocumentClassificationSuggestion | null;
};
