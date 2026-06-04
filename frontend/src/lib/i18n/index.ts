import { useCallback, useMemo, useSyncExternalStore } from "react";
import { de } from "./de";
import { ru } from "./ru";
import type { AdminSystemTranslations } from "./catalogs/admin-system";
import type { CasesClinicalTranslations } from "./catalogs/cases-clinical";
import type { ClinicalTranslations } from "./catalogs/clinical";
import type { ExtractedUiTranslations } from "./catalogs/extracted-ui";
import type { OperationsTranslations } from "./catalogs/operations";
import type { PatientsPortalTranslations } from "./catalogs/patients-portal";
import type { RevenueTranslations } from "./catalogs/revenue";
import type { SharedCoreTranslations } from "./catalogs/shared";

export interface Translations
  extends SharedCoreTranslations,
    AdminSystemTranslations,
    CasesClinicalTranslations,
    ClinicalTranslations,
    ExtractedUiTranslations,
    OperationsTranslations,
    PatientsPortalTranslations,
    RevenueTranslations {
  app_name: string;
  app_subtitle: string;
  app_not_found_title: string;
  app_not_found_body: string;

  nav_dashboard: string;
  nav_main: string;
  nav_documents: string;
  nav_contracts: string;
  nav_invoices: string;
  nav_finance_catalog: string;
  nav_admin: string;
  nav_users_roles: string;
  nav_access_matrix: string;
  nav_logout: string;
  nav_my_documents: string;
  nav_my_appointments: string;
  nav_my_recommendations: string;
  nav_my_services: string;
  nav_my_invoices: string;
  nav_my_privacy: string;
  nav_my_feedback: string;
  nav_feedback: string;
  nav_reports: string;
  nav_learning: string;
  nav_interpreters: string;

  login_title: string;
  login_email: string;
  login_password: string;
  login_submit: string;
  login_loading: string;
  login_error_invalid: string;
  login_error_email_required: string;
  login_error_email_invalid: string;
  login_error_password_required: string;
  login_error_password_short: string;
  login_error_password_long: string;
  login_error_unknown: string;
  login_mfa_rejected_title: string;
  login_mfa_rejected_msg: string;
  login_mfa_pending_msg: string;
  login_mfa_checking: string;
  login_sign_in_subtitle: string;

  users_title: string;
  users_subtitle: string;
  users_new: string;
  users_create_title: string;
  users_name: string;
  users_name_placeholder: string;
  users_email: string;
  users_email_placeholder: string;
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
  users_confirm_password: string;
  users_password_mismatch: string;
  users_admins: string;
  users_reset_password: string;
  users_reset_button: string;
  users_empty_no_results: string;
  users_empty_no_users: string;

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
  access_audit_note: string;

  common_loading: string;
  common_error: string;
  common_save: string;
  common_edit: string;
  common_cancel: string;
  common_confirm: string;
  common_ok: string;
  common_yes: string;
  common_no: string;
  common_search: string;
  common_search_placeholder: string;
  common_select_placeholder: string;
  common_no_results: string;
  common_clear: string;
  common_remove: string;
  common_value: string;
  common_actions: string;
  common_unknown_value: string;
  enum_unknown: string;
  select_missing_value: string;
  common_delete: string;
  common_archive: string;
  common_sort: string;
  common_export: string;
  common_reset: string;
  common_show_stats: string;
  common_create: string;
  common_refresh: string;
  common_registry: string;
  common_configuration: string;
  common_monitoring: string;
  common_last_updated: string;
  common_discard_unsaved_confirm: string;
  common_overlay_dismiss_blocked: string;
  table_filter: string;
  table_filter_search_fields: string;
  table_filter_value: string;
  table_filter_no_fields: string;
  table_filter_remove: string;
  table_sort_add: string;
  table_sort_clear: string;
  table_sort_none: string;
  table_sort_ascending: string;
  table_sort_descending: string;
  table_sort_move_up: string;
  table_sort_move_down: string;
  table_sort_remove: string;
  table_columns: string;
  table_columns_search: string;
  table_columns_show_all: string;
  table_columns_hide_all: string;
  table_columns_required: string;
  table_columns_freeze: string;
  table_columns_unfreeze: string;
  table_columns_frozen: string;
  table_columns_freeze_limit: string;
  table_select_all: string;
  table_select_row: string;
  table_resize_column: string;
  table_actions: string;
  table_no_sort_applied: string;
  table_density: string;
  table_density_comfortable: string;
  table_density_compact: string;
  table_density_condensed: string;
  filter_op_contains: string;
  filter_op_does_not_contain: string;
  filter_op_is_empty: string;
  filter_op_is_not_empty: string;
  filter_op_is: string;
  filter_op_is_not: string;
  filter_op_is_any_of: string;
  filter_op_is_none_of: string;
  filter_op_has_any: string;
  filter_op_has_all: string;
  filter_op_has_none: string;
  filter_op_before: string;
  filter_op_after: string;
  filter_op_between: string;
  filter_op_last_n_days: string;
  filter_op_equals: string;
  pagination_per_page: string;
  pagination_go_to_page: string;
  pagination_go: string;
  pagination_first: string;
  pagination_previous: string;
  pagination_next: string;
  pagination_last: string;

  patients_title: string;
  patients_subtitle: string;
  patients_new: string;
  patients_col_status: string;
  patients_col_no: string;
  patients_col_patient: string;
  patients_col_id: string;
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
  providers_select_to_open_workspace: string;
  providers_no_access_title: string;
  providers_no_access_body: string;
  providers_create_description: string;
  providers_edit_restricted_note: string;
  providers_doctors_description_medical: string;
  providers_doctors_description_non_medical: string;
  providers_doctors_hint: string;
  providers_services_description: string;
  providers_services_hint: string;
  providers_linked_patients_description: string;
  providers_interactions_description: string;
  providers_type: string;
  providers_category: string;
  providers_none_in_category: string;
  providers_choose_category: string;
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
  providers_min_rating: string;
  providers_internal_rating: string;
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
  providers_staff_external: string;
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
  providers_delete_provider_confirm: string;
  providers_delete_doctor_confirm: string;
  providers_delete_service_confirm: string;
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
  orders_cost_pass_through_badge: string;
  orders_treat_as_cost_pass_through: string;
  orders_cost_pass_through_hint: string;
  orders_auto_billed_from_interpreter_report: string;
  orders_auto_billed_from_completed_appointment: string;
  orders_supporting_document: string;
  orders_open_linked_document: string;
  orders_supporting_document_auto_link_hint: string;
  orders_supporting_document_select_hint: string;
  orders_supporting_document_pin_hint: string;
  orders_billing_source: string;
  orders_billing_source_interpreter_report: string;
  orders_billing_source_completed_appointment: string;
  orders_billing_source_manual: string;
  orders_agency_service: string;
  orders_not_catalog_linked: string;
  orders_open_provider: string;
  orders_unlinked: string;
  orders_open_doctor_context: string;
  orders_not_specified: string;

  cases_title: string;
  cases_subtitle: string;
  cases_reason: string;
  cases_new: string;
  cases_patient: string;
  cases_referrer: string;
  cases_anamnesis: string;
  cases_core_anamnesis: string;
  cases_narrative: string;
  cases_snippets_title: string;
  cases_snippets_description: string;
  cases_snippets_empty: string;
  cases_snippets_insert: string;
  cases_snippets_manage: string;
  cases_snippets_new: string;
  cases_snippets_label: string;
  cases_snippets_category: string;
  cases_snippets_body: string;
  cases_snippets_active: string;
  cases_snippets_preview: string;
  cases_snippets_save: string;
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
  appointments_provider_category: string;
  appointments_location: string;
  appointments_new: string;
  appointments_recurring_series: string;
  appointments_occurrence: string;
  appointments_until: string;
  appointments_total_planned_occurrences: string;
  appointments_quick_actions: string;
  appointments_open_detail: string;
  appointments_scope_apply_status: string;
  appointments_scope_apply_schedule: string;
  appointments_scope_single: string;
  appointments_scope_following: string;
  appointments_scope_series: string;
  appointments_scope_bulk_status_hint: string;
  appointments_scope_following_hint: string;
  appointments_repeat_this: string;
  appointments_repeat_hint: string;
  appointments_repeat_interval_error: string;
  appointments_repeat_require_end_error: string;
  appointments_active_series_path: string;
  appointments_current_occurrence: string;
  appointments_open_checklist: string;
  appointments_open_checklists: string;
  appointments_cancel_this_and_following: string;
  appointments_cancel_whole_series: string;
  appointments_complete_only: string;
  appointments_complete_and_schedule: string;
  appointments_scope_targets: string;
  appointments_active_occurrence: string;
  appointments_active_occurrences: string;
  appointments_open_branch_root: string;
  appointments_lineage_parent: string;
  appointments_lineage_ancestor: string;
  appointments_lineage_current: string;
  appointments_lineage_child: string;
  appointments_lineage_descendant: string;
  appointments_lineage_related: string;
  appointments_lineage_split_from_occurrence: string;
  appointments_lineage_previous_plan: string;
  appointments_lineage_tail_root: string;
  appointments_lineage_tail_member: string;
  appointments_lineage_current_branch: string;
  appointments_lineage_total_occurrences: string;
  appointments_lineage_still_operational: string;
  appointments_lineage_completed_occurrences: string;
  appointments_lineage_related_branches: string;
  appointments_lineage_related_branches_meta: string;
  appointments_lineage_history: string;
  appointments_lineage_history_hint: string;
  appointments_lineage_related_series: string;
  appointments_lineage_total_short: string;
  appointments_lineage_active_short: string;
  appointments_lineage_completed_short: string;
  appointments_lineage_cancelled_short: string;
  appointments_today: string;
  appointments_doctor_directed_followup_title: string;
  appointments_doctor_directed_followup_subtitle: string;
  appointments_directed_item_singular: string;
  appointments_directed_item_plural: string;
  appointments_reminder_trail: string;
  appointments_task_trail: string;
  appointments_add_reminder: string;
  appointments_interpreter_report_title: string;
  appointments_interpreter_report_subtitle: string;
  appointments_report_submitted_prefix: string;
  appointments_report_needs_interpreter_revision: string;
  appointments_report_waiting_teamlead_review: string;
  appointments_report_no_reviewer_recorded: string;
  appointments_report_reviewer_notes: string;
  appointments_report_billing_sync: string;
  appointments_billing_sync_synced: string;
  appointments_billing_sync_missing_catalog: string;
  appointments_billing_sync_missing_order: string;
  appointments_billing_sync_pending: string;
  appointments_billing_sync_none: string;
  appointments_timeline_appointment_created: string;
  appointments_timeline_scheduled_slot: string;
  appointments_timeline_interpreter_pending: string;
  appointments_timeline_interpreter_assigned: string;
  appointments_timeline_interpreter_accepted: string;
  appointments_timeline_interpreter_declined: string;
  appointments_timeline_interpreter_discussion: string;
  appointments_timeline_checklist_completed: string;
  appointments_timeline_checklist_pending: string;
  appointments_timeline_external_response_logged: string;
  appointments_timeline_external_communication_cancelled: string;
  appointments_timeline_external_communication_closed: string;
  appointments_timeline_interpreter_report_submitted: string;
  appointments_timeline_interpreter_report_approved: string;
  appointments_timeline_interpreter_report_rejected: string;
  appointments_timeline_concierge_transfer_completed: string;

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
  settings_document_requirements: string;
  settings_document_requirements_hint: string;
  settings_required_patient_documents: string;
  settings_clinical_data: string;
  settings_clinical_data_hint: string;
  settings_clinical_retention_years: string;
  settings_sessions: string;
  settings_active_sessions: string;
  settings_logout_user: string;
  settings_logout_all: string;
  settings_logout_all_confirm: string;
  settings_no_sessions: string;
  settings_last_active: string;
  settings_updated: string;
  settings_no_changes: string;

  nav_activity: string;
  activity_title: string;
  activity_subtitle: string;
  activity_action: string;
  activity_entity: string;
  activity_user: string;
  activity_time: string;
  activity_details: string;
  activity_payload: string;
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
  security_ip_add_hint: string;
  security_ip_cidr: string;
  security_ip_cidr_placeholder: string;
  security_ip_desc: string;
  security_ip_none: string;
  security_locked_users: string;
  security_no_locked: string;
  security_unlock: string;
  security_force_pw_reset: string;
  security_login_history: string;
  security_maintenance: string;
  security_maintenance_msg: string;
  security_maintenance_hint: string;
  security_maintenance_on: string;
  security_maintenance_off: string;
  security_audit_analytics: string;
  security_audit_recent: string;
  security_audit_top_readers: string;
  security_audit_failed_logins: string;
  security_audit_blocked_logins: string;
  security_audit_token_theft: string;
  security_audit_executive_access: string;
  security_audit_off_hours: string;
  security_audit_hint: string;
  security_col_reason: string;
  security_col_route: string;
  security_col_events: string;
  security_col_distinct_entities: string;
  security_col_cidr: string;
  security_anonymous: string;
  security_no_suspicious: string;
  security_no_outlier_readers: string;

  health_title: string;
  health_subtitle: string;
  health_db_size: string;
  health_connections: string;
  health_tables: string;
  health_attention: string;
  health_section_database: string;
  health_section_access: string;
  health_section_data: string;
  health_users_total: string;
  health_users_active: string;
  health_users_locked: string;
  health_sessions_active: string;
  health_mfa_pending: string;
  health_data: string;
  health_audit_suffix: string;
  health_col_table: string;
  health_col_size: string;

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
  compliance_patient_id_uuid: string;
  compliance_patient_uuid_placeholder: string;
  compliance_privacy_status_requested: string;
  compliance_privacy_status_retention_hold: string;
  compliance_privacy_status_approved: string;
  compliance_privacy_status_rejected: string;
  compliance_privacy_status_completed: string;
  compliance_stat_privacy_queue: string;
  compliance_stat_ready_for_execution: string;
  compliance_stat_overdue_privacy: string;
  compliance_patient_register_title: string;
  compliance_patient_register_hint: string;
  compliance_load_register: string;
  compliance_consent_type_label: string;
  compliance_operational_note: string;
  compliance_consent_note_placeholder: string;
  compliance_expiry_date: string;
  compliance_expiry_hint: string;
  compliance_saving: string;
  compliance_grant_consent: string;
  compliance_revoke_consent: string;
  compliance_consent_history: string;
  compliance_no_consent_events: string;
  compliance_load_patient_consent_hint: string;
  compliance_col_consent: string;
  compliance_col_status: string;
  compliance_col_managed_by: string;
  compliance_col_effective_at: string;
  compliance_col_expires: string;
  compliance_col_note: string;
  compliance_privacy_requests_title: string;
  compliance_privacy_requests_hint: string;
  compliance_request_type_label: string;
  compliance_request_reason: string;
  compliance_request_reason_placeholder: string;
  compliance_create_request: string;
  compliance_new_request_hint: string;
  compliance_privacy_history: string;
  compliance_no_privacy_requests: string;
  compliance_load_patient_privacy_hint: string;
  compliance_col_request: string;
  compliance_col_requested_by: string;
  compliance_col_due: string;
  compliance_col_retention_until: string;
  compliance_col_linked_records: string;
  compliance_col_notes: string;
  compliance_created_label: string;
  compliance_manual_override: string;
  compliance_uuid_required: string;
  compliance_uses_loaded_uuid: string;
  compliance_col_type: string;
  compliance_col_total: string;
  compliance_privacy_review_queue: string;
  compliance_impact_summary: string;
  compliance_stat_requested: string;
  compliance_stat_hold: string;
  compliance_stat_approved: string;
  compliance_stat_overdue: string;
  compliance_no_privacy_scope: string;
  compliance_col_patient: string;
  compliance_col_actions: string;
  compliance_approve: string;
  compliance_hold: string;
  compliance_reject: string;
  compliance_execute: string;
  compliance_executing: string;
  compliance_executed_label: string;
  compliance_col_expired_at: string;
  compliance_downloaded: string;
  compliance_consent_type_dsgvo: string;
  compliance_consent_type_schweigepflicht: string;
  compliance_consent_type_portal: string;
  compliance_consent_type_treatment: string;
  compliance_consent_type_third_party: string;
  compliance_request_type_erasure: string;
  compliance_request_type_restriction: string;
  compliance_request_type_third_party_revoke: string;

  stub_not_implemented: string;

  ann_success: string;

  staff_link_no_access: string;

  topbar_search: string;
  topbar_notifications: string;
  topbar_mark_all_read: string;
  topbar_no_notifications: string;
  topbar_message_placeholder: string;
  topbar_online: string;

  common_back: string;
  common_close: string;
  common_dismiss: string;
  common_lang_native: string;
  nav_back: string;
  nav_forward: string;
  ui_toggle_sidebar: string;

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
  notif_config_placeholder: string;
  notif_test: string;
  notif_no_channels: string;
  notif_host: string;
  notif_port: string;
  notif_user: string;
  notif_url: string;
  notif_test_ok: string;
  notif_config_invalid: string;

  cf_title: string;
  cf_subtitle: string;
  cf_new: string;
  cf_entity_type: string;
  cf_field_key: string;
  cf_field_key_placeholder: string;
  cf_field_label: string;
  cf_field_type: string;
  cf_required: string;
  cf_sort: string;
  cf_options: string;
  cf_options_placeholder: string;
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
  dash_subtitle: string;
  dash_open_tasks: string;
  dash_leads_monthly_hint: string;
  dash_insurance_mix: string;
  dash_no_data: string;
  dash_no_upcoming: string;
  dash_no_tasks: string;
  dash_no_due: string;
  dash_due: string;
  dash_my_tasks: string;
  dash_greeting_morning: string;
  dash_greeting_afternoon: string;
  dash_greeting_evening: string;
  dash_sec_demographics: string;
  dash_sec_demographics_hint: string;
  dash_sec_clinical: string;
  dash_sec_clinical_hint: string;
  dash_sec_ops: string;
  dash_sec_ops_hint: string;
  dash_by_country: string;
  dash_by_age: string;
  dash_by_age_hint: string;
  dash_by_gender: string;
  dash_top_languages: string;
  dash_top_reasons: string;
  dash_top_reasons_hint: string;
  dash_cases_by_status: string;
  dash_cases_status_hint: string;
  dash_avg_duration: string;
  dash_avg_duration_hint: string;
  dash_days: string;
  dash_service_mix: string;
  dash_service_mix_hint: string;
  dash_appointments_by_status: string;
  dash_pipeline_value: string;
  dash_pipeline_hint: string;
  dash_heatmap: string;
  dash_heatmap_hint: string;
  dash_top_providers: string;
  dash_top_providers_hint: string;
  dash_period_7d: string;
  dash_period_30d: string;
  dash_period_90d: string;
  dash_period_12m: string;
  dash_period_all: string;
  day_mon: string;
  day_tue: string;
  day_wed: string;
  day_thu: string;
  day_fri: string;
  day_sat: string;
  day_sun: string;
  appt_planned: string;
  appt_confirmed: string;
  appt_in_progress: string;
  appt_completed: string;
  appt_cancelled: string;
  cal_weekdays: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  cal_months: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  // Patients extended
  patients_first_name: string;
  patients_col_age: string;
  patients_created_at: string;
  patients_functional_labels: string;
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
  patients_relations: string;
  patients_workflow: string;
  patients_timeline: string;
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
  common_today: string;
  common_pending: string;
  common_completed: string;

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
  invoices_workspace_access_denied: string;
  invoices_workspace_kicker: string;
  invoices_workspace_description: string;
  invoices_workspace_refresh: string;
  invoices_workspace_new_invoice: string;
  invoices_workspace_gross_total: string;
  invoices_workspace_gross_total_description: string;
  invoices_workspace_open_balance: string;
  invoices_workspace_open_balance_description: string;
  invoices_workspace_quotes_ready: string;
  invoices_workspace_quotes_ready_description: string;
  invoices_workspace_accounting_title: string;
  invoices_workspace_accounting_description: string;
  invoices_workspace_refresh_ledger: string;
  invoices_workspace_export_csv: string;
  invoices_workspace_cash_income: string;
  invoices_workspace_cash_expense: string;
  invoices_workspace_euer_surplus: string;
  invoices_workspace_cost_passthrough_revenue: string;
  invoices_workspace_no_accounting_entries: string;
  invoices_workspace_no_accounting_entries_description: string;
  invoices_workspace_no_order: string;
  invoices_workspace_no_patient: string;
  invoices_workspace_net: string;
  invoices_workspace_gross: string;
  invoices_workspace_monthly_euer: string;
  invoices_workspace_no_cash_movement: string;
  invoices_workspace_income: string;
  invoices_workspace_expense: string;
  invoices_workspace_surplus: string;
  invoices_workspace_search_placeholder: string;
  invoices_workspace_all_orders: string;
  invoices_workspace_all_quotes: string;
  invoices_workspace_empty_invoices_description: string;
  invoices_workspace_balance: string;
  invoices_workspace_page_label: string;
  invoices_workspace_invoice_count: string;
  invoices_workspace_previous: string;
  invoices_workspace_next: string;
  invoices_workspace_create_invoice_description: string;
  invoices_workspace_selected_quote_snapshot: string;
  invoices_workspace_choose_quote: string;
  invoices_workspace_notes: string;
  invoices_workspace_billing_note_placeholder: string;
  invoices_workspace_detail_sheet_description: string;
  invoices_workspace_no_invoice_selected: string;
  invoices_workspace_no_invoice_selected_description: string;
  invoices_workspace_invoice_overview: string;
  invoices_workspace_invoice_overview_description: string;
  invoices_workspace_preview_pdf: string;
  invoices_workspace_download_pdf: string;
  invoices_workspace_balance_due: string;
  invoices_workspace_linked_context_description: string;
  invoices_workspace_quotes: string;
  invoices_workspace_documents: string;
  invoices_workspace_save_invoice: string;
  invoices_workspace_dunning_title: string;
  invoices_workspace_dunning_description: string;
  invoices_workspace_dunning_history: string;
  invoices_workspace_dunning_action: string;
  invoices_workspace_dunning_sent_at: string;
  invoices_workspace_dunning_responsible: string;
  invoices_workspace_dunning_balance_due: string;
  invoices_workspace_create_dunning: string;
  invoices_workspace_no_dunning_events: string;
  invoices_workspace_no_dunning_events_description: string;
  invoices_workspace_next_escalation: string;
  invoices_workspace_completed: string;
  invoices_workspace_balance_prefix: string;
  invoices_workspace_dunning_note: string;
  invoices_workspace_dunning_placeholder: string;
  invoices_workspace_no_further_escalation: string;
  invoices_workspace_line_items: string;
  invoices_workspace_line_items_description: string;
  invoices_workspace_no_line_items: string;
  invoices_workspace_no_line_items_description: string;
  invoices_workspace_quantity: string;
  invoices_workspace_unit: string;
  invoices_workspace_supporting_documents: string;
  invoices_workspace_supporting_documents_description: string;
  invoices_workspace_no_supporting_documents: string;
  invoices_workspace_no_supporting_documents_description: string;
  invoices_workspace_linked_order_document: string;
  invoices_workspace_open_documents: string;
  invoices_workspace_popup_blocked: string;
  invoices_workspace_pdf_open_error: string;
  invoices_workspace_pdf_download_error: string;
  invoices_workspace_system: string;
  invoices_workspace_status_draft: string;
  invoices_workspace_status_sent: string;
  invoices_workspace_status_partially_paid: string;
  invoices_workspace_status_paid: string;
  invoices_workspace_status_overdue: string;
  invoices_workspace_status_cancelled: string;
  invoices_workspace_type_advance: string;
  invoices_workspace_type_interim: string;
  invoices_workspace_type_final: string;
  invoices_workspace_dunning_level_first: string;
  invoices_workspace_dunning_level_second: string;
  invoices_workspace_dunning_level_collections: string;
  invoices_workspace_direction_income: string;
  invoices_workspace_direction_expense: string;
  invoices_workspace_stats_sent_word: string;
  invoices_workspace_stats_paid_word: string;
  invoices_workspace_page_of: string;
  invoices_workspace_linked_order: string;
  invoices_workspace_send_dunning: string;


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
  documents_delete_file: string;
  documents_delete_file_description: string;
  documents_delete_file_hint: string;
  documents_delete_file_reason: string;
  documents_delete_file_reason_placeholder: string;
  documents_delete_file_reason_required: string;
  documents_delete_file_confirm: string;
  documents_deleting: string;
  documents_file_deleted_notice: string;
  documents_file_deleted_banner: string;
  documents_file_deleted_by: string;
  documents_failed_delete_file: string;
  documents_no_files: string;
  documents_clinic: string;
  documents_date_from: string;
  documents_date_to: string;
  documents_source: string;
  documents_share_channel: string;
  documents_share_provider_channel_unavailable: string;
  documents_share_provider_context_hint: string;
  documents_share_provider_context_empty: string;
  documents_share_provider_not_in_context: string;
  documents_share_provider_linking_steps: string;
  documents_share_provider_repair_title: string;
  documents_share_provider_repair_available_title: string;
  documents_share_provider_repair_description: string;
  documents_share_provider_repair_available_description: string;
  documents_share_provider_repair_order_step: string;
  documents_share_provider_repair_appointment_step: string;
  documents_share_provider_repair_after_step: string;
  documents_share_provider_no_single_context: string;
  documents_share_provider_medical_required: string;
  documents_share_provider_specialty_mismatch: string;
  documents_share_external_release_required: string;
  documents_share_provider_channel_fix: string;
  documents_share_open_order_services: string;
  documents_share_open_appointment: string;
  documents_size: string;
  documents_generate_title: string;
  documents_generate_description: string;
  documents_generate_replace_warning: string;
  documents_select_template: string;
  documents_select_patient: string;
  documents_patient_wide_context: string;
  documents_all_appointments_scope: string;
  documents_text_blocks: string;
  documents_text_blocks_hint: string;
  documents_default_template_source: string;
  documents_generate_document: string;
  documents_generating: string;
  documents_version_history: string;
  documents_text_extraction: string;
  documents_run_extraction: string;
  documents_extracted_text: string;
  documents_no_extracted_text: string;
  documents_translation_requests: string;
  documents_request_translation: string;
  documents_no_translation_requests: string;
  documents_source_language: string;
  documents_use_extracted_text: string;
  documents_save_workspace: string;
  documents_translation_note_placeholder: string;
  documents_source_text: string;
  documents_source_text_placeholder: string;
  documents_translated_text: string;
  documents_translated_text_placeholder: string;
  documents_interpreter_review: string;
  documents_interpreter_review_hint: string;
  documents_mark_medical_data: string;
  documents_save_metadata: string;
  documents_patient_portal: string;
  documents_portal_eligible: string;
  documents_not_portal_eligible: string;
  documents_active_patient_portal_user: string;
  documents_no_active_patient_portal_user: string;
  documents_active_portal_releases: string;
  documents_portal_access_hint: string;
  documents_link_patient_before_portal: string;
  documents_link_active_patient_portal_user: string;
  documents_patient_portal_user: string;
  documents_confirmed: string;
  documents_waiting_confirmation: string;
  documents_portal_controls: string;
  documents_confirmed_recipients: string;
  documents_refresh_portal_release: string;
  documents_release_to_portal: string;
  documents_revoke_portal_release: string;
  documents_only_ceo_pm_portal: string;
  documents_no_shares_yet: string;
  documents_internal_user: string;
  documents_provider_target: string;
  documents_select_user: string;
  documents_select_provider: string;
  documents_share_message: string;
  documents_share_message_placeholder: string;
  documents_share_message_required: string;
  documents_detail_description: string;
  documents_loading_document: string;
  documents_unknown_uploader: string;
  documents_updated: string;
  documents_version_chain: string;
  documents_archived: string;
  documents_last_processed: string;
  documents_no_extraction_run: string;
  documents_unknown_requester: string;
  documents_translation_start: string;
  documents_translation_complete: string;
  documents_translation_cancel: string;
  documents_classification_category: string;
  documents_choose_category: string;
  documents_review_notes: string;
  documents_release_internal_hint: string;
  documents_release_reviewed_document: string;
  documents_releasing: string;
  documents_portal_released_at: string;
  documents_portal_confirmed_by_patient: string;
  documents_unknown_target: string;
  documents_shared_by: string;
  documents_sharing_selected: string;
  documents_require_confirmation: string;
  documents_create_share: string;
  documents_sharing: string;
  documents_no_city: string;
  documents_preview: string;
  documents_released: string;
  documents_revoke: string;
  documents_portal_trail_hint: string;
  documents_workspace_heading: string;
  documents_workspace_intro: string;
  documents_refresh: string;
  documents_generate_from_template: string;
  documents_intake_queue: string;
  documents_intake_interpreter_hint: string;
  documents_intake_general_hint: string;
  documents_pending: string;
  documents_loading_intake_queue: string;
  documents_no_intake_pending: string;
  documents_unlinked_document: string;
  documents_needs_review: string;
  documents_no_auto_classification: string;
  documents_open_document: string;
  documents_apply_and_release: string;
  documents_apply_suggestion: string;
  documents_uploading: string;
  documents_loading_documents: string;
  documents_confidence: string;
  documents_confidence_low: string;
  documents_confidence_medium: string;
  documents_confidence_high: string;
  documents_unclassified: string;
  documents_upload_interpreter_hint: string;
  documents_upload_teamlead_hint: string;
  documents_auto_classification_optional: string;
  documents_popup_blocked: string;
  documents_failed_load_documents: string;
  documents_failed_load_intake_queue: string;
  documents_failed_load_document: string;
  documents_file_required: string;
  documents_link_context_required: string;
  documents_uploaded_internal_review: string;
  documents_uploaded_to_intake: string;
  documents_uploaded: string;
  documents_failed_upload: string;
  documents_classification_applied_released: string;
  documents_classification_applied: string;
  documents_failed_apply_classification: string;
  documents_not_linked_template: string;
  documents_choose_template: string;
  documents_patient_context_required: string;
  documents_failed_generate: string;
  documents_generated_version_preview: string;
  documents_generated_version: string;
  documents_preview_opened: string;
  documents_failed_open_preview: string;
  documents_translation_created: string;
  documents_failed_create_translation: string;
  documents_extraction_updated: string;
  documents_failed_extract: string;
  documents_translation_marked: string;
  documents_failed_update_translation: string;
  documents_translation_workspace_saved: string;
  documents_save_data_unavailable: string;
  documents_save_name_type_required: string;
  documents_save_forbidden: string;
  documents_save_type_required: string;
  documents_metadata_updated_notice: string;
  documents_review_released_notice: string;
  documents_failed_save: string;
  documents_choose_user_target: string;
  documents_choose_provider_target: string;
  documents_shared_count: string;
  documents_share_created_notice: string;
  documents_failed_create_share: string;
  documents_share_revoked_notice: string;
  documents_share_confirmed_notice: string;
  documents_portal_released_notice: string;
  documents_failed_release_portal: string;
  documents_portal_release_revoked_notice: string;
  documents_failed_revoke_portal: string;
  documents_select_all_shown: string;
  documents_clear_selection: string;
  documents_select_bulk_share: string;
  documents_no_documents_match: string;
  documents_shares_count: string;
  documents_optional_order_link: string;
  documents_optional_appointment_link: string;
  documents_no_category: string;
  documents_no_patient: string;
  documents_no_order: string;
  documents_no_appointment: string;
  documents_status_draft: string;
  documents_status_active: string;
  documents_status_archived: string;
  documents_visibility_internal: string;
  documents_visibility_released_internal: string;
  documents_visibility_released_external: string;
  documents_visibility_patient_visible: string;
  documents_translation_in_progress: string;
  documents_translation_completed: string;
  documents_translation_cancelled: string;
  documents_translation_requested: string;
  documents_extraction_completed: string;
  documents_extraction_failed: string;
  documents_extraction_unsupported: string;
  documents_extraction_not_started: string;
  documents_extraction_message_ocr_unavailable: string;
  documents_extraction_message_ocr_no_text: string;
  documents_extraction_message_ocr_failed: string;
  documents_extraction_message_pdf_no_text: string;
  documents_extraction_message_pdf_failed: string;
  documents_extraction_message_html_no_text: string;
  documents_extraction_message_text_no_text: string;
  documents_extraction_message_unsupported_binary: string;
  documents_extraction_message_failed: string;

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

  services_failed_load: string;
  services_notice_created: string;
  services_error_create: string;
  services_notice_cancelled: string;
  services_error_cancel: string;
  services_loading: string;
  services_title: string;
  services_description: string;
  services_open_requests: string;
  services_booked_or_in_service: string;
  services_completed: string;
  services_history_title: string;
  services_history_description: string;
  services_empty_title: string;
  services_empty_description: string;
  services_care_team_pending: string;
  services_preferred_start: string;
  services_preferred_end: string;
  services_vendor: string;
  services_estimate: string;
  services_booking_reference: string;
  services_created_at: string;
  services_cancel_request: string;
  services_request_title: string;
  services_request_description: string;
  services_form_service_type: string;
  services_category: string;
  services_all_categories: string;
  services_type_hotel: string;
  services_type_transfer: string;
  services_type_vip_terminal: string;
  services_type_flight: string;
  services_type_chauffeur: string;
  services_type_translation_support: string;
  services_type_other: string;
  services_form_title: string;
  services_form_title_placeholder: string;
  services_form_preferred_vendor: string;
  services_form_preferred_vendor_placeholder: string;
  services_form_vendor_contact: string;
  services_form_vendor_contact_placeholder: string;
  services_form_budget: string;
  services_form_notes: string;
  services_form_notes_placeholder: string;
  services_submit: string;
}

export type Lang = "de" | "ru";

const LANG_KEY = "gmed_lang";
const LANG_EVENT = "gmed:lang-change";

export function getLang(): Lang {
  if (typeof window === "undefined") return "ru";
  const stored = localStorage.getItem(LANG_KEY);
  return stored === "de" ? "de" : "ru";
}

function setLang(lang: Lang): void {
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

export type UiTextValues = Record<string, string | number | boolean | null | undefined>;

export function formatUiText(template: string, values?: UiTextValues): string {
  if (!values) return template;

  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value ?? "")),
    template,
  );
}

export function uiText(
  key: string,
  lang: Lang = getLang(),
  values?: UiTextValues,
): string {
  return formatUiText(t(lang).uiText[key] ?? key, values);
}

export type EnumLabelMap = Partial<Record<string, string>>;
export type TranslationKey = {
  [Key in keyof Translations]: Translations[Key] extends string ? Key : never;
}[keyof Translations];

export function formatUnknownValue(
  value: unknown,
  translations: Pick<Translations, "common_unknown" | "common_unknown_value">,
): string {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return raw ? translations.common_unknown_value : translations.common_unknown;
}

export function formatEnumLabel(
  value: string | null | undefined,
  labels: EnumLabelMap,
  translations: Pick<
    Translations,
    "common_not_set" | "common_unknown" | "common_unknown_value"
  >,
): string {
  if (!value) {
    return translations.common_not_set;
  }

  return labels[value] ?? formatUnknownValue(value, translations);
}

export function formatEnumLabelFromKeys(
  value: string | null | undefined,
  labelKeys: Partial<Record<string, TranslationKey>>,
  translations: Translations,
): string {
  if (!value) {
    return translations.common_not_set;
  }

  const labelKey = labelKeys[value];
  return labelKey ? translations[labelKey] : formatUnknownValue(value, translations);
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
