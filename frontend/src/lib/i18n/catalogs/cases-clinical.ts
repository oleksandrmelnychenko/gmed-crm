export interface CasesClinicalTranslations {
  cases_clinical_patient_fallback: string;
  cases_clinical_history_value_empty: string;
  cases_clinical_loading_case: string;
  cases_clinical_case_id: string;
  cases_clinical_patient_id: string;
  cases_clinical_referrer_label: string;
  cases_clinical_reference_code: string;
  cases_clinical_system_case_uuid: string;
  cases_clinical_retention_until: string;
  cases_clinical_last_clinical_update: string;
  cases_clinical_orders: string;
  cases_clinical_appointments: string;
  cases_clinical_revisions_metric: string;
  cases_clinical_revisions_metric_hint: string;
  cases_clinical_save_overview: string;
  cases_clinical_doctor_registry: string;
  cases_clinical_doctor_label: string;
  cases_clinical_legacy_manual_fallback: string;
  cases_clinical_valid_until: string;
  cases_clinical_remove: string;
  cases_clinical_medication_expired: string;
  cases_clinical_medication_confirmation_required: string;
  cases_clinical_medication_review_confirmed: string;
  cases_clinical_medication_validity_ended: string;
  cases_clinical_medication_notification_sent: string;
  cases_clinical_medication_confirm_expiry_review: string;
  cases_clinical_no_access_title: string;
  cases_clinical_no_access_description: string;

  cases_clinical_section_overview: string;
  cases_clinical_section_preconditions: string;
  cases_clinical_section_allergies: string;
  cases_clinical_section_surgeries: string;
  cases_clinical_section_medications: string;
  cases_clinical_section_pain: string;
  cases_clinical_section_pain_records: string;
  cases_clinical_section_symptoms: string;
  cases_clinical_section_vegetative: string;
  cases_clinical_section_cardiology: string;
  cases_clinical_section_gastroenterology: string;
  cases_clinical_section_orthopedics: string;
  cases_clinical_section_neurology: string;
  cases_clinical_section_pulmonology: string;
  cases_clinical_section_urology: string;
  cases_clinical_section_vaccination: string;
  cases_clinical_section_history: string;
  cases_clinical_group_procedure: string;
  cases_clinical_group_responsible_doctor: string;
  cases_clinical_group_notes: string;

  cases_clinical_snippet_category_anamnesis: string;
  cases_clinical_snippet_category_cardiology: string;
  cases_clinical_snippet_category_general: string;
  cases_clinical_snippet_category_medication: string;
  cases_clinical_snippet_category_neurology: string;
  cases_clinical_snippet_category_oncology: string;
  cases_clinical_snippet_category_symptoms: string;

  cases_clinical_medication_type_permanent: string;
  cases_clinical_medication_type_temporary: string;
  cases_clinical_medication_type_as_needed: string;

  cases_workspace_group_clinical: string;
  cases_workspace_group_specialty: string;
  cases_workspace_group_meta: string;
  cases_workspace_header_description: string;
  cases_workspace_history_title: string;
  cases_workspace_history_description: string;
  cases_workspace_history_revisions: string;
  cases_workspace_history_empty_title: string;
  cases_workspace_history_empty_description: string;
  cases_workspace_history_changed_by: string;
  cases_workspace_overview_description: string;
  cases_workspace_overview_main_reason: string;
  cases_workspace_overview_referrer: string;
  cases_workspace_overview_referrer_label: string;
  cases_workspace_overview_current_anamnesis: string;
  cases_workspace_overview_snippets_title: string;
  cases_workspace_overview_snippets_description: string;
  cases_workspace_overview_snippets_empty: string;
  cases_workspace_overview_snippets_insert: string;
  cases_workspace_overview_save: string;

  cases_workspace_item_save_failed: string;
  cases_workspace_item_remove_failed: string;
  cases_workspace_item_count_label: string;
  cases_workspace_item_add: string;
  cases_workspace_item_submit_create: string;
  cases_workspace_item_submit_edit: string;
  cases_workspace_item_remove: string;
  cases_workspace_specialty_relevant: string;
  cases_workspace_specialty_relevant_hint: string;
  cases_workspace_specialty_key_signs: string;
  cases_workspace_specialty_save: string;

  cases_allergies_description: string;
  cases_allergies_sheet_create: string;
  cases_allergies_sheet_edit: string;
  cases_allergies_empty_title: string;
  cases_allergies_empty_hint: string;
  cases_allergies_add_first: string;
  cases_allergies_missing_allergen: string;
  cases_allergies_untitled: string;
  cases_allergies_reaction: string;
  cases_allergies_no_reaction: string;
  cases_allergies_allergen: string;

  cases_specialty_cardiology_subflow_title: string;
  cases_specialty_cardiology_active_description: string;
  cases_specialty_cardiology_inactive_description: string;
  cases_specialty_cardiology_relevant: string;
  cases_specialty_cardiology_description: string;
  cases_specialty_cardiology_save: string;
  cases_specialty_chest_pain: string;
  cases_specialty_dyspnea: string;
  cases_specialty_palpitations: string;
  cases_specialty_syncope: string;
  cases_specialty_edema: string;
  cases_specialty_known_diagnosis: string;
  cases_specialty_prior_cardiac_workup: string;
  cases_specialty_anticoagulation: string;
  cases_specialty_cv_risk_factors: string;
  cases_specialty_family_history: string;
  cases_specialty_red_flags: string;
  cases_specialty_cardiology_notes: string;

  cases_medications_title: string;
  cases_medications_description: string;
  cases_medications_sheet_create: string;
  cases_medications_sheet_edit: string;
  cases_medications_group_identity: string;
  cases_medications_group_dosage: string;
  cases_medications_group_form_validity: string;
  cases_medications_group_prescriber: string;
  cases_medications_group_notes: string;
  cases_medications_empty_title: string;
  cases_medications_add_first: string;
  cases_medications_missing_brand: string;
  cases_medications_missing_active_ingredient: string;
  cases_medications_untitled: string;
  cases_medications_brand_name: string;
  cases_medications_active_ingredient: string;
  cases_medications_dose: string;
  cases_medications_unit: string;
  cases_medications_regimen: string;
  cases_medications_form: string;
  cases_medications_type: string;
  cases_medications_valid_until: string;
  cases_medications_since: string;
  cases_medications_reason: string;
  cases_medications_prescriber_registry: string;
  cases_medications_doctor_label: string;
  cases_medications_note: string;
  cases_medications_expired: string;
  cases_medications_confirmation_required: string;
  cases_medications_status_verified: string;
  cases_medications_status_rejected: string;
  cases_medications_status_candidate: string;
  cases_medications_status_pending: string;
  cases_medications_status_unknown: string;
  cases_medications_equivalents_load_error: string;
  cases_medications_equivalent_verify_error: string;
  cases_medications_drug_search_required: string;
  cases_medications_drug_search_failed: string;
  cases_medications_product_verify_failed: string;
  cases_medications_drug_match_create_failed: string;
  cases_medications_drug_match_verify_failed: string;
  cases_medications_import_preview_required: string;
  cases_medications_import_preview_failed: string;
  cases_medications_expiry_review_pending: string;
  cases_medications_expiry_review_full_editor: string;
  cases_medications_equivalent_lookup_medication: string;
  cases_medications_reference_title: string;
  cases_medications_reference_description: string;
  cases_medications_staff_only: string;
  cases_medications_drug_search: string;
  cases_medications_country: string;
  cases_medications_searching: string;
  cases_medications_search: string;
  cases_medications_include_candidates: string;
  cases_medications_match_saved: string;
  cases_medications_match_label: string;
  cases_medications_match_verify: string;
  cases_medications_match_reject: string;
  cases_medications_search_results_empty: string;
  cases_medications_substances: string;
  cases_medications_unknown: string;
  cases_medications_product_verify: string;
  cases_medications_reject: string;
  cases_medications_use_for_medication: string;
  cases_medications_import_title: string;
  cases_medications_import_description: string;
  cases_medications_previewing: string;
  cases_medications_preview_import: string;
  cases_medications_import_summary: string;
  cases_medications_no_substances: string;
  cases_medications_issues: string;
  cases_medications_equivalents_title: string;
  cases_medications_equivalents_description: string;
  cases_medications_equivalents_count_label: string;
  cases_medications_equivalents_find: string;
  cases_medications_equivalents_warning: string;
  cases_medications_equivalents_active_substance: string;
  cases_medications_equivalents_include_unverified: string;
  cases_medications_equivalents_empty: string;
  cases_medications_equivalents_confidence: string;
  cases_medications_equivalents_unverified_warning: string;
  cases_medications_equivalents_verify: string;
  cases_medications_equivalents_no_link: string;

  cases_pain_title: string;
  cases_pain_description: string;
  cases_pain_sheet_create: string;
  cases_pain_sheet_edit: string;
  cases_pain_group_location_timing: string;
  cases_pain_group_characteristics: string;
  cases_pain_group_intensity: string;
  cases_pain_group_course: string;
  cases_pain_empty_title: string;
  cases_pain_add_first: string;
  cases_pain_missing_location: string;
  cases_pain_no_location: string;
  cases_pain_since: string;
  cases_pain_cause: string;
  cases_pain_location: string;
  cases_pain_since_when: string;
  cases_pain_quality: string;
  cases_pain_continuity: string;
  cases_pain_evolution: string;
  cases_pain_nrs_current: string;
  cases_pain_nrs_initial: string;
  cases_pain_initial_duration: string;
  cases_pain_current_duration: string;
  cases_pain_radiation: string;
  cases_pain_triggers: string;
}

export const casesClinicalRu: CasesClinicalTranslations = {
  cases_clinical_no_access_title: "Рабочее пространство кейсов",
  cases_clinical_no_access_description:
    "Управление кейсами в backend сейчас ограничено ролями CEO и Patient Manager.",
  cases_clinical_patient_fallback: "Пациент",
  cases_clinical_history_value_empty: "пусто",
  cases_clinical_loading_case: "Загрузка кейса",
  cases_clinical_case_id: "ID кейса",
  cases_clinical_patient_id: "ID пациента",
  cases_clinical_referrer_label: "Наименование направившего врача",
  cases_clinical_reference_code: "Код ссылки",
  cases_clinical_system_case_uuid: "Системный UUID кейса",
  cases_clinical_retention_until: "Хранить до",
  cases_clinical_last_clinical_update: "Последнее клиническое обновление",
  cases_clinical_orders: "Заказы",
  cases_clinical_appointments: "Приёмы",
  cases_clinical_revisions_metric: "Клинические ревизии",
  cases_clinical_revisions_metric_hint: "Неизменяемые записи в истории кейса",
  cases_clinical_save_overview: "Сохранить обзор",
  cases_clinical_doctor_registry: "Врач из реестра",
  cases_clinical_doctor_label: "Наименование врача",
  cases_clinical_legacy_manual_fallback: "Устаревшее / ручной ввод",
  cases_clinical_valid_until: "Действительно до",
  cases_clinical_remove: "Удалить",
  cases_clinical_medication_expired: "Истёк срок",
  cases_clinical_medication_confirmation_required: "Требуется подтверждение",
  cases_clinical_medication_review_confirmed: "Проверка подтверждена",
  cases_clinical_medication_validity_ended:
    "Срок действия лекарства закончился {date}.",
  cases_clinical_medication_notification_sent:
    "Уведомление отправлено {date}.",
  cases_clinical_medication_confirm_expiry_review:
    "Подтвердить проверку срока действия",

  cases_clinical_section_overview: "Обзор",
  cases_clinical_section_preconditions: "Сопутствующие заболевания",
  cases_clinical_section_allergies: "Аллергии",
  cases_clinical_section_surgeries: "Операции",
  cases_clinical_section_medications: "Медикаменты",
  cases_clinical_section_pain: "Боль",
  cases_clinical_section_pain_records: "Записи о боли",
  cases_clinical_section_symptoms: "Симптомы",
  cases_clinical_section_vegetative: "Вегетативный анамнез",
  cases_clinical_section_cardiology: "Кардиология",
  cases_clinical_section_gastroenterology: "Гастроэнтерология",
  cases_clinical_section_orthopedics: "Ортопедия",
  cases_clinical_section_neurology: "Неврология",
  cases_clinical_section_pulmonology: "Пульмонология",
  cases_clinical_section_urology: "Урология",
  cases_clinical_section_vaccination: "Статус вакцинации",
  cases_clinical_section_history: "История",
  cases_clinical_group_procedure: "Данные операции",
  cases_clinical_group_responsible_doctor: "Ответственный врач",
  cases_clinical_group_notes: "Дополнительная информация",

  cases_clinical_snippet_category_anamnesis: "Анамнез",
  cases_clinical_snippet_category_cardiology: "Кардиология",
  cases_clinical_snippet_category_general: "Общее",
  cases_clinical_snippet_category_medication: "Медикация",
  cases_clinical_snippet_category_neurology: "Неврология",
  cases_clinical_snippet_category_oncology: "Онкология",
  cases_clinical_snippet_category_symptoms: "Симптомы",

  cases_clinical_medication_type_permanent: "Постоянная",
  cases_clinical_medication_type_temporary: "Временная",
  cases_clinical_medication_type_as_needed: "По необходимости",

  cases_workspace_group_clinical: "Клинические",
  cases_workspace_group_specialty: "Специализации",
  cases_workspace_group_meta: "Метаданные",
  cases_workspace_header_description:
    "Рабочее пространство выбранного кейса пациента. Разделы открываются из левого меню.",
  cases_workspace_history_title: "История",
  cases_workspace_history_description:
    "Неизменяемая история изменений в кейсе.",
  cases_workspace_history_revisions: "ревизий",
  cases_workspace_history_empty_title: "Ревизий пока нет.",
  cases_workspace_history_empty_description:
    "Каждое сохранение добавляет запись в историю.",
  cases_workspace_history_changed_by: "Изменено",
  cases_workspace_overview_description:
    "Причина обращения, направивший врач и текущий анамнез.",
  cases_workspace_overview_main_reason: "Причина обращения",
  cases_workspace_overview_referrer: "Направивший врач",
  cases_workspace_overview_referrer_label: "Наименование направившего врача",
  cases_workspace_overview_current_anamnesis: "Текущий анамнез",
  cases_workspace_overview_snippets_title: "Шаблоны текста",
  cases_workspace_overview_snippets_description:
    "Повторно используемые фрагменты для вставки в текст анамнеза.",
  cases_workspace_overview_snippets_empty: "Активных шаблонов пока нет.",
  cases_workspace_overview_snippets_insert: "Вставить",
  cases_workspace_overview_save: "Сохранить обзор",
  cases_workspace_item_save_failed:
    "Не удалось сохранить. Попробуйте ещё раз.",
  cases_workspace_item_remove_failed: "Не удалось удалить.",
  cases_workspace_item_count_label: "записей",
  cases_workspace_item_add: "Добавить",
  cases_workspace_item_submit_create: "Добавить",
  cases_workspace_item_submit_edit: "Сохранить изменения",
  cases_workspace_item_remove: "Удалить",
  cases_workspace_specialty_relevant: "Относится к специальности",
  cases_workspace_specialty_relevant_hint:
    "Включите, если этот раздел относится к кейсу.",
  cases_workspace_specialty_key_signs: "Ключевые симптомы",
  cases_workspace_specialty_save: "Сохранить раздел",

  cases_allergies_description:
    "Известные аллергии и задокументированные реакции.",
  cases_allergies_sheet_create: "Новая аллергия",
  cases_allergies_sheet_edit: "Редактировать аллергию",
  cases_allergies_empty_title: "Аллергий пока нет.",
  cases_allergies_empty_hint:
    "Нажмите «Добавить» - справа откроется окно ввода.",
  cases_allergies_add_first: "Добавить первую запись",
  cases_allergies_missing_allergen: "Укажите аллерген.",
  cases_allergies_untitled: "Без названия",
  cases_allergies_reaction: "Реакция",
  cases_allergies_no_reaction: "Реакция не указана",
  cases_allergies_allergen: "Аллерген",

  cases_specialty_cardiology_subflow_title: "Кардиологический блок",
  cases_specialty_cardiology_active_description:
    "Специализированный блок для кардиологических симптомов и ранее выполненной кардиодиагностики.",
  cases_specialty_cardiology_inactive_description:
    "Включайте, если симптомы или направление указывают на кардиологию.",
  cases_specialty_cardiology_relevant: "Показания к кардиологии",
  cases_specialty_cardiology_description:
    "Сердечно-сосудистый анамнез и ключевые симптомы.",
  cases_specialty_cardiology_save: "Сохранить кардиологию",
  cases_specialty_chest_pain: "Боль в груди",
  cases_specialty_dyspnea: "Одышка",
  cases_specialty_palpitations: "Сердцебиение",
  cases_specialty_syncope: "Обмороки",
  cases_specialty_edema: "Отеки",
  cases_specialty_known_diagnosis: "Известный диагноз",
  cases_specialty_prior_cardiac_workup: "Предыдущие ЭКГ / Эхо / обследования",
  cases_specialty_anticoagulation: "Антикоагуляция",
  cases_specialty_cv_risk_factors: "Сердечно-сосудистые факторы риска",
  cases_specialty_family_history: "Семейный анамнез",
  cases_specialty_red_flags: "Красные флаги",
  cases_specialty_cardiology_notes: "Кардиологические заметки",

  cases_medications_title: "Медикаменты",
  cases_medications_description:
    "Текущая медикация, дозировка, срок действия и назначивший врач.",
  cases_medications_sheet_create: "Новый медикамент",
  cases_medications_sheet_edit: "Редактировать медикамент",
  cases_medications_group_identity: "Идентификация препарата",
  cases_medications_group_dosage: "Дозировка и схема",
  cases_medications_group_form_validity: "Форма, срок и причина",
  cases_medications_group_prescriber: "Назначение",
  cases_medications_group_notes: "Дополнительная информация",
  cases_medications_empty_title: "Медикаментов пока нет.",
  cases_medications_add_first: "Добавить первый медикамент",
  cases_medications_missing_brand: "Укажите торговое название.",
  cases_medications_missing_active_ingredient: "Укажите действующее вещество.",
  cases_medications_untitled: "Без названия",
  cases_medications_brand_name: "Торговое название",
  cases_medications_active_ingredient: "Действующее вещество",
  cases_medications_dose: "Доза",
  cases_medications_unit: "Единица",
  cases_medications_regimen: "Схема приёма",
  cases_medications_form: "Форма",
  cases_medications_type: "Тип",
  cases_medications_valid_until: "Действительно до",
  cases_medications_since: "Начало приёма",
  cases_medications_reason: "Причина",
  cases_medications_prescriber_registry: "Назначивший врач (реестр)",
  cases_medications_doctor_label: "Наименование врача",
  cases_medications_note: "Комментарий",
  cases_medications_expired: "Истёк срок",
  cases_medications_confirmation_required: "Требуется подтверждение",
  cases_medications_status_verified: "Проверено",
  cases_medications_status_rejected: "Отклонено",
  cases_medications_status_candidate: "Кандидат",
  cases_medications_status_pending: "Ожидает",
  cases_medications_status_unknown: "Неизвестный статус",
  cases_medications_equivalents_load_error:
    "Не удалось загрузить эквиваленты медикации.",
  cases_medications_equivalent_verify_error:
    "Не удалось проверить эквивалент.",
  cases_medications_drug_search_required:
    "Введите название препарата, ATC-код или действующее вещество.",
  cases_medications_drug_search_failed:
    "Не удалось выполнить поиск препаратов.",
  cases_medications_product_verify_failed:
    "Не удалось проверить препарат.",
  cases_medications_drug_match_create_failed:
    "Не удалось создать связь с препаратом.",
  cases_medications_drug_match_verify_failed:
    "Не удалось проверить связь с препаратом.",
  cases_medications_import_preview_required:
    "Вставьте минимум одну CSV-строку для предпросмотра.",
  cases_medications_import_preview_failed:
    "Не удалось создать предпросмотр импорта.",
  cases_medications_expiry_review_pending:
    "Требуется подтверждение истечения срока",
  cases_medications_expiry_review_full_editor:
    "Подтверждение выполняется в полном редакторе.",
  cases_medications_equivalent_lookup_medication:
    "Медикация для поиска немецкого эквивалента",
  cases_medications_reference_title: "Справочник препаратов",
  cases_medications_reference_description:
    "Поиск по справочнику, проверка записей и привязка препарата к выбранной медикации.",
  cases_medications_staff_only: "Только команда",
  cases_medications_drug_search: "Поиск препаратов",
  cases_medications_country: "Страна",
  cases_medications_searching: "Поиск...",
  cases_medications_search: "Найти",
  cases_medications_include_candidates:
    "Включить кандидаты и отклонённые препараты для проверки командой",
  cases_medications_match_saved: "Связь с препаратом сохранена",
  cases_medications_match_label: "Связь",
  cases_medications_match_verify: "Проверить связь",
  cases_medications_match_reject: "Отклонить связь",
  cases_medications_search_results_empty:
    "Результаты поиска появятся здесь.",
  cases_medications_substances: "Действующие вещества",
  cases_medications_unknown: "Неизвестно",
  cases_medications_product_verify: "Проверить препарат",
  cases_medications_reject: "Отклонить",
  cases_medications_use_for_medication: "Использовать для медикации",
  cases_medications_import_title: "Предпросмотр импорта препаратов",
  cases_medications_import_description:
    "Тестовый CSV-предпросмотр будущего импорта препаратов. Формат: brand,country,substance,strength,form,manufacturer,atc.",
  cases_medications_previewing: "Предпросмотр...",
  cases_medications_preview_import: "Проверить импорт",
  cases_medications_import_summary:
    "{received} строк получено - {valid} валидных строк предпросмотра - {issues} с замечаниями",
  cases_medications_no_substances: "Нет действующих веществ",
  cases_medications_issues: "замечания",
  cases_medications_equivalents_title: "Найти немецкий эквивалент",
  cases_medications_equivalents_description:
    "Справочная информация для команды по немецким эквивалентам. Это не назначение.",
  cases_medications_equivalents_count_label: "кандидатов",
  cases_medications_equivalents_find: "Найти",
  cases_medications_equivalents_warning:
    "Немецкие эквиваленты являются только справочной информацией для команды, не назначением. Непроверенные кандидаты нельзя показывать пациенту.",
  cases_medications_equivalents_active_substance: "Действующее вещество",
  cases_medications_equivalents_include_unverified:
    "Включить непроверенные кандидаты только для команды",
  cases_medications_equivalents_empty:
    "Немецкие эквиваленты пока не найдены.",
  cases_medications_equivalents_confidence: "Уверенность",
  cases_medications_equivalents_unverified_warning:
    "Непроверенный кандидат: только для команды, не показывать пациенту.",
  cases_medications_equivalents_verify: "Проверить",
  cases_medications_equivalents_no_link:
    "Курируемой связи с эквивалентом пока нет. Сначала добавьте связь с препаратом.",

  cases_pain_title: "Боль",
  cases_pain_description: "Локализация, характер и интенсивность боли.",
  cases_pain_sheet_create: "Новая запись о боли",
  cases_pain_sheet_edit: "Редактировать запись о боли",
  cases_pain_group_location_timing: "Локализация и начало",
  cases_pain_group_characteristics: "Характер боли",
  cases_pain_group_intensity: "Интенсивность",
  cases_pain_group_course: "Динамика и триггеры",
  cases_pain_empty_title: "Записей о боли пока нет.",
  cases_pain_add_first: "Добавить первую запись",
  cases_pain_missing_location: "Укажите локализацию.",
  cases_pain_no_location: "Без локализации",
  cases_pain_since: "с",
  cases_pain_cause: "Причина",
  cases_pain_location: "Локализация",
  cases_pain_since_when: "С какого времени",
  cases_pain_quality: "Характер",
  cases_pain_continuity: "Постоянство",
  cases_pain_evolution: "Развитие",
  cases_pain_nrs_current: "NRS сейчас (0-10)",
  cases_pain_nrs_initial: "NRS в начале",
  cases_pain_initial_duration: "Длительность в начале",
  cases_pain_current_duration: "Длительность сейчас",
  cases_pain_radiation: "Иррадиация",
  cases_pain_triggers: "Провоцирующие факторы",
};

export const casesClinicalDe: CasesClinicalTranslations = {
  cases_clinical_patient_fallback: "Patient",
  cases_clinical_history_value_empty: "leer",
  cases_clinical_loading_case: "Fall wird geladen",
  cases_clinical_case_id: "Fall-ID",
  cases_clinical_patient_id: "Patient-ID",
  cases_clinical_referrer_label: "Bezeichnung des Zuweisers",
  cases_clinical_reference_code: "Referenzcode",
  cases_clinical_system_case_uuid: "System-UUID des Falls",
  cases_clinical_retention_until: "Aufbewahrung bis",
  cases_clinical_last_clinical_update: "Letzte klinische Aktualisierung",
  cases_clinical_orders: "Aufträge",
  cases_clinical_appointments: "Termine",
  cases_clinical_revisions_metric: "Klinische Revisionen",
  cases_clinical_revisions_metric_hint:
    "Append-only-Einträge in der Fallhistorie",
  cases_clinical_save_overview: "Übersicht speichern",
  cases_clinical_doctor_registry: "Arzt aus Register",
  cases_clinical_doctor_label: "Freitext Arzt",
  cases_clinical_legacy_manual_fallback: "Altbestand / manuelle Angabe",
  cases_clinical_valid_until: "Gültig bis",
  cases_clinical_remove: "Entfernen",
  cases_clinical_medication_expired: "Abgelaufen",
  cases_clinical_medication_confirmation_required: "Bestätigung nötig",
  cases_clinical_medication_review_confirmed: "Prüfung bestätigt",
  cases_clinical_medication_validity_ended:
    "Die Gültigkeit des Medikaments endete am {date}.",
  cases_clinical_medication_notification_sent:
    "Benachrichtigung gesendet {date}.",
  cases_clinical_medication_confirm_expiry_review:
    "Ablaufprüfung bestätigen",
  cases_clinical_no_access_title: "Fallbereich",
  cases_clinical_no_access_description:
    "Die Fallverwaltung ist im Backend derzeit auf die Rollen CEO und Patient Manager beschränkt.",

  cases_clinical_section_overview: "Übersicht",
  cases_clinical_section_preconditions: "Vorerkrankungen",
  cases_clinical_section_allergies: "Allergien",
  cases_clinical_section_surgeries: "Operationen",
  cases_clinical_section_medications: "Medikamente",
  cases_clinical_section_pain: "Schmerz",
  cases_clinical_section_pain_records: "Schmerzdokumentation",
  cases_clinical_section_symptoms: "Symptome",
  cases_clinical_section_vegetative: "Vegetative Anamnese",
  cases_clinical_section_cardiology: "Kardiologie",
  cases_clinical_section_gastroenterology: "Gastroenterologie",
  cases_clinical_section_orthopedics: "Orthopädie",
  cases_clinical_section_neurology: "Neurologie",
  cases_clinical_section_pulmonology: "Pneumologie",
  cases_clinical_section_urology: "Urologie",
  cases_clinical_section_vaccination: "Impfstatus",
  cases_clinical_section_history: "Verlauf",
  cases_clinical_group_procedure: "Eingriffsdaten",
  cases_clinical_group_responsible_doctor: "Verantwortlicher Arzt",
  cases_clinical_group_notes: "Zusätzliche Angaben",

  cases_clinical_snippet_category_anamnesis: "Anamnese",
  cases_clinical_snippet_category_cardiology: "Kardiologie",
  cases_clinical_snippet_category_general: "Allgemein",
  cases_clinical_snippet_category_medication: "Medikation",
  cases_clinical_snippet_category_neurology: "Neurologie",
  cases_clinical_snippet_category_oncology: "Onkologie",
  cases_clinical_snippet_category_symptoms: "Symptome",

  cases_clinical_medication_type_permanent: "Dauermedikation",
  cases_clinical_medication_type_temporary: "Befristet",
  cases_clinical_medication_type_as_needed: "Bei Bedarf",

  cases_workspace_group_clinical: "Klinisch",
  cases_workspace_group_specialty: "Fachgebiete",
  cases_workspace_group_meta: "Metadaten",
  cases_workspace_header_description:
    "Workspace für den ausgewählten Patientenfall. Die Sektionen werden aus der linken Navigation geöffnet.",
  cases_workspace_history_title: "Verlauf",
  cases_workspace_history_description:
    "Append-only Historie der Änderungen in diesem Fall.",
  cases_workspace_history_revisions: "Revisionen",
  cases_workspace_history_empty_title: "Noch keine Revisionen.",
  cases_workspace_history_empty_description:
    "Jede Speicherung erzeugt einen Eintrag in der Historie.",
  cases_workspace_history_changed_by: "Geändert von",
  cases_workspace_overview_description:
    "Hauptanfragegrund, Zuweiser und aktuelle Anamnese.",
  cases_workspace_overview_main_reason: "Hauptanfragegrund",
  cases_workspace_overview_referrer: "Zuweiser",
  cases_workspace_overview_referrer_label: "Bezeichnung des Zuweisers",
  cases_workspace_overview_current_anamnesis: "Aktuelle Anamnese",
  cases_workspace_overview_snippets_title: "Textbausteine",
  cases_workspace_overview_snippets_description:
    "Wiederverwendbare Fragmente zum Einfügen in den Anamnese-Text.",
  cases_workspace_overview_snippets_empty:
    "Keine aktiven Textbausteine vorhanden.",
  cases_workspace_overview_snippets_insert: "Einfügen",
  cases_workspace_overview_save: "Übersicht speichern",
  cases_workspace_item_save_failed:
    "Speichern fehlgeschlagen. Versuchen Sie es erneut.",
  cases_workspace_item_remove_failed: "Entfernen fehlgeschlagen.",
  cases_workspace_item_count_label: "Einträge",
  cases_workspace_item_add: "Hinzufügen",
  cases_workspace_item_submit_create: "Hinzufügen",
  cases_workspace_item_submit_edit: "Änderungen speichern",
  cases_workspace_item_remove: "Entfernen",
  cases_workspace_specialty_relevant: "Fachrelevant",
  cases_workspace_specialty_relevant_hint:
    "Aktivieren, wenn dieser Fachbereich für den Fall berücksichtigt werden soll.",
  cases_workspace_specialty_key_signs: "Leitsymptome",
  cases_workspace_specialty_save: "Abschnitt speichern",

  cases_allergies_description:
    "Bekannte Allergien und dokumentierte Reaktionen.",
  cases_allergies_sheet_create: "Neue Allergie",
  cases_allergies_sheet_edit: "Allergie bearbeiten",
  cases_allergies_empty_title: "Keine Allergien erfasst.",
  cases_allergies_empty_hint:
    "Hinzufügen öffnet das Eingabefenster rechts.",
  cases_allergies_add_first: "Erste Allergie hinzufügen",
  cases_allergies_missing_allergen: "Bitte den Allergiename eingeben.",
  cases_allergies_untitled: "Ohne Namen",
  cases_allergies_reaction: "Reaktion",
  cases_allergies_no_reaction: "Keine Reaktion erfasst",
  cases_allergies_allergen: "Allergen",

  cases_specialty_cardiology_subflow_title: "Kardiologischer Teilbereich",
  cases_specialty_cardiology_active_description:
    "Fachspezifischer Pfad für kardiologische Symptome und bereits erfolgte Herzdiagnostik.",
  cases_specialty_cardiology_inactive_description:
    "Aktivieren, wenn Symptome oder Überweisung auf Kardiologie hinweisen.",
  cases_specialty_cardiology_relevant: "Kardiologie relevant",
  cases_specialty_cardiology_description:
    "Kardiovaskuläre Anamnese und Leitsymptome.",
  cases_specialty_cardiology_save: "Kardiologie speichern",
  cases_specialty_chest_pain: "Brustschmerz",
  cases_specialty_dyspnea: "Dyspnoe",
  cases_specialty_palpitations: "Palpitationen",
  cases_specialty_syncope: "Synkope",
  cases_specialty_edema: "Ödeme",
  cases_specialty_known_diagnosis: "Bekannte Diagnose",
  cases_specialty_prior_cardiac_workup: "Vorbefunde (EKG / Echo / Diagnostik)",
  cases_specialty_anticoagulation: "Antikoagulation",
  cases_specialty_cv_risk_factors: "Kardiovaskuläre Risikofaktoren",
  cases_specialty_family_history: "Familienanamnese",
  cases_specialty_red_flags: "Warnzeichen",
  cases_specialty_cardiology_notes: "Kardiologische Notizen",

  cases_medications_title: "Medikamente",
  cases_medications_description:
    "Aktuelle Medikation, Dosierung, Ablaufdatum und Verordner.",
  cases_medications_sheet_create: "Neues Medikament",
  cases_medications_sheet_edit: "Medikament bearbeiten",
  cases_medications_group_identity: "Arzneimittel-Identifikation",
  cases_medications_group_dosage: "Dosierung und Schema",
  cases_medications_group_form_validity: "Form, Gültigkeit und Grund",
  cases_medications_group_prescriber: "Verordnung",
  cases_medications_group_notes: "Zusätzliche Angaben",
  cases_medications_empty_title: "Keine Medikamente erfasst.",
  cases_medications_add_first: "Erstes Medikament hinzufügen",
  cases_medications_missing_brand: "Bitte den Handelsnamen eingeben.",
  cases_medications_missing_active_ingredient: "Bitte den Wirkstoff eingeben.",
  cases_medications_untitled: "Ohne Namen",
  cases_medications_brand_name: "Handelsname",
  cases_medications_active_ingredient: "Wirkstoff",
  cases_medications_dose: "Dosis",
  cases_medications_unit: "Einheit",
  cases_medications_regimen: "Schema",
  cases_medications_form: "Darreichungsform",
  cases_medications_type: "Typ",
  cases_medications_valid_until: "Gültig bis",
  cases_medications_since: "Seit",
  cases_medications_reason: "Grund",
  cases_medications_prescriber_registry: "Verordnender Arzt (Register)",
  cases_medications_doctor_label: "Freitext Arzt",
  cases_medications_note: "Anmerkung",
  cases_medications_expired: "Abgelaufen",
  cases_medications_confirmation_required: "Bestätigung nötig",
  cases_medications_status_verified: "Verifiziert",
  cases_medications_status_rejected: "Abgelehnt",
  cases_medications_status_candidate: "Kandidat",
  cases_medications_status_pending: "Ausstehend",
  cases_medications_status_unknown: "Unbekannter Status",
  cases_medications_equivalents_load_error:
    "Medikationsäquivalente konnten nicht geladen werden.",
  cases_medications_equivalent_verify_error:
    "Äquivalent konnte nicht verifiziert werden.",
  cases_medications_drug_search_required:
    "Arzneiname, ATC-Code oder Wirkstoff eingeben.",
  cases_medications_drug_search_failed: "Arzneisuche fehlgeschlagen.",
  cases_medications_product_verify_failed:
    "Produkt konnte nicht verifiziert werden.",
  cases_medications_drug_match_create_failed:
    "Medikations-Match konnte nicht erstellt werden.",
  cases_medications_drug_match_verify_failed:
    "Medikations-Match konnte nicht verifiziert werden.",
  cases_medications_import_preview_required:
    "Mindestens eine CSV-Zeile für die Vorschau einfügen.",
  cases_medications_import_preview_failed:
    "Importvorschau konnte nicht erstellt werden.",
  cases_medications_expiry_review_pending: "Ablaufprüfung ausstehend",
  cases_medications_expiry_review_full_editor:
    "Die Bestätigung des Ablaufs erfolgt im vollständigen Editor.",
  cases_medications_equivalent_lookup_medication:
    "Medikation für die Suche nach deutschem Äquivalent",
  cases_medications_reference_title: "Arzneimittel-Referenz",
  cases_medications_reference_description:
    "Kuratierte Produkte suchen, Datensätze prüfen und einen Produkt-Match zur ausgewählten Medikation hinzufügen.",
  cases_medications_staff_only: "Nur Team",
  cases_medications_drug_search: "Arzneisuche",
  cases_medications_country: "Land",
  cases_medications_searching: "Suche...",
  cases_medications_search: "Suchen",
  cases_medications_include_candidates:
    "Kandidaten und abgelehnte Produkte für Team-Prüfung einschließen",
  cases_medications_match_saved: "Medikations-Match gespeichert",
  cases_medications_match_label: "Match",
  cases_medications_match_verify: "Match prüfen",
  cases_medications_match_reject: "Match ablehnen",
  cases_medications_search_results_empty:
    "Suchergebnisse erscheinen hier.",
  cases_medications_substances: "Wirkstoffe",
  cases_medications_unknown: "Unbekannt",
  cases_medications_product_verify: "Produkt prüfen",
  cases_medications_reject: "Ablehnen",
  cases_medications_use_for_medication: "Für Medikation nutzen",
  cases_medications_import_title: "Arzneiimport-Vorschau",
  cases_medications_import_description:
    "CSV-Testlauf für zukünftige Arzneiimporte. Format: brand,country,substance,strength,form,manufacturer,atc.",
  cases_medications_previewing: "Vorschau...",
  cases_medications_preview_import: "Import prüfen",
  cases_medications_import_summary:
    "{received} Zeilen empfangen - {valid} gültige Vorschauzeilen - {issues} mit Hinweisen",
  cases_medications_no_substances: "Keine Wirkstoffe",
  cases_medications_issues: "Hinweise",
  cases_medications_equivalents_title: "Deutsches Äquivalent finden",
  cases_medications_equivalents_description:
    "Team-Referenz für deutsche Medikationsäquivalente. Keine Verordnung.",
  cases_medications_equivalents_count_label: "Kandidaten",
  cases_medications_equivalents_find: "Finden",
  cases_medications_equivalents_warning:
    "Deutsche Äquivalente sind nur Team-Referenzinformationen, keine Verordnung. Ungeprüfte Kandidaten dürfen nicht patientenseitig angezeigt werden.",
  cases_medications_equivalents_active_substance: "Wirkstoff",
  cases_medications_equivalents_include_unverified:
    "Ungeprüfte Team-Kandidaten einschließen",
  cases_medications_equivalents_empty:
    "Noch keine deutschen Äquivalente gefunden.",
  cases_medications_equivalents_confidence: "Trefferquote",
  cases_medications_equivalents_unverified_warning:
    "Ungeprüfter Kandidat: nur für das Team, nicht patientenseitig.",
  cases_medications_equivalents_verify: "Prüfen",
  cases_medications_equivalents_no_link:
    "Noch keine kuratierte Äquivalent-Verknüpfung vorhanden. Zuerst einen Produkt-Match hinzufügen.",

  cases_pain_title: "Schmerz",
  cases_pain_description: "Schmerz-Lokalisation, Qualität und Intensität.",
  cases_pain_sheet_create: "Neuer Schmerzbefund",
  cases_pain_sheet_edit: "Schmerzbefund bearbeiten",
  cases_pain_group_location_timing: "Lokalisation und Beginn",
  cases_pain_group_characteristics: "Schmerzcharakter",
  cases_pain_group_intensity: "Intensität",
  cases_pain_group_course: "Verlauf und Auslöser",
  cases_pain_empty_title: "Keine Schmerzbefunde erfasst.",
  cases_pain_add_first: "Ersten Befund hinzufügen",
  cases_pain_missing_location: "Bitte die Lokalisation angeben.",
  cases_pain_no_location: "Ohne Lokalisation",
  cases_pain_since: "seit",
  cases_pain_cause: "Ursache",
  cases_pain_location: "Lokalisation",
  cases_pain_since_when: "Seit wann",
  cases_pain_quality: "Qualität",
  cases_pain_continuity: "Kontinuität",
  cases_pain_evolution: "Entwicklung",
  cases_pain_nrs_current: "NRS aktuell (0-10)",
  cases_pain_nrs_initial: "NRS Anfang",
  cases_pain_initial_duration: "Dauer Anfang",
  cases_pain_current_duration: "Dauer aktuell",
  cases_pain_radiation: "Ausstrahlung",
  cases_pain_triggers: "Auftreten",
};

export const CASE_STATUS_LABEL_KEYS = {
  open: "cases_open",
  in_progress: "cases_in_progress",
  closed: "cases_closed",
} as const;

export const CASE_HISTORY_SECTION_LABEL_KEYS = {
  overview: "cases_clinical_section_overview",
  vorerkrankungen: "cases_clinical_section_preconditions",
  preconditions: "cases_clinical_section_preconditions",
  allergien: "cases_clinical_section_allergies",
  allergies: "cases_clinical_section_allergies",
  operationen: "cases_clinical_section_surgeries",
  surgeries: "cases_clinical_section_surgeries",
  medikamente: "cases_clinical_section_medications",
  medications: "cases_clinical_section_medications",
  pain: "cases_clinical_section_pain",
  pain_records: "cases_clinical_section_pain_records",
  symptome: "cases_clinical_section_symptoms",
  symptoms: "cases_clinical_section_symptoms",
  vegetative: "cases_clinical_section_vegetative",
  cardiology: "cases_clinical_section_cardiology",
  gastroenterology: "cases_clinical_section_gastroenterology",
  orthopedics: "cases_clinical_section_orthopedics",
  neurology: "cases_clinical_section_neurology",
  pulmonology: "cases_clinical_section_pulmonology",
  urology: "cases_clinical_section_urology",
  impfstatus: "cases_clinical_section_vaccination",
  vaccination: "cases_clinical_section_vaccination",
  history: "cases_clinical_section_history",
} as const;

export const CASE_SNIPPET_CATEGORY_LABEL_KEYS = {
  anamnesis: "cases_clinical_snippet_category_anamnesis",
  cardiology: "cases_clinical_snippet_category_cardiology",
  general: "cases_clinical_snippet_category_general",
  medication: "cases_clinical_snippet_category_medication",
  neurology: "cases_clinical_snippet_category_neurology",
  oncology: "cases_clinical_snippet_category_oncology",
  symptoms: "cases_clinical_snippet_category_symptoms",
} as const;

export const CASE_SNIPPET_CATEGORY_VALUES = [
  "general",
  "anamnesis",
  "symptoms",
  "medication",
  "cardiology",
  "neurology",
  "oncology",
] as const;

export const CASE_MEDICATION_TYPE_LABEL_KEYS = {
  permanent: "cases_clinical_medication_type_permanent",
  temporary: "cases_clinical_medication_type_temporary",
  as_needed: "cases_clinical_medication_type_as_needed",
} as const;

export const CASE_MEDICATION_TYPE_VALUES = [
  "permanent",
  "temporary",
  "as_needed",
] as const;

export const CASE_WORKSPACE_SECTION_LABEL_KEYS = {
  overview: "cases_clinical_section_overview",
  preconditions: "cases_clinical_section_preconditions",
  allergies: "cases_clinical_section_allergies",
  surgeries: "cases_clinical_section_surgeries",
  medications: "cases_clinical_section_medications",
  pain: "cases_clinical_section_pain",
  symptoms: "cases_clinical_section_symptoms",
  vegetative: "cases_clinical_section_vegetative",
  cardiology: "cases_clinical_section_cardiology",
  gastroenterology: "cases_clinical_section_gastroenterology",
  orthopedics: "cases_clinical_section_orthopedics",
  neurology: "cases_clinical_section_neurology",
  pulmonology: "cases_clinical_section_pulmonology",
  urology: "cases_clinical_section_urology",
  history: "cases_clinical_section_history",
} as const;

export const CASE_WORKSPACE_SECTION_GROUP_LABEL_KEYS = {
  clinical: "cases_workspace_group_clinical",
  specialty: "cases_workspace_group_specialty",
  meta: "cases_workspace_group_meta",
} as const;
