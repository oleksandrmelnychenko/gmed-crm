/**
 * GwG instruction and reliability of the staff (§ 6 Abs. 2 GwG): the section
 * in "SOP и обучение" (/sops). See docs/architecture/gwg-staff-training_ua.md.
 */
export interface GwgTrainingTranslations {
  sops_gwg_title: string;
  sops_gwg_intro: string;
  sops_gwg_empty: string;
  sops_gwg_due_count: string;
  sops_gwg_column_employee: string;
  sops_gwg_column_position: string;
  sops_gwg_column_last: string;
  sops_gwg_column_status: string;
  sops_gwg_column_document: string;
  sops_gwg_status_none: string;
  sops_gwg_status_unsigned: string;
  sops_gwg_status_signed: string;
  sops_gwg_due: string;
  sops_gwg_next_due: string;
  sops_gwg_action_conduct: string;
  sops_gwg_action_open_pdf: string;
  sops_gwg_action_open_signed: string;
  sops_gwg_action_upload_signed: string;
  sops_gwg_action_history: string;
  sops_gwg_history_title: string;
  sops_gwg_history_empty: string;
  sops_gwg_form_title: string;
  sops_gwg_form_hint: string;
  sops_gwg_save: string;
  sops_gwg_employment_start: string;
  sops_gwg_position: string;
  sops_gwg_department: string;
  sops_gwg_section_instruction: string;
  sops_gwg_instructed_on: string;
  sops_gwg_delivered_by: string;
  sops_gwg_delivered_internal: string;
  sops_gwg_delivered_other: string;
  sops_gwg_details: string;
  sops_gwg_form_label: string;
  sops_gwg_form_oral: string;
  sops_gwg_form_material: string;
  sops_gwg_form_other: string;
  sops_gwg_section_instructions: string;
  sops_gwg_instruction_identify_partner: string;
  sops_gwg_instruction_identify_acting_person: string;
  sops_gwg_instruction_beneficial_owner: string;
  sops_gwg_instruction_enhanced_due_diligence: string;
  sops_gwg_instruction_suspicious_activity_report: string;
  sops_gwg_instruction_record_keeping: string;
  sops_gwg_section_reliability: string;
  sops_gwg_reliability_long_standing: string;
  sops_gwg_reliability_new_employee: string;
  sops_gwg_reliability_interview: string;
  sops_gwg_reliability_certificate: string;
  sops_gwg_reliability_other: string;
  sops_gwg_reliability_monitoring: string;
  sops_gwg_management: string;
  sops_gwg_error_date: string;
  sops_gwg_error_delivered_by_other: string;
  sops_gwg_error_form: string;
  sops_gwg_error_form_other: string;
  sops_gwg_error_instructions: string;
  sops_gwg_error_reliability: string;
  sops_gwg_error_reliability_other: string;
  sops_gwg_error_load: string;
  sops_gwg_error_save: string;
  sops_gwg_error_upload: string;
  sops_gwg_notice_created: string;
  sops_gwg_notice_signed: string;
  sops_gwg_my_title: string;
  sops_gwg_my_intro: string;
  sops_gwg_my_empty: string;
}

export const gwgTrainingRu: GwgTrainingTranslations = {
  sops_gwg_title: "GwG-инструктаж (§ 6 Abs. 2 GwG)",
  sops_gwg_intro:
    "Ежегодный инструктаж сотрудников по противодействию отмыванию денег и проверка их надёжности. Лист «Dokumentation interner Sicherungsmaßnahmen» формируется в оформлении GMED и хранится в личном деле сотрудника.",
  sops_gwg_empty:
    "Нет действующих сотрудников с личным делом. Сотрудников добавляют в разделе «Личные дела».",
  sops_gwg_due_count: "Нужен инструктаж: {count}",
  sops_gwg_column_employee: "Сотрудник",
  sops_gwg_column_position: "Должность",
  sops_gwg_column_last: "Последний инструктаж",
  sops_gwg_column_status: "Статус",
  sops_gwg_column_document: "Документ",
  sops_gwg_status_none: "не проводилось",
  sops_gwg_status_unsigned: "проведено, не подписано",
  sops_gwg_status_signed: "подписано",
  sops_gwg_due: "Пора провести инструктаж",
  sops_gwg_next_due: "Следующий до {date}",
  sops_gwg_action_conduct: "Провести инструктаж",
  sops_gwg_action_open_pdf: "Открыть PDF",
  sops_gwg_action_open_signed: "Открыть подписанный",
  sops_gwg_action_upload_signed: "Загрузить подписанный",
  sops_gwg_action_history: "История",
  sops_gwg_history_title: "История инструктажей",
  sops_gwg_history_empty: "Инструктажей ещё не было.",
  sops_gwg_form_title: "GwG-инструктаж",
  sops_gwg_form_hint:
    "После сохранения GMED сформирует лист и положит его в личное дело. Распечатайте его, подпишите (стр. 1 — сотрудник, стр. 2 — руководство) и загрузите скан.",
  sops_gwg_save: "Сохранить и сформировать PDF",
  sops_gwg_employment_start: "В компании с",
  sops_gwg_position: "Должность (als)",
  sops_gwg_department: "Отдел (im Bereich)",
  sops_gwg_section_instruction: "1. Инструктаж",
  sops_gwg_instructed_on: "Дата инструктажа",
  sops_gwg_delivered_by: "Кто проводил",
  sops_gwg_delivered_internal: "внутри компании (betriebsintern)",
  sops_gwg_delivered_other: "сторонний специалист (durch Sonstige)",
  sops_gwg_details: "Уточнение",
  sops_gwg_form_label: "Форма",
  sops_gwg_form_oral: "устный инструктаж",
  sops_gwg_form_material: "выдача информационных материалов (Dokumentationsbogen)",
  sops_gwg_form_other: "другое",
  sops_gwg_section_instructions: "2. Сотруднику даны указания",
  sops_gwg_instruction_identify_partner: "идентифицировать контрагента (§ 10 Abs. 1 Nr. 1 GwG)",
  sops_gwg_instruction_identify_acting_person:
    "идентифицировать лицо, действующее за контрагента, и проверить его полномочия",
  sops_gwg_instruction_beneficial_owner: "установить бенефициара (§ 10 Abs. 1 Nr. 2 GwG)",
  sops_gwg_instruction_enhanced_due_diligence:
    "применять усиленную проверку: повышенный риск, PEP, страна высокого риска, необычная сделка (§ 15 GwG)",
  sops_gwg_instruction_suspicious_activity_report:
    "сообщать о подозрительных операциях (§ 43 GwG)",
  sops_gwg_instruction_record_keeping: "фиксировать сведения и хранить их 5 лет (§ 8 GwG)",
  sops_gwg_section_reliability: "3. Надёжность сотрудника",
  sops_gwg_reliability_long_standing: "a) давний сотрудник, сомнений в надёжности нет",
  sops_gwg_reliability_new_employee: "b) новый сотрудник, надёжность проверена",
  sops_gwg_reliability_interview:
    "вопрос о судимостях, связанных с отмыванием денег (собеседование или анкета)",
  sops_gwg_reliability_certificate: "справка о несудимости (Führungszeugnis) в личном деле",
  sops_gwg_reliability_other: "другое",
  sops_gwg_reliability_monitoring:
    "Надёжность контролируется постоянно. Раздел 3 подписывает руководство: {name}.",
  sops_gwg_management: "Руководство",
  sops_gwg_error_date: "Укажите дату инструктажа (не позже сегодняшней).",
  sops_gwg_error_delivered_by_other: "Укажите, кто проводил инструктаж.",
  sops_gwg_error_form: "Выберите форму инструктажа.",
  sops_gwg_error_form_other: "Опишите другую форму инструктажа.",
  sops_gwg_error_instructions: "Отметьте хотя бы одно указание.",
  sops_gwg_error_reliability: "Отметьте, как проверена надёжность нового сотрудника.",
  sops_gwg_error_reliability_other: "Опишите другую проверку надёжности.",
  sops_gwg_error_load: "Не удалось загрузить GwG-инструктажи.",
  sops_gwg_error_save: "Не удалось сохранить инструктаж.",
  sops_gwg_error_upload: "Не удалось загрузить подписанный лист.",
  sops_gwg_notice_created: "Инструктаж сохранён, лист добавлен в личное дело.",
  sops_gwg_notice_signed: "Подписанный лист сохранён в личном деле.",
  sops_gwg_my_title: "Мои GwG-инструктажи",
  sops_gwg_my_intro:
    "Ваши инструктажи по противодействию отмыванию денег. Листы хранятся в вашем личном деле.",
  sops_gwg_my_empty: "Инструктажей пока не было.",
};

export const gwgTrainingDe: GwgTrainingTranslations = {
  sops_gwg_title: "GwG-Unterweisung (§ 6 Abs. 2 GwG)",
  sops_gwg_intro:
    "Jährliche Unterweisung der Beschäftigten zur Verhinderung von Geldwäsche und Prüfung ihrer Zuverlässigkeit. Der Bogen „Dokumentation interner Sicherungsmaßnahmen“ wird im GMED-Layout erstellt und in der Personalakte abgelegt.",
  sops_gwg_empty:
    "Keine aktiven Beschäftigten mit Personalakte. Beschäftigte werden unter „Personalakten“ angelegt.",
  sops_gwg_due_count: "Unterweisung fällig: {count}",
  sops_gwg_column_employee: "Beschäftigte/r",
  sops_gwg_column_position: "Funktion",
  sops_gwg_column_last: "Letzte Unterweisung",
  sops_gwg_column_status: "Status",
  sops_gwg_column_document: "Dokument",
  sops_gwg_status_none: "nicht durchgeführt",
  sops_gwg_status_unsigned: "durchgeführt, nicht unterschrieben",
  sops_gwg_status_signed: "unterschrieben",
  sops_gwg_due: "Unterweisung fällig",
  sops_gwg_next_due: "Nächste bis {date}",
  sops_gwg_action_conduct: "Unterweisung durchführen",
  sops_gwg_action_open_pdf: "PDF öffnen",
  sops_gwg_action_open_signed: "Unterschriebene öffnen",
  sops_gwg_action_upload_signed: "Unterschriebene hochladen",
  sops_gwg_action_history: "Verlauf",
  sops_gwg_history_title: "Verlauf der Unterweisungen",
  sops_gwg_history_empty: "Noch keine Unterweisung.",
  sops_gwg_form_title: "GwG-Unterweisung",
  sops_gwg_form_hint:
    "Nach dem Speichern erstellt GMED den Bogen und legt ihn in der Personalakte ab. Ausdrucken, unterschreiben (Seite 1 Beschäftigte/r, Seite 2 Geschäftsleitung) und den Scan hochladen.",
  sops_gwg_save: "Speichern und PDF erstellen",
  sops_gwg_employment_start: "Beschäftigt seit",
  sops_gwg_position: "Funktion (als)",
  sops_gwg_department: "Bereich (im Bereich)",
  sops_gwg_section_instruction: "1. Unterrichtung",
  sops_gwg_instructed_on: "Datum der Unterrichtung",
  sops_gwg_delivered_by: "Die Unterrichtung erfolgte",
  sops_gwg_delivered_internal: "betriebsintern",
  sops_gwg_delivered_other: "durch Sonstige",
  sops_gwg_details: "Weitere Angaben",
  sops_gwg_form_label: "in Form",
  sops_gwg_form_oral: "einer mündlichen Unterweisung",
  sops_gwg_form_material: "der Aushändigung des Informationsmaterials (Dokumentationsbogen)",
  sops_gwg_form_other: "Sonstiges",
  sops_gwg_section_instructions: "2. Anweisungen an die/den Beschäftigte/n",
  sops_gwg_instruction_identify_partner:
    "den Geschäfts-/Vertragspartner identifizieren (§ 10 Abs. 1 Nr. 1 GwG)",
  sops_gwg_instruction_identify_acting_person:
    "die für den Vertragspartner auftretende Person identifizieren und ihre Berechtigung prüfen",
  sops_gwg_instruction_beneficial_owner:
    "den wirtschaftlich Berechtigten ermitteln (§ 10 Abs. 1 Nr. 2 GwG)",
  sops_gwg_instruction_enhanced_due_diligence:
    "verstärkte Sorgfaltspflichten erfüllen: erhöhtes Risiko, PeP, Drittstaat mit hohem Risiko, außergewöhnliche Transaktion (§ 15 GwG)",
  sops_gwg_instruction_suspicious_activity_report:
    "bei ungewöhnlichen Geschäftsvorfällen eine Verdachtsmeldung abgeben (§ 43 GwG)",
  sops_gwg_instruction_record_keeping:
    "die Angaben aufzeichnen und 5 Jahre aufbewahren (§ 8 GwG)",
  sops_gwg_section_reliability: "3. Zuverlässigkeit",
  sops_gwg_reliability_long_standing:
    "a) langjährige/r Mitarbeiter/in, keine Zweifel an der Zuverlässigkeit",
  sops_gwg_reliability_new_employee: "b) neu eingestellt, Zuverlässigkeit überprüft durch",
  sops_gwg_reliability_interview:
    "Nachfrage nach geldwäscherelevanten Vorstrafen (Vorstellungsgespräch oder Personalfragebogen)",
  sops_gwg_reliability_certificate: "Führungszeugnis in den Personalunterlagen",
  sops_gwg_reliability_other: "Sonstiges",
  sops_gwg_reliability_monitoring:
    "Die Zuverlässigkeit wird fortlaufend überwacht. Abschnitt 3 unterschreibt die Geschäftsleitung: {name}.",
  sops_gwg_management: "Geschäftsleitung",
  sops_gwg_error_date: "Bitte das Datum der Unterweisung angeben (nicht in der Zukunft).",
  sops_gwg_error_delivered_by_other: "Bitte angeben, wer die Unterweisung durchgeführt hat.",
  sops_gwg_error_form: "Bitte die Form der Unterweisung wählen.",
  sops_gwg_error_form_other: "Bitte die sonstige Form beschreiben.",
  sops_gwg_error_instructions: "Bitte mindestens eine Anweisung wählen.",
  sops_gwg_error_reliability: "Bitte angeben, wie die Zuverlässigkeit geprüft wurde.",
  sops_gwg_error_reliability_other: "Bitte die sonstige Prüfung beschreiben.",
  sops_gwg_error_load: "Die GwG-Unterweisungen konnten nicht geladen werden.",
  sops_gwg_error_save: "Die Unterweisung konnte nicht gespeichert werden.",
  sops_gwg_error_upload: "Der unterschriebene Bogen konnte nicht hochgeladen werden.",
  sops_gwg_notice_created: "Unterweisung gespeichert, Bogen in der Personalakte abgelegt.",
  sops_gwg_notice_signed: "Unterschriebener Bogen in der Personalakte abgelegt.",
  sops_gwg_my_title: "Meine GwG-Unterweisungen",
  sops_gwg_my_intro:
    "Ihre Unterweisungen zur Verhinderung von Geldwäsche. Die Bögen liegen in Ihrer Personalakte.",
  sops_gwg_my_empty: "Noch keine Unterweisung.",
};
