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
}

export const casesClinicalRu: CasesClinicalTranslations = {
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
