/**
 * Personnel files (Personalakte): pages under /personnel and /my-personnel-file.
 * See docs/personnel-files-plan-2026-09-30_ua.md.
 */
export interface PersonnelTranslations {
  nav_personnel: string;
  nav_my_personnel_file: string;
  personnel_page_intro: string;
  personnel_tab_employees: string;
  personnel_tab_completeness: string;
  personnel_tab_intake: string;
  personnel_tab_export: string;
  personnel_tab_integrity: string;
  personnel_tab_settings: string;
  personnel_tab_documents: string;
  personnel_tab_journal: string;
  personnel_employee: string;
  personnel_employees_empty: string;
  personnel_employee_new: string;
  personnel_employee_edit: string;
  personnel_employee_dialog_hint: string;
  personnel_section_person: string;
  personnel_section_employment: string;
  personnel_salutation: string;
  personnel_salutation_frau: string;
  personnel_salutation_herr: string;
  personnel_salutation_none: string;
  personnel_first_name: string;
  personnel_last_name: string;
  personnel_name_file_hint: string;
  personnel_number: string;
  personnel_employment_start: string;
  personnel_employment_end: string;
  personnel_employment_period: string;
  personnel_employment_range_invalid: string;
  personnel_since: string;
  personnel_user_link: string;
  personnel_user_link_hint: string;
  personnel_no_user_link: string;
  personnel_notes: string;
  personnel_status: string;
  personnel_status_active: string;
  personnel_status_former: string;
  personnel_filter_active: string;
  personnel_filter_former: string;
  personnel_filter_all: string;
  personnel_documents_count: string;
  personnel_last_archived: string;
  personnel_missing_for_month: string;
  personnel_intake_banner: string;
  personnel_intake_open: string;
  personnel_month_from: string;
  personnel_month_to: string;
  personnel_range_invalid: string;
  personnel_completeness_summary: string;
  personnel_late_rule: string;
  personnel_cell_present: string;
  personnel_cell_late: string;
  personnel_cell_missing: string;
  personnel_cell_open: string;
  personnel_cell_not_employed: string;
  personnel_intake_intro: string;
  personnel_intake_add: string;
  personnel_intake_uploaded: string;
  personnel_intake_uploaded_many: string;
  personnel_import_title: string;
  personnel_import_source: string;
  personnel_import_section: string;
  personnel_import_hint: string;
  personnel_import_action: string;
  personnel_intake_empty: string;
  personnel_intake_assign: string;
  personnel_intake_assign_title: string;
  personnel_intake_discard: string;
  personnel_intake_discard_title: string;
  personnel_intake_original_name: string;
  personnel_export_scope: string;
  personnel_export_all: string;
  personnel_export_selected: string;
  personnel_export_no_limit: string;
  personnel_export_include_versions: string;
  personnel_export_download: string;
  personnel_export_done: string;
  personnel_export_contents_title: string;
  personnel_export_contents_files: string;
  personnel_export_contents_index: string;
  personnel_export_contents_manifest: string;
  personnel_export_contents_report: string;
  personnel_export_logged: string;
  personnel_integrity_intro: string;
  personnel_tsa_not_configured: string;
  personnel_integrity_runs: string;
  personnel_integrity_run_now: string;
  personnel_integrity_no_runs: string;
  personnel_integrity_passed_toast: string;
  personnel_integrity_failed_toast: string;
  personnel_integrity_employees: string;
  personnel_integrity_documents: string;
  personnel_run_running: string;
  personnel_run_passed: string;
  personnel_run_failed: string;
  personnel_run_error: string;
  personnel_trigger_scheduled: string;
  personnel_trigger_manual: string;
  personnel_open_file: string;
  personnel_anchors: string;
  personnel_anchors_hint: string;
  personnel_anchors_empty: string;
  personnel_anchor_now: string;
  personnel_anchor_done: string;
  personnel_anchor_date: string;
  personnel_anchor_hash: string;
  personnel_tsa_status: string;
  personnel_tsa_time: string;
  personnel_tsa_token: string;
  personnel_tsa_pending: string;
  personnel_tsa_stamped: string;
  personnel_tsa_failed: string;
  personnel_tsa_disabled: string;
  personnel_settings_archive: string;
  personnel_settings_saved: string;
  personnel_late_days: string;
  personnel_late_days_hint: string;
  personnel_tsa_url: string;
  personnel_tsa_url_hint: string;
  personnel_deletion_enabled: string;
  personnel_deletion_warning: string;
  personnel_retention_periods: string;
  personnel_retention_periods_hint: string;
  personnel_retention_years: string;
  personnel_retention_years_invalid: string;
  personnel_retention_from: string;
  personnel_retention_from_document: string;
  personnel_retention_from_employment_end: string;
  personnel_legal_basis: string;
  personnel_monthly: string;
  personnel_retention_due: string;
  personnel_retention_due_disabled: string;
  personnel_retention_due_empty: string;
  personnel_retention_until: string;
  personnel_delete: string;
  personnel_delete_title: string;
  personnel_delete_description: string;
  personnel_deleted_toast: string;
  personnel_deleted: string;
  personnel_reason: string;
  personnel_reason_optional: string;
  personnel_reason_required: string;
  personnel_upload: string;
  personnel_upload_title: string;
  personnel_upload_hint: string;
  personnel_upload_correction: string;
  personnel_correction_title: string;
  personnel_correction_hint: string;
  personnel_correction_of: string;
  personnel_correction_none: string;
  personnel_correction_reason: string;
  personnel_category: string;
  personnel_period_month: string;
  personnel_document_date: string;
  personnel_title_optional: string;
  personnel_file: string;
  personnel_choose_file: string;
  personnel_file_hint: string;
  personnel_file_unsupported: string;
  personnel_file_too_large: string;
  personnel_will_be_archived_as: string;
  personnel_archive_name_pending: string;
  personnel_immutable_hint: string;
  personnel_archive_action: string;
  personnel_archived_toast: string;
  personnel_immutable_notice: string;
  personnel_immutable: string;
  personnel_health_hidden: string;
  personnel_health_badge: string;
  personnel_documents_empty: string;
  personnel_versions_history: string;
  personnel_version_badge: string;
  personnel_superseded: string;
  personnel_archived_late: string;
  personnel_archived_at: string;
  personnel_legal_hold: string;
  personnel_legal_hold_set: string;
  personnel_legal_hold_release: string;
  personnel_legal_hold_hint: string;
  personnel_preview: string;
  personnel_download: string;
  personnel_open_new_tab: string;
  personnel_preview_unavailable: string;
  personnel_access_logged: string;
  personnel_source_upload: string;
  personnel_source_scan: string;
  personnel_source_import: string;
  personnel_journal_empty: string;
  personnel_event_employee_created: string;
  personnel_event_employee_updated: string;
  personnel_event_document_archived: string;
  personnel_event_document_version: string;
  personnel_event_document_downloaded: string;
  personnel_event_own_file_viewed: string;
  personnel_event_own_document_downloaded: string;
  personnel_event_legal_hold_set: string;
  personnel_event_legal_hold_released: string;
  personnel_event_document_deleted: string;
  personnel_event_export_created: string;
  personnel_event_intake_received: string;
  personnel_event_intake_discarded: string;
  personnel_event_integrity_failed: string;
  personnel_event_category_updated: string;
  personnel_event_settings_updated: string;
  personnel_category_arbeitsvertrag: string;
  personnel_category_vertragsaenderung: string;
  personnel_category_nachweis: string;
  personnel_category_stundenzettel: string;
  personnel_category_entgeltabrechnung: string;
  personnel_category_lohnsteuer: string;
  personnel_category_sozialversicherung: string;
  personnel_category_arbeitsunfaehigkeit: string;
  personnel_category_urlaub: string;
  personnel_category_abmahnung: string;
  personnel_category_kuendigung: string;
  personnel_category_zeugnis: string;
  personnel_category_schriftverkehr: string;
  personnel_category_sonstiges: string;
  personnel_my_file_missing: string;
  personnel_my_file_notice: string;
  personnel_notification_intake_title: string;
  personnel_notification_intake_body: string;
  personnel_notification_missing_title: string;
  personnel_notification_missing_body: string;
  personnel_notification_integrity_title: string;
  personnel_notification_integrity_body: string;
  personnel_category_short_arbeitsvertrag: string;
  personnel_category_short_vertragsaenderung: string;
  personnel_category_short_nachweis: string;
  personnel_category_short_stundenzettel: string;
  personnel_category_short_entgeltabrechnung: string;
  personnel_category_short_lohnsteuer: string;
  personnel_category_short_sozialversicherung: string;
  personnel_category_short_arbeitsunfaehigkeit: string;
  personnel_category_short_urlaub: string;
  personnel_category_short_abmahnung: string;
  personnel_category_short_kuendigung: string;
  personnel_category_short_zeugnis: string;
  personnel_category_short_schriftverkehr: string;
  personnel_category_short_sonstiges: string;
  personnel_period: string;
  personnel_document_marks: string;
  personnel_document_note: string;
  personnel_archived_by: string;
  personnel_source: string;
  personnel_file_size: string;
  personnel_received_at: string;
  personnel_uploaded_by: string;
  personnel_journal_time: string;
  personnel_journal_action: string;
  personnel_journal_actor: string;
  personnel_integrity_started: string;
  personnel_integrity_trigger: string;
  personnel_integrity_checked: string;
  personnel_integrity_failures: string;
  personnel_integrity_failures_of: string;
  personnel_tsa_error: string;
}

export const personnelRu: PersonnelTranslations = {
  nav_personnel: "Личные дела",
  nav_my_personnel_file: "Моё личное дело",
  personnel_page_intro: "Цифровой архив личных дел по § 8 BVV. Документы хранятся без изменений под именами, которые формирует система; исправление — только новая версия с причиной.",
  personnel_tab_employees: "Сотрудники",
  personnel_tab_completeness: "Комплектность",
  personnel_tab_intake: "Входящие сканы",
  personnel_tab_export: "Выгрузка для проверки",
  personnel_tab_integrity: "Контроль целостности",
  personnel_tab_settings: "Настройки",
  personnel_tab_documents: "Документы",
  personnel_tab_journal: "Журнал действий",
  personnel_employee: "Сотрудник",
  personnel_employees_empty: "Личных дел пока нет",
  personnel_employee_new: "Новое дело",
  personnel_employee_edit: "Редактировать",
  personnel_employee_dialog_hint: "Имя и фамилия входят в имена архивных файлов. Уже сохранённые файлы при изменении не переименовываются.",
  personnel_section_person: "Личные данные",
  personnel_section_employment: "Трудовые отношения",
  personnel_salutation: "Обращение",
  personnel_salutation_frau: "Frau",
  personnel_salutation_herr: "Herr",
  personnel_salutation_none: "Без обращения",
  personnel_first_name: "Имя",
  personnel_last_name: "Фамилия",
  personnel_name_file_hint: "Как в паспорте. В именах файлов умлауты заменяются: ä → ae, ß → ss.",
  personnel_number: "Персональный номер (DATEV)",
  personnel_employment_start: "Дата приёма",
  personnel_employment_end: "Дата увольнения",
  personnel_employment_period: "Период работы",
  personnel_employment_range_invalid: "Дата увольнения не может быть раньше даты приёма.",
  personnel_since: "с",
  personnel_user_link: "Аккаунт в GMED",
  personnel_user_link_hint: "Сотрудник с привязанным аккаунтом видит своё дело в разделе «Моё личное дело» — только просмотр и скачивание.",
  personnel_no_user_link: "Не привязан",
  personnel_notes: "Заметки",
  personnel_status: "Статус",
  personnel_status_active: "Работает",
  personnel_status_former: "Не работает",
  personnel_filter_active: "Работающие",
  personnel_filter_former: "Бывшие сотрудники",
  personnel_filter_all: "Все",
  personnel_documents_count: "Документы",
  personnel_last_archived: "Последний документ",
  personnel_missing_for_month: "Не хватает за {month}",
  personnel_intake_banner: "Во входящих ждут распределения сканы: {count}",
  personnel_intake_open: "Перейти к сканам",
  personnel_month_from: "С месяца",
  personnel_month_to: "По месяц",
  personnel_range_invalid: "Начальный месяц позже конечного.",
  personnel_completeness_summary: "Не хватает: {missing} · с опозданием: {late}",
  personnel_late_rule: "«С опозданием» — документ за месяц добавлен позже чем через {days} дн. после конца месяца. До этого срока месяц считается открытым.",
  personnel_cell_present: "Есть",
  personnel_cell_late: "Есть, с опозданием",
  personnel_cell_missing: "Не хватает",
  personnel_cell_open: "Срок ещё идёт",
  personnel_cell_not_employed: "Не работал(а)",
  personnel_intake_intro: "Сюда попадают сканы со скан-станции (режим «gmed-scan --personnel») и файлы, загруженные вручную. Каждый скан нужно добавить в дело сотрудника или отклонить с причиной. (Сдать скан может и Patient Manager со скан-станции; видит очередь и распределяет сканы только CEO.)",
  personnel_intake_add: "Загрузить файлы",
  personnel_intake_uploaded: "Файл добавлен во входящие",
  personnel_intake_uploaded_many: "Добавлено файлов: {count}",
  personnel_import_title: "Добавить документ из профиля переводчика",
  personnel_import_source: "Файл из профиля переводчика",
  personnel_import_section: "В профиле переводчика есть документы, которых нет в деле",
  personnel_import_hint: "В дело сохраняется копия под архивным именем; документ в профиле не меняется. Каждый документ добавляется один раз.",
  personnel_import_action: "Добавить в дело",
  personnel_intake_empty: "Новых сканов нет",
  personnel_intake_assign: "Добавить в дело",
  personnel_intake_assign_title: "Добавить скан в личное дело",
  personnel_intake_discard: "Отклонить",
  personnel_intake_discard_title: "Отклонить скан",
  personnel_intake_original_name: "Исходный файл",
  personnel_export_scope: "Чьи дела",
  personnel_export_all: "Все сотрудники",
  personnel_export_selected: "Выбранные ({count})",
  personnel_export_no_limit: "За всё время",
  personnel_export_include_versions: "С прежними версиями (проверяющий увидит исправления)",
  personnel_export_download: "Скачать ZIP",
  personnel_export_done: "Выгрузка сохранена: {name}",
  personnel_export_contents_title: "Что внутри ZIP",
  personnel_export_contents_files: "Файлы под архивными именами, по папке на сотрудника",
  personnel_export_contents_index: "Index.csv — список документов: сотрудник, категория, период, имя файла, дата добавления, версия, SHA-256",
  personnel_export_contents_manifest: "Manifest.sha256 — контрольные суммы всех файлов",
  personnel_export_contents_report: "Pruefbericht.txt — результат проверки целостности и отметки времени",
  personnel_export_logged: "Каждая выгрузка записывается в журнал.",
  personnel_integrity_intro: "Раз в неделю система сверяет каждый файл и цепочку SHA-256. Раз в день все цепочки получают отметку времени RFC 3161 — независимое доказательство даты. (При сбое CEO получает уведомление; инцидент в реестре заводится вручную.)",
  personnel_tsa_not_configured: "Сервис отметок времени (TSA) не настроен (сервис ещё не выбран): ежедневные отметки создаются без внешней подписи. Адрес TSA указывается в настройках.",
  personnel_integrity_runs: "Проверки",
  personnel_integrity_run_now: "Проверить сейчас",
  personnel_integrity_no_runs: "Проверок ещё не было",
  personnel_integrity_passed_toast: "Проверка пройдена, расхождений нет",
  personnel_integrity_failed_toast: "Найдены расхождения",
  personnel_integrity_employees: "дел",
  personnel_integrity_documents: "документов",
  personnel_run_running: "Выполняется",
  personnel_run_passed: "Пройдена",
  personnel_run_failed: "Есть расхождения",
  personnel_run_error: "Ошибка",
  personnel_trigger_scheduled: "по расписанию",
  personnel_trigger_manual: "вручную",
  personnel_open_file: "Открыть дело",
  personnel_anchors: "Ежедневные отметки времени",
  personnel_anchors_hint: "Хеш всех цепочек за день. В сервис TSA уходит только хеш, без персональных данных.",
  personnel_anchors_empty: "Отметок ещё нет",
  personnel_anchor_now: "Создать отметку",
  personnel_anchor_done: "Отметка создана",
  personnel_anchor_date: "Дата",
  personnel_anchor_hash: "Хеш",
  personnel_tsa_status: "Подпись TSA",
  personnel_tsa_time: "Время подписи",
  personnel_tsa_token: "Файл .tsr",
  personnel_tsa_pending: "Ожидает",
  personnel_tsa_stamped: "Подписано",
  personnel_tsa_failed: "Ошибка",
  personnel_tsa_disabled: "Без TSA",
  personnel_settings_archive: "Архив",
  personnel_settings_saved: "Настройки сохранены",
  personnel_late_days: "Срок сдачи, дней после конца месяца",
  personnel_late_days_hint: "Документ за месяц, добавленный позже, помечается «с опозданием». Сейчас: 7 дней.",
  personnel_tsa_url: "Адрес сервиса отметок времени (RFC 3161)",
  personnel_tsa_url_hint: "Если пусто, отметки времени не запрашиваются.",
  personnel_deletion_enabled: "Разрешить удаление после окончания срока хранения",
  personnel_deletion_warning: "Не включайте, пока Steuerberater не подтвердит сроки. Удаление необратимо: в архиве остаётся только запись с хешем.",
  personnel_retention_periods: "Сроки хранения (предложение — ждёт подтверждения Steuerberater)",
  personnel_retention_periods_hint: "Срок считается от конца года документа или года увольнения. При изменении срока даты хранения пересчитываются.",
  personnel_retention_years: "Лет",
  personnel_retention_years_invalid: "Укажите срок от 1 до 50 лет.",
  personnel_retention_from: "Считается от",
  personnel_retention_from_document: "конца года документа",
  personnel_retention_from_employment_end: "конца года увольнения",
  personnel_legal_basis: "Основание",
  personnel_monthly: "ежемесячно",
  personnel_retention_due: "Срок хранения истёк",
  personnel_retention_due_disabled: "Удаление выключено в настройках (до подтверждения сроков Steuerberater).",
  personnel_retention_due_empty: "Документов с истёкшим сроком нет",
  personnel_retention_until: "Хранить до",
  personnel_delete: "Удалить",
  personnel_delete_title: "Удалить документ",
  personnel_delete_description: "Файл {name} будет удалён безвозвратно. В архиве останутся запись с хешем и причина.",
  personnel_deleted_toast: "Документ удалён",
  personnel_deleted: "Удалён",
  personnel_reason: "Причина",
  personnel_reason_optional: "Причина (необязательно)",
  personnel_reason_required: "Укажите причину.",
  personnel_upload: "Загрузить документ",
  personnel_upload_title: "Загрузить документ",
  personnel_upload_hint: "Имя файла система составит из категории, периода и имени сотрудника (схема имён, включая «_», согласуется со Steuerberater). После сохранения документ изменить нельзя.",
  personnel_upload_correction: "Исправить",
  personnel_correction_title: "Новая версия документа",
  personnel_correction_hint: "Исправленный файл сохраняется новой версией, прежняя остаётся в истории. Укажите причину.",
  personnel_correction_of: "Заменяет документ",
  personnel_correction_none: "Нет, это новый документ",
  personnel_correction_reason: "Причина исправления",
  personnel_category: "Категория",
  personnel_period_month: "Месяц",
  personnel_document_date: "Дата документа",
  personnel_title_optional: "Описание",
  personnel_file: "Файл",
  personnel_choose_file: "Выбрать файл",
  personnel_file_hint: "PDF, JPEG, PNG, BMP или TIFF, до 25 МБ",
  personnel_file_unsupported: "Подходят только PDF, JPEG, PNG, BMP и TIFF.",
  personnel_file_too_large: "Файл пустой или больше 25 МБ.",
  personnel_will_be_archived_as: "Имя в архиве",
  personnel_archive_name_pending: "Выберите категорию и период — появится имя файла.",
  personnel_immutable_hint: "После сохранения файл не меняется; исправить можно только новой версией.",
  personnel_archive_action: "Сохранить в архив",
  personnel_archived_toast: "Сохранено: {name}",
  personnel_immutable_notice: "Сохранённые документы нельзя изменить или заменить — только добавить исправленную версию с причиной. Документы за месяц, добавленные позже {days} дн. после его конца, помечаются «с опозданием».",
  personnel_immutable: "Неизменяемый файл",
  personnel_health_hidden: "Документы с данными о здоровье скрыты: нет прав на просмотр.",
  personnel_health_badge: "Данные о здоровье",
  personnel_documents_empty: "Документов пока нет",
  personnel_versions_history: "Прежние версии: {count}",
  personnel_version_badge: "V{version}",
  personnel_superseded: "Заменён новой версией",
  personnel_archived_late: "С опозданием",
  personnel_archived_at: "Добавлен",
  personnel_legal_hold: "Запрет удаления",
  personnel_legal_hold_set: "Запретить удаление",
  personnel_legal_hold_release: "Снять запрет удаления",
  personnel_legal_hold_hint: "Документ с запретом не удаляется и после окончания срока хранения — например, на время спора или проверки.",
  personnel_preview: "Просмотр",
  personnel_download: "Скачать",
  personnel_open_new_tab: "Открыть в новой вкладке",
  personnel_preview_unavailable: "Браузер не показывает этот формат (например, TIFF). Скачайте файл.",
  personnel_access_logged: "Просмотры и скачивания записываются в журнал.",
  personnel_source_upload: "загружен",
  personnel_source_scan: "скан",
  personnel_source_import: "из профиля",
  personnel_journal_empty: "Записей нет",
  personnel_event_employee_created: "Дело создано",
  personnel_event_employee_updated: "Данные сотрудника изменены",
  personnel_event_document_archived: "Документ добавлен",
  personnel_event_document_version: "Добавлена новая версия",
  personnel_event_document_downloaded: "Документ просмотрен или скачан",
  personnel_event_own_file_viewed: "Сотрудник открыл своё дело",
  personnel_event_own_document_downloaded: "Сотрудник просмотрел или скачал свой документ",
  personnel_event_legal_hold_set: "Установлен запрет удаления",
  personnel_event_legal_hold_released: "Запрет удаления снят",
  personnel_event_document_deleted: "Документ удалён по сроку хранения",
  personnel_event_export_created: "Сделана выгрузка",
  personnel_event_intake_received: "Получен скан",
  personnel_event_intake_discarded: "Скан отклонён",
  personnel_event_integrity_failed: "Проверка целостности нашла расхождение",
  personnel_event_category_updated: "Изменён срок хранения",
  personnel_event_settings_updated: "Изменены настройки",
  personnel_category_arbeitsvertrag: "Трудовой договор",
  personnel_category_vertragsaenderung: "Изменение договора",
  personnel_category_nachweis: "Условия труда (NachwG)",
  personnel_category_stundenzettel: "Табель рабочего времени",
  personnel_category_entgeltabrechnung: "Расчётный листок",
  personnel_category_lohnsteuer: "Налог с зарплаты (Lohnsteuer)",
  personnel_category_sozialversicherung: "Социальное страхование",
  personnel_category_arbeitsunfaehigkeit: "Больничный лист",
  personnel_category_urlaub: "Отпуск",
  personnel_category_abmahnung: "Выговор (Abmahnung)",
  personnel_category_kuendigung: "Увольнение",
  personnel_category_zeugnis: "Характеристика (Arbeitszeugnis)",
  personnel_category_schriftverkehr: "Переписка",
  personnel_category_sonstiges: "Прочее",
  personnel_my_file_missing: "К вашему аккаунту не привязано личное дело.",
  personnel_my_file_notice: "Только просмотр и скачивание; каждое открытие записывается в журнал. Если в документе ошибка, обратитесь к руководству.",
  personnel_notification_intake_title: "Личные дела: новый скан",
  personnel_notification_intake_body: "Скан ждёт распределения в личное дело.",
  personnel_notification_missing_title: "Личные дела: не хватает документов за {month}",
  personnel_notification_missing_body: "Не добавлено ежемесячных документов: {documents}, сотрудников: {employees}.",
  personnel_notification_integrity_title: "Личные дела: проверка целостности не пройдена",
  personnel_notification_integrity_body: "Расхождений в архиве: {count}. Откройте «Личные дела» → «Контроль целостности».",
  personnel_category_short_arbeitsvertrag: "Договор",
  personnel_category_short_vertragsaenderung: "Изм. дог.",
  personnel_category_short_nachweis: "NachwG",
  personnel_category_short_stundenzettel: "Табель",
  personnel_category_short_entgeltabrechnung: "Расчёт",
  personnel_category_short_lohnsteuer: "Налог",
  personnel_category_short_sozialversicherung: "Соц. страх.",
  personnel_category_short_arbeitsunfaehigkeit: "Больн.",
  personnel_category_short_urlaub: "Отпуск",
  personnel_category_short_abmahnung: "Выговор",
  personnel_category_short_kuendigung: "Увольн.",
  personnel_category_short_zeugnis: "Характ.",
  personnel_category_short_schriftverkehr: "Перепис.",
  personnel_category_short_sonstiges: "Прочее",
  personnel_period: "Период",
  personnel_document_marks: "Отметки",
  personnel_document_note: "Примечание",
  personnel_archived_by: "Добавил",
  personnel_source: "Источник",
  personnel_file_size: "Размер",
  personnel_received_at: "Получен",
  personnel_uploaded_by: "Загрузил",
  personnel_journal_time: "Когда",
  personnel_journal_action: "Действие",
  personnel_journal_actor: "Кто",
  personnel_integrity_started: "Начало",
  personnel_integrity_trigger: "Запуск",
  personnel_integrity_checked: "Проверено",
  personnel_integrity_failures: "Расхождения",
  personnel_integrity_failures_of: "Расхождения проверки от {date}",
  personnel_tsa_error: "Ошибка TSA",
};

export const personnelDe: PersonnelTranslations = {
  nav_personnel: "Personalakten",
  nav_my_personnel_file: "Meine Personalakte",
  personnel_page_intro: "Digitales Archiv der Personalakten nach § 8 BVV: Dokumente werden unveränderbar unter generierten Dateinamen abgelegt, Korrekturen nur als neue Version mit Begründung.",
  personnel_tab_employees: "Mitarbeitende",
  personnel_tab_completeness: "Vollständigkeit",
  personnel_tab_intake: "Scan-Eingang",
  personnel_tab_export: "Export für Prüfung",
  personnel_tab_integrity: "Integrität",
  personnel_tab_settings: "Einstellungen",
  personnel_tab_documents: "Dokumente",
  personnel_tab_journal: "Protokoll",
  personnel_employee: "Mitarbeitende(r)",
  personnel_employees_empty: "Noch keine Personalakten",
  personnel_employee_new: "Neue Personalakte",
  personnel_employee_edit: "Bearbeiten",
  personnel_employee_dialog_hint: "Stammdaten der Akte. Vor- und Nachname gehen in die Archiv-Dateinamen ein; bereits archivierte Dateien werden nicht umbenannt.",
  personnel_section_person: "Person",
  personnel_section_employment: "Beschäftigung",
  personnel_salutation: "Anrede",
  personnel_salutation_frau: "Frau",
  personnel_salutation_herr: "Herr",
  personnel_salutation_none: "Ohne Anrede",
  personnel_first_name: "Vorname",
  personnel_last_name: "Nachname",
  personnel_name_file_hint: "Wie im Ausweis schreiben; Umlaute und ß werden im Dateinamen umgeschrieben (ä → ae, ß → ss).",
  personnel_number: "Personalnummer (DATEV)",
  personnel_employment_start: "Eintritt",
  personnel_employment_end: "Austritt",
  personnel_employment_period: "Beschäftigung",
  personnel_employment_range_invalid: "Der Austritt darf nicht vor dem Eintritt liegen.",
  personnel_since: "seit",
  personnel_user_link: "GMED-Benutzerkonto",
  personnel_user_link_hint: "Das verknüpfte Konto sieht die eigene Akte unter „Meine Personalakte“ (nur Ansehen und Herunterladen).",
  personnel_no_user_link: "Kein Benutzerkonto",
  personnel_notes: "Notizen",
  personnel_status: "Status",
  personnel_status_active: "Beschäftigt",
  personnel_status_former: "Ausgeschieden",
  personnel_filter_active: "Beschäftigte",
  personnel_filter_former: "Ehemalige",
  personnel_filter_all: "Alle",
  personnel_documents_count: "Dokumente",
  personnel_last_archived: "Zuletzt archiviert",
  personnel_missing_for_month: "Fehlt für {month}",
  personnel_intake_banner: "Scans im Eingang, die noch zugeordnet werden müssen: {count}",
  personnel_intake_open: "Eingang öffnen",
  personnel_month_from: "Von Monat",
  personnel_month_to: "Bis Monat",
  personnel_range_invalid: "Der Anfangsmonat liegt nach dem Endmonat.",
  personnel_completeness_summary: "Fehlend: {missing} · verspätet: {late}",
  personnel_late_rule: "„Verspätet“: Das Monatsdokument wurde später als {days} Tage nach Monatsende archiviert. Bis dahin gilt der Monat als offen.",
  personnel_cell_present: "Vorhanden, rechtzeitig",
  personnel_cell_late: "Vorhanden, verspätet",
  personnel_cell_missing: "Fehlt",
  personnel_cell_open: "Frist läuft noch",
  personnel_cell_not_employed: "Nicht beschäftigt",
  personnel_intake_intro: "Hier landen Scans der Scan-Station (Modus „gmed-scan --personnel“) und manuell hochgeladene Dateien. Jeder Scan wird einer Personalakte zugeordnet oder mit Begründung verworfen. (Auch Patient Manager können über die Scan-Station Scans abgeben; nur der CEO sieht den Eingang und ordnet die Scans zu.)",
  personnel_intake_add: "Dateien hochladen",
  personnel_intake_uploaded: "Datei im Eingang abgelegt",
  personnel_intake_uploaded_many: "Hochgeladene Dateien: {count}",
  personnel_import_title: "Dokument aus dem Dolmetscherprofil übernehmen",
  personnel_import_source: "Datei aus dem Dolmetscherprofil",
  personnel_import_section: "Im Dolmetscherprofil liegen Dokumente, die noch nicht in der Akte sind",
  personnel_import_hint: "Die Akte erhält eine Kopie unter dem Archivnamen; das Dokument im Profil bleibt unverändert. Jedes Dokument wird einmal übernommen.",
  personnel_import_action: "In die Akte übernehmen",
  personnel_intake_empty: "Keine Scans im Eingang",
  personnel_intake_assign: "Zuordnen",
  personnel_intake_assign_title: "Scan einer Personalakte zuordnen",
  personnel_intake_discard: "Verwerfen",
  personnel_intake_discard_title: "Scan verwerfen",
  personnel_intake_original_name: "Originaldatei",
  personnel_export_scope: "Umfang",
  personnel_export_all: "Alle Mitarbeitenden",
  personnel_export_selected: "Ausgewählte ({count})",
  personnel_export_no_limit: "Ohne Begrenzung",
  personnel_export_include_versions: "Frühere Versionen einschließen (Korrekturen bleiben für die Prüfung sichtbar)",
  personnel_export_download: "ZIP herunterladen",
  personnel_export_done: "Export gespeichert: {name}",
  personnel_export_contents_title: "Inhalt des ZIP",
  personnel_export_contents_files: "Dateien unter ihren Archivnamen, ein Ordner je Mitarbeitende(r)",
  personnel_export_contents_index: "Index.csv: Mitarbeitende(r), Kategorie, Zeitraum, Dateiname, Archivierungsdatum, Version, SHA-256",
  personnel_export_contents_manifest: "Manifest.sha256 zur Prüfung der Unveränderbarkeit",
  personnel_export_contents_report: "Pruefbericht.txt: Ergebnis der Hash-Ketten-Prüfung und TSA-Zeitstempel",
  personnel_export_logged: "Jeder Export wird im Protokoll der Personalakten vermerkt.",
  personnel_integrity_intro: "Wöchentlich prüft das System jede Datei und die SHA-256-Kette. Täglich erhalten alle Ketten einen RFC-3161-Zeitstempel als unabhängigen Nachweis des Datums. (Bei einem Fehler wird der CEO benachrichtigt; ein Vorfall im Register wird manuell angelegt.)",
  personnel_tsa_not_configured: "Kein Zeitstempeldienst (TSA) eingerichtet (Dienst noch nicht ausgewählt): Die täglichen Anker entstehen ohne externen Zeitstempel. TSA-Adresse in den Einstellungen hinterlegen.",
  personnel_integrity_runs: "Integritätsprüfungen",
  personnel_integrity_run_now: "Jetzt prüfen",
  personnel_integrity_no_runs: "Noch keine Prüfung",
  personnel_integrity_passed_toast: "Prüfung bestanden: keine Abweichungen",
  personnel_integrity_failed_toast: "Die Prüfung hat Abweichungen gefunden",
  personnel_integrity_employees: "Akten",
  personnel_integrity_documents: "Dokumente",
  personnel_run_running: "Läuft",
  personnel_run_passed: "Bestanden",
  personnel_run_failed: "Abweichungen",
  personnel_run_error: "Fehler",
  personnel_trigger_scheduled: "planmäßig",
  personnel_trigger_manual: "manuell",
  personnel_open_file: "Akte öffnen",
  personnel_anchors: "Tägliche Zeitstempel",
  personnel_anchors_hint: "Hash aller Ketten eines Tages; an den TSA geht nur der Hash, keine personenbezogenen Daten.",
  personnel_anchors_empty: "Noch keine Zeitstempel",
  personnel_anchor_now: "Zeitstempel erstellen",
  personnel_anchor_done: "Zeitstempel erstellt",
  personnel_anchor_date: "Datum",
  personnel_anchor_hash: "Hash",
  personnel_tsa_status: "Zeitstempel",
  personnel_tsa_time: "TSA-Zeit",
  personnel_tsa_token: "Token .tsr",
  personnel_tsa_pending: "Ausstehend",
  personnel_tsa_stamped: "Gestempelt",
  personnel_tsa_failed: "Fehlgeschlagen",
  personnel_tsa_disabled: "Kein TSA",
  personnel_settings_archive: "Archiv",
  personnel_settings_saved: "Einstellungen gespeichert",
  personnel_late_days: "Abgabefrist, Tage nach Monatsende",
  personnel_late_days_hint: "Später archivierte Monatsdokumente werden als „verspätet“ markiert. Aktuell: 7 Tage.",
  personnel_tsa_url: "Adresse des Zeitstempeldienstes (RFC 3161)",
  personnel_tsa_url_hint: "Leer: Es werden keine Zeitstempel angefordert.",
  personnel_deletion_enabled: "Löschung nach Ablauf der Aufbewahrungsfristen erlauben",
  personnel_deletion_warning: "Ausgeschaltet lassen, bis das Steuerbüro die Aufbewahrungsfristen bestätigt hat. Die Löschung ist endgültig; im Archiv bleibt nur ein Eintrag mit Hash.",
  personnel_retention_periods: "Aufbewahrungsfristen je Kategorie (Vorschlag – Bestätigung durch das Steuerbüro ausstehend)",
  personnel_retention_periods_hint: "Die Frist läuft ab Ende des Kalenderjahres des Dokuments bzw. des Austritts. Eine Änderung berechnet das Aufbewahrungsende vorhandener Dokumente neu.",
  personnel_retention_years: "Jahre",
  personnel_retention_years_invalid: "Bitte 1 bis 50 Jahre angeben.",
  personnel_retention_from: "Fristbeginn",
  personnel_retention_from_document: "Ende des Dokumentjahres",
  personnel_retention_from_employment_end: "Ende des Austrittsjahres",
  personnel_legal_basis: "Rechtsgrundlage",
  personnel_monthly: "monatlich",
  personnel_retention_due: "Aufbewahrungsfrist abgelaufen",
  personnel_retention_due_disabled: "Die Löschung ist in den Einstellungen ausgeschaltet (bis das Steuerbüro die Fristen bestätigt).",
  personnel_retention_due_empty: "Keine Dokumente mit abgelaufener Frist",
  personnel_retention_until: "Aufbewahren bis",
  personnel_delete: "Löschen",
  personnel_delete_title: "Dokument nach Fristablauf löschen",
  personnel_delete_description: "Die Datei {name} wird endgültig gelöscht. Im Archiv bleiben ein Eintrag mit Hash und die Begründung.",
  personnel_deleted_toast: "Dokument gelöscht",
  personnel_deleted: "Gelöscht",
  personnel_reason: "Begründung",
  personnel_reason_optional: "Begründung (optional)",
  personnel_reason_required: "Bitte eine Begründung angeben.",
  personnel_upload: "Dokument hochladen",
  personnel_upload_title: "Dokument in die Personalakte laden",
  personnel_upload_hint: "Der Archiv-Dateiname entsteht automatisch aus Kategorie, Zeitraum und Name (Namensschema einschließlich „_“ wird mit dem Steuerbüro abgestimmt). Nach dem Speichern kann das Dokument nicht mehr geändert werden.",
  personnel_upload_correction: "Korrigieren (neue Version)",
  personnel_correction_title: "Korrektur: neue Version des Dokuments",
  personnel_correction_hint: "Die korrigierte Datei wird als neue Version gespeichert; die bisherige bleibt im Archiv und in der Historie sichtbar. Eine Begründung ist Pflicht.",
  personnel_correction_of: "Korrigiert Dokument",
  personnel_correction_none: "Nein, neues Dokument",
  personnel_correction_reason: "Korrekturgrund",
  personnel_category: "Kategorie",
  personnel_period_month: "Monat",
  personnel_document_date: "Dokumentdatum",
  personnel_title_optional: "Bezeichnung (optional)",
  personnel_file: "Datei",
  personnel_choose_file: "Datei auswählen",
  personnel_file_hint: "Nur PDF, JPEG, PNG, BMP oder TIFF · maximal 25 MB",
  personnel_file_unsupported: "Erlaubt sind nur PDF, JPEG, PNG, BMP und TIFF.",
  personnel_file_too_large: "Die Datei ist leer oder größer als 25 MB.",
  personnel_will_be_archived_as: "Wird archiviert als",
  personnel_archive_name_pending: "Kategorie und Zeitraum wählen, um den Dateinamen zu sehen.",
  personnel_immutable_hint: "Nach der Archivierung ist die Datei unveränderbar; Korrekturen nur als neue Version.",
  personnel_archive_action: "Archivieren",
  personnel_archived_toast: "Archiviert: {name}",
  personnel_immutable_notice: "Archivierte Dokumente können nicht geändert oder ersetzt werden. Fehler werden durch eine neue Version mit Begründung korrigiert; alle Versionen und Vorgänge bleiben im Protokoll. Monatsdokumente, die später als {days} Tage nach Monatsende archiviert werden, gelten als verspätet.",
  personnel_immutable: "Unveränderbare Archivdatei",
  personnel_health_hidden: "Dokumente mit Gesundheitsdaten sind ausgeblendet: keine Berechtigung.",
  personnel_health_badge: "Gesundheitsdaten",
  personnel_documents_empty: "Noch keine Dokumente",
  personnel_versions_history: "Frühere Versionen: {count}",
  personnel_version_badge: "V{version}",
  personnel_superseded: "Durch neue Version ersetzt",
  personnel_archived_late: "Verspätet",
  personnel_archived_at: "Archiviert",
  personnel_legal_hold: "Löschsperre",
  personnel_legal_hold_set: "Löschsperre setzen",
  personnel_legal_hold_release: "Löschsperre aufheben",
  personnel_legal_hold_hint: "Ein gesperrtes Dokument wird auch nach Fristablauf nicht gelöscht (z. B. bei Rechtsstreit oder Prüfung).",
  personnel_preview: "Ansehen",
  personnel_download: "Herunterladen",
  personnel_open_new_tab: "In neuem Tab öffnen",
  personnel_preview_unavailable: "Der Browser kann dieses Format (z. B. TIFF) nicht anzeigen. Bitte herunterladen.",
  personnel_access_logged: "Ansehen und Herunterladen werden im Protokoll der Akte vermerkt.",
  personnel_source_upload: "hochgeladen",
  personnel_source_scan: "Scan",
  personnel_source_import: "aus Profil",
  personnel_journal_empty: "Keine Protokolleinträge",
  personnel_event_employee_created: "Akte angelegt",
  personnel_event_employee_updated: "Stammdaten geändert",
  personnel_event_document_archived: "Dokument archiviert",
  personnel_event_document_version: "Neue Dokumentversion",
  personnel_event_document_downloaded: "Dokument angesehen oder heruntergeladen",
  personnel_event_own_file_viewed: "Eigene Akte angesehen",
  personnel_event_own_document_downloaded: "Eigenes Dokument angesehen oder heruntergeladen",
  personnel_event_legal_hold_set: "Löschsperre gesetzt",
  personnel_event_legal_hold_released: "Löschsperre aufgehoben",
  personnel_event_document_deleted: "Dokument nach Fristablauf gelöscht",
  personnel_event_export_created: "Export erstellt",
  personnel_event_intake_received: "Scan eingegangen",
  personnel_event_intake_discarded: "Scan verworfen",
  personnel_event_integrity_failed: "Integritätsprüfung mit Abweichung",
  personnel_event_category_updated: "Aufbewahrungsfrist geändert",
  personnel_event_settings_updated: "Archiveinstellungen geändert",
  personnel_category_arbeitsvertrag: "Arbeitsvertrag",
  personnel_category_vertragsaenderung: "Vertragsänderung",
  personnel_category_nachweis: "Nachweis (NachwG)",
  personnel_category_stundenzettel: "Stundenzettel",
  personnel_category_entgeltabrechnung: "Entgeltabrechnung",
  personnel_category_lohnsteuer: "Lohnsteuer",
  personnel_category_sozialversicherung: "Sozialversicherung",
  personnel_category_arbeitsunfaehigkeit: "Arbeitsunfähigkeit",
  personnel_category_urlaub: "Urlaub",
  personnel_category_abmahnung: "Abmahnung",
  personnel_category_kuendigung: "Kündigung",
  personnel_category_zeugnis: "Zeugnis",
  personnel_category_schriftverkehr: "Schriftverkehr",
  personnel_category_sonstiges: "Sonstiges",
  personnel_my_file_missing: "Mit Ihrem Konto ist keine Personalakte verknüpft.",
  personnel_my_file_notice: "Nur Ansehen und Herunterladen; jeder Zugriff wird protokolliert. Ist ein Dokument fehlerhaft, wenden Sie sich an den CEO.",
  personnel_notification_intake_title: "Personalakten: neuer Scan zur Zuordnung",
  personnel_notification_intake_body: "Ein gescanntes Dokument wartet auf die Zuordnung zu einer Personalakte.",
  personnel_notification_missing_title: "Personalakten: Dokumente fehlen für {month}",
  personnel_notification_missing_body: "Nicht archivierte Monatsdokumente: {documents}, betroffene Mitarbeitende: {employees}.",
  personnel_notification_integrity_title: "Personalakten: Integritätsprüfung fehlgeschlagen",
  personnel_notification_integrity_body: "Abweichungen im Archiv: {count}. Personalakten → Integrität öffnen.",
  personnel_category_short_arbeitsvertrag: "Vertrag",
  personnel_category_short_vertragsaenderung: "Änderung",
  personnel_category_short_nachweis: "NachwG",
  personnel_category_short_stundenzettel: "Stunden",
  personnel_category_short_entgeltabrechnung: "Lohn",
  personnel_category_short_lohnsteuer: "LSt",
  personnel_category_short_sozialversicherung: "SV",
  personnel_category_short_arbeitsunfaehigkeit: "AU",
  personnel_category_short_urlaub: "Urlaub",
  personnel_category_short_abmahnung: "Abmahn.",
  personnel_category_short_kuendigung: "Künd.",
  personnel_category_short_zeugnis: "Zeugnis",
  personnel_category_short_schriftverkehr: "Schrift.",
  personnel_category_short_sonstiges: "Sonst.",
  personnel_period: "Zeitraum",
  personnel_document_marks: "Kennzeichen",
  personnel_document_note: "Hinweis",
  personnel_archived_by: "Abgelegt von",
  personnel_source: "Quelle",
  personnel_file_size: "Größe",
  personnel_received_at: "Eingang",
  personnel_uploaded_by: "Hochgeladen von",
  personnel_journal_time: "Zeitpunkt",
  personnel_journal_action: "Aktion",
  personnel_journal_actor: "Wer",
  personnel_integrity_started: "Beginn",
  personnel_integrity_trigger: "Auslöser",
  personnel_integrity_checked: "Geprüft",
  personnel_integrity_failures: "Abweichungen",
  personnel_integrity_failures_of: "Abweichungen der Prüfung vom {date}",
  personnel_tsa_error: "TSA-Fehler",
};
