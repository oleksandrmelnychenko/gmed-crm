import { useCallback, useMemo, useSyncExternalStore } from "react";
import { de } from "./de";
import { ru } from "./ru";

export interface Translations {
  app_name: string;
  app_subtitle: string;

  nav_dashboard: string;
  nav_admin: string;
  nav_users_roles: string;
  nav_access_matrix: string;
  nav_logout: string;
  nav_my_documents: string;
  nav_my_appointments: string;
  nav_my_invoices: string;
  nav_my_privacy: string;

  login_title: string;
  login_email: string;
  login_password: string;
  login_submit: string;
  login_loading: string;
  login_error_invalid: string;

  users_title: string;
  users_subtitle: string;
  users_new: string;
  users_create_title: string;
  users_name: string;
  users_email: string;
  users_password: string;
  users_role: string;
  users_status: string;
  users_created: string;
  users_actions: string;
  users_create_btn: string;
  users_creating: string;
  users_cancel: string;
  users_activate: string;
  users_deactivate: string;
  users_count: string;
  users_active: string;
  users_inactive: string;
  users_password_hint: string;

  role_ceo: string;
  role_ceo_assistant: string;
  role_patient_manager: string;
  role_teamlead_interpreter: string;
  role_interpreter: string;
  role_concierge: string;
  role_billing: string;
  role_sales: string;
  role_it_admin: string;
  role_patient: string;

  access_title: string;
  access_subtitle: string;
  access_entity: string;
  access_field: string;
  access_full: string;
  access_masked: string;
  access_hidden: string;
  access_conditional: string;
  access_system_locked: string;
  access_save: string;
  access_reset: string;

  common_loading: string;
  common_error: string;
  common_save: string;
  common_cancel: string;
  common_confirm: string;
  common_search: string;
  common_delete: string;
  common_archive: string;

  patients_title: string;
  patients_subtitle: string;
  patients_new: string;
  patients_last_name: string;
  patients_created: string;
  patients_gender: string;
  patients_create: string;
  patients_edit: string;
  providers_title: string;
  providers_subtitle: string;
  providers_new: string;
  providers_detail: string;
  providers_select_hint: string;
  providers_type: string;
  providers_type_medical: string;
  providers_type_non_medical: string;
  providers_active: string;
  providers_inactive: string;
  providers_activate: string;
  providers_deactivate: string;
  providers_city: string;
  providers_country: string;
  providers_street: string;
  providers_zip: string;
  providers_fachbereich: string;
  providers_contract: string;
  providers_contract_with: string;
  providers_contract_without: string;
  providers_notes: string;
  providers_website: string;
  providers_state: string;
  providers_stats: string;
  providers_open: string;
  providers_all: string;
  providers_doctors: string;
  providers_doctor_new: string;
  providers_doctor_detail: string;
  providers_doctor_title: string;
  providers_services: string;
  providers_service_new: string;
  providers_service_detail: string;
  providers_service_name: string;
  providers_service_price: string;
  providers_service_currency: string;
  providers_service_desc: string;
  providers_service_period: string;
  providers_service_valid_from: string;
  providers_service_valid_to: string;
  providers_linked_patients: string;
  providers_no_patients: string;
  providers_no_activity: string;
  providers_add_service: string;
  providers_interactions: string;
  providers_patient: string;
  providers_appointments: string;
  providers_leistungen: string;
  providers_last_activity: string;
  providers_context: string;
  providers_date: string;
  providers_amount: string;
  providers_select_first: string;
  providers_price_numeric: string;
  gender_male: string;
  gender_female: string;
  gender_diverse: string;
  insurance_private: string;
  insurance_public: string;
  insurance_self_pay: string;
  insurance_foreign: string;

  leads_title: string;
  leads_subtitle: string;
  leads_new: string;
  leads_source: string;
  leads_needs: string;
  leads_qualify: string;
  leads_convert: string;
  leads_total_month: string;
  leads_qualified_month: string;
  leads_converted_month: string;
  leads_total_all: string;
  leads_monthly_growth: string;
  leads_by_status: string;

  orders_title: string;
  orders_subtitle: string;
  orders_patient: string;
  orders_phase: string;

  cases_title: string;
  cases_subtitle: string;
  cases_reason: string;
  cases_new: string;
  cases_patient: string;
  cases_referrer: string;
  cases_anamnesis: string;
  cases_core_anamnesis: string;
  cases_narrative: string;
  cases_preconditions: string;
  cases_allergies: string;
  cases_operations: string;
  cases_medication: string;
  cases_medications: string;
  cases_pain: string;
  cases_symptoms: string;
  cases_vegetative: string;
  cases_vaccination: string;
  cases_open: string;
  cases_in_progress: string;
  cases_closed: string;
  cases_roster: string;
  cases_no_match: string;
  cases_detail: string;
  cases_note: string;
  cases_status: string;

  appointments_title: string;
  appointments_subtitle: string;
  appointments_date: string;
  appointments_time: string;
  appointments_title_col: string;
  appointments_type: string;
  appointments_location: string;
  appointments_new: string;

  nav_overview: string;
  nav_crm: string;
  nav_medicine: string;
  nav_providers: string;

  dash_pipeline: string;
  dash_daily_ops: string;
  phase_discovery: string;
  phase_execution: string;
  phase_followup: string;

  settings_title: string;
  settings_subtitle: string;
  settings_token_config: string;
  settings_access_token_min: string;
  settings_refresh_token_days: string;
  settings_max_sessions: string;
  settings_idle_days: string;
  settings_agency_profile: string;
  settings_agency_name: string;
  settings_agency_care_of: string;
  settings_agency_address: string;
  settings_agency_phone: string;
  settings_agency_email: string;
  settings_agency_hint: string;
  settings_sessions: string;
  settings_active_sessions: string;
  settings_logout_user: string;
  settings_logout_all: string;
  settings_logout_all_confirm: string;
  settings_no_sessions: string;
  settings_last_active: string;
  settings_updated: string;

  nav_activity: string;
  activity_title: string;
  activity_subtitle: string;
  activity_action: string;
  activity_entity: string;
  activity_user: string;
  activity_time: string;
  activity_details: string;
  activity_filter_user: string;
  activity_filter_action: string;
  common_ip: string;
  common_device: string;
  common_location: string;
  common_browser: string;
  common_os: string;
  interaction_appointment: string;
  interaction_service: string;
  interaction_activity: string;
  mfa_title: string;
  mfa_enabled: string;
  mfa_disabled: string;
  mfa_pending: string;
  mfa_approve: string;
  mfa_reject: string;
  mfa_pending_logins: string;
  mfa_no_pending: string;
  mfa_toggle: string;

  security_title: string;
  security_subtitle: string;
  security_ip_whitelist: string;
  security_ip_add: string;
  security_ip_cidr: string;
  security_ip_desc: string;
  security_ip_none: string;
  security_locked_users: string;
  security_no_locked: string;
  security_unlock: string;
  security_force_pw_reset: string;
  security_login_history: string;
  security_maintenance: string;
  security_maintenance_msg: string;
  security_maintenance_on: string;
  security_maintenance_off: string;

  health_title: string;
  health_subtitle: string;
  health_db_size: string;
  health_connections: string;
  health_tables: string;
  health_users_total: string;
  health_users_active: string;
  health_users_locked: string;
  health_sessions_active: string;
  health_mfa_pending: string;

  compliance_title: string;
  compliance_subtitle: string;
  compliance_export: string;
  compliance_anonymize: string;
  compliance_anonymize_confirm: string;
  compliance_consents: string;
  compliance_granted: string;
  compliance_revoked: string;
  compliance_expired: string;
  compliance_expired_consents: string;
  compliance_no_expired: string;
  compliance_recent: string;
  compliance_patient_id: string;

  nav_security: string;
  nav_health: string;
  nav_compliance: string;
  nav_notifications: string;
  nav_custom_fields: string;
  nav_announcements: string;

  notif_title: string;
  notif_subtitle: string;
  notif_new: string;
  notif_smtp: string;
  notif_webhook: string;
  notif_name: string;
  notif_type: string;
  notif_config: string;
  notif_test: string;
  notif_no_channels: string;
  notif_host: string;
  notif_port: string;
  notif_user: string;
  notif_url: string;

  cf_title: string;
  cf_subtitle: string;
  cf_new: string;
  cf_entity_type: string;
  cf_field_key: string;
  cf_field_label: string;
  cf_field_type: string;
  cf_required: string;
  cf_sort: string;
  cf_options: string;
  cf_no_fields: string;

  ann_title: string;
  ann_subtitle: string;
  ann_new: string;
  ann_message: string;
  ann_variant: string;
  ann_starts: string;
  ann_ends: string;
  ann_active: string;
  ann_no_announcements: string;
  ann_info: string;
  ann_warning: string;

  apt_type_medical: string;
  apt_type_non_medical: string;
  apt_type_internal: string;
  apt_time_from: string;
  apt_time_to: string;

  search_placeholder: string;

  dash_greeting: string;
  dash_total_patients: string;
  dash_total_visitors: string;
  dash_total_appointments: string;
  dash_new_patients: string;
  dash_this_week: string;
  dash_this_month: string;
  dash_this_year: string;
  dash_patients_today: string;
  dash_view_all: string;
  dash_completed: string;
  dash_upcoming: string;
  dash_cancelled: string;
  dash_ward_overview: string;
  dash_general_ward: string;
  dash_private_ward: string;
  dash_children_ward: string;
  dash_maternity_ward: string;
  dash_new_report: string;
  dash_export: string;
  dash_stable: string;
  dash_moderate: string;
  dash_almost_full: string;
  dash_checkups: string;
  dash_surgeries: string;
  dash_followups: string;
  dash_active: string;
  cal_weekdays: readonly [string, string, string, string, string, string, string];
  cal_months: readonly [string, string, string, string, string, string, string, string, string, string, string, string];

  // Patients extended
  patients_first_name: string;
  patients_birth_date: string;
  patients_nationality: string;
  patients_residence_country: string;
  patients_languages: string;
  patients_phone_primary: string;
  patients_phone_secondary: string;
  patients_email: string;
  patients_insurance_type: string;
  patients_insurance_provider: string;
  patients_insurance_number: string;
  patients_address_street: string;
  patients_address_city: string;
  patients_address_zip: string;
  patients_address_country: string;
  patients_emergency_name: string;
  patients_emergency_phone: string;
  patients_emergency_relation: string;
  patients_notes: string;
  patients_title_field: string;
  patients_legal_status: string;
  patients_profile: string;
  patients_save: string;
  patients_saving: string;
  patients_creating: string;
  patients_records: string;
  patients_syncing: string;
  patients_no_match: string;
  patients_registry_control: string;
  patients_readonly_view: string;
  patients_assign_owner: string;
  patients_no_assignments: string;
  patients_revoked: string;
  patients_assigned_by: string;
  patients_user_active: string;
  patients_user_inactive: string;

  // Common extended
  common_not_set: string;
  common_unknown: string;
  common_active: string;
  common_inactive: string;
  common_activity: string;
  common_provider: string;
  common_doctor: string;
  common_failed_load: string;
  common_failed_create: string;
  common_failed_update: string;
  common_failed_assign: string;

  field_name: string;
  field_birth_date: string;
  field_phone: string;
  field_email: string;
  field_nationality: string;
  field_languages: string;
  field_insurance: string;
  field_diagnosis: string;
  field_medications: string;
  field_allergies: string;
  field_vitals: string;
  field_internal_notes: string;
  field_travel_data: string;

  // Contracts
  contracts_title: string;
  contracts_subtitle: string;
  contracts_new: string;
  contracts_number: string;
  contracts_type: string;
  contracts_status: string;
  contracts_patient: string;
  contracts_start_date: string;
  contracts_end_date: string;
  contracts_signed_at: string;
  contracts_total: string;
  contracts_notes: string;
  contracts_draft: string;
  contracts_active: string;
  contracts_archived: string;
  contracts_signed: string;
  contracts_cancelled: string;
  contracts_framework: string;
  contracts_order: string;
  contracts_treatment: string;

  // Invoices
  invoices_title: string;
  invoices_subtitle: string;
  invoices_new: string;
  invoices_number: string;
  invoices_patient: string;
  invoices_type: string;
  invoices_status: string;
  invoices_amount: string;
  invoices_issued_at: string;
  invoices_due_at: string;
  invoices_paid_at: string;
  invoices_draft: string;
  invoices_issued: string;
  invoices_paid: string;
  invoices_overdue: string;
  invoices_cancelled: string;
  invoices_advance: string;
  invoices_final: string;
  invoices_interim: string;
  invoices_items: string;
  invoices_subtotal: string;
  invoices_vat: string;
  invoices_total: string;

  // Documents
  documents_title: string;
  documents_subtitle: string;
  documents_upload: string;
  documents_filename: string;
  documents_category: string;
  documents_status: string;
  documents_uploaded_by: string;
  documents_uploaded_at: string;
  documents_download: string;
  documents_share: string;
  documents_delete: string;
  documents_no_files: string;
  documents_source: string;
  documents_size: string;

  chat_title: string;
  chat_subtitle: string;
  chat_new: string;
  chat_search_users: string;
  chat_no_conversations: string;
  chat_type_message: string;
  chat_send: string;
  chat_select_conversation: string;
  chat_you: string;
  chat_online: string;
  chat_just_now: string;
  chat_minutes_ago: string;
  chat_hours_ago: string;
  chat_yesterday: string;
  nav_chat: string;
}

export type Lang = "de" | "ru";

const LANG_KEY = "gmed_lang";
const LANG_EVENT = "gmed:lang-change";

export function getLang(): Lang {
  if (typeof window === "undefined") return "ru";
  const stored = localStorage.getItem(LANG_KEY);
  return stored === "de" ? "de" : "ru";
}

export function setLang(lang: Lang): void {
  localStorage.setItem(LANG_KEY, lang);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LANG_EVENT));
  }
}

export function t(lang: Lang): Translations {
  switch (lang) {
    case "de":
      return de;
    case "ru":
      return ru;
  }
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key === LANG_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(LANG_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(LANG_EVENT, onStoreChange);
  };
}

export function useLang() {
  const lang = useSyncExternalStore<Lang>(subscribe, getLang, () => "ru");

  const changeLang = useCallback((newLang: Lang) => {
    setLang(newLang);
  }, []);

  const translations = useMemo(() => t(lang), [lang]);

  return { lang, setLang: changeLang, t: translations };
}
