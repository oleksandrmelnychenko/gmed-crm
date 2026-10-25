/**
 * EU sanctions list screening and the blocked-country policy: the CEO review
 * page (/sanctions), the list card in the admin settings, the notices in lead
 * wizard step 1 and the badges in the leads list.
 * See docs/architecture/sanctions-screening_ua.md.
 */
export interface SanctionsTranslations {
  nav_sanctions: string;
  sanctions_page_intro: string;
  sanctions_disclaimer: string;
  sanctions_tab_open: string;
  sanctions_tab_decided: string;
  sanctions_tab_countries: string;
  sanctions_tab_list: string;
  sanctions_status_open: string;
  sanctions_status_false_positive: string;
  sanctions_status_confirmed: string;
  sanctions_kind_lead_patient: string;
  sanctions_kind_lead_guardian: string;
  sanctions_kind_lead_payer: string;
  sanctions_kind_lead_recipient: string;
  sanctions_kind_patient: string;
  sanctions_kind_patient_bank: string;
  sanctions_kind_payer_bank: string;
  sanctions_kind_patient_relation: string;
  sanctions_kind_relation_default_payer: string;
  sanctions_kind_relation_invoice_payer: string;
  sanctions_kind_relation_legal_representative: string;
  sanctions_kind_payer_contact: string;
  sanctions_our_person: string;
  sanctions_list_entry: string;
  sanctions_field_names: string;
  sanctions_field_dob: string;
  sanctions_field_citizenships: string;
  sanctions_field_residence: string;
  sanctions_field_seat: string;
  sanctions_field_bank: string;
  sanctions_field_account_country: string;
  sanctions_field_relation: string;
  sanctions_field_regulation: string;
  sanctions_field_eu_reference: string;
  sanctions_field_un_reference: string;
  sanctions_field_remark: string;
  sanctions_field_score: string;
  sanctions_field_matched_name: string;
  sanctions_field_list_version: string;
  sanctions_field_entity: string;
  sanctions_dob_exact: string;
  sanctions_dob_year: string;
  sanctions_dob_conflict: string;
  sanctions_dob_unknown: string;
  sanctions_circa: string;
  sanctions_legal_act: string;
  sanctions_snapshot_differs: string;
  sanctions_no_longer_matches: string;
  sanctions_button_false_positive: string;
  sanctions_button_confirm: string;
  sanctions_button_fisalis: string;
  sanctions_fisalis_copied: string;
  sanctions_fisalis_copy_failed: string;
  sanctions_reason: string;
  sanctions_reason_hint: string;
  sanctions_reason_too_short: string;
  sanctions_decide_false_positive_title: string;
  sanctions_decide_false_positive_hint: string;
  sanctions_decide_confirm_title: string;
  sanctions_decide_confirm_hint: string;
  sanctions_decided_by: string;
  sanctions_no_hits: string;
  sanctions_open_lead: string;
  sanctions_open_patient: string;
  sanctions_country_hint: string;
  sanctions_country_none: string;
  sanctions_country_lift: string;
  sanctions_country_lift_title: string;
  sanctions_country_lift_hint: string;
  sanctions_country_leads: string;
  sanctions_country_patients: string;
  sanctions_country_patients_hint: string;
  sanctions_country_lift_patient: string;
  sanctions_country_lift_patient_title: string;
  sanctions_country_lift_patient_hint: string;
  sanctions_country_revoke: string;
  sanctions_country_revoke_title: string;
  sanctions_list_title: string;
  sanctions_list_active: string;
  sanctions_list_none: string;
  sanctions_list_stale: string;
  sanctions_list_auto_off: string;
  sanctions_list_last_success: string;
  sanctions_list_last_error: string;
  sanctions_list_source: string;
  sanctions_list_refresh: string;
  sanctions_list_refresh_started: string;
  sanctions_list_upload: string;
  sanctions_list_uploaded: string;
  sanctions_list_unchanged: string;
  sanctions_list_versions: string;
  sanctions_list_source_download: string;
  sanctions_list_source_upload: string;
  sanctions_blocked_countries: string;
  sanctions_blocked_countries_placeholder: string;
  sanctions_blocked_countries_saved: string;
  sanctions_countries_synced: string;
  sanctions_countries_sync_failed: string;
  sanctions_settings_title: string;
  sanctions_settings_hint: string;
  sanctions_live_checking: string;
  sanctions_live_clear: string;
  sanctions_live_possible: string;
  // The live check stores nothing; the line says what happens to a possible
  // match before the lead exists, before a save and after the CEO's decision
  // (QA 2026-10-11 N-14, A-39b).
  sanctions_live_possible_new_lead: string;
  sanctions_live_possible_unsaved: string;
  sanctions_live_possible_review: string;
  sanctions_live_false_positive: string;
  sanctions_live_confirmed: string;
  sanctions_live_unavailable: string;
  sanctions_live_error: string;
  sanctions_banner_review: string;
  sanctions_banner_confirmed: string;
  sanctions_banner_country: string;
  sanctions_banner_country_lifted: string;
  sanctions_banner_list_stale: string;
  sanctions_banner_open_review: string;
  sanctions_badge_review_pending: string;
  sanctions_badge_confirmed: string;
  sanctions_badge_blocked_country: string;
  sanctions_badge_country_lifted: string;
  sanctions_notification_title: string;
  sanctions_notification_body: string;
  // Lead risk assessment (trigger flow 2026-10-07): the tab /sanctions?tab=risk.
  sanctions_tab_risk: string;
  risk_config_title: string;
  risk_config_hint: string;
  risk_config_version: string;
  risk_list_1: string;
  risk_list_2: string;
  risk_lists_hint: string;
  risk_points: string;
  risk_points_list_1: string;
  risk_points_list_2: string;
  risk_knockout: string;
  risk_level_2_from: string;
  risk_level_3_from: string;
  risk_level_2_blocks_automatic: string;
  risk_reviewers: string;
  risk_reviewers_hint: string;
  /** "{ceo}" active CEO accounts and "{deputies}" named deputies who may decide. */
  risk_reviewers_count: string;
  risk_reviewers_none: string;
  risk_config_saved: string;
  risk_config_error_codes: string;
  risk_config_error_lists: string;
  risk_config_error_points: string;
  risk_config_error_levels: string;
  risk_queue_title: string;
  risk_queue_hint: string;
  risk_queue_empty: string;
  risk_queue_since: string;
  risk_queue_proposal: string;
}

export const sanctionsRu: SanctionsTranslations = {
  nav_sanctions: "Санкционные проверки",
  sanctions_page_intro:
    "Проверка лидов, родителей/опекунов несовершеннолетних, плательщиков и пациентов по консолидированному финансовому санкционному списку ЕС (включая санкции ООН). Список загружается на наш сервер; данные пациентов никуда не передаются.",
  sanctions_disclaimer:
    "Совпадение имени — не установление личности; решение принимает CEO. Подтверждение окончательно: работа с лицом прекращается навсегда. FiSaLis (портал юстиции) ищет по тому же списку ЕС и используется только вручную: имя копируется в буфер обмена, данные пациентов туда автоматически не передаются.",
  sanctions_tab_open: "Открытые",
  sanctions_tab_decided: "Решённые",
  sanctions_tab_countries: "Страны",
  sanctions_tab_list: "Список ЕС",
  sanctions_status_open: "Открыто",
  sanctions_status_false_positive: "Ложное совпадение",
  sanctions_status_confirmed: "Подтверждено",
  sanctions_kind_lead_patient: "Пациент (лид)",
  sanctions_kind_lead_guardian: "Родитель / опекун",
  sanctions_kind_lead_payer: "Плательщик",
  sanctions_kind_lead_recipient: "Получатель счёта",
  sanctions_kind_patient: "Пациент",
  sanctions_kind_patient_bank: "Банк пациента",
  sanctions_kind_payer_bank: "Банк плательщика",
  sanctions_kind_patient_relation: "Связь пациента",
  sanctions_kind_relation_default_payer: "Плательщик пациента по умолчанию",
  sanctions_kind_relation_invoice_payer: "Плательщик в заказе или счёте пациента",
  sanctions_kind_relation_legal_representative: "Родитель / опекун пациента",
  sanctions_kind_payer_contact: "Плательщик (контакт в заказе или счёте)",
  sanctions_our_person: "Наши данные",
  sanctions_list_entry: "Запись в списке ЕС",
  sanctions_field_names: "Имена",
  sanctions_field_dob: "Дата рождения",
  sanctions_field_citizenships: "Гражданство",
  sanctions_field_residence: "Страна проживания",
  sanctions_field_seat: "Страна регистрации",
  sanctions_field_bank: "Банк",
  sanctions_field_account_country: "Страна счёта",
  sanctions_field_relation: "Отношение",
  sanctions_field_regulation: "Правовой акт / программа",
  sanctions_field_eu_reference: "Номер ЕС",
  sanctions_field_un_reference: "Номер ООН",
  sanctions_field_remark: "Примечание",
  sanctions_field_score: "Сходство",
  sanctions_field_matched_name: "Совпавшее имя",
  sanctions_field_list_version: "Версия списка",
  sanctions_field_entity: "Организация",
  sanctions_dob_exact: "дата совпадает",
  sanctions_dob_year: "совпадает год",
  sanctions_dob_conflict: "дата другая",
  sanctions_dob_unknown: "нет даты для сравнения",
  sanctions_circa: "прибл.",
  sanctions_legal_act: "EUR-Lex",
  sanctions_snapshot_differs: "Данные изменились после совпадения; в момент проверки было:",
  sanctions_no_longer_matches: "С текущими данными совпадение больше не находится",
  sanctions_button_false_positive: "Ложное совпадение",
  sanctions_button_confirm: "Подтвердить совпадение",
  sanctions_button_fisalis: "Проверить в FiSaLis",
  sanctions_fisalis_copied: "FiSaLis открыт в новой вкладке. Имя скопировано — вставьте его в поиск:",
  sanctions_fisalis_copy_failed: "FiSaLis открыт в новой вкладке. Скопировать не удалось — имя выделено, скопируйте его вручную:",
  sanctions_reason: "Причина",
  sanctions_reason_hint: "Обязательно, минимум 10 символов. Сохраняется в журнале аудита.",
  sanctions_reason_too_short: "Укажите причину (минимум 10 символов).",
  sanctions_decide_false_positive_title: "Отметить как ложное совпадение",
  sanctions_decide_false_positive_hint:
    "Блокировка снимается. При изменении данных человека или записи в списке совпадение будет проверено заново.",
  sanctions_decide_confirm_title: "Подтвердить совпадение с санкционным списком",
  sanctions_decide_confirm_hint:
    "Окончательное решение: лид нельзя квалифицировать или конвертировать, агентство не подписывает заказ, работа по заказам и договорам блокируется. Отменить подтверждение нельзя.",
  sanctions_decided_by: "Решение: {name}, {date}",
  sanctions_no_hits: "Совпадений нет",
  sanctions_open_lead: "Открыть лид",
  sanctions_open_patient: "Открыть пациента",
  sanctions_country_hint:
    "Лиды и пациенты, у которых гражданство или страна проживания пациента, родителя/опекуна несовершеннолетнего, плательщика или получателя счёта входит в список заблокированных стран.",
  sanctions_country_none: "Нет лидов и пациентов с заблокированной страной",
  sanctions_country_lift: "Снять блокировку для лида",
  sanctions_country_lift_title: "Снять блокировку по стране для этого лида",
  sanctions_country_lift_hint:
    "Снятие действует только для этого лида и для стран, заблокированных сейчас. Решение и причина сохраняются в журнале аудита.",
  sanctions_country_leads: "Лиды",
  sanctions_country_patients: "Пациенты",
  sanctions_country_patients_hint:
    "Страна самого пациента, его связей, которые оплачивают или получают счета, и плательщиков, указанных в заказах и счетах. Блокировка удерживает подпись агентства.",
  sanctions_country_lift_patient: "Снять блокировку для пациента",
  sanctions_country_lift_patient_title: "Снять блокировку по стране для этого пациента",
  sanctions_country_lift_patient_hint:
    "Снятие действует только для этого пациента и для стран, заблокированных сейчас. Решение и причина сохраняются в журнале аудита.",
  sanctions_country_revoke: "Вернуть блокировку",
  sanctions_country_revoke_title: "Вернуть блокировку по стране",
  sanctions_list_title: "Санкционный список ЕС",
  sanctions_list_active: "Действующая версия от {date} — записей: {entries}, из них физических лиц: {persons}",
  sanctions_list_none: "Список ещё не загружен — проверка невозможна.",
  sanctions_list_stale: "Список не обновлялся более 7 дней.",
  sanctions_list_auto_off: "Автоматическая загрузка отключена на этом сервере — загрузите файл вручную.",
  sanctions_list_last_success: "Последнее успешное обновление: {date}",
  sanctions_list_last_error: "Последняя ошибка загрузки: {code}, {date}",
  sanctions_list_source: "Источник: Financial Sanctions Files (FSF) Еврокомиссии, XML 1.1",
  sanctions_list_refresh: "Загрузить сейчас",
  sanctions_list_refresh_started: "Загрузка запущена. Обновите страницу через минуту.",
  sanctions_list_upload: "Загрузить файл",
  sanctions_list_uploaded: "Список от {date} загружен — записей: {entries}. Повторная проверка — новых совпадений: {new_hits}.",
  sanctions_list_unchanged: "Файл совпадает с действующей версией.",
  sanctions_list_versions: "Версии",
  sanctions_list_source_download: "загрузка",
  sanctions_list_source_upload: "вручную",
  sanctions_blocked_countries: "Заблокированные страны",
  sanctions_blocked_countries_placeholder: "Страны",
  sanctions_blocked_countries_saved: "Список заблокированных стран сохранён",
  sanctions_countries_synced: "Учтены страны из EU Sanctions Map: {count}.",
  sanctions_countries_sync_failed: "Не удалось обновить страны из EU Sanctions Map. Повторите загрузку, чтобы обновить страны.",
  sanctions_settings_title: "Санкции и заблокированные страны",
  sanctions_settings_hint: "Санкционный список ЕС и политика по странам. Изменяет только CEO.",
  sanctions_live_checking: "Проверка по санкционному списку ЕС…",
  sanctions_live_clear: "Санкционный список ЕС ({date}): совпадений нет",
  sanctions_live_possible: "Возможное совпадение — решение принимает CEO",
  sanctions_live_possible_new_lead: "Возможное совпадение — после создания лида CEO проверит его",
  sanctions_live_possible_unsaved: "Возможное совпадение — после сохранения изменений CEO проверит его",
  sanctions_live_possible_review: "Возможное совпадение — ждёт решения CEO",
  sanctions_live_false_positive: "Совпадение проверено CEO: ложное совпадение",
  sanctions_live_confirmed: "Совпадение подтверждено CEO",
  sanctions_live_unavailable: "Санкционный список ЕС не загружен — проверка невозможна",
  sanctions_live_error: "Проверка по санкционному списку сейчас недоступна",
  sanctions_banner_review:
    "Возможное совпадение с санкционным списком ЕС. Квалификация, конвертация, подпись агентства и работа по заказам и договорам заблокированы до решения CEO.",
  sanctions_banner_confirmed:
    "Подтверждённое совпадение с санкционным списком ЕС. Работа с этим лицом прекращена окончательно; блокировку снять нельзя.",
  sanctions_banner_country:
    "Заблокированная страна ({countries}): квалификация, конвертация и подпись агентства невозможны. Снять блокировку для этого лида может только CEO.",
  sanctions_banner_country_lifted: "Блокировка по стране ({countries}) снята: {name}, {date}. Причина: {reason}",
  sanctions_banner_list_stale: "Санкционный список ЕС давно не обновлялся.",
  sanctions_banner_open_review: "Открыть проверку",
  sanctions_badge_review_pending: "Санкции: проверка",
  sanctions_badge_confirmed: "Санкции",
  sanctions_badge_blocked_country: "Страна",
  sanctions_badge_country_lifted: "Страна: снято",
  sanctions_notification_title: "Возможное совпадение с санкционным списком ЕС",
  sanctions_notification_body: "Проверьте совпадение на странице санкционных проверок.",
  sanctions_tab_risk: "Оценка риска",
  risk_config_title: "Настройки оценки риска",
  risk_config_hint:
    "Баллы за триггеры, списки стран, пороги и границы уровней. Система только считает и показывает — решения принимают сотрудники. Изменение не понижает уже сохранённые оценки; повышение действует при следующем пересчёте.",
  risk_config_version: "Версия {version}",
  risk_list_1: "Список 1 (повышенный риск)",
  risk_list_2: "Список 2 (высокий риск)",
  risk_lists_hint:
    "Страна стоит только в одном списке: при добавлении в список 2 она убирается из списка 1. Страна — повод для проверки, никогда не для отказа.",
  risk_points: "Баллы за триггеры",
  risk_points_list_1: "список 1",
  risk_points_list_2: "список 2",
  risk_knockout: "K.o.: сразу уровень 3",
  risk_level_2_from: "Уровень 2 от, баллов",
  risk_level_3_from: "Уровень 3 от, баллов",
  risk_level_2_blocks_automatic: "На уровне 2 дополнительные вопросы задаются автоматически",
  risk_reviewers: "Проверяющие — заместители CEO",
  risk_reviewers_hint:
    "Каждый аккаунт CEO проверяет всегда, заместители — по назначению. Решение одного проверяющего действует сразу на любом уровне, причина обязательна.",
  risk_reviewers_count: "Сейчас решают: аккаунты CEO — {ceo}, назначенные заместители — {deputies}.",
  risk_reviewers_none: "Нет подходящих сотрудников",
  risk_config_saved: "Настройки оценки риска сохранены",
  risk_config_error_codes: "Коды стран: две латинские буквы (ISO).",
  risk_config_error_lists: "Страна не может стоять в обоих списках.",
  risk_config_error_points: "Баллы — целые числа от 0 до 20.",
  risk_config_error_levels: "Уровень 2 начинается раньше уровня 3 и больше 0 (целые баллы).",
  risk_queue_title: "Очередь проверки",
  risk_queue_hint: "Обращения, которые ждут решения или сведений — сначала самые старые.",
  risk_queue_empty: "Нет обращений на проверке",
  risk_queue_since: "с {date}",
  risk_queue_proposal: "Старое предложение: {decision} — {name}, {date}",
};

export const sanctionsDe: SanctionsTranslations = {
  nav_sanctions: "Sanktionsprüfung",
  sanctions_page_intro:
    "Prüfung von Leads, Eltern/Vormündern Minderjähriger, Zahlern und Patienten gegen die konsolidierte EU-Finanzsanktionsliste (einschließlich der UN-Sanktionen). Die Liste wird auf unseren Server geladen; Patientendaten verlassen das System nicht.",
  sanctions_disclaimer:
    "Eine Namensgleichheit ist keine Identitätsfeststellung; die Entscheidung trifft der CEO. Eine Bestätigung ist endgültig: Die Zusammenarbeit endet dauerhaft. FiSaLis (Justizportal) durchsucht dieselbe EU-Liste und wird nur manuell genutzt: Der Name wird in die Zwischenablage kopiert, Patientendaten werden nicht automatisch übermittelt.",
  sanctions_tab_open: "Offen",
  sanctions_tab_decided: "Entschieden",
  sanctions_tab_countries: "Länder",
  sanctions_tab_list: "EU-Liste",
  sanctions_status_open: "Offen",
  sanctions_status_false_positive: "Falsch positiv",
  sanctions_status_confirmed: "Bestätigt",
  sanctions_kind_lead_patient: "Patient (Lead)",
  sanctions_kind_lead_guardian: "Elternteil / Vormund",
  sanctions_kind_lead_payer: "Zahler",
  sanctions_kind_lead_recipient: "Rechnungsempfänger",
  sanctions_kind_patient: "Patient",
  sanctions_kind_patient_bank: "Bank des Patienten",
  sanctions_kind_payer_bank: "Bank des Zahlers",
  sanctions_kind_patient_relation: "Bezugsperson des Patienten",
  sanctions_kind_relation_default_payer: "Standardzahler des Patienten",
  sanctions_kind_relation_invoice_payer: "Zahler in Auftrag oder Rechnung des Patienten",
  sanctions_kind_relation_legal_representative: "Elternteil / Vormund des Patienten",
  sanctions_kind_payer_contact: "Zahler (Kontakt in Auftrag oder Rechnung)",
  sanctions_our_person: "Unsere Daten",
  sanctions_list_entry: "Eintrag der EU-Liste",
  sanctions_field_names: "Namen",
  sanctions_field_dob: "Geburtsdatum",
  sanctions_field_citizenships: "Staatsangehörigkeit",
  sanctions_field_residence: "Wohnsitzland",
  sanctions_field_seat: "Sitzland",
  sanctions_field_bank: "Bank",
  sanctions_field_account_country: "Kontoland",
  sanctions_field_relation: "Beziehung",
  sanctions_field_regulation: "Rechtsakt / Programm",
  sanctions_field_eu_reference: "EU-Referenz",
  sanctions_field_un_reference: "UN-Referenz",
  sanctions_field_remark: "Bemerkung",
  sanctions_field_score: "Ähnlichkeit",
  sanctions_field_matched_name: "Übereinstimmender Name",
  sanctions_field_list_version: "Listenstand",
  sanctions_field_entity: "Organisation",
  sanctions_dob_exact: "Datum gleich",
  sanctions_dob_year: "Jahr gleich",
  sanctions_dob_conflict: "anderes Datum",
  sanctions_dob_unknown: "kein Datum zum Vergleich",
  sanctions_circa: "ca.",
  sanctions_legal_act: "EUR-Lex",
  sanctions_snapshot_differs: "Die Daten wurden nach dem Treffer geändert; bei der Prüfung lagen vor:",
  sanctions_no_longer_matches: "Mit den aktuellen Daten wird kein Treffer mehr gefunden",
  sanctions_button_false_positive: "Falsch positiv",
  sanctions_button_confirm: "Treffer bestätigen",
  sanctions_button_fisalis: "In FiSaLis prüfen",
  sanctions_fisalis_copied: "FiSaLis ist in einem neuen Tab geöffnet. Name kopiert – in die Suche einfügen:",
  sanctions_fisalis_copy_failed: "FiSaLis ist in einem neuen Tab geöffnet. Kopieren fehlgeschlagen – der Name ist markiert, bitte manuell kopieren:",
  sanctions_reason: "Begründung",
  sanctions_reason_hint: "Pflichtfeld, mindestens 10 Zeichen. Wird im Audit-Protokoll gespeichert.",
  sanctions_reason_too_short: "Bitte eine Begründung angeben (mindestens 10 Zeichen).",
  sanctions_decide_false_positive_title: "Als falsch positiv markieren",
  sanctions_decide_false_positive_hint:
    "Die Sperre wird aufgehoben. Ändern sich die Daten der Person oder der Listeneintrag, wird erneut geprüft.",
  sanctions_decide_confirm_title: "Treffer der Sanktionsliste bestätigen",
  sanctions_decide_confirm_hint:
    "Endgültige Entscheidung: Der Lead kann nicht qualifiziert oder konvertiert werden, die Agentur unterzeichnet keinen Auftrag, Arbeit an Aufträgen und Verträgen wird gesperrt. Die Bestätigung kann nicht zurückgenommen werden.",
  sanctions_decided_by: "Entscheidung: {name}, {date}",
  sanctions_no_hits: "Keine Treffer",
  sanctions_open_lead: "Lead öffnen",
  sanctions_open_patient: "Patient öffnen",
  sanctions_country_hint:
    "Leads und Patienten, bei denen Staatsangehörigkeit oder Wohnsitzland des Patienten, eines Elternteils/Vormunds eines Minderjährigen, des Zahlers oder des Rechnungsempfängers auf der Liste der gesperrten Länder stehen.",
  sanctions_country_none: "Keine Leads oder Patienten mit gesperrtem Land",
  sanctions_country_lift: "Sperre für diesen Lead aufheben",
  sanctions_country_lift_title: "Länder-Sperre für diesen Lead aufheben",
  sanctions_country_lift_hint:
    "Die Aufhebung gilt nur für diesen Lead und die jetzt gesperrten Länder. Entscheidung und Begründung werden im Audit-Protokoll gespeichert.",
  sanctions_country_leads: "Leads",
  sanctions_country_patients: "Patienten",
  sanctions_country_patients_hint:
    "Land des Patienten selbst, seiner Bezugspersonen, die Rechnungen zahlen oder erhalten, und der in Aufträgen und Rechnungen genannten Zahler. Die Sperre hält die Unterschrift der Agentur an.",
  sanctions_country_lift_patient: "Sperre für diesen Patienten aufheben",
  sanctions_country_lift_patient_title: "Länder-Sperre für diesen Patienten aufheben",
  sanctions_country_lift_patient_hint:
    "Die Aufhebung gilt nur für diesen Patienten und die jetzt gesperrten Länder. Entscheidung und Begründung werden im Audit-Protokoll gespeichert.",
  sanctions_country_revoke: "Sperre wiederherstellen",
  sanctions_country_revoke_title: "Länder-Sperre wiederherstellen",
  sanctions_list_title: "EU-Sanktionsliste",
  sanctions_list_active: "Aktueller Stand vom {date} – Einträge: {entries}, davon natürliche Personen: {persons}",
  sanctions_list_none: "Noch keine Liste geladen – keine Prüfung möglich.",
  sanctions_list_stale: "Die Liste wurde seit mehr als 7 Tagen nicht aktualisiert.",
  sanctions_list_auto_off: "Der automatische Download ist auf diesem Server abgeschaltet – bitte die Datei hochladen.",
  sanctions_list_last_success: "Letzte erfolgreiche Aktualisierung: {date}",
  sanctions_list_last_error: "Letzter Download-Fehler: {code}, {date}",
  sanctions_list_source: "Quelle: Financial Sanctions Files (FSF) der Europäischen Kommission, XML 1.1",
  sanctions_list_refresh: "Jetzt herunterladen",
  sanctions_list_refresh_started: "Download gestartet. Bitte die Seite in einer Minute neu laden.",
  sanctions_list_upload: "Datei hochladen",
  sanctions_list_uploaded: "Liste vom {date} geladen – Einträge: {entries}. Neuprüfung – neue Treffer: {new_hits}.",
  sanctions_list_unchanged: "Die Datei entspricht dem aktuellen Stand.",
  sanctions_list_versions: "Versionen",
  sanctions_list_source_download: "Download",
  sanctions_list_source_upload: "manuell",
  sanctions_blocked_countries: "Gesperrte Länder",
  sanctions_blocked_countries_placeholder: "Länder",
  sanctions_blocked_countries_saved: "Gesperrte Länder gespeichert",
  sanctions_countries_synced: "Berücksichtigte Länder aus der EU Sanctions Map: {count}.",
  sanctions_countries_sync_failed: "Die Länder aus der EU Sanctions Map konnten nicht aktualisiert werden. Bitte den Download erneut starten, um die Länder zu aktualisieren.",
  sanctions_settings_title: "Sanktionen und gesperrte Länder",
  sanctions_settings_hint: "EU-Sanktionsliste und Länderregel. Änderungen nur durch den CEO.",
  sanctions_live_checking: "Prüfung gegen die EU-Sanktionsliste…",
  sanctions_live_clear: "EU-Sanktionsliste ({date}): kein Treffer",
  sanctions_live_possible: "Möglicher Treffer – die Entscheidung trifft der CEO",
  sanctions_live_possible_new_lead: "Möglicher Treffer – nach dem Anlegen des Leads prüft ihn der CEO",
  sanctions_live_possible_unsaved: "Möglicher Treffer – nach dem Speichern der Änderungen prüft ihn der CEO",
  sanctions_live_possible_review: "Möglicher Treffer – wartet auf die Entscheidung des CEO",
  sanctions_live_false_positive: "Treffer vom CEO geprüft: falsch positiv",
  sanctions_live_confirmed: "Treffer vom CEO bestätigt",
  sanctions_live_unavailable: "EU-Sanktionsliste nicht geladen – keine Prüfung möglich",
  sanctions_live_error: "Die Sanktionsprüfung ist gerade nicht verfügbar",
  sanctions_banner_review:
    "Möglicher Treffer der EU-Sanktionsliste. Qualifizierung, Konvertierung, Unterschrift der Agentur sowie Arbeit an Aufträgen und Verträgen sind bis zur Entscheidung des CEO gesperrt.",
  sanctions_banner_confirmed:
    "Bestätigter Treffer der EU-Sanktionsliste. Die Zusammenarbeit mit dieser Person ist endgültig beendet; die Sperre kann nicht aufgehoben werden.",
  sanctions_banner_country:
    "Gesperrtes Land ({countries}): Qualifizierung, Konvertierung und Unterschrift der Agentur sind nicht möglich. Nur der CEO kann die Sperre für diesen Lead aufheben.",
  sanctions_banner_country_lifted: "Länder-Sperre ({countries}) aufgehoben: {name}, {date}. Begründung: {reason}",
  sanctions_banner_list_stale: "Die EU-Sanktionsliste wurde länger nicht aktualisiert.",
  sanctions_banner_open_review: "Prüfung öffnen",
  sanctions_badge_review_pending: "Sanktionen: Prüfung",
  sanctions_badge_confirmed: "Sanktionen",
  sanctions_badge_blocked_country: "Land gesperrt",
  sanctions_badge_country_lifted: "Land: aufgehoben",
  sanctions_notification_title: "Möglicher Treffer der EU-Sanktionsliste",
  sanctions_notification_body: "Bitte den Treffer auf der Seite Sanktionsprüfung prüfen.",
  sanctions_tab_risk: "Risikobewertung",
  risk_config_title: "Einstellungen der Risikobewertung",
  risk_config_hint:
    "Punkte je Auslöser, Länderlisten, Schwellen und Stufengrenzen. Das System rechnet und zeigt nur – entscheiden die Mitarbeitenden. Eine Änderung senkt gespeicherte Bewertungen nicht; eine Erhöhung gilt bei der nächsten Neuberechnung.",
  risk_config_version: "Version {version}",
  risk_list_1: "Liste 1 (erhöhtes Risiko)",
  risk_list_2: "Liste 2 (hohes Risiko)",
  risk_lists_hint:
    "Ein Land steht nur in einer Liste: Beim Hinzufügen zu Liste 2 wird es aus Liste 1 entfernt. Ein Land ist Anlass zur Prüfung, nie zur Ablehnung.",
  risk_points: "Punkte je Auslöser",
  risk_points_list_1: "Liste 1",
  risk_points_list_2: "Liste 2",
  risk_knockout: "K.o.: sofort Stufe 3",
  risk_level_2_from: "Stufe 2 ab Punkten",
  risk_level_3_from: "Stufe 3 ab Punkten",
  risk_level_2_blocks_automatic: "Auf Stufe 2 werden ergänzende Angaben automatisch abgefragt",
  risk_reviewers: "Prüfende – Vertretung des CEO",
  risk_reviewers_hint:
    "Jedes CEO-Konto prüft immer, Vertretungen nach Benennung. Die Entscheidung einer prüfenden Person gilt auf jeder Stufe sofort; eine Begründung ist Pflicht.",
  risk_reviewers_count: "Derzeit entscheiden: CEO-Konten – {ceo}, benannte Vertretungen – {deputies}.",
  risk_reviewers_none: "Keine geeigneten Mitarbeitenden",
  risk_config_saved: "Einstellungen der Risikobewertung gespeichert",
  risk_config_error_codes: "Ländercodes: zwei lateinische Buchstaben (ISO).",
  risk_config_error_lists: "Ein Land kann nicht in beiden Listen stehen.",
  risk_config_error_points: "Punkte sind ganze Zahlen von 0 bis 20.",
  risk_config_error_levels: "Stufe 2 beginnt vor Stufe 3 und über 0 (ganze Punkte).",
  risk_queue_title: "Prüfwarteschlange",
  risk_queue_hint: "Anfragen, die auf eine Entscheidung oder Angaben warten – die ältesten zuerst.",
  risk_queue_empty: "Keine Anfragen in Prüfung",
  risk_queue_since: "seit {date}",
  risk_queue_proposal: "Alter Vorschlag: {decision} – {name}, {date}",
};
