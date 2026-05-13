export interface ClinicalTranslations {
  appointment_status_planned: string;
  appointment_status_confirmed: string;
  appointment_status_in_progress: string;
  appointment_status_completed: string;
  appointment_status_cancelled: string;
  appointment_care_path_regular: string;
  appointment_care_path_preventive: string;
  appointment_care_path_control: string;
  appointment_care_path_followup: string;
  appointment_interpreter_response_pending: string;
  appointment_interpreter_response_accepted: string;
  appointment_interpreter_response_declined: string;
  appointment_interpreter_response_discussion: string;
  appointment_communication_status_planned: string;
  appointment_communication_status_sent: string;
  appointment_communication_status_answered: string;
  appointment_communication_status_closed: string;
  appointment_communication_status_cancelled: string;
  appointment_communication_channel_phone: string;
  appointment_communication_channel_email: string;
  appointment_communication_channel_portal: string;
  appointment_communication_channel_fax: string;
  appointment_communication_channel_whatsapp: string;
  appointment_communication_channel_other: string;
  appointment_communication_target_doctor: string;
  appointment_communication_target_service_provider: string;
  appointment_communication_target_clinic: string;
  appointment_communication_direction_inbound: string;
  appointment_communication_direction_outbound: string;
  appointment_checklist_phase_preparation: string;
  appointment_checklist_phase_execution: string;
  appointment_checklist_phase_followup: string;
  appointment_checklist_phase_unknown: string;
  appointment_recurrence_frequency_daily: string;
  appointment_recurrence_frequency_weekly: string;
  appointment_recurrence_frequency_monthly: string;
  appointment_findings_artifact_arztbrief: string;
  appointment_findings_artifact_written_findings: string;
  appointment_findings_artifact_both: string;
  appointment_incoming_source_patient: string;
  appointment_incoming_source_doctor: string;
  appointment_incoming_source_clinic: string;
  appointment_incoming_source_interpreter: string;
  appointment_incoming_source_external_lab: string;
  appointment_incoming_source_other: string;
  appointment_incoming_category_medical_update: string;
  appointment_incoming_category_diagnosis: string;
  appointment_incoming_category_medication: string;
  appointment_incoming_category_symptom: string;
  appointment_incoming_category_lab_result: string;
  appointment_incoming_category_imaging: string;
  appointment_incoming_category_recommendation: string;
  appointment_incoming_category_risk_flag: string;
  appointment_incoming_category_other: string;
  appointment_task_status_open: string;
  appointment_task_status_in_progress: string;
  appointment_task_status_completed: string;
  appointment_task_status_cancelled: string;
  appointment_task_priority_low: string;
  appointment_task_priority_normal: string;
  appointment_task_priority_medium: string;
  appointment_task_priority_high: string;
  appointment_task_priority_urgent: string;
  appointment_billing_handoff_kind_interpreter_hours: string;
  appointment_billing_handoff_kind_concierge_settlement: string;
  appointment_billing_handoff_kind_patient_invoice: string;
  appointment_billing_handoff_kind_provider_invoice: string;
  appointment_billing_handoff_kind_payment_confirmation: string;
  appointment_billing_handoff_kind_other: string;
  appointment_concierge_service_kind_hotel: string;
  appointment_concierge_service_kind_transfer: string;
  appointment_concierge_service_kind_vip_terminal: string;
  appointment_concierge_service_kind_flight: string;
  appointment_concierge_service_kind_chauffeur: string;
  appointment_concierge_service_kind_translation_support: string;
  appointment_concierge_service_kind_other: string;
  appointment_concierge_service_status_planned: string;
  appointment_concierge_service_status_booked: string;
  appointment_concierge_service_status_confirmed: string;
  appointment_concierge_service_status_in_service: string;
  appointment_concierge_service_status_completed: string;
  appointment_concierge_service_status_cancelled: string;
  appointment_billing_status_draft: string;
  appointment_billing_status_planned: string;
  appointment_billing_status_ready: string;
  appointment_billing_status_submitted: string;
  appointment_billing_status_approved: string;
  appointment_billing_status_settled: string;
  appointment_billing_status_paid: string;
  appointment_billing_status_cancelled: string;
  appointment_billing_status_billed: string;
  appointment_billing_status_waived: string;
  appointment_follow_up_preset_post_1w_label: string;
  appointment_follow_up_preset_post_1w_title: string;
  appointment_follow_up_preset_post_1m_label: string;
  appointment_follow_up_preset_post_1m_title: string;
  appointment_follow_up_preset_post_6m_label: string;
  appointment_follow_up_preset_post_6m_title: string;
  appointment_interpreter_preference_preferred: string;
  appointment_interpreter_preference_neutral: string;
  appointment_interpreter_preference_avoid: string;
  appointment_interpreter_language_status_unknown: string;
  appointment_interpreter_language_status_match: string;
  appointment_interpreter_language_status_missing: string;
  appointment_interpreter_reason_preferred_patient: string;
  appointment_interpreter_reason_worked_before: string;
  appointment_interpreter_reason_high_feedback: string;
  appointment_interpreter_reason_language_match: string;
  appointments_workspace_nav_overview: string;
  appointments_workspace_nav_timeline: string;
  appointments_workspace_nav_coordination: string;
  appointments_workspace_nav_clinical: string;
  appointments_workspace_nav_workflow: string;
  appointments_workspace_nav_services: string;
  appointments_workspace_nav_notes: string;
  appointments_common_due: string;
  appointments_common_due_at: string;
  appointments_common_via: string;
  appointments_common_item: string;
  appointments_common_items: string;
  appointments_common_service: string;
  appointments_common_services: string;
  appointments_common_communication: string;
  appointments_common_communications: string;
  appointments_common_stakeholder: string;
  appointments_common_stakeholders: string;
  appointments_common_package_item: string;
  appointments_common_package_items: string;
  appointments_common_linked: string;
  appointments_common_ready: string;
  appointments_common_pending: string;
  appointments_common_not_required: string;
  appointments_common_not_applicable: string;
  appointments_common_approved: string;
  appointments_common_completed: string;
  appointments_common_open_count: string;
  appointments_common_task_priority: string;
  appointments_common_create_linked_task: string;
  appointments_common_open_chat: string;
  appointments_concierge_title: string;
  appointments_concierge_description: string;
  appointments_concierge_estimate: string;
  appointments_concierge_actual: string;
  appointments_concierge_no_provider: string;
  appointments_concierge_no_concierge: string;
  appointments_concierge_save_service: string;
  appointments_concierge_add_service: string;
  appointments_external_handoff_title: string;
  appointments_external_handoff_description: string;
  appointments_external_handoff_mark_answered: string;
  appointments_external_handoff_close: string;
  appointments_external_handoff_cancel: string;
  appointments_external_handoff_internal_trail: string;
  appointments_external_handoff_mirror_task: string;
  appointments_external_handoff_open_chat: string;
  appointments_external_handoff_log: string;
  appointments_follow_up_visit_title: string;
  appointments_follow_up_visit_description: string;
  appointments_follow_up_visit_created: string;
  appointments_follow_up_visit_create_reminder: string;
  appointments_follow_up_visit_create: string;
  appointments_follow_up_visit_reminder_title: string;
  appointments_follow_up_visit_reminder_description: string;
  appointments_handoff_title: string;
  appointments_handoff_description: string;
  appointments_auto_planned_from_appointment: string;
  appointments_auto_planned_completion: string;
  appointments_package_follow_up_title: string;
  appointments_package_follow_up_description: string;
  appointments_package_follow_up_reminder_scheduled_for: string;
  appointments_package_follow_up_create_task: string;
  appointments_package_follow_up_schedule: string;
  appointments_doctor_follow_up_mirror_task: string;
  appointments_doctor_follow_up_create: string;
  appointments_interpreter_suggestions_title: string;
  appointments_interpreter_suggestions_description: string;
  appointments_interpreter_recommended_now: string;
  appointments_interpreter_score: string;
  appointments_interpreter_use_recommendation: string;
  appointments_interpreter_loading_suggestions: string;
  appointments_interpreter_no_suggestions: string;
  appointments_interpreter_worked_before: string;
  appointments_interpreter_hours_approved: string;
  appointments_interpreter_languages: string;
  appointments_interpreter_selected: string;
  appointments_interpreter_use: string;
  appointments_interpreter_history_title: string;
  appointments_interpreter_total_relationships: string;
  appointments_interpreter_loading_history: string;
  appointments_interpreter_no_history: string;
  appointments_interpreter_fallback_name: string;
  appointments_interpreter_feedback: string;
  appointments_interpreter_appointments: string;
  appointments_interpreter_completed: string;
  appointments_interpreter_last: string;
  appointments_interpreter_note: string;
  appointments_interpreter_saving: string;
  appointments_report_approved_at: string;
  appointments_report_returned_at: string;
  appointments_recurring_occurrence_summary: string;
  appointments_edit_recurrence_rule_guidance: string;
  appointments_workflow_completion_scope_blocked: string;
  appointments_workflow_occurrence: string;
  appointments_workflow_occurrences: string;
  appointments_workflow_add_task: string;
  appointments_billing_mirror_task: string;
  appointments_billing_select_assignee: string;
  appointments_billing_open_chat: string;
  appointments_billing_create_handoff: string;
  appointments_overview_concierge_limited_warning: string;
}

export const clinicalRu: ClinicalTranslations = {
  appointment_status_planned: "Запланирован",
  appointment_status_confirmed: "Подтверждён",
  appointment_status_in_progress: "В процессе",
  appointment_status_completed: "Завершён",
  appointment_status_cancelled: "Отменён",
  appointment_care_path_regular: "Стандартный",
  appointment_care_path_preventive: "Профилактика",
  appointment_care_path_control: "Контроль",
  appointment_care_path_followup: "Наблюдение",
  appointment_interpreter_response_pending: "Ожидается",
  appointment_interpreter_response_accepted: "Принято",
  appointment_interpreter_response_declined: "Отклонено",
  appointment_interpreter_response_discussion: "Нужно уточнение",
  appointment_communication_status_planned: "Запланировано",
  appointment_communication_status_sent: "Отправлено",
  appointment_communication_status_answered: "Получен ответ",
  appointment_communication_status_closed: "Закрыто",
  appointment_communication_status_cancelled: "Отменено",
  appointment_communication_channel_phone: "Телефон",
  appointment_communication_channel_email: "Эл. почта",
  appointment_communication_channel_portal: "Портал",
  appointment_communication_channel_fax: "Факс",
  appointment_communication_channel_whatsapp: "WhatsApp",
  appointment_communication_channel_other: "Другой канал",
  appointment_communication_target_doctor: "Врач",
  appointment_communication_target_service_provider: "Поставщик услуг",
  appointment_communication_target_clinic: "Клиника",
  appointment_communication_direction_inbound: "Входящее",
  appointment_communication_direction_outbound: "Исходящее",
  appointment_checklist_phase_preparation: "Подготовка",
  appointment_checklist_phase_execution: "Выполнение",
  appointment_checklist_phase_followup: "После визита",
  appointment_checklist_phase_unknown: "Неизвестная фаза",
  appointment_recurrence_frequency_daily: "Ежедневно",
  appointment_recurrence_frequency_weekly: "Еженедельно",
  appointment_recurrence_frequency_monthly: "Ежемесячно",
  appointment_findings_artifact_arztbrief: "Врачебное письмо",
  appointment_findings_artifact_written_findings: "Письменное заключение",
  appointment_findings_artifact_both: "Врачебное письмо и письменное заключение",
  appointment_incoming_source_patient: "Пациент",
  appointment_incoming_source_doctor: "Врач",
  appointment_incoming_source_clinic: "Клиника",
  appointment_incoming_source_interpreter: "Переводчик",
  appointment_incoming_source_external_lab: "Внешняя лаборатория",
  appointment_incoming_source_other: "Другой источник",
  appointment_incoming_category_medical_update: "Медицинское обновление",
  appointment_incoming_category_diagnosis: "Диагноз",
  appointment_incoming_category_medication: "Назначения",
  appointment_incoming_category_symptom: "Симптомы",
  appointment_incoming_category_lab_result: "Результат анализа",
  appointment_incoming_category_imaging: "Визуализация",
  appointment_incoming_category_recommendation: "Рекомендация",
  appointment_incoming_category_risk_flag: "Флаг риска",
  appointment_incoming_category_other: "Другое",
  appointment_task_status_open: "Открыта",
  appointment_task_status_in_progress: "В работе",
  appointment_task_status_completed: "Завершена",
  appointment_task_status_cancelled: "Отменена",
  appointment_task_priority_low: "Низкий",
  appointment_task_priority_normal: "Обычный",
  appointment_task_priority_medium: "Средний",
  appointment_task_priority_high: "Высокий",
  appointment_task_priority_urgent: "Срочно",
  appointment_billing_handoff_kind_interpreter_hours: "Часы переводчика",
  appointment_billing_handoff_kind_concierge_settlement: "Расчёт консьерж-сервисов",
  appointment_billing_handoff_kind_patient_invoice: "Счёт пациенту",
  appointment_billing_handoff_kind_provider_invoice: "Счёт провайдера",
  appointment_billing_handoff_kind_payment_confirmation: "Подтверждение оплаты",
  appointment_billing_handoff_kind_other: "Другое",
  appointment_concierge_service_kind_hotel: "Отель",
  appointment_concierge_service_kind_transfer: "Трансфер",
  appointment_concierge_service_kind_vip_terminal: "VIP-терминал",
  appointment_concierge_service_kind_flight: "Перелёт",
  appointment_concierge_service_kind_chauffeur: "Водитель",
  appointment_concierge_service_kind_translation_support: "Поддержка перевода",
  appointment_concierge_service_kind_other: "Другое",
  appointment_concierge_service_status_planned: "Запланировано",
  appointment_concierge_service_status_booked: "Забронировано",
  appointment_concierge_service_status_confirmed: "Подтверждено",
  appointment_concierge_service_status_in_service: "В работе",
  appointment_concierge_service_status_completed: "Завершено",
  appointment_concierge_service_status_cancelled: "Отменено",
  appointment_billing_status_draft: "Черновик",
  appointment_billing_status_planned: "Запланировано",
  appointment_billing_status_ready: "Готово",
  appointment_billing_status_submitted: "Передано",
  appointment_billing_status_approved: "Согласовано",
  appointment_billing_status_settled: "Рассчитано",
  appointment_billing_status_paid: "Оплачено",
  appointment_billing_status_cancelled: "Отменено",
  appointment_billing_status_billed: "Выставлено",
  appointment_billing_status_waived: "Списано",
  appointment_follow_up_preset_post_1w_label: "1 неделя",
  appointment_follow_up_preset_post_1w_title: "Контрольный контакт через 1 неделю",
  appointment_follow_up_preset_post_1m_label: "1 месяц",
  appointment_follow_up_preset_post_1m_title: "Контрольный контакт через 1 месяц",
  appointment_follow_up_preset_post_6m_label: "6 месяцев",
  appointment_follow_up_preset_post_6m_title: "Контрольный контакт через 6 месяцев",
  appointment_interpreter_preference_preferred: "Предпочтительный",
  appointment_interpreter_preference_neutral: "Нейтрально",
  appointment_interpreter_preference_avoid: "Избегать",
  appointment_interpreter_language_status_unknown: "Язык неизвестен",
  appointment_interpreter_language_status_match: "Язык подходит",
  appointment_interpreter_language_status_missing: "Нет нужного языка",
  appointment_interpreter_reason_preferred_patient: "Предпочтителен для этого пациента",
  appointment_interpreter_reason_worked_before: "Работал ранее",
  appointment_interpreter_reason_high_feedback: "Высокая оценка",
  appointment_interpreter_reason_language_match: "Подходит по языку",
  appointments_workspace_nav_overview: "Обзор",
  appointments_workspace_nav_timeline: "Таймлайн",
  appointments_workspace_nav_coordination: "Координация",
  appointments_workspace_nav_clinical: "Клиника",
  appointments_workspace_nav_workflow: "Рабочий процесс",
  appointments_workspace_nav_services: "Сервисы",
  appointments_workspace_nav_notes: "Заметки",
  appointments_common_due: "Срок",
  appointments_common_due_at: "Срок",
  appointments_common_via: "через",
  appointments_common_item: "пункт",
  appointments_common_items: "пункты",
  appointments_common_service: "сервис",
  appointments_common_services: "сервисы",
  appointments_common_communication: "коммуникация",
  appointments_common_communications: "коммуникации",
  appointments_common_stakeholder: "участник",
  appointments_common_stakeholders: "участники",
  appointments_common_package_item: "пункт пакета",
  appointments_common_package_items: "пункты пакета",
  appointments_common_linked: "связано",
  appointments_common_ready: "Готово",
  appointments_common_pending: "Ожидается",
  appointments_common_not_required: "Не требуется",
  appointments_common_not_applicable: "Не применимо",
  appointments_common_approved: "Согласовано",
  appointments_common_completed: "Завершено",
  appointments_common_open_count: "открыто",
  appointments_common_task_priority: "Приоритет задачи",
  appointments_common_create_linked_task: "Создать связанную задачу",
  appointments_common_open_chat: "Открыть чат",
  appointments_concierge_title: "Консьерж- и VIP-сервисы",
  appointments_concierge_description: "Поездки, трансферы и VIP-сопровождение, связанные с этим приёмом.",
  appointments_concierge_estimate: "Оценка",
  appointments_concierge_actual: "Факт",
  appointments_concierge_no_provider: "Без провайдера",
  appointments_concierge_no_concierge: "Без консьержа",
  appointments_concierge_save_service: "Сохранить сервис",
  appointments_concierge_add_service: "Добавить сервис",
  appointments_external_handoff_title: "Передача клинике и врачу",
  appointments_external_handoff_description: "Журнал внешней коммуникации с клиниками, врачами и поставщиками услуг, плюс внутренний follow-up.",
  appointments_external_handoff_mark_answered: "Отметить ответ",
  appointments_external_handoff_close: "Закрыть",
  appointments_external_handoff_cancel: "Отменить",
  appointments_external_handoff_internal_trail: "Внутренний follow-up",
  appointments_external_handoff_mirror_task: "Отразить эту коммуникацию как внутреннюю задачу, если указан ответственный и срок.",
  appointments_external_handoff_open_chat: "Открыть черновик внутреннего чата",
  appointments_external_handoff_log: "Зафиксировать коммуникацию",
  appointments_follow_up_visit_title: "Планирование follow-up-визита",
  appointments_follow_up_visit_description: "Запланируйте следующий контрольный визит или обследование прямо из текущего приёма.",
  appointments_follow_up_visit_created: "Follow-up-визит создан.",
  appointments_follow_up_visit_create_reminder: "Создать подготовительное напоминание для нового follow-up-визита.",
  appointments_follow_up_visit_create: "Создать follow-up-визит",
  appointments_follow_up_visit_reminder_title: "Подготовить follow-up-визит: {title}",
  appointments_follow_up_visit_reminder_description:
    "Запланировано из приёма {patientPid} · {title} · {slot}.",
  appointments_handoff_title: "Handoff и follow-up",
  appointments_handoff_description: "Координируйте назначенную команду и планируйте последующее сопровождение прямо из приёма.",
  appointments_auto_planned_from_appointment:
    "Автоматически запланировано из приёма {patientPid} · {title}.",
  appointments_auto_planned_completion:
    "Автоматически запланировано при завершении приёма для {patientPid} · {title}.",
  appointments_package_follow_up_title: "Follow-up по окончанию пакета",
  appointments_package_follow_up_description: "Запланируйте обязательное напоминание за месяц до окончания связанного пакета или окна заказа.",
  appointments_package_follow_up_reminder_scheduled_for: "Напоминание будет запланировано на",
  appointments_package_follow_up_create_task: "Создать связанную задачу для контроля окончания пакета.",
  appointments_package_follow_up_schedule: "Запланировать напоминание по пакету",
  appointments_doctor_follow_up_mirror_task: "Отразить это поручение как операционную задачу для выполнения и владения.",
  appointments_doctor_follow_up_create: "Создать follow-up по назначению врача",
  appointments_interpreter_suggestions_title: "Рекомендации переводчика",
  appointments_interpreter_suggestions_description: "Ранжирование учитывает историю пациента, предпочтения, обратную связь и язык. Отсутствующие языковые данные не блокируют рекомендацию. Нежелательные переводчики скрыты из рекомендаций назначения, но остаются видимыми в истории.",
  appointments_interpreter_recommended_now: "Рекомендуется сейчас",
  appointments_interpreter_score: "Оценка",
  appointments_interpreter_use_recommendation: "Использовать рекомендацию",
  appointments_interpreter_loading_suggestions: "Загрузка рекомендаций",
  appointments_interpreter_no_suggestions: "Подходящих рекомендаций нет. Нежелательные переводчики не показаны.",
  appointments_interpreter_worked_before: "работал ранее",
  appointments_interpreter_hours_approved: "ч согласовано",
  appointments_interpreter_languages: "Языки",
  appointments_interpreter_selected: "Выбран",
  appointments_interpreter_use: "Выбрать",
  appointments_interpreter_history_title: "История переводчиков для этого пациента",
  appointments_interpreter_total_relationships: "всего связей",
  appointments_interpreter_loading_history: "Загрузка истории переводчиков",
  appointments_interpreter_no_history: "Истории переводчиков или предпочтений пока нет.",
  appointments_interpreter_fallback_name: "Переводчик",
  appointments_interpreter_feedback: "оценка",
  appointments_interpreter_appointments: "приёмы",
  appointments_interpreter_completed: "завершено",
  appointments_interpreter_last: "последний",
  appointments_interpreter_note: "Примечание",
  appointments_interpreter_saving: "Сохранение",
  appointments_report_approved_at: "Утверждено {date}",
  appointments_report_returned_at: "Возвращено {date}",
  appointments_recurring_occurrence_summary:
    "Приём {index} на {date} ({count} {checklistLabel})",
  appointments_edit_recurrence_rule_guidance: "Изменения правила повтора применяются только при выборе «этот и следующие» или «вся серия». Изменение одного приёма не меняет правило серии.",
  appointments_workflow_completion_scope_blocked: "Завершение выбранной области сейчас заблокировано",
  appointments_workflow_occurrence: "повторением",
  appointments_workflow_occurrences: "повторениями",
  appointments_workflow_add_task: "Добавить задачу",
  appointments_billing_mirror_task: "Отразить этот billing-handoff как задачу",
  appointments_billing_select_assignee: "Выберите ответственного из биллинга",
  appointments_billing_open_chat: "Открыть черновик billing-чата",
  appointments_billing_create_handoff: "Создать billing-handoff",
  appointments_overview_concierge_limited_warning: "Вид консьержа намеренно ограничен для медицинских слотов. Клинические заметки и детали провайдера здесь скрыты.",
};

export const clinicalDe: ClinicalTranslations = {
  appointment_status_planned: "Geplant",
  appointment_status_confirmed: "Bestätigt",
  appointment_status_in_progress: "Läuft",
  appointment_status_completed: "Abgeschlossen",
  appointment_status_cancelled: "Abgesagt",
  appointment_care_path_regular: "Standard",
  appointment_care_path_preventive: "Präventiv",
  appointment_care_path_control: "Kontrolle",
  appointment_care_path_followup: "Nachsorge",
  appointment_interpreter_response_pending: "Ausstehend",
  appointment_interpreter_response_accepted: "Angenommen",
  appointment_interpreter_response_declined: "Abgelehnt",
  appointment_interpreter_response_discussion: "Klärung erforderlich",
  appointment_communication_status_planned: "Geplant",
  appointment_communication_status_sent: "Gesendet",
  appointment_communication_status_answered: "Beantwortet",
  appointment_communication_status_closed: "Geschlossen",
  appointment_communication_status_cancelled: "Abgebrochen",
  appointment_communication_channel_phone: "Telefon",
  appointment_communication_channel_email: "E-Mail",
  appointment_communication_channel_portal: "Portal",
  appointment_communication_channel_fax: "Fax",
  appointment_communication_channel_whatsapp: "WhatsApp",
  appointment_communication_channel_other: "Anderer Kanal",
  appointment_communication_target_doctor: "Arzt",
  appointment_communication_target_service_provider: "Leistungserbringer",
  appointment_communication_target_clinic: "Klinik",
  appointment_communication_direction_inbound: "Eingehend",
  appointment_communication_direction_outbound: "Ausgehend",
  appointment_checklist_phase_preparation: "Vorbereitung",
  appointment_checklist_phase_execution: "Durchführung",
  appointment_checklist_phase_followup: "Nachbereitung",
  appointment_checklist_phase_unknown: "Unbekannte Phase",
  appointment_recurrence_frequency_daily: "Täglich",
  appointment_recurrence_frequency_weekly: "Wöchentlich",
  appointment_recurrence_frequency_monthly: "Monatlich",
  appointment_findings_artifact_arztbrief: "Arztbrief",
  appointment_findings_artifact_written_findings: "Schriftlicher Befund",
  appointment_findings_artifact_both: "Arztbrief und schriftlicher Befund",
  appointment_incoming_source_patient: "Patient",
  appointment_incoming_source_doctor: "Arzt",
  appointment_incoming_source_clinic: "Klinik",
  appointment_incoming_source_interpreter: "Dolmetscher",
  appointment_incoming_source_external_lab: "Externes Labor",
  appointment_incoming_source_other: "Andere Quelle",
  appointment_incoming_category_medical_update: "Medizinisches Update",
  appointment_incoming_category_diagnosis: "Diagnose",
  appointment_incoming_category_medication: "Medikation",
  appointment_incoming_category_symptom: "Symptome",
  appointment_incoming_category_lab_result: "Laborergebnis",
  appointment_incoming_category_imaging: "Bildgebung",
  appointment_incoming_category_recommendation: "Empfehlung",
  appointment_incoming_category_risk_flag: "Risikohinweis",
  appointment_incoming_category_other: "Sonstiges",
  appointment_task_status_open: "Offen",
  appointment_task_status_in_progress: "In Bearbeitung",
  appointment_task_status_completed: "Erledigt",
  appointment_task_status_cancelled: "Abgebrochen",
  appointment_task_priority_low: "Niedrig",
  appointment_task_priority_normal: "Normal",
  appointment_task_priority_medium: "Mittel",
  appointment_task_priority_high: "Hoch",
  appointment_task_priority_urgent: "Dringend",
  appointment_billing_handoff_kind_interpreter_hours: "Dolmetscherstunden",
  appointment_billing_handoff_kind_concierge_settlement: "Concierge-Abrechnung",
  appointment_billing_handoff_kind_patient_invoice: "Patientenrechnung",
  appointment_billing_handoff_kind_provider_invoice: "Providerrechnung",
  appointment_billing_handoff_kind_payment_confirmation: "Zahlungsbestätigung",
  appointment_billing_handoff_kind_other: "Sonstiges",
  appointment_concierge_service_kind_hotel: "Hotel",
  appointment_concierge_service_kind_transfer: "Transfer",
  appointment_concierge_service_kind_vip_terminal: "VIP-Terminal",
  appointment_concierge_service_kind_flight: "Flug",
  appointment_concierge_service_kind_chauffeur: "Chauffeur",
  appointment_concierge_service_kind_translation_support: "Übersetzungsunterstützung",
  appointment_concierge_service_kind_other: "Sonstiges",
  appointment_concierge_service_status_planned: "Geplant",
  appointment_concierge_service_status_booked: "Gebucht",
  appointment_concierge_service_status_confirmed: "Bestätigt",
  appointment_concierge_service_status_in_service: "In Ausführung",
  appointment_concierge_service_status_completed: "Abgeschlossen",
  appointment_concierge_service_status_cancelled: "Abgebrochen",
  appointment_billing_status_draft: "Entwurf",
  appointment_billing_status_planned: "Geplant",
  appointment_billing_status_ready: "Bereit",
  appointment_billing_status_submitted: "Übergeben",
  appointment_billing_status_approved: "Freigegeben",
  appointment_billing_status_settled: "Abgerechnet",
  appointment_billing_status_paid: "Bezahlt",
  appointment_billing_status_cancelled: "Abgebrochen",
  appointment_billing_status_billed: "In Rechnung gestellt",
  appointment_billing_status_waived: "Erlassen",
  appointment_follow_up_preset_post_1w_label: "1 Woche",
  appointment_follow_up_preset_post_1w_title: "1-Woche-Follow-up",
  appointment_follow_up_preset_post_1m_label: "1 Monat",
  appointment_follow_up_preset_post_1m_title: "1-Monats-Follow-up",
  appointment_follow_up_preset_post_6m_label: "6 Monate",
  appointment_follow_up_preset_post_6m_title: "6-Monats-Follow-up",
  appointment_interpreter_preference_preferred: "Bevorzugt",
  appointment_interpreter_preference_neutral: "Neutral",
  appointment_interpreter_preference_avoid: "Vermeiden",
  appointment_interpreter_language_status_unknown: "Sprache unbekannt",
  appointment_interpreter_language_status_match: "Sprache passt",
  appointment_interpreter_language_status_missing: "Sprache fehlt",
  appointment_interpreter_reason_preferred_patient: "Für diesen Patienten bevorzugt",
  appointment_interpreter_reason_worked_before: "Bereits zusammengearbeitet",
  appointment_interpreter_reason_high_feedback: "Hohe Bewertung",
  appointment_interpreter_reason_language_match: "Sprachlich passend",
  appointments_workspace_nav_overview: "Überblick",
  appointments_workspace_nav_timeline: "Timeline",
  appointments_workspace_nav_coordination: "Koordination",
  appointments_workspace_nav_clinical: "Klinik",
  appointments_workspace_nav_workflow: "Arbeitsablauf",
  appointments_workspace_nav_services: "Services",
  appointments_workspace_nav_notes: "Notizen",
  appointments_common_due: "Fällig",
  appointments_common_due_at: "Fällig am",
  appointments_common_via: "über",
  appointments_common_item: "Element",
  appointments_common_items: "Elemente",
  appointments_common_service: "Service",
  appointments_common_services: "Services",
  appointments_common_communication: "Kommunikation",
  appointments_common_communications: "Kommunikationen",
  appointments_common_stakeholder: "Stakeholder",
  appointments_common_stakeholders: "Stakeholder",
  appointments_common_package_item: "Paketelement",
  appointments_common_package_items: "Paketelemente",
  appointments_common_linked: "verknüpft",
  appointments_common_ready: "Bereit",
  appointments_common_pending: "Ausstehend",
  appointments_common_not_required: "Nicht erforderlich",
  appointments_common_not_applicable: "Nicht anwendbar",
  appointments_common_approved: "Freigegeben",
  appointments_common_completed: "Abgeschlossen",
  appointments_common_open_count: "offen",
  appointments_common_task_priority: "Aufgabenpriorität",
  appointments_common_create_linked_task: "Verknüpfte Aufgabe erstellen",
  appointments_common_open_chat: "Chat öffnen",
  appointments_concierge_title: "Concierge- und VIP-Services",
  appointments_concierge_description: "Reise, Transfer und VIP-Ausführung, die mit diesem Termin verknüpft sind.",
  appointments_concierge_estimate: "Schätzung",
  appointments_concierge_actual: "Ist",
  appointments_concierge_no_provider: "Kein Anbieter",
  appointments_concierge_no_concierge: "Ohne Concierge",
  appointments_concierge_save_service: "Service speichern",
  appointments_concierge_add_service: "Service hinzufügen",
  appointments_external_handoff_title: "Klinik- und Arzt-Handoff",
  appointments_external_handoff_description: "Externes Kommunikationsprotokoll für Kliniken, Ärzte und Leistungserbringer plus interne Nachverfolgung.",
  appointments_external_handoff_mark_answered: "Antwort markieren",
  appointments_external_handoff_close: "Schließen",
  appointments_external_handoff_cancel: "Abbrechen",
  appointments_external_handoff_internal_trail: "Interne Nachverfolgung",
  appointments_external_handoff_mirror_task: "Diese Kommunikation als interne Aufgabe spiegeln, wenn Verantwortlicher und Fälligkeit gesetzt sind.",
  appointments_external_handoff_open_chat: "Internen Chatentwurf öffnen",
  appointments_external_handoff_log: "Kommunikation protokollieren",
  appointments_follow_up_visit_title: "Follow-up-Termin planen",
  appointments_follow_up_visit_description: "Planen Sie den nächsten Kontrolltermin oder die nächste Untersuchung direkt aus dem aktuellen Termin.",
  appointments_follow_up_visit_created: "Follow-up-Termin erstellt.",
  appointments_follow_up_visit_create_reminder: "Vorbereitungs-Reminder für den neuen Follow-up-Termin erstellen.",
  appointments_follow_up_visit_create: "Follow-up-Termin erstellen",
  appointments_follow_up_visit_reminder_title: "Follow-up-Termin vorbereiten: {title}",
  appointments_follow_up_visit_reminder_description:
    "Geplant aus Termin {patientPid} · {title} · {slot}.",
  appointments_handoff_title: "Handoff und Follow-up",
  appointments_handoff_description: "Koordinieren Sie das zugewiesene Team und planen Sie die Nachsorge direkt aus dem Termin.",
  appointments_auto_planned_from_appointment:
    "Automatisch aus Termin {patientPid} · {title} geplant.",
  appointments_auto_planned_completion:
    "Automatisch beim Terminabschluss fuer {patientPid} · {title} geplant.",
  appointments_package_follow_up_title: "Paketende-Follow-up",
  appointments_package_follow_up_description: "Planen Sie den erforderlichen Reminder einen Monat vor Ende des verknüpften Paket- oder Auftragsfensters.",
  appointments_package_follow_up_reminder_scheduled_for: "Reminder wird geplant für",
  appointments_package_follow_up_create_task: "Verknüpfte Aufgabe für das Paketende-Follow-up erstellen.",
  appointments_package_follow_up_schedule: "Paket-Reminder planen",
  appointments_doctor_follow_up_mirror_task: "Diese ärztliche Anweisung als operative Aufgabe für Ausführung und Ownership spiegeln.",
  appointments_doctor_follow_up_create: "Ärztliches Follow-up erstellen",
  appointments_interpreter_suggestions_title: "Dolmetscher-Vorschläge",
  appointments_interpreter_suggestions_description: "Das Ranking nutzt Patientenhistorie, Präferenz, Feedback und Sprache. Fehlende Sprachdaten blockieren den Vorschlag nicht. Vermeidungspräferenzen werden aus Zuweisungsvorschlägen ausgeblendet, bleiben aber in der Historie sichtbar.",
  appointments_interpreter_recommended_now: "Aktuell empfohlen",
  appointments_interpreter_score: "Score",
  appointments_interpreter_use_recommendation: "Empfehlung übernehmen",
  appointments_interpreter_loading_suggestions: "Vorschläge werden geladen",
  appointments_interpreter_no_suggestions: "Keine passenden Vorschläge. Vermeidungspräferenzen werden nicht angezeigt.",
  appointments_interpreter_worked_before: "früher eingesetzt",
  appointments_interpreter_hours_approved: "Std. freigegeben",
  appointments_interpreter_languages: "Sprachen",
  appointments_interpreter_selected: "Ausgewählt",
  appointments_interpreter_use: "Auswählen",
  appointments_interpreter_history_title: "Dolmetscherhistorie für diesen Patienten",
  appointments_interpreter_total_relationships: "Beziehungen gesamt",
  appointments_interpreter_loading_history: "Dolmetscherhistorie wird geladen",
  appointments_interpreter_no_history: "Noch keine Dolmetscherhistorie oder Präferenzen.",
  appointments_interpreter_fallback_name: "Dolmetscher",
  appointments_interpreter_feedback: "Feedback",
  appointments_interpreter_appointments: "Termine",
  appointments_interpreter_completed: "abgeschlossen",
  appointments_interpreter_last: "zuletzt",
  appointments_interpreter_note: "Notiz",
  appointments_interpreter_saving: "Speichern",
  appointments_report_approved_at: "Freigegeben {date}",
  appointments_report_returned_at: "Zurueckgegeben {date}",
  appointments_recurring_occurrence_summary:
    "Termin {index} am {date} ({count} {checklistLabel})",
  appointments_edit_recurrence_rule_guidance: "Änderungen an der Wiederholungsregel greifen nur, wenn Sie „diesen und folgende“ oder „ganze Serie“ auswählen. Einzeltermine bleiben von Regeländerungen getrennt.",
  appointments_workflow_completion_scope_blocked: "Der Abschluss dieses Bereichs ist derzeit blockiert durch",
  appointments_workflow_occurrence: "Termin",
  appointments_workflow_occurrences: "Termine",
  appointments_workflow_add_task: "Aufgabe hinzufügen",
  appointments_billing_mirror_task: "Dieses Billing-Handoff als Aufgabe spiegeln",
  appointments_billing_select_assignee: "Billing-Zuständigen auswählen",
  appointments_billing_open_chat: "Billing-Chatentwurf öffnen",
  appointments_billing_create_handoff: "Billing-Handoff erstellen",
  appointments_overview_concierge_limited_warning: "Die Concierge-Ansicht ist für medizinische Slots bewusst eingeschränkt. Klinische Notizen und Providerdetails bleiben hier verborgen.",
};
