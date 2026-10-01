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
}

export const personnelRu: PersonnelTranslations = {
  nav_personnel: "Личные дела сотрудников",
  nav_my_personnel_file: "Моё личное дело",
  personnel_page_intro: "Цифровой архив личных дел по § 8 BVV: документы сохраняются без изменений под сгенерированными именами файлов, исправления — только новой версией с причиной.",
  personnel_tab_employees: "Сотрудники",
  personnel_tab_completeness: "Полнота",
  personnel_tab_intake: "Входящие сканы",
  personnel_tab_export: "Экспорт",
  personnel_tab_integrity: "Целостность",
  personnel_tab_settings: "Настройки и сроки",
  personnel_tab_documents: "Документы",
  personnel_tab_journal: "Журнал",
  personnel_employee: "Сотрудник",
  personnel_employees_empty: "Личных дел пока нет",
  personnel_employee_new: "Новое личное дело",
  personnel_employee_edit: "Изменить данные",
  personnel_employee_dialog_hint: "Данные сотрудника. Имя и фамилия входят в имена файлов архива; уже сохранённые файлы не переименовываются.",
  personnel_salutation: "Обращение",
  personnel_salutation_frau: "Frau",
  personnel_salutation_herr: "Herr",
  personnel_salutation_none: "Без обращения",
  personnel_first_name: "Имя",
  personnel_last_name: "Фамилия",
  personnel_name_file_hint: "Пишите как в паспорте; умлауты и ß в именах файлов транслитерируются (ä → ae, ß → ss).",
  personnel_number: "Табельный номер",
  personnel_employment_start: "Начало работы",
  personnel_employment_end: "Окончание работы",
  personnel_employment_period: "Период работы",
  personnel_employment_range_invalid: "Дата окончания не может быть раньше даты начала.",
  personnel_since: "с",
  personnel_user_link: "Учётная запись в GMED",
  personnel_user_link_hint: "Связанный пользователь видит своё дело в разделе «Моё личное дело» (только просмотр и скачивание).",
  personnel_no_user_link: "Без учётной записи",
  personnel_notes: "Заметки",
  personnel_status: "Статус",
  personnel_status_active: "Работает",
  personnel_status_former: "Уволен(а)",
  personnel_filter_active: "Работающие",
  personnel_filter_former: "Бывшие",
  personnel_filter_all: "Все",
  personnel_documents_count: "Документы",
  personnel_last_archived: "Последнее архивирование",
  personnel_missing_for_month: "Нет за {month}",
  personnel_intake_banner: "Входящих сканов, ожидающих разнесения: {count}",
  personnel_intake_open: "Открыть входящие",
  personnel_month_from: "С месяца",
  personnel_month_to: "По месяц",
  personnel_range_invalid: "Начальный месяц позже конечного.",
  personnel_completeness_summary: "Нет: {missing} · с опозданием: {late}",
  personnel_late_rule: "«С опозданием» — документ за месяц архивирован позже, чем через {days} дн. после окончания месяца. До этого срока ячейка считается открытой.",
  personnel_cell_present: "Есть, вовремя",
  personnel_cell_late: "Есть, с опозданием",
  personnel_cell_missing: "Отсутствует",
  personnel_cell_open: "Срок ещё не истёк",
  personnel_cell_not_employed: "Не работал(а)",
  personnel_intake_intro: "Сканы со скан-станции (режим «gmed-scan --personnel») и загруженные вручную файлы ждут здесь, пока их не разнесут в личное дело или не отклонят с причиной. (Сдать скан может и Patient Manager со скан-станции; видит очередь и разносит сканы только CEO.)",
  personnel_intake_add: "Добавить файл во входящие",
  personnel_intake_uploaded: "Файл добавлен во входящие",
  personnel_intake_uploaded_many: "Добавлено во входящие: {count}",
  personnel_import_title: "Перенести документ из профиля переводчика",
  personnel_import_source: "Файл из профиля переводчика",
  personnel_import_section: "Документы из профиля переводчика, которых ещё нет в деле",
  personnel_import_hint: "В деле сохраняется копия под архивным именем; документ в профиле не меняется. Каждый документ переносится один раз.",
  personnel_import_action: "Перенести в дело",
  personnel_intake_empty: "Входящих сканов нет",
  personnel_intake_assign: "Разнести в дело",
  personnel_intake_assign_title: "Разнести скан в личное дело",
  personnel_intake_discard: "Отклонить",
  personnel_intake_discard_title: "Отклонить скан",
  personnel_intake_original_name: "Исходный файл",
  personnel_export_scope: "Что выгрузить",
  personnel_export_all: "Все личные дела",
  personnel_export_selected: "Выбранные ({count})",
  personnel_export_no_limit: "Без ограничения",
  personnel_export_include_versions: "Включить предыдущие версии (исправления видны проверяющему)",
  personnel_export_download: "Скачать ZIP",
  personnel_export_done: "Экспорт сохранён: {name}",
  personnel_export_contents_title: "Содержимое ZIP",
  personnel_export_contents_files: "Файлы под архивными именами, по папке на сотрудника",
  personnel_export_contents_index: "Index.csv: сотрудник, категория, период, имя файла, дата архивирования, версия, SHA-256",
  personnel_export_contents_manifest: "Manifest.sha256 для проверки неизменности файлов",
  personnel_export_contents_report: "Pruefbericht.txt: результат проверки цепочки хешей и отметки времени TSA",
  personnel_export_logged: "Каждый экспорт записывается в журнал личных дел.",
  personnel_integrity_intro: "Еженедельная проверка расшифровывает каждый файл и сверяет SHA-256 и цепочку хешей. Ежедневная фиксация получает отметку времени RFC 3161 — независимое доказательство своевременного архивирования. (При сбое CEO получает уведомление; инцидент в реестре заводится вручную.)",
  personnel_tsa_not_configured: "Сервис отметок времени (TSA) не настроен (сервис ещё не выбран): ежедневные фиксации создаются без внешней отметки времени. Укажите адрес TSA в настройках.",
  personnel_integrity_runs: "Проверки целостности",
  personnel_integrity_run_now: "Проверить сейчас",
  personnel_integrity_no_runs: "Проверок ещё не было",
  personnel_integrity_passed_toast: "Проверка пройдена: расхождений нет",
  personnel_integrity_failed_toast: "Проверка обнаружила расхождения",
  personnel_integrity_employees: "дел",
  personnel_integrity_documents: "документов",
  personnel_run_running: "Выполняется",
  personnel_run_passed: "Пройдена",
  personnel_run_failed: "Расхождения",
  personnel_run_error: "Ошибка",
  personnel_trigger_scheduled: "по расписанию",
  personnel_trigger_manual: "вручную",
  personnel_open_file: "Открыть дело",
  personnel_anchors: "Ежедневные фиксации",
  personnel_anchors_hint: "Хеш всех цепочек за день; на TSA передаётся только хеш, без персональных данных.",
  personnel_anchors_empty: "Фиксаций ещё нет",
  personnel_anchor_now: "Зафиксировать сейчас",
  personnel_anchor_done: "Фиксация создана",
  personnel_anchor_date: "Дата",
  personnel_anchor_hash: "Хеш",
  personnel_tsa_status: "Отметка времени",
  personnel_tsa_time: "Время TSA",
  personnel_tsa_token: "Токен .tsr",
  personnel_tsa_pending: "Ожидает",
  personnel_tsa_stamped: "Получена",
  personnel_tsa_failed: "Ошибка",
  personnel_tsa_disabled: "TSA не настроен",
  personnel_settings_archive: "Архив",
  personnel_settings_saved: "Настройки сохранены",
  personnel_late_days: "Порог опоздания, дней после конца месяца",
  personnel_late_days_hint: "Документ за месяц, архивированный позже, помечается «с опозданием» (решение: 7 дней).",
  personnel_tsa_url: "Адрес сервиса отметок времени (RFC 3161)",
  personnel_tsa_url_hint: "Пусто — отметки времени не запрашиваются.",
  personnel_deletion_enabled: "Разрешить удаление по истечении сроков хранения",
  personnel_deletion_warning: "Оставьте выключенным, пока Steuerberater не подтвердит сроки хранения. Удаление необратимо; в архиве остаётся только запись с хешем.",
  personnel_retention_periods: "Сроки хранения по категориям (предложение — ждёт подтверждения Steuerberater)",
  personnel_retention_periods_hint: "Срок считается от конца календарного года документа или года увольнения. Изменение срока пересчитывает дату хранения уже сохранённых документов.",
  personnel_retention_years: "Лет",
  personnel_retention_years_invalid: "Укажите срок от 1 до 50 лет.",
  personnel_retention_from: "Отсчёт от",
  personnel_retention_from_document: "конца года документа",
  personnel_retention_from_employment_end: "конца года увольнения",
  personnel_legal_basis: "Основание",
  personnel_monthly: "ежемесячно",
  personnel_retention_due: "Срок хранения истёк",
  personnel_retention_due_disabled: "Удаление выключено в настройках (до подтверждения сроков Steuerberater).",
  personnel_retention_due_empty: "Документов с истёкшим сроком нет",
  personnel_retention_until: "Хранить до",
  personnel_delete: "Удалить",
  personnel_delete_title: "Удалить документ по истечении срока",
  personnel_delete_description: "Файл {name} будет удалён безвозвратно. В архиве останется запись с хешем и причиной.",
  personnel_deleted_toast: "Документ удалён",
  personnel_deleted: "Удалён",
  personnel_reason: "Причина",
  personnel_reason_optional: "Причина (необязательно)",
  personnel_reason_required: "Укажите причину.",
  personnel_upload: "Загрузить документ",
  personnel_upload_title: "Загрузить документ в личное дело",
  personnel_upload_hint: "Имя файла в архиве формируется автоматически из категории, периода и имени сотрудника (схема имён, включая «_», согласуется со Steuerberater). После сохранения документ изменить нельзя.",
  personnel_upload_correction: "Исправить (новая версия)",
  personnel_correction_title: "Исправление: новая версия документа",
  personnel_correction_hint: "Исправленный файл сохраняется как новая версия; прежняя версия остаётся в архиве и видна в истории. Причина обязательна.",
  personnel_correction_of: "Исправляет документ",
  personnel_correction_none: "Нет — новый документ",
  personnel_correction_reason: "Причина исправления",
  personnel_category: "Категория",
  personnel_period_month: "Месяц",
  personnel_document_date: "Дата документа",
  personnel_title_optional: "Описание (необязательно)",
  personnel_file: "Файл",
  personnel_choose_file: "Выбрать файл",
  personnel_file_hint: "Только PDF, JPEG, PNG, BMP или TIFF · не более 25 МБ",
  personnel_file_unsupported: "Допустимы только PDF, JPEG, PNG, BMP и TIFF.",
  personnel_file_too_large: "Файл пустой или больше 25 МБ.",
  personnel_will_be_archived_as: "Будет сохранён как",
  personnel_archive_name_pending: "Заполните категорию и период, чтобы увидеть имя файла.",
  personnel_immutable_hint: "После архивирования файл не изменяется; исправления — только новой версией.",
  personnel_archive_action: "Архивировать",
  personnel_archived_toast: "Архивировано: {name}",
  personnel_immutable_notice: "Архивированные документы нельзя изменить или заменить. Ошибку исправляют загрузкой новой версии с причиной; все версии и действия остаются в журнале. Ежемесячные документы, архивированные позже {days} дн. после конца месяца, помечаются «с опозданием».",
  personnel_immutable: "Неизменяемый архивный файл",
  personnel_health_hidden: "Документы с данными о здоровье скрыты: нет права на их просмотр.",
  personnel_health_badge: "Данные о здоровье",
  personnel_documents_empty: "Документов пока нет",
  personnel_versions_history: "Предыдущие версии: {count}",
  personnel_version_badge: "V{version}",
  personnel_superseded: "Заменён новой версией",
  personnel_archived_late: "С опозданием",
  personnel_archived_at: "Архивирован",
  personnel_legal_hold: "Удержание (legal hold)",
  personnel_legal_hold_set: "Запретить удаление",
  personnel_legal_hold_release: "Снять запрет удаления",
  personnel_legal_hold_hint: "Документ с запретом не удаляется даже после окончания срока хранения (например, при споре или проверке).",
  personnel_preview: "Просмотр",
  personnel_download: "Скачать",
  personnel_open_new_tab: "Открыть в новой вкладке",
  personnel_preview_unavailable: "Браузер не может показать этот формат (например, TIFF). Скачайте файл.",
  personnel_access_logged: "Просмотр и скачивание записываются в журнал дела.",
  personnel_source_upload: "загрузка",
  personnel_source_scan: "скан",
  personnel_source_import: "импорт",
  personnel_journal_empty: "Записей в журнале нет",
  personnel_event_employee_created: "Дело создано",
  personnel_event_employee_updated: "Данные дела изменены",
  personnel_event_document_archived: "Документ архивирован",
  personnel_event_document_version: "Новая версия документа",
  personnel_event_document_downloaded: "Документ открыт или скачан",
  personnel_event_own_file_viewed: "Сотрудник открыл своё дело",
  personnel_event_own_document_downloaded: "Сотрудник открыл или скачал свой документ",
  personnel_event_legal_hold_set: "Установлен запрет удаления",
  personnel_event_legal_hold_released: "Запрет удаления снят",
  personnel_event_document_deleted: "Документ удалён по сроку хранения",
  personnel_event_export_created: "Экспорт создан",
  personnel_event_intake_received: "Скан получен",
  personnel_event_intake_discarded: "Скан отклонён",
  personnel_event_integrity_failed: "Проверка целостности выявила расхождение",
  personnel_event_category_updated: "Изменён срок хранения категории",
  personnel_event_settings_updated: "Изменены настройки архива",
  personnel_category_arbeitsvertrag: "Трудовой договор",
  personnel_category_vertragsaenderung: "Изменение договора",
  personnel_category_nachweis: "Уведомление об условиях (NachwG)",
  personnel_category_stundenzettel: "Табель учёта времени",
  personnel_category_entgeltabrechnung: "Расчёт зарплаты",
  personnel_category_lohnsteuer: "Подоходный налог",
  personnel_category_sozialversicherung: "Социальное страхование",
  personnel_category_arbeitsunfaehigkeit: "Больничный",
  personnel_category_urlaub: "Отпуск",
  personnel_category_abmahnung: "Предупреждение (Abmahnung)",
  personnel_category_kuendigung: "Расторжение договора",
  personnel_category_zeugnis: "Трудовой отзыв (Zeugnis)",
  personnel_category_schriftverkehr: "Переписка",
  personnel_category_sonstiges: "Прочее",
  personnel_my_file_missing: "Личное дело к вашей учётной записи не привязано.",
  personnel_my_file_notice: "Только просмотр и скачивание. Каждый просмотр записывается в журнал дела. Если документ неверен, обратитесь к руководству.",
  personnel_notification_intake_title: "Личные дела: новый скан для разнесения",
  personnel_notification_intake_body: "Отсканированный документ ждёт разнесения в личное дело.",
  personnel_notification_missing_title: "Личные дела: нет документов за {month}",
  personnel_notification_missing_body: "Не архивировано ожидаемых ежемесячных документов: {documents}, сотрудников: {employees}.",
  personnel_notification_integrity_title: "Личные дела: проверка целостности не пройдена",
  personnel_notification_integrity_body: "Найдено расхождений в архиве: {count}. Откройте «Личные дела» → «Целостность».",
};

export const personnelDe: PersonnelTranslations = {
  nav_personnel: "Personalakten",
  nav_my_personnel_file: "Meine Personalakte",
  personnel_page_intro: "Digitales Archiv der Personalakten nach § 8 BVV: Dokumente werden unveränderbar unter generierten Dateinamen abgelegt, Korrekturen nur als neue Version mit Begründung.",
  personnel_tab_employees: "Mitarbeitende",
  personnel_tab_completeness: "Vollständigkeit",
  personnel_tab_intake: "Scan-Eingang",
  personnel_tab_export: "Export",
  personnel_tab_integrity: "Integrität",
  personnel_tab_settings: "Einstellungen und Fristen",
  personnel_tab_documents: "Dokumente",
  personnel_tab_journal: "Protokoll",
  personnel_employee: "Mitarbeiter/in",
  personnel_employees_empty: "Noch keine Personalakten",
  personnel_employee_new: "Neue Personalakte",
  personnel_employee_edit: "Stammdaten bearbeiten",
  personnel_employee_dialog_hint: "Stammdaten der Akte. Vor- und Nachname gehen in die Archiv-Dateinamen ein; bereits archivierte Dateien werden nicht umbenannt.",
  personnel_salutation: "Anrede",
  personnel_salutation_frau: "Frau",
  personnel_salutation_herr: "Herr",
  personnel_salutation_none: "Ohne Anrede",
  personnel_first_name: "Vorname",
  personnel_last_name: "Nachname",
  personnel_name_file_hint: "Wie im Ausweis schreiben; Umlaute und ß werden im Dateinamen umgeschrieben (ä → ae, ß → ss).",
  personnel_number: "Personalnummer",
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
  personnel_intake_intro: "Scans der Scan-Station (Modus „gmed-scan --personnel“) und manuell hochgeladene Dateien warten hier, bis sie einer Personalakte zugeordnet oder mit Begründung verworfen werden. (Auch Patient Manager können über die Scan-Station Scans abgeben; nur die Geschäftsführung sieht die Warteschlange und ordnet die Scans zu.)",
  personnel_intake_add: "Datei in den Eingang laden",
  personnel_intake_uploaded: "Datei im Eingang abgelegt",
  personnel_intake_uploaded_many: "Im Eingang abgelegt: {count}",
  personnel_import_title: "Dokument aus dem Dolmetscherprofil übernehmen",
  personnel_import_source: "Datei aus dem Dolmetscherprofil",
  personnel_import_section: "Dokumente aus dem Dolmetscherprofil, die noch nicht in der Akte sind",
  personnel_import_hint: "Die Akte erhält eine Kopie unter dem Archivnamen; das Dokument im Profil bleibt unverändert. Jedes Dokument wird einmal übernommen.",
  personnel_import_action: "In die Akte übernehmen",
  personnel_intake_empty: "Keine Scans im Eingang",
  personnel_intake_assign: "Zuordnen",
  personnel_intake_assign_title: "Scan einer Personalakte zuordnen",
  personnel_intake_discard: "Verwerfen",
  personnel_intake_discard_title: "Scan verwerfen",
  personnel_intake_original_name: "Originaldatei",
  personnel_export_scope: "Umfang",
  personnel_export_all: "Alle Personalakten",
  personnel_export_selected: "Ausgewählte ({count})",
  personnel_export_no_limit: "Ohne Begrenzung",
  personnel_export_include_versions: "Frühere Versionen einschließen (Korrekturen bleiben für die Prüfung sichtbar)",
  personnel_export_download: "ZIP herunterladen",
  personnel_export_done: "Export gespeichert: {name}",
  personnel_export_contents_title: "Inhalt des ZIP",
  personnel_export_contents_files: "Dateien unter ihren Archivnamen, ein Ordner je Mitarbeiter/in",
  personnel_export_contents_index: "Index.csv: Mitarbeiter/in, Kategorie, Zeitraum, Dateiname, Archivierungsdatum, Version, SHA-256",
  personnel_export_contents_manifest: "Manifest.sha256 zur Prüfung der Unveränderbarkeit",
  personnel_export_contents_report: "Pruefbericht.txt: Ergebnis der Hash-Ketten-Prüfung und TSA-Zeitstempel",
  personnel_export_logged: "Jeder Export wird im Protokoll der Personalakten vermerkt.",
  personnel_integrity_intro: "Die wöchentliche Prüfung entschlüsselt jede Datei und vergleicht SHA-256 und Hash-Kette. Der tägliche Anker erhält einen RFC-3161-Zeitstempel als unabhängigen Nachweis der rechtzeitigen Archivierung. (Bei einem Fehler wird die Geschäftsführung benachrichtigt; ein Vorfall im Register wird manuell angelegt.)",
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
  personnel_anchors: "Tägliche Anker",
  personnel_anchors_hint: "Hash aller Ketten eines Tages; an den TSA geht nur der Hash, keine personenbezogenen Daten.",
  personnel_anchors_empty: "Noch keine Anker",
  personnel_anchor_now: "Jetzt verankern",
  personnel_anchor_done: "Anker erstellt",
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
  personnel_late_days: "Verspätungsgrenze, Tage nach Monatsende",
  personnel_late_days_hint: "Später archivierte Monatsdokumente werden als „verspätet“ markiert (Festlegung: 7 Tage).",
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
  personnel_legal_hold: "Aufbewahrungssperre",
  personnel_legal_hold_set: "Löschsperre setzen",
  personnel_legal_hold_release: "Löschsperre aufheben",
  personnel_legal_hold_hint: "Ein gesperrtes Dokument wird auch nach Fristablauf nicht gelöscht (z. B. bei Rechtsstreit oder Prüfung).",
  personnel_preview: "Ansehen",
  personnel_download: "Herunterladen",
  personnel_open_new_tab: "In neuem Tab öffnen",
  personnel_preview_unavailable: "Der Browser kann dieses Format (z. B. TIFF) nicht anzeigen. Bitte herunterladen.",
  personnel_access_logged: "Ansehen und Herunterladen werden im Protokoll der Akte vermerkt.",
  personnel_source_upload: "Upload",
  personnel_source_scan: "Scan",
  personnel_source_import: "Import",
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
  personnel_my_file_notice: "Nur Ansehen und Herunterladen. Jeder Zugriff wird im Protokoll der Akte vermerkt. Ist ein Dokument fehlerhaft, wenden Sie sich an die Geschäftsführung.",
  personnel_notification_intake_title: "Personalakten: neuer Scan zur Zuordnung",
  personnel_notification_intake_body: "Ein gescanntes Dokument wartet auf die Zuordnung zu einer Personalakte.",
  personnel_notification_missing_title: "Personalakten: Dokumente fehlen für {month}",
  personnel_notification_missing_body: "Nicht archivierte erwartete Monatsdokumente: {documents}, betroffene Mitarbeitende: {employees}.",
  personnel_notification_integrity_title: "Personalakten: Integritätsprüfung fehlgeschlagen",
  personnel_notification_integrity_body: "Abweichungen im Archiv: {count}. Personalakten → Integrität öffnen.",
};
