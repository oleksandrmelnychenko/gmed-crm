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
  sanctions_kind_patient: string;
  sanctions_our_person: string;
  sanctions_list_entry: string;
  sanctions_field_names: string;
  sanctions_field_dob: string;
  sanctions_field_citizenships: string;
  sanctions_field_residence: string;
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
  sanctions_list_upload_hint: string;
  sanctions_list_uploaded: string;
  sanctions_list_unchanged: string;
  sanctions_list_versions: string;
  sanctions_list_source_download: string;
  sanctions_list_source_upload: string;
  sanctions_blocked_countries: string;
  sanctions_blocked_countries_hint: string;
  sanctions_blocked_countries_placeholder: string;
  sanctions_blocked_countries_saved: string;
  sanctions_settings_title: string;
  sanctions_settings_hint: string;
  sanctions_live_checking: string;
  sanctions_live_clear: string;
  sanctions_live_possible: string;
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
  sanctions_kind_patient: "Пациент",
  sanctions_our_person: "Наши данные",
  sanctions_list_entry: "Запись в списке ЕС",
  sanctions_field_names: "Имена",
  sanctions_field_dob: "Дата рождения",
  sanctions_field_citizenships: "Гражданство",
  sanctions_field_residence: "Страна проживания",
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
    "Лиды, у которых гражданство или страна проживания пациента, родителя/опекуна несовершеннолетнего или плательщика входит в список заблокированных стран.",
  sanctions_country_none: "Нет лидов с заблокированной страной",
  sanctions_country_lift: "Снять блокировку для лида",
  sanctions_country_lift_title: "Снять блокировку по стране для этого лида",
  sanctions_country_lift_hint:
    "Снятие действует только для этого лида и для стран, заблокированных сейчас. Решение и причина сохраняются в журнале аудита.",
  sanctions_country_revoke: "Вернуть блокировку",
  sanctions_country_revoke_title: "Вернуть блокировку по стране",
  sanctions_list_title: "Санкционный список ЕС",
  sanctions_list_active: "Действующая версия от {date}: {entries} записей, из них {persons} физических лиц",
  sanctions_list_none: "Список ещё не загружен — проверка невозможна.",
  sanctions_list_stale: "Список не обновлялся более 7 дней.",
  sanctions_list_auto_off: "Автоматическая загрузка отключена на этом сервере — загрузите файл вручную.",
  sanctions_list_last_success: "Последнее успешное обновление: {date}",
  sanctions_list_last_error: "Последняя ошибка загрузки: {code}, {date}",
  sanctions_list_source: "Источник: Financial Sanctions Files (FSF) Еврокомиссии, XML 1.1",
  sanctions_list_refresh: "Загрузить сейчас",
  sanctions_list_refresh_started: "Загрузка запущена. Обновите страницу через минуту.",
  sanctions_list_upload: "Загрузить файл",
  sanctions_list_upload_hint:
    "Резервный путь, например без интернета: файл «Full sanctions list» в формате XML 1.1 с портала FSF (или ZIP с этим файлом).",
  sanctions_list_uploaded: "Список от {date} загружен: {entries} записей. Повторная проверка: {new_hits} новых совпадений.",
  sanctions_list_unchanged: "Файл совпадает с действующей версией.",
  sanctions_list_versions: "Версии",
  sanctions_list_source_download: "загрузка",
  sanctions_list_source_upload: "вручную",
  sanctions_blocked_countries: "Заблокированные страны",
  sanctions_blocked_countries_hint:
    "Если гражданство или страна проживания пациента, родителя/опекуна несовершеннолетнего или плательщика входит в список, лид нельзя квалифицировать и конвертировать, а агентство не подписывает заказ, пока CEO не снимет блокировку для лида. Санкции ЕС касаются конкретных лиц и секторов и не запрещают лечение граждан страны как таковых: отказ по гражданству — деловое решение с рисками AGG § 19 и DSGVO ст. 22 (нужна проверка юриста).",
  sanctions_blocked_countries_placeholder: "Страны",
  sanctions_blocked_countries_saved: "Список заблокированных стран сохранён",
  sanctions_settings_title: "Санкции и заблокированные страны",
  sanctions_settings_hint: "Санкционный список ЕС и политика по странам. Изменяет только CEO.",
  sanctions_live_checking: "Проверка по санкционному списку ЕС…",
  sanctions_live_clear: "Санкционный список ЕС ({date}): совпадений нет",
  sanctions_live_possible: "Возможное совпадение — передано CEO на проверку",
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
  sanctions_kind_patient: "Patient",
  sanctions_our_person: "Unsere Daten",
  sanctions_list_entry: "Eintrag der EU-Liste",
  sanctions_field_names: "Namen",
  sanctions_field_dob: "Geburtsdatum",
  sanctions_field_citizenships: "Staatsangehörigkeit",
  sanctions_field_residence: "Wohnsitzland",
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
    "Leads, bei denen Staatsangehörigkeit oder Wohnsitzland des Patienten, eines Elternteils/Vormunds eines Minderjährigen oder des Zahlers auf der Liste der gesperrten Länder stehen.",
  sanctions_country_none: "Keine Leads mit gesperrtem Land",
  sanctions_country_lift: "Sperre für diesen Lead aufheben",
  sanctions_country_lift_title: "Länder-Sperre für diesen Lead aufheben",
  sanctions_country_lift_hint:
    "Die Aufhebung gilt nur für diesen Lead und die jetzt gesperrten Länder. Entscheidung und Begründung werden im Audit-Protokoll gespeichert.",
  sanctions_country_revoke: "Sperre wiederherstellen",
  sanctions_country_revoke_title: "Länder-Sperre wiederherstellen",
  sanctions_list_title: "EU-Sanktionsliste",
  sanctions_list_active: "Aktueller Stand vom {date}: {entries} Einträge, davon {persons} natürliche Personen",
  sanctions_list_none: "Noch keine Liste geladen – keine Prüfung möglich.",
  sanctions_list_stale: "Die Liste wurde seit mehr als 7 Tagen nicht aktualisiert.",
  sanctions_list_auto_off: "Der automatische Download ist auf diesem Server abgeschaltet – bitte die Datei hochladen.",
  sanctions_list_last_success: "Letzte erfolgreiche Aktualisierung: {date}",
  sanctions_list_last_error: "Letzter Download-Fehler: {code}, {date}",
  sanctions_list_source: "Quelle: Financial Sanctions Files (FSF) der Europäischen Kommission, XML 1.1",
  sanctions_list_refresh: "Jetzt herunterladen",
  sanctions_list_refresh_started: "Download gestartet. Bitte die Seite in einer Minute neu laden.",
  sanctions_list_upload: "Datei hochladen",
  sanctions_list_upload_hint:
    "Ausweichweg, z. B. ohne Internet: die Datei „Full sanctions list“ im Format XML 1.1 aus dem FSF-Portal (oder ein ZIP mit dieser Datei).",
  sanctions_list_uploaded: "Liste vom {date} geladen: {entries} Einträge. Neuprüfung: {new_hits} neue Treffer.",
  sanctions_list_unchanged: "Die Datei entspricht dem aktuellen Stand.",
  sanctions_list_versions: "Versionen",
  sanctions_list_source_download: "Download",
  sanctions_list_source_upload: "manuell",
  sanctions_blocked_countries: "Gesperrte Länder",
  sanctions_blocked_countries_hint:
    "Steht die Staatsangehörigkeit oder das Wohnsitzland des Patienten, eines Elternteils/Vormunds eines Minderjährigen oder des Zahlers auf der Liste, kann der Lead weder qualifiziert noch konvertiert werden und die Agentur unterzeichnet keinen Auftrag, bis der CEO die Sperre für den Lead aufhebt. EU-Sanktionen betreffen bestimmte Personen und Sektoren und verbieten keine Behandlung von Staatsangehörigen als solchen: Eine Ablehnung wegen der Staatsangehörigkeit ist eine geschäftliche Entscheidung mit Risiken nach AGG § 19 und DSGVO Art. 22 (anwaltliche Prüfung erforderlich).",
  sanctions_blocked_countries_placeholder: "Länder",
  sanctions_blocked_countries_saved: "Gesperrte Länder gespeichert",
  sanctions_settings_title: "Sanktionen und gesperrte Länder",
  sanctions_settings_hint: "EU-Sanktionsliste und Länderregel. Änderungen nur durch den CEO.",
  sanctions_live_checking: "Prüfung gegen die EU-Sanktionsliste…",
  sanctions_live_clear: "EU-Sanktionsliste ({date}): kein Treffer",
  sanctions_live_possible: "Möglicher Treffer – an den CEO zur Prüfung übergeben",
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
};
