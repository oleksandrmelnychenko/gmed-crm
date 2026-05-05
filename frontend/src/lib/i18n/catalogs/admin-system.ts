export interface AdminSystemTranslations {
  admin_system_overview: string;
  admin_system_fields: string;
  admin_system_permissions: string;
  admin_system_click_to_change: string;
  admin_system_patient_entity: string;
  admin_system_field_workspace: string;
  admin_system_access_levels_guide_title: string;
  admin_system_access_levels_guide_description: string;
  admin_system_access_level_full_description: string;
  admin_system_access_level_masked_description: string;
  admin_system_access_level_hidden_description: string;
  admin_system_access_level_conditional_description: string;
  admin_system_access_level_locked_description: string;
  admin_system_access_how_change_title: string;
  admin_system_access_how_change_body: string;
  admin_system_access_locked_hint: string;
  admin_system_access_reset_title: string;
  admin_system_access_reset_body: string;
  admin_system_access_cycle_hint: string;
  admin_system_export_error_prefix: string;
  admin_system_entity_id_separator: string;
  admin_system_record_count_appointments: string;
  admin_system_record_count_cases: string;
  admin_system_record_count_orders: string;
  admin_system_record_count_documents: string;
  admin_system_record_count_invoices: string;
  access_field_functional_labels: string;

  cf_entity_lead: string;
  cf_entity_patient: string;
  cf_entity_order: string;
  cf_entity_provider: string;
  cf_field_type_text: string;
  cf_field_type_number: string;
  cf_field_type_date: string;
  cf_field_type_boolean: string;
  cf_field_type_select: string;

  activity_action_login: string;
  activity_action_create_lead: string;
  activity_action_create_patient: string;
  activity_action_convert_lead: string;
  activity_action_qualify_lead: string;
  activity_action_update_setting: string;
  activity_action_revoke_all_sessions: string;
  activity_action_admin_force_logout_user: string;
  activity_action_revoke_all_users_sessions: string;
  activity_action_token_theft_detected: string;

  activity_entity_access_policy: string;
  activity_entity_announcement: string;
  activity_entity_appointment: string;
  activity_entity_appointment_checklist: string;
  activity_entity_appointment_request: string;
  activity_entity_case: string;
  activity_entity_concierge_service: string;
  activity_entity_consent: string;
  activity_entity_custom_field: string;
  activity_entity_document: string;
  activity_entity_feedback: string;
  activity_entity_framework_contract: string;
  activity_entity_invoice: string;
  activity_entity_lead: string;
  activity_entity_notification_channel: string;
  activity_entity_order: string;
  activity_entity_patient: string;
  activity_entity_pending_login: string;
  activity_entity_privacy_request: string;
  activity_entity_provider: string;
  activity_entity_quote: string;
  activity_entity_reminder: string;
  activity_entity_security: string;
  activity_entity_session: string;
  activity_entity_system_setting: string;
  activity_entity_task: string;
  activity_entity_user: string;
  activity_entity_workflow_checklist_item: string;

  activity_event_activated: string;
  activity_event_added: string;
  activity_event_approved: string;
  activity_event_assigned: string;
  activity_event_assignment_revoked: string;
  activity_event_billing_ready: string;
  activity_event_cancelled: string;
  activity_event_completed: string;
  activity_event_confirmed: string;
  activity_event_converted: string;
  activity_event_created: string;
  activity_event_deactivated: string;
  activity_event_debt_management_updated: string;
  activity_event_deleted: string;
  activity_event_doctor_created: string;
  activity_event_doctor_deleted: string;
  activity_event_doctor_updated: string;
  activity_event_dunning_created: string;
  activity_event_executed: string;
  activity_event_execution_flow_updated: string;
  activity_event_external_invoice_created: string;
  activity_event_external_invoice_overdue: string;
  activity_event_external_invoice_updated: string;
  activity_event_failed_resolved: string;
  activity_event_followup_flow_updated: string;
  activity_event_force_password_reset: string;
  activity_event_generated: string;
  activity_event_granted: string;
  activity_event_ip_whitelist_added: string;
  activity_event_ip_whitelist_deleted: string;
  activity_event_leistung_added: string;
  activity_event_leistung_approved: string;
  activity_event_maintenance_toggled: string;
  activity_event_medication_expiry_confirmed: string;
  activity_event_medication_expiry_flagged: string;
  activity_event_mfa_toggled: string;
  activity_event_overdue_marked: string;
  activity_event_password_reset: string;
  activity_event_payment_proof_uploaded: string;
  activity_event_phase_changed: string;
  activity_event_planning_preparation_updated: string;
  activity_event_portal_released: string;
  activity_event_portal_revoked: string;
  activity_event_process_gates_updated: string;
  activity_event_rejected: string;
  activity_event_reset: string;
  activity_event_reviewed: string;
  activity_event_revoked: string;
  activity_event_revoked_all: string;
  activity_event_service_created: string;
  activity_event_service_deleted: string;
  activity_event_service_updated: string;
  activity_event_status_changed: string;
  activity_event_submitted: string;
  activity_event_translation_requested: string;
  activity_event_translation_updated: string;
  activity_event_unlocked: string;
  activity_event_updated: string;
  activity_event_uploaded: string;

  compliance_privacy_source_patient_request: string;
  compliance_privacy_source_admin_intake: string;
  compliance_privacy_source_legal_hold: string;
  compliance_privacy_source_patient_portal: string;
  compliance_privacy_source_manual: string;
  compliance_privacy_source_system: string;
  compliance_privacy_source_compliance_workspace: string;

  chat_access_denied: string;
  chat_secure_setup_failed_device: string;
  chat_secure_setup_pending: string;
  chat_secure_key_failed: string;
  chat_secure_attachment_unavailable: string;
  chat_secure_attachment_peer_key_failed: string;
  chat_secure_attachment_decrypt_failed: string;
  chat_secure_attachment_send_failed: string;
  chat_attachment_send_failed: string;
  chat_secure_message_send_failed: string;
  chat_secure_passphrase_required: string;
  chat_secure_backup_downloaded: string;
  chat_secure_keys_imported: string;
  chat_secure_operation_failed: string;
  chat_secure_encrypted_label: string;
  chat_secure_attachment_label: string;
  chat_seen: string;
  chat_export_keys: string;
  chat_import_keys: string;
  chat_export_secure_keys_title: string;
  chat_import_secure_keys_title: string;
  chat_export_secure_keys_description: string;
  chat_import_secure_keys_description: string;
  chat_backup_selected: string;
  chat_backup_choose_first: string;
  chat_key_passphrase: string;
  chat_key_passphrase_placeholder: string;
  chat_close: string;
  chat_working: string;
  chat_export_backup: string;
  chat_import_backup: string;

  sops_access_denied: string;
  sops_loading_workspace: string;
  sops_title: string;
  sops_subtitle: string;
  sops_new_content: string;
  sops_notice_created: string;
  sops_notice_updated: string;
  sops_notice_ack_requested: string;
  sops_notice_ack_done: string;
  sops_notice_review_saved: string;
  sops_error_load: string;
  sops_error_save: string;
  sops_error_ack_request: string;
  sops_error_ack: string;
  sops_error_review: string;
  sops_metric_visible: string;
  sops_metric_approved: string;
  sops_metric_pending_ack: string;
  sops_queue_title: string;
  sops_queue_description: string;
  sops_queue_empty_title: string;
  sops_queue_empty_description: string;
  sops_library_title: string;
  sops_library_description: string;
  sops_library_search_placeholder: string;
  sops_library_empty_title: string;
  sops_library_empty_description: string;
  sops_detail_title: string;
  sops_detail_description: string;
  sops_detail_overview: string;
  sops_detail_targeting: string;
  sops_detail_body: string;
  sops_detail_actions: string;
  sops_no_selection_title: string;
  sops_no_selection_description: string;
  sops_targeting_model_title: string;
  sops_targeting_model_description: string;
  sops_scope_title: string;
  sops_scope_description: string;
  sops_form_create_title: string;
  sops_form_edit_title: string;
  sops_form_title: string;
  sops_form_category: string;
  sops_form_summary: string;
  sops_form_body: string;
  sops_form_target_roles: string;
  sops_form_direct_users: string;
  sops_form_requires_ack: string;
  sops_review_title: string;
  sops_review_description: string;
  sops_review_decision: string;
  sops_review_note: string;
  sops_review_approve: string;
  sops_review_reject: string;
  sops_review_save: string;
  sops_action_open_review: string;
  sops_action_request_ack: string;
  sops_action_acknowledge: string;
  sops_column_title: string;
  sops_column_summary: string;
  sops_column_status: string;
  sops_column_category: string;
  sops_column_revision: string;
  sops_column_updated: string;
  sops_column_author: string;
  sops_column_ack: string;
  sops_column_approval: string;
  sops_category_sop: string;
  sops_category_handbook: string;
  sops_category_training: string;
  sops_status_approved: string;
  sops_status_pending_approval: string;
  sops_status_rejected: string;
  sops_status_archived: string;
  sops_status_draft: string;
  sops_ack_pending: string;
  sops_ack_acknowledged: string;
  sops_ack_requested: string;
  sops_direct_users: string;
  sops_pending_ack: string;
  sops_acknowledged: string;
  sops_my_status: string;
  sops_approval_role_ceo: string;
  sops_approval_role_patient_manager: string;
  sops_review_queue_metric_pm: string;
  sops_review_queue_title_pm: string;
  sops_review_queue_description_pm: string;
  sops_review_queue_metric_ceo: string;
  sops_review_queue_title_ceo: string;
  sops_review_queue_description_ceo: string;
  sops_form_description_ceo: string;
  sops_form_description_patient_manager: string;
  sops_form_description_teamlead: string;
  sops_date_not_set: string;

  dash_order_phase_closure: string;
  dash_order_phase_execution: string;
  dash_order_phase_intake: string;
  dash_order_phase_planning: string;
  dash_order_count_suffix: string;

  feedback_status_submitted: string;
  feedback_status_reviewed: string;
  feedback_status_archived: string;
  feedback_source_patient_portal: string;
  feedback_source_staff_capture: string;
  feedback_treatment_success_yes: string;
  feedback_treatment_success_partial: string;
  feedback_treatment_success_no: string;
  feedback_patient_feedback: string;
  feedback_general_feedback: string;
  feedback_scores: string;
  feedback_not_rated: string;
  feedback_overall: string;
  feedback_interpreter: string;
  feedback_treatment: string;
  feedback_doctor: string;
  feedback_organization: string;
  feedback_service: string;
  feedback_ambience: string;
  feedback_price_value: string;
  feedback_treatment_success: string;
  feedback_complication: string;
  feedback_complication_reported: string;
  feedback_comment: string;
  feedback_improvement_notes: string;
  feedback_internal_note: string;
  feedback_review_note: string;
  feedback_patient_manager: string;
  feedback_concierge: string;
  feedback_treatment_quality: string;
  feedback_doctors: string;
  feedback_service_quality: string;
  feedback_infrastructure_ambience: string;
  feedback_comment_placeholder: string;
  feedback_improvement_notes_placeholder: string;
  feedback_internal_note_placeholder: string;
  feedback_complication_after_visit: string;
  feedback_date: string;
  feedback_status: string;
  feedback_source: string;
  feedback_visit: string;
  feedback_provider: string;
  feedback_patient: string;
  feedback_nps_band: string;
  feedback_loading_workspace: string;
  feedback_workspace_load_error: string;
  feedback_submit_success: string;
  feedback_submit_error: string;
  feedback_patient_page_title: string;
  feedback_patient_page_description: string;
  feedback_submitted_feedback_metric: string;
  feedback_promoters_metric: string;
  feedback_detractors_metric: string;
  feedback_average_overall_metric: string;
  feedback_available_visits_metric: string;
  feedback_new_survey_title: string;
  feedback_new_survey_description: string;
  feedback_submit_button: string;
  feedback_history_title: string;
  feedback_history_description: string;
  feedback_empty_title: string;
  feedback_empty_description: string;
  feedback_detail_title: string;
  feedback_detail_description: string;
  feedback_staff_page_title: string;
  feedback_staff_page_description: string;
  feedback_access_denied: string;
  feedback_capture_button: string;
  feedback_capture_notice: string;
  feedback_capture_error: string;
  feedback_select_patient_error: string;
  feedback_total_metric: string;
  feedback_reviewed_metric: string;
  feedback_queue_title: string;
  feedback_queue_description: string;
  feedback_queue_empty_title: string;
  feedback_queue_empty_description: string;
  feedback_summary_title: string;
  feedback_summary_description: string;
  feedback_overall_average: string;
  feedback_interpreter_average: string;
  feedback_concierge_average: string;
  feedback_treatment_average: string;
  feedback_service_average: string;
  feedback_ambience_average: string;
  feedback_value_average: string;
  feedback_complication_rate: string;
  feedback_top_promoters_title: string;
  feedback_no_promoter_ranking: string;
  feedback_interpreter_ranking_title: string;
  feedback_no_interpreter_feedback: string;
  feedback_clinic_ranking_title: string;
  feedback_no_clinic_ranking: string;
  feedback_feedback_count_suffix: string;
  feedback_rating_count_suffix: string;
  feedback_capture_title: string;
  feedback_capture_description: string;
  feedback_select_patient: string;
  feedback_review_title: string;
  feedback_review_actions: string;
  feedback_review_status: string;
  feedback_review_save: string;
  feedback_review_notice: string;
  feedback_review_error: string;
  feedback_review_note_placeholder: string;
  feedback_review_button: string;
  feedback_group_identity: string;
  feedback_group_feedback: string;
  feedback_group_treatment: string;
  feedback_group_scores: string;
  feedback_group_audit: string;
}

export const adminSystemRu: AdminSystemTranslations = {
  admin_system_overview: "Обзор",
  admin_system_fields: "Поля",
  admin_system_permissions: "Права доступа",
  admin_system_click_to_change: "Нажмите, чтобы изменить",
  admin_system_patient_entity: "Пациент",
  admin_system_field_workspace: "Рабочая область поля",
  admin_system_access_levels_guide_title: "Уровни доступа - справка",
  admin_system_access_levels_guide_description:
    "Как работают поля, кнопки и статусы на этой странице.",
  admin_system_access_level_full_description: "Полная видимость и редактирование.",
  admin_system_access_level_masked_description:
    "Значение видно частично, например как ****.",
  admin_system_access_level_hidden_description: "Поле полностью скрыто.",
  admin_system_access_level_conditional_description:
    "Поле видно только при выполнении условия, например после одобрения.",
  admin_system_access_level_locked_description:
    "Заблокировано системой и не может быть изменено вручную.",
  admin_system_access_how_change_title: "Как изменить",
  admin_system_access_how_change_body:
    "Откройте строку таблицы, затем в правой панели нажмите кнопку уровня рядом с ролью.",
  admin_system_access_locked_hint: "Заблокированные поля фиксируются системой.",
  admin_system_access_reset_title: "Сброс",
  admin_system_access_reset_body:
    "Кнопка сброса возвращает все уровни к стандартной конфигурации.",
  admin_system_access_cycle_hint:
    "Уровень переключается по циклу: полный -> маска -> скрыто -> условно -> полный.",
  admin_system_export_error_prefix: "Ошибка",
  admin_system_entity_id_separator: " - ",
  admin_system_record_count_appointments: "Визиты",
  admin_system_record_count_cases: "Кейсы",
  admin_system_record_count_orders: "Заказы",
  admin_system_record_count_documents: "Документы",
  admin_system_record_count_invoices: "Счета",
  access_field_functional_labels: "Функциональные метки",

  cf_entity_lead: "Лид",
  cf_entity_patient: "Пациент",
  cf_entity_order: "Заказ",
  cf_entity_provider: "Провайдер",
  cf_field_type_text: "Текст",
  cf_field_type_number: "Число",
  cf_field_type_date: "Дата",
  cf_field_type_boolean: "Да/нет",
  cf_field_type_select: "Список",

  activity_action_login: "Вход",
  activity_action_create_lead: "Лид создан",
  activity_action_create_patient: "Пациент создан",
  activity_action_convert_lead: "Лид конвертирован",
  activity_action_qualify_lead: "Лид квалифицирован",
  activity_action_update_setting: "Настройка обновлена",
  activity_action_revoke_all_sessions: "Все сессии отозваны",
  activity_action_admin_force_logout_user: "Пользователь выведен из системы",
  activity_action_revoke_all_users_sessions: "Все сессии пользователей отозваны",
  activity_action_token_theft_detected: "Обнаружена кража токена",

  activity_entity_access_policy: "Правило доступа",
  activity_entity_announcement: "Объявление",
  activity_entity_appointment: "Визит",
  activity_entity_appointment_checklist: "Чек-лист визита",
  activity_entity_appointment_request: "Запрос на визит",
  activity_entity_case: "Кейс",
  activity_entity_concierge_service: "Консьерж-сервис",
  activity_entity_consent: "Согласие",
  activity_entity_custom_field: "Пользовательское поле",
  activity_entity_document: "Документ",
  activity_entity_feedback: "Отзыв",
  activity_entity_framework_contract: "Рамочный договор",
  activity_entity_invoice: "Счет",
  activity_entity_lead: "Лид",
  activity_entity_notification_channel: "Канал уведомлений",
  activity_entity_order: "Заказ",
  activity_entity_patient: "Пациент",
  activity_entity_pending_login: "Ожидающий вход",
  activity_entity_privacy_request: "Запрос приватности",
  activity_entity_provider: "Провайдер",
  activity_entity_quote: "Предложение",
  activity_entity_reminder: "Напоминание",
  activity_entity_security: "Безопасность",
  activity_entity_session: "Сессия",
  activity_entity_system_setting: "Системная настройка",
  activity_entity_task: "Задача",
  activity_entity_user: "Пользователь",
  activity_entity_workflow_checklist_item: "Чек-лист процесса",

  activity_event_activated: "активировано",
  activity_event_added: "добавлено",
  activity_event_approved: "одобрено",
  activity_event_assigned: "назначено",
  activity_event_assignment_revoked: "назначение отозвано",
  activity_event_billing_ready: "готово к биллингу",
  activity_event_cancelled: "отменено",
  activity_event_completed: "завершено",
  activity_event_confirmed: "подтверждено",
  activity_event_converted: "конвертировано",
  activity_event_created: "создано",
  activity_event_deactivated: "деактивировано",
  activity_event_debt_management_updated: "управление долгом обновлено",
  activity_event_deleted: "удалено",
  activity_event_doctor_created: "врач создан",
  activity_event_doctor_deleted: "врач удален",
  activity_event_doctor_updated: "врач обновлен",
  activity_event_dunning_created: "напоминание об оплате создано",
  activity_event_executed: "исполнено",
  activity_event_execution_flow_updated: "исполнение обновлено",
  activity_event_external_invoice_created: "внешний счет создан",
  activity_event_external_invoice_overdue: "внешний счет просрочен",
  activity_event_external_invoice_updated: "внешний счет обновлен",
  activity_event_failed_resolved: "ошибка закрыта",
  activity_event_followup_flow_updated: "последующее сопровождение обновлено",
  activity_event_force_password_reset: "сброс пароля принудительно запрошен",
  activity_event_generated: "сгенерировано",
  activity_event_granted: "выдано",
  activity_event_ip_whitelist_added: "IP добавлен в белый список",
  activity_event_ip_whitelist_deleted: "IP удален из белого списка",
  activity_event_leistung_added: "услуга добавлена",
  activity_event_leistung_approved: "услуга одобрена",
  activity_event_maintenance_toggled: "режим обслуживания переключен",
  activity_event_medication_expiry_confirmed: "срок препарата подтвержден",
  activity_event_medication_expiry_flagged: "срок препарата отмечен",
  activity_event_mfa_toggled: "MFA переключена",
  activity_event_overdue_marked: "помечено просроченным",
  activity_event_password_reset: "пароль сброшен",
  activity_event_payment_proof_uploaded: "подтверждение оплаты загружено",
  activity_event_phase_changed: "фаза изменена",
  activity_event_planning_preparation_updated: "планирование обновлено",
  activity_event_portal_released: "опубликовано в портале",
  activity_event_portal_revoked: "публикация в портале отозвана",
  activity_event_process_gates_updated: "контрольные точки процесса обновлены",
  activity_event_rejected: "отклонено",
  activity_event_reset: "сброшено",
  activity_event_reviewed: "проверено",
  activity_event_revoked: "отозвано",
  activity_event_revoked_all: "все отозваны",
  activity_event_service_created: "сервис создан",
  activity_event_service_deleted: "сервис удален",
  activity_event_service_updated: "сервис обновлен",
  activity_event_status_changed: "статус изменен",
  activity_event_submitted: "отправлено",
  activity_event_translation_requested: "перевод запрошен",
  activity_event_translation_updated: "перевод обновлен",
  activity_event_unlocked: "разблокировано",
  activity_event_updated: "обновлено",
  activity_event_uploaded: "загружено",

  compliance_privacy_source_patient_request: "Запрос пациента",
  compliance_privacy_source_admin_intake: "Ввод администратором",
  compliance_privacy_source_legal_hold: "Юридическое удержание",
  compliance_privacy_source_patient_portal: "Портал пациента",
  compliance_privacy_source_manual: "Вручную",
  compliance_privacy_source_system: "Система",
  compliance_privacy_source_compliance_workspace: "Рабочая область compliance",

  chat_access_denied: "Текущая роль не имеет доступа к чату.",
  chat_secure_setup_failed_device: "Не удалось настроить защищенный чат на этом устройстве.",
  chat_secure_setup_pending:
    "Защищенный чат еще настраивается для этой беседы. Текстовые сообщения приостановлены, пока собеседник не откроет чат.",
  chat_secure_key_failed: "Не удалось загрузить ключ защищенного чата.",
  chat_secure_attachment_unavailable:
    "Защищенное вложение недоступно на этом устройстве.",
  chat_secure_attachment_peer_key_failed:
    "Не удалось загрузить ключ собеседника для защищенного вложения.",
  chat_secure_attachment_decrypt_failed: "Не удалось расшифровать защищенное вложение.",
  chat_secure_attachment_send_failed: "Не удалось отправить защищенное вложение.",
  chat_attachment_send_failed: "Не удалось загрузить вложение.",
  chat_secure_message_send_failed: "Не удалось отправить зашифрованное сообщение.",
  chat_secure_passphrase_required: "Введите парольную фразу.",
  chat_secure_backup_downloaded: "Резервная копия ключей защищенного чата скачана.",
  chat_secure_keys_imported: "Импортировано ключей защищенного чата: {count}.",
  chat_secure_operation_failed: "Операция с защищенными ключами не выполнена.",
  chat_secure_encrypted_label: "Сквозное шифрование",
  chat_secure_attachment_label: "Защищенное вложение",
  chat_seen: "Прочитано",
  chat_export_keys: "Экспорт ключей",
  chat_import_keys: "Импорт ключей",
  chat_export_secure_keys_title: "Экспорт ключей защищенного чата",
  chat_import_secure_keys_title: "Импорт ключей защищенного чата",
  chat_export_secure_keys_description:
    "Создайте зашифрованную резервную копию, чтобы восстановить защищенный чат на другом устройстве.",
  chat_import_secure_keys_description:
    "Восстановите зашифрованную резервную копию ключей, чтобы открыть старые защищенные чаты на этом устройстве.",
  chat_backup_selected: "Выбрана резервная копия: {name}",
  chat_backup_choose_first: "Сначала выберите файл резервной копии защищенного чата.",
  chat_key_passphrase: "Парольная фраза",
  chat_key_passphrase_placeholder: "Введите парольную фразу",
  chat_close: "Закрыть",
  chat_working: "Выполняется...",
  chat_export_backup: "Экспортировать копию",
  chat_import_backup: "Импортировать копию",

  sops_access_denied: "Этот раздел доступен только внутренним ролям.",
  sops_loading_workspace: "Загрузка рабочей области SOP...",
  sops_title: "SOP и обучение",
  sops_subtitle:
    "Библиотека SOP, справочников и обучения с маршрутами согласования и подтверждением ознакомления.",
  sops_new_content: "Новый материал",
  sops_notice_created: "Материал создан.",
  sops_notice_updated: "Материал обновлен.",
  sops_notice_ack_requested: "Запрос подтверждения отправлен.",
  sops_notice_ack_done: "Подтверждение зафиксировано.",
  sops_notice_review_saved: "Решение проверки сохранено.",
  sops_error_load: "Не удалось загрузить рабочую область SOP.",
  sops_error_save: "Не удалось сохранить материал.",
  sops_error_ack_request: "Не удалось запросить подтверждение.",
  sops_error_ack: "Не удалось зафиксировать подтверждение.",
  sops_error_review: "Не удалось сохранить проверку.",
  sops_metric_visible: "Видимые материалы",
  sops_metric_approved: "Одобрено",
  sops_metric_pending_ack: "Ожидает подтверждения",
  sops_queue_title: "Очередь согласования",
  sops_queue_description: "Материалы, ожидающие решения текущей роли.",
  sops_queue_empty_title: "Очередь пуста",
  sops_queue_empty_description: "Сейчас нет SOP, ожидающих согласования.",
  sops_library_title: "Реестр SOP",
  sops_library_description:
    "Единый список видимых материалов с фильтрами, статусами и действиями.",
  sops_library_search_placeholder: "Поиск по названию, описанию или роли",
  sops_library_empty_title: "Материалы отсутствуют",
  sops_library_empty_description:
    "Материалы появятся в реестре после одобрения или назначения.",
  sops_detail_title: "Карточка SOP",
  sops_detail_description:
    "Статус, таргетинг, текст материала и операционные действия.",
  sops_detail_overview: "Обзор",
  sops_detail_targeting: "Таргетинг",
  sops_detail_body: "Материал",
  sops_detail_actions: "Действия",
  sops_no_selection_title: "Запись не выбрана",
  sops_no_selection_description:
    "Выберите запись в таблице, чтобы открыть правую панель.",
  sops_targeting_model_title: "Модель таргетинга",
  sops_targeting_model_description:
    "Доступ определяется целевыми ролями и прямыми назначениями пользователей.",
  sops_scope_title: "Охват",
  sops_scope_description:
    "Текущий срез покрывает библиотеку SOP, маршруты согласования и подтверждения ознакомления.",
  sops_form_create_title: "Новый материал",
  sops_form_edit_title: "Редактирование материала",
  sops_form_title: "Заголовок",
  sops_form_category: "Категория",
  sops_form_summary: "Краткое описание",
  sops_form_body: "Текст",
  sops_form_target_roles: "Целевые роли",
  sops_form_direct_users: "Прямые назначения",
  sops_form_requires_ack: "Требуется подтверждение ознакомления",
  sops_review_title: "Проверка материала",
  sops_review_description:
    "Одобрите SOP или верните его на доработку с заметкой.",
  sops_review_decision: "Решение",
  sops_review_note: "Заметка проверки",
  sops_review_approve: "Одобрить",
  sops_review_reject: "Отклонить / нужны правки",
  sops_review_save: "Сохранить проверку",
  sops_action_open_review: "Открыть проверку",
  sops_action_request_ack: "Запросить подтверждение",
  sops_action_acknowledge: "Подтвердить",
  sops_column_title: "Название",
  sops_column_summary: "Описание",
  sops_column_status: "Статус",
  sops_column_category: "Категория",
  sops_column_revision: "Ревизия",
  sops_column_updated: "Обновлено",
  sops_column_author: "Автор",
  sops_column_ack: "Подтверждение",
  sops_column_approval: "Маршрут согласования",
  sops_category_sop: "SOP",
  sops_category_handbook: "Справочник",
  sops_category_training: "Обучение",
  sops_status_approved: "Одобрено",
  sops_status_pending_approval: "Ожидает согласования",
  sops_status_rejected: "Отклонено",
  sops_status_archived: "В архиве",
  sops_status_draft: "Черновик",
  sops_ack_pending: "Ожидает",
  sops_ack_acknowledged: "Подтверждено",
  sops_ack_requested: "Запрошено",
  sops_direct_users: "Прямые пользователи",
  sops_pending_ack: "Ожидает подтверждения",
  sops_acknowledged: "Подтвердили",
  sops_my_status: "Мой статус",
  sops_approval_role_ceo: "Согласование CEO",
  sops_approval_role_patient_manager: "Согласование менеджера пациента",
  sops_review_queue_metric_pm: "Очередь проверки PM",
  sops_review_queue_title_pm: "Очередь согласования менеджера пациента",
  sops_review_queue_description_pm:
    "SOP команды переводчиков, ожидающие согласования менеджера пациента перед публикацией.",
  sops_review_queue_metric_ceo: "Очередь проверки CEO",
  sops_review_queue_title_ceo: "Очередь согласования CEO",
  sops_review_queue_description_ceo:
    "SOP, созданные командой, ожидают согласования CEO перед публикацией.",
  sops_form_description_ceo:
    "Создайте SOP, справочник или обучение для ролей. Материалы CEO публикуются сразу.",
  sops_form_description_patient_manager:
    "Создайте SOP, справочник или обучение для ролей. Материалы менеджера пациента направляются на согласование CEO.",
  sops_form_description_teamlead:
    "Создайте SOP для команды переводчиков. Материалы тимлида переводчиков направляются менеджеру пациента и могут быть назначены только переводчикам.",
  sops_date_not_set: "Не указано",

  dash_order_phase_closure: "Закрытие",
  dash_order_phase_execution: "Исполнение",
  dash_order_phase_intake: "Прием",
  dash_order_phase_planning: "Планирование",
  dash_order_count_suffix: "заказов",

  feedback_status_submitted: "Отправлено",
  feedback_status_reviewed: "Проверено",
  feedback_status_archived: "В архиве",
  feedback_source_patient_portal: "Портал пациента",
  feedback_source_staff_capture: "Зафиксировано сотрудником",
  feedback_treatment_success_yes: "Да",
  feedback_treatment_success_partial: "Частично",
  feedback_treatment_success_no: "Нет",
  feedback_patient_feedback: "Отзыв пациента",
  feedback_general_feedback: "Общий отзыв",
  feedback_scores: "Оценки",
  feedback_not_rated: "Не оценено",
  feedback_overall: "Общая",
  feedback_interpreter: "Переводчик",
  feedback_treatment: "Лечение",
  feedback_doctor: "Врач",
  feedback_organization: "Организация",
  feedback_service: "Сервис",
  feedback_ambience: "Атмосфера",
  feedback_price_value: "Цена / ценность",
  feedback_treatment_success: "Успех лечения",
  feedback_complication: "Осложнение",
  feedback_complication_reported: "Сообщено",
  feedback_comment: "Комментарий",
  feedback_improvement_notes: "Замечания по улучшению",
  feedback_internal_note: "Внутренняя заметка",
  feedback_review_note: "Заметка проверки",
  feedback_patient_manager: "Менеджер пациента",
  feedback_concierge: "Консьерж",
  feedback_treatment_quality: "Качество лечения",
  feedback_doctors: "Врачи",
  feedback_service_quality: "Качество сервиса",
  feedback_infrastructure_ambience: "Инфраструктура / атмосфера",
  feedback_comment_placeholder: "Что прошло хорошо?",
  feedback_improvement_notes_placeholder: "Что команде стоит улучшить?",
  feedback_internal_note_placeholder: "Как был собран этот отзыв",
  feedback_complication_after_visit: "Сообщено об осложнении после визита",
  feedback_date: "Дата",
  feedback_status: "Статус",
  feedback_source: "Источник",
  feedback_visit: "Визит",
  feedback_provider: "Провайдер",
  feedback_patient: "Пациент",
  feedback_nps_band: "NPS-группа",
  feedback_loading_workspace: "Загрузка рабочей области отзывов...",
  feedback_workspace_load_error: "Не удалось загрузить рабочую область отзывов.",
  feedback_submit_success: "Отзыв отправлен. Спасибо.",
  feedback_submit_error: "Не удалось отправить отзыв.",
  feedback_patient_page_title: "Мои отзывы",
  feedback_patient_page_description: "Поделитесь впечатлениями о лечении, клинике и сервисе.",
  feedback_submitted_feedback_metric: "Отправлено отзывов",
  feedback_promoters_metric: "Промоутеры",
  feedback_detractors_metric: "Критики",
  feedback_average_overall_metric: "Средняя общая",
  feedback_available_visits_metric: "Доступные визиты",
  feedback_new_survey_title: "Новый опрос удовлетворенности",
  feedback_new_survey_description: "Один отзыв на визит плюс общий отзыв без визита.",
  feedback_submit_button: "Отправить отзыв",
  feedback_history_title: "История отзывов",
  feedback_history_description: "Отправленные анкеты и сигналы качества лечения.",
  feedback_empty_title: "Пока нет отзывов",
  feedback_empty_description: "Здесь появятся ваши отправленные отзывы.",
  feedback_detail_title: "Карточка отзыва",
  feedback_detail_description: "Детали оценок и комментарии.",
  feedback_staff_page_title: "Отзывы и NPS",
  feedback_staff_page_description: "Очередь, проверка и фиксация отзывов пациентов.",
  feedback_access_denied: "У этой роли нет доступа к операциям с отзывами.",
  feedback_capture_button: "Зафиксировать отзыв",
  feedback_capture_notice: "Отзыв сохранен.",
  feedback_capture_error: "Не удалось сохранить отзыв.",
  feedback_select_patient_error: "Сначала выберите пациента.",
  feedback_total_metric: "Всего отзывов",
  feedback_reviewed_metric: "Проверено",
  feedback_queue_title: "Очередь отзывов",
  feedback_queue_description: "Поиск по пациенту, клинике, врачу или заметкам.",
  feedback_queue_empty_title: "Нет записей отзывов",
  feedback_queue_empty_description: "Текущие фильтры не возвращают записи.",
  feedback_summary_title: "Сводка",
  feedback_summary_description: "Средние значения качества и сигналы результата лечения.",
  feedback_overall_average: "Средняя общая",
  feedback_interpreter_average: "Средняя по переводчику",
  feedback_concierge_average: "Средняя по консьержу",
  feedback_treatment_average: "Средняя по лечению",
  feedback_service_average: "Средняя по сервису",
  feedback_ambience_average: "Средняя по атмосфере",
  feedback_value_average: "Средняя цена/ценность",
  feedback_complication_rate: "Частота осложнений",
  feedback_top_promoters_title: "Топ промоутеров",
  feedback_no_promoter_ranking: "Рейтинг промоутеров пока отсутствует.",
  feedback_interpreter_ranking_title: "Рейтинг переводчиков",
  feedback_no_interpreter_feedback: "Отзывов по переводчикам пока нет.",
  feedback_clinic_ranking_title: "Рейтинг клиник",
  feedback_no_clinic_ranking: "Рейтинг клиник пока отсутствует.",
  feedback_feedback_count_suffix: "отзывов",
  feedback_rating_count_suffix: "оценок",
  feedback_capture_title: "Зафиксировать отзыв",
  feedback_capture_description: "Зафиксируйте отзыв о клинике, полученный по телефону или через сотрудника.",
  feedback_select_patient: "Выберите пациента",
  feedback_review_title: "Проверить отзыв",
  feedback_review_actions: "Действия проверки",
  feedback_review_status: "Статус проверки",
  feedback_review_save: "Сохранить проверку",
  feedback_review_notice: "Проверка отзыва сохранена.",
  feedback_review_error: "Не удалось сохранить проверку отзыва.",
  feedback_review_note_placeholder: "Оперативное действие или заметка проверки",
  feedback_review_button: "Проверить",
  feedback_group_identity: "Идентификация",
  feedback_group_feedback: "Отзыв",
  feedback_group_treatment: "Лечение",
  feedback_group_scores: "Оценки",
  feedback_group_audit: "Аудит",
};

export const adminSystemDe: AdminSystemTranslations = {
  admin_system_overview: "Übersicht",
  admin_system_fields: "Felder",
  admin_system_permissions: "Berechtigungen",
  admin_system_click_to_change: "Zum Ändern klicken",
  admin_system_patient_entity: "Patient",
  admin_system_field_workspace: "Feldarbeitsbereich",
  admin_system_access_levels_guide_title: "Zugriffsstufen - Anleitung",
  admin_system_access_levels_guide_description:
    "So funktionieren Felder, Schaltflächen und Status auf dieser Seite.",
  admin_system_access_level_full_description: "Vollständige Sichtbarkeit und Bearbeitung.",
  admin_system_access_level_masked_description:
    "Der Wert ist nur teilweise sichtbar, zum Beispiel als ****.",
  admin_system_access_level_hidden_description: "Das Feld ist vollständig ausgeblendet.",
  admin_system_access_level_conditional_description:
    "Das Feld ist nur unter einer Bedingung sichtbar, zum Beispiel nach Freigabe.",
  admin_system_access_level_locked_description:
    "Vom System gesperrt und nicht manuell änderbar.",
  admin_system_access_how_change_title: "Ändern",
  admin_system_access_how_change_body:
    "Öffnen Sie eine Tabellenzeile und klicken Sie rechts auf die Stufenschaltfläche neben einer Rolle.",
  admin_system_access_locked_hint: "Gesperrte Felder werden vom System festgelegt.",
  admin_system_access_reset_title: "Zurücksetzen",
  admin_system_access_reset_body:
    "Die Reset-Schaltfläche setzt alle Stufen auf die Standardkonfiguration zurück.",
  admin_system_access_cycle_hint:
    "Die Stufe wechselt im Zyklus: Voll -> Maskiert -> Ausgeblendet -> Bedingt -> Voll.",
  admin_system_export_error_prefix: "Fehler",
  admin_system_entity_id_separator: " - ",
  admin_system_record_count_appointments: "Termine",
  admin_system_record_count_cases: "Fälle",
  admin_system_record_count_orders: "Aufträge",
  admin_system_record_count_documents: "Dokumente",
  admin_system_record_count_invoices: "Rechnungen",
  access_field_functional_labels: "Funktionslabels",

  cf_entity_lead: "Lead",
  cf_entity_patient: "Patient",
  cf_entity_order: "Auftrag",
  cf_entity_provider: "Anbieter",
  cf_field_type_text: "Text",
  cf_field_type_number: "Zahl",
  cf_field_type_date: "Datum",
  cf_field_type_boolean: "Ja/Nein",
  cf_field_type_select: "Auswahl",

  activity_action_login: "Anmeldung",
  activity_action_create_lead: "Lead erstellt",
  activity_action_create_patient: "Patient erstellt",
  activity_action_convert_lead: "Lead konvertiert",
  activity_action_qualify_lead: "Lead qualifiziert",
  activity_action_update_setting: "Einstellung aktualisiert",
  activity_action_revoke_all_sessions: "Alle Sitzungen widerrufen",
  activity_action_admin_force_logout_user: "Benutzer abgemeldet",
  activity_action_revoke_all_users_sessions: "Alle Benutzersitzungen widerrufen",
  activity_action_token_theft_detected: "Token-Diebstahl erkannt",

  activity_entity_access_policy: "Zugriffsregel",
  activity_entity_announcement: "Ankündigung",
  activity_entity_appointment: "Termin",
  activity_entity_appointment_checklist: "Termin-Checkliste",
  activity_entity_appointment_request: "Terminanfrage",
  activity_entity_case: "Fall",
  activity_entity_concierge_service: "Concierge-Service",
  activity_entity_consent: "Einwilligung",
  activity_entity_custom_field: "Benutzerdefiniertes Feld",
  activity_entity_document: "Dokument",
  activity_entity_feedback: "Feedback",
  activity_entity_framework_contract: "Rahmenvertrag",
  activity_entity_invoice: "Rechnung",
  activity_entity_lead: "Lead",
  activity_entity_notification_channel: "Benachrichtigungskanal",
  activity_entity_order: "Auftrag",
  activity_entity_patient: "Patient",
  activity_entity_pending_login: "Ausstehende Anmeldung",
  activity_entity_privacy_request: "Datenschutzantrag",
  activity_entity_provider: "Anbieter",
  activity_entity_quote: "Angebot",
  activity_entity_reminder: "Erinnerung",
  activity_entity_security: "Sicherheit",
  activity_entity_session: "Sitzung",
  activity_entity_system_setting: "Systemeinstellung",
  activity_entity_task: "Aufgabe",
  activity_entity_user: "Benutzer",
  activity_entity_workflow_checklist_item: "Workflow-Checkliste",

  activity_event_activated: "aktiviert",
  activity_event_added: "hinzugefügt",
  activity_event_approved: "genehmigt",
  activity_event_assigned: "zugewiesen",
  activity_event_assignment_revoked: "Zuweisung widerrufen",
  activity_event_billing_ready: "abrechnungsbereit",
  activity_event_cancelled: "abgesagt",
  activity_event_completed: "abgeschlossen",
  activity_event_confirmed: "bestätigt",
  activity_event_converted: "konvertiert",
  activity_event_created: "erstellt",
  activity_event_deactivated: "deaktiviert",
  activity_event_debt_management_updated: "Forderungsmanagement aktualisiert",
  activity_event_deleted: "gelöscht",
  activity_event_doctor_created: "Arzt erstellt",
  activity_event_doctor_deleted: "Arzt gelöscht",
  activity_event_doctor_updated: "Arzt aktualisiert",
  activity_event_dunning_created: "Mahnung erstellt",
  activity_event_executed: "ausgeführt",
  activity_event_execution_flow_updated: "Ausführung aktualisiert",
  activity_event_external_invoice_created: "externe Rechnung erstellt",
  activity_event_external_invoice_overdue: "externe Rechnung überfällig",
  activity_event_external_invoice_updated: "externe Rechnung aktualisiert",
  activity_event_failed_resolved: "Fehler geklärt",
  activity_event_followup_flow_updated: "Nachsorge aktualisiert",
  activity_event_force_password_reset: "Passwort-Reset erzwungen",
  activity_event_generated: "erzeugt",
  activity_event_granted: "erteilt",
  activity_event_ip_whitelist_added: "IP-Freigabe hinzugefügt",
  activity_event_ip_whitelist_deleted: "IP-Freigabe gelöscht",
  activity_event_leistung_added: "Leistung hinzugefügt",
  activity_event_leistung_approved: "Leistung genehmigt",
  activity_event_maintenance_toggled: "Wartung umgeschaltet",
  activity_event_medication_expiry_confirmed: "Medikamentenablauf bestätigt",
  activity_event_medication_expiry_flagged: "Medikamentenablauf markiert",
  activity_event_mfa_toggled: "MFA umgeschaltet",
  activity_event_overdue_marked: "überfällig markiert",
  activity_event_password_reset: "Passwort zurückgesetzt",
  activity_event_payment_proof_uploaded: "Zahlungsnachweis hochgeladen",
  activity_event_phase_changed: "Phase geändert",
  activity_event_planning_preparation_updated: "Planung aktualisiert",
  activity_event_portal_released: "im Portal freigegeben",
  activity_event_portal_revoked: "Portalfreigabe widerrufen",
  activity_event_process_gates_updated: "Prozess-Gates aktualisiert",
  activity_event_rejected: "abgelehnt",
  activity_event_reset: "zurückgesetzt",
  activity_event_reviewed: "geprüft",
  activity_event_revoked: "widerrufen",
  activity_event_revoked_all: "alle widerrufen",
  activity_event_service_created: "Service erstellt",
  activity_event_service_deleted: "Service gelöscht",
  activity_event_service_updated: "Service aktualisiert",
  activity_event_status_changed: "Status geändert",
  activity_event_submitted: "eingereicht",
  activity_event_translation_requested: "Übersetzung angefragt",
  activity_event_translation_updated: "Übersetzung aktualisiert",
  activity_event_unlocked: "entsperrt",
  activity_event_updated: "aktualisiert",
  activity_event_uploaded: "hochgeladen",

  compliance_privacy_source_patient_request: "Patientenantrag",
  compliance_privacy_source_admin_intake: "Admin-Erfassung",
  compliance_privacy_source_legal_hold: "Rechtliche Sperre",
  compliance_privacy_source_patient_portal: "Patientenportal",
  compliance_privacy_source_manual: "Manuell",
  compliance_privacy_source_system: "System",
  compliance_privacy_source_compliance_workspace: "Compliance-Arbeitsbereich",

  chat_access_denied: "Ihre aktuelle Rolle hat keinen Zugriff auf den Chat.",
  chat_secure_setup_failed_device:
    "Der sichere Chat konnte auf diesem Gerät nicht eingerichtet werden.",
  chat_secure_setup_pending:
    "Die sichere Einrichtung ist für diese Unterhaltung noch ausstehend. Textnachrichten bleiben pausiert, bis die Gegenseite den Chat einmal öffnet.",
  chat_secure_key_failed: "Der sichere Chat-Schlüssel konnte nicht geladen werden.",
  chat_secure_attachment_unavailable:
    "Dieser sichere Anhang ist auf diesem Gerät nicht verfügbar.",
  chat_secure_attachment_peer_key_failed:
    "Der Schlüssel der Gegenseite für diesen sicheren Anhang konnte nicht geladen werden.",
  chat_secure_attachment_decrypt_failed: "Der sichere Anhang konnte nicht entschlüsselt werden.",
  chat_secure_attachment_send_failed: "Der sichere Anhang konnte nicht gesendet werden.",
  chat_attachment_send_failed: "Der Anhang konnte nicht hochgeladen werden.",
  chat_secure_message_send_failed: "Die verschlüsselte Nachricht konnte nicht gesendet werden.",
  chat_secure_passphrase_required: "Passphrase ist erforderlich.",
  chat_secure_backup_downloaded: "Sicherung der sicheren Chat-Schlüssel heruntergeladen.",
  chat_secure_keys_imported: "{count} sichere Chat-Schlüssel importiert.",
  chat_secure_operation_failed: "Der sichere Schlüsselvorgang ist fehlgeschlagen.",
  chat_secure_encrypted_label: "Ende-zu-Ende verschlüsselt",
  chat_secure_attachment_label: "Sicherer Anhang",
  chat_seen: "Gesehen",
  chat_export_keys: "Schlüssel exportieren",
  chat_import_keys: "Schlüssel importieren",
  chat_export_secure_keys_title: "Sichere Chat-Schlüssel exportieren",
  chat_import_secure_keys_title: "Sichere Chat-Schlüssel importieren",
  chat_export_secure_keys_description:
    "Erstellen Sie eine verschlüsselte Sicherung, um sichere Chats auf einem anderen Gerät wiederherzustellen.",
  chat_import_secure_keys_description:
    "Stellen Sie eine verschlüsselte Schlüssel-Sicherung wieder her, um ältere sichere Chats auf diesem Gerät zu öffnen.",
  chat_backup_selected: "Ausgewählte Sicherung: {name}",
  chat_backup_choose_first: "Wählen Sie zuerst eine Sicherungsdatei für den sicheren Chat aus.",
  chat_key_passphrase: "Passphrase",
  chat_key_passphrase_placeholder: "Passphrase eingeben",
  chat_close: "Schließen",
  chat_working: "Wird ausgeführt...",
  chat_export_backup: "Sicherung exportieren",
  chat_import_backup: "Sicherung importieren",

  sops_access_denied: "Dieser Bereich steht nur internen Rollen zur Verfügung.",
  sops_loading_workspace: "SOP-Arbeitsbereich wird geladen...",
  sops_title: "SOP und Lernen",
  sops_subtitle:
    "Bibliothek für SOPs, Handbücher und Trainings mit Freigaberouten und Bestätigung der Kenntnisnahme.",
  sops_new_content: "Neuer Inhalt",
  sops_notice_created: "Inhalt erstellt.",
  sops_notice_updated: "Inhalt aktualisiert.",
  sops_notice_ack_requested: "Bestätigungsanfrage gesendet.",
  sops_notice_ack_done: "Bestätigung erfasst.",
  sops_notice_review_saved: "Review-Entscheidung gespeichert.",
  sops_error_load: "SOP-Arbeitsbereich konnte nicht geladen werden.",
  sops_error_save: "Inhalt konnte nicht gespeichert werden.",
  sops_error_ack_request: "Bestätigung konnte nicht angefordert werden.",
  sops_error_ack: "Bestätigung konnte nicht erfasst werden.",
  sops_error_review: "Review konnte nicht gespeichert werden.",
  sops_metric_visible: "Sichtbare Inhalte",
  sops_metric_approved: "Genehmigt",
  sops_metric_pending_ack: "Ausstehende Bestätigung",
  sops_queue_title: "Freigabewarteschlange",
  sops_queue_description: "Inhalte, die auf eine Entscheidung der aktuellen Rolle warten.",
  sops_queue_empty_title: "Warteschlange ist leer",
  sops_queue_empty_description: "Derzeit warten keine SOPs auf Freigabe.",
  sops_library_title: "SOP-Register",
  sops_library_description:
    "Einheitliche Liste sichtbarer Inhalte mit Filtern, Status und Aktionen.",
  sops_library_search_placeholder: "Nach Titel, Zusammenfassung oder Rolle suchen",
  sops_library_empty_title: "Keine Lerninhalte",
  sops_library_empty_description:
    "Inhalte erscheinen im Register, sobald sie genehmigt oder zugewiesen wurden.",
  sops_detail_title: "SOP-Detail",
  sops_detail_description:
    "Status, Zielgruppen, Inhaltskörper und operative Aktionen.",
  sops_detail_overview: "Übersicht",
  sops_detail_targeting: "Zielgruppen",
  sops_detail_body: "Inhalt",
  sops_detail_actions: "Aktionen",
  sops_no_selection_title: "Kein Eintrag ausgewählt",
  sops_no_selection_description:
    "Wählen Sie einen Eintrag in der Tabelle aus, um die rechte Ansicht zu öffnen.",
  sops_targeting_model_title: "Zielgruppenmodell",
  sops_targeting_model_description:
    "Sichtbarkeit wird über Zielrollen und direkte Benutzerzuweisungen definiert.",
  sops_scope_title: "Umfang",
  sops_scope_description:
    "Der aktuelle Ausschnitt umfasst SOP-Bibliothek, Freigaberouten und Bestätigungen.",
  sops_form_create_title: "Neuer Inhalt",
  sops_form_edit_title: "Inhalt bearbeiten",
  sops_form_title: "Titel",
  sops_form_category: "Kategorie",
  sops_form_summary: "Kurzbeschreibung",
  sops_form_body: "Text",
  sops_form_target_roles: "Zielrollen",
  sops_form_direct_users: "Direkte Zuweisungen",
  sops_form_requires_ack: "Kenntnisnahme erforderlich",
  sops_review_title: "Inhalt prüfen",
  sops_review_description:
    "Genehmigen Sie die SOP oder geben Sie sie mit einer Review-Notiz zur Überarbeitung zurück.",
  sops_review_decision: "Entscheidung",
  sops_review_note: "Review-Notiz",
  sops_review_approve: "Genehmigen",
  sops_review_reject: "Ablehnen / Änderungen erforderlich",
  sops_review_save: "Review speichern",
  sops_action_open_review: "Review öffnen",
  sops_action_request_ack: "Bestätigung anfordern",
  sops_action_acknowledge: "Bestätigen",
  sops_column_title: "Titel",
  sops_column_summary: "Zusammenfassung",
  sops_column_status: "Status",
  sops_column_category: "Kategorie",
  sops_column_revision: "Revision",
  sops_column_updated: "Aktualisiert",
  sops_column_author: "Autor",
  sops_column_ack: "Bestätigung",
  sops_column_approval: "Freigaberoute",
  sops_category_sop: "SOP",
  sops_category_handbook: "Handbuch",
  sops_category_training: "Training",
  sops_status_approved: "Genehmigt",
  sops_status_pending_approval: "Freigabe ausstehend",
  sops_status_rejected: "Abgelehnt",
  sops_status_archived: "Archiviert",
  sops_status_draft: "Entwurf",
  sops_ack_pending: "Ausstehend",
  sops_ack_acknowledged: "Bestätigt",
  sops_ack_requested: "Angefordert",
  sops_direct_users: "Direkte Benutzer",
  sops_pending_ack: "Ausstehende Bestätigung",
  sops_acknowledged: "Bestätigt",
  sops_my_status: "Mein Status",
  sops_approval_role_ceo: "CEO-Freigabe",
  sops_approval_role_patient_manager: "Freigabe durch Patientenmanager",
  sops_review_queue_metric_pm: "PM-Review-Warteschlange",
  sops_review_queue_title_pm: "Freigabewarteschlange des Patientenmanagers",
  sops_review_queue_description_pm:
    "SOPs des Dolmetscherteams, die vor der Veröffentlichung auf Freigabe durch den Patientenmanager warten.",
  sops_review_queue_metric_ceo: "CEO-Review-Warteschlange",
  sops_review_queue_title_ceo: "CEO-Freigabewarteschlange",
  sops_review_queue_description_ceo:
    "Vom Team erstellte SOPs warten vor der Veröffentlichung auf CEO-Freigabe.",
  sops_form_description_ceo:
    "Erstellen Sie rollenbezogene SOPs, Handbücher oder Trainings. CEO-Inhalte werden sofort veröffentlicht.",
  sops_form_description_patient_manager:
    "Erstellen Sie rollenbezogene SOPs, Handbücher oder Trainings. Inhalte des Patientenmanagers gehen zur CEO-Freigabe.",
  sops_form_description_teamlead:
    "Erstellen Sie SOP-Inhalte für das Dolmetscherteam. Inhalte des Teamleads gehen zur Freigabe an den Patientenmanager und können nur Dolmetscher adressieren.",
  sops_date_not_set: "Nicht festgelegt",

  dash_order_phase_closure: "Abschluss",
  dash_order_phase_execution: "Ausführung",
  dash_order_phase_intake: "Aufnahme",
  dash_order_phase_planning: "Planung",
  dash_order_count_suffix: "Auftr.",

  feedback_status_submitted: "Eingereicht",
  feedback_status_reviewed: "Geprüft",
  feedback_status_archived: "Archiviert",
  feedback_source_patient_portal: "Patientenportal",
  feedback_source_staff_capture: "Durch Mitarbeitende erfasst",
  feedback_treatment_success_yes: "Ja",
  feedback_treatment_success_partial: "Teilweise",
  feedback_treatment_success_no: "Nein",
  feedback_patient_feedback: "Patientenfeedback",
  feedback_general_feedback: "Allgemeines Feedback",
  feedback_scores: "Bewertungen",
  feedback_not_rated: "Nicht bewertet",
  feedback_overall: "Gesamt",
  feedback_interpreter: "Dolmetscher",
  feedback_treatment: "Behandlung",
  feedback_doctor: "Arzt",
  feedback_organization: "Organisation",
  feedback_service: "Service",
  feedback_ambience: "Ambiente",
  feedback_price_value: "Preis / Leistung",
  feedback_treatment_success: "Behandlungserfolg",
  feedback_complication: "Komplikation",
  feedback_complication_reported: "Gemeldet",
  feedback_comment: "Kommentar",
  feedback_improvement_notes: "Verbesserungshinweise",
  feedback_internal_note: "Interne Erfassungsnotiz",
  feedback_review_note: "Review-Notiz",
  feedback_patient_manager: "Patientenmanager",
  feedback_concierge: "Concierge",
  feedback_treatment_quality: "Behandlungsqualität",
  feedback_doctors: "Ärzte",
  feedback_service_quality: "Servicequalität",
  feedback_infrastructure_ambience: "Infrastruktur / Ambiente",
  feedback_comment_placeholder: "Was ist gut gelaufen?",
  feedback_improvement_notes_placeholder: "Was sollte das Team verbessern?",
  feedback_internal_note_placeholder: "Wie dieses Feedback erfasst wurde",
  feedback_complication_after_visit: "Komplikation nach dem Termin gemeldet",
  feedback_date: "Datum",
  feedback_status: "Status",
  feedback_source: "Quelle",
  feedback_visit: "Termin",
  feedback_provider: "Provider",
  feedback_patient: "Patient",
  feedback_nps_band: "NPS-Band",
  feedback_loading_workspace: "Feedback-Bereich wird geladen...",
  feedback_workspace_load_error: "Feedback-Bereich konnte nicht geladen werden.",
  feedback_submit_success: "Feedback wurde gesendet. Vielen Dank.",
  feedback_submit_error: "Feedback konnte nicht gesendet werden.",
  feedback_patient_page_title: "Mein Feedback",
  feedback_patient_page_description: "Teilen Sie Ihre Erfahrungen mit Behandlung, Klinik und Service.",
  feedback_submitted_feedback_metric: "Abgegebene Rückmeldungen",
  feedback_promoters_metric: "Promotoren",
  feedback_detractors_metric: "Detraktoren",
  feedback_average_overall_metric: "Durchschnitt gesamt",
  feedback_available_visits_metric: "Verfügbare Termine",
  feedback_new_survey_title: "Neue Zufriedenheitsumfrage",
  feedback_new_survey_description: "Eine Rückmeldung pro Termin plus allgemeines Feedback ohne Termin.",
  feedback_submit_button: "Feedback senden",
  feedback_history_title: "Feedback-Verlauf",
  feedback_history_description: "Gesendete Fragebögen und Signale zur Behandlungsqualität.",
  feedback_empty_title: "Noch kein Feedback",
  feedback_empty_description: "Ihre gesendeten Einträge erscheinen hier.",
  feedback_detail_title: "Feedback-Detail",
  feedback_detail_description: "Bewertungsdetails und Kommentare.",
  feedback_staff_page_title: "Feedback und NPS",
  feedback_staff_page_description: "Warteschlange, Review-Prozess und Erfassung von Patientenfeedback.",
  feedback_access_denied: "Diese Rolle hat keinen Zugriff auf Feedback-Vorgänge.",
  feedback_capture_button: "Feedback erfassen",
  feedback_capture_notice: "Feedback wurde erfasst.",
  feedback_capture_error: "Feedback konnte nicht erfasst werden.",
  feedback_select_patient_error: "Wählen Sie zuerst einen Patienten aus.",
  feedback_total_metric: "Feedback gesamt",
  feedback_reviewed_metric: "Geprüft",
  feedback_queue_title: "Feedback-Warteschlange",
  feedback_queue_description: "Suche nach Patient, Klinik, Arzt oder Notizen.",
  feedback_queue_empty_title: "Keine Feedback-Einträge",
  feedback_queue_empty_description: "Die aktuellen Filter liefern keine Datensätze.",
  feedback_summary_title: "Übersicht",
  feedback_summary_description: "Durchschnittswerte zur Qualität und Signale zum Behandlungsergebnis.",
  feedback_overall_average: "Durchschnitt gesamt",
  feedback_interpreter_average: "Durchschnitt Dolmetscher",
  feedback_concierge_average: "Durchschnitt Concierge",
  feedback_treatment_average: "Durchschnitt Behandlung",
  feedback_service_average: "Durchschnitt Service",
  feedback_ambience_average: "Durchschnitt Ambiente",
  feedback_value_average: "Durchschnitt Preis/Leistung",
  feedback_complication_rate: "Komplikationsrate",
  feedback_top_promoters_title: "Top-Promotoren",
  feedback_no_promoter_ranking: "Noch kein Promotoren-Ranking.",
  feedback_interpreter_ranking_title: "Dolmetscher-Ranking",
  feedback_no_interpreter_feedback: "Noch kein Dolmetscher-Feedback.",
  feedback_clinic_ranking_title: "Klinik-Ranking",
  feedback_no_clinic_ranking: "Noch kein Klinik-Ranking.",
  feedback_feedback_count_suffix: "Rückmeldungen",
  feedback_rating_count_suffix: "Bewertungen",
  feedback_capture_title: "Feedback erfassen",
  feedback_capture_description: "Erfassen Sie Klinikfeedback, wenn es telefonisch oder über Mitarbeitende eingeht.",
  feedback_select_patient: "Patient auswählen",
  feedback_review_title: "Feedback prüfen",
  feedback_review_actions: "Review-Aktionen",
  feedback_review_status: "Prüfstatus",
  feedback_review_save: "Prüfung speichern",
  feedback_review_notice: "Feedback-Prüfung wurde gespeichert.",
  feedback_review_error: "Feedback konnte nicht geprüft werden.",
  feedback_review_note_placeholder: "Operative Nachverfolgung oder Prüfnotiz",
  feedback_review_button: "Prüfen",
  feedback_group_identity: "Identität",
  feedback_group_feedback: "Feedback",
  feedback_group_treatment: "Behandlung",
  feedback_group_scores: "Bewertungen",
  feedback_group_audit: "Audit",
};
