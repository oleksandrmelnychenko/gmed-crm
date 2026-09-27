/**
 * Texts of invoice corrections and patient balances: line-level credit notes
 * and their documents, overpayments and credit transfers, advances applied to
 * settlement invoices and termination settlement figures.
 */
export interface FinanceBalancesTranslations {
  finance_credit_note_section_title: string;
  finance_credit_note_section_description: string;
  finance_credit_note_mode_lines: string;
  finance_credit_note_mode_vat_rate: string;
  finance_credit_note_line_remaining: string;
  finance_credit_note_line_fully_credited: string;
  finance_credit_note_line_amount: string;
  finance_credit_note_line_amount_hint: string;
  finance_credit_note_vat_rate: string;
  finance_credit_note_vat_rate_option: string;
  finance_credit_note_amount: string;
  finance_credit_note_date: string;
  finance_credit_note_reason: string;
  finance_credit_note_portal_visible: string;
  finance_credit_note_preview: string;
  finance_credit_note_create: string;
  finance_credit_note_no_open_lines: string;
  finance_credit_note_error_nothing_selected: string;
  finance_credit_note_error_invalid_amount: string;
  finance_credit_note_error_line_exceeded: string;
  finance_credit_note_error_vat_rate_missing: string;
  finance_credit_note_error_vat_rate_exceeded: string;
  finance_credit_note_empty: string;
  finance_credit_note_visible_in_portal: string;
  finance_credit_note_staff_only: string;
  finance_credit_note_reverse: string;
  finance_credit_note_reversal_reason: string;
  finance_credit_note_reversal: string;
  finance_credit_note_legacy: string;
  finance_credit_note_partial: string;
  finance_credit_note_passthrough: string;
  finance_credit_note_vat_line: string;
  finance_credit_note_pdf: string;
  finance_credit_note_pdf_error: string;
  finance_credit_note_portal_title: string;
  finance_accounting_category_patient_credit: string;
}

export const financeBalancesRu: FinanceBalancesTranslations = {
  finance_credit_note_section_title: "Кредит-ноты (корректировки счёта)",
  finance_credit_note_section_description:
    "Кредит-нота уменьшает выбранные позиции счёта; НДС берётся по ставке каждой позиции, поэтому позиция 0 % не уменьшает НДС. Ошибочная кредит-нота отменяется сторно, а не удаляется.",
  finance_credit_note_mode_lines: "По позициям",
  finance_credit_note_mode_vat_rate: "Сумма в ставке НДС",
  finance_credit_note_line_remaining: "Можно скорректировать: {amount}",
  finance_credit_note_line_fully_credited: "Полностью скорректирована",
  finance_credit_note_line_amount: "Сумма брутто",
  finance_credit_note_line_amount_hint: "Пусто — вся оставшаяся сумма позиции",
  finance_credit_note_vat_rate: "Ставка НДС",
  finance_credit_note_vat_rate_option: "{rate} % — можно {amount}",
  finance_credit_note_amount: "Сумма брутто",
  finance_credit_note_date: "Дата",
  finance_credit_note_reason: "Причина",
  finance_credit_note_portal_visible: "Показывать в портале пациента",
  finance_credit_note_preview: "Нетто {net} · НДС {vat} · Брутто {gross}",
  finance_credit_note_create: "Создать кредит-ноту",
  finance_credit_note_no_open_lines: "Все позиции счёта уже скорректированы.",
  finance_credit_note_error_nothing_selected: "Выберите хотя бы одну позицию.",
  finance_credit_note_error_invalid_amount: "Сумма должна быть больше нуля.",
  finance_credit_note_error_line_exceeded: "Сумма превышает остаток позиции.",
  finance_credit_note_error_vat_rate_missing: "Выберите ставку НДС.",
  finance_credit_note_error_vat_rate_exceeded: "Сумма превышает остаток по этой ставке НДС.",
  finance_credit_note_empty: "Кредит-нот пока нет.",
  finance_credit_note_visible_in_portal: "Видно в портале",
  finance_credit_note_staff_only: "Только для сотрудников",
  finance_credit_note_reverse: "Сторнировать",
  finance_credit_note_reversal_reason: "Причина сторно",
  finance_credit_note_reversal: "Сторно",
  finance_credit_note_legacy: "Пропорционально по всему счёту (до корректировок по позициям)",
  finance_credit_note_partial: "частично",
  finance_credit_note_passthrough: "проходные расходы",
  finance_credit_note_vat_line: "{rate} %: нетто {net}, НДС {vat}",
  finance_credit_note_pdf: "PDF",
  finance_credit_note_pdf_error: "Не удалось открыть документ корректировки.",
  finance_credit_note_portal_title: "Корректировки счёта",
  finance_accounting_category_patient_credit: "Переплата пациента (не выручка)",
};

export const financeBalancesDe: FinanceBalancesTranslations = {
  finance_credit_note_section_title: "Rechnungskorrekturen (Gutschriften)",
  finance_credit_note_section_description:
    "Eine Rechnungskorrektur mindert ausgewählte Rechnungspositionen; die Umsatzsteuer folgt dem Steuersatz jeder Position, eine 0-%-Position mindert also keine Umsatzsteuer. Eine falsche Korrektur wird storniert, nicht gelöscht.",
  finance_credit_note_mode_lines: "Nach Positionen",
  finance_credit_note_mode_vat_rate: "Betrag je Steuersatz",
  finance_credit_note_line_remaining: "Korrigierbar: {amount}",
  finance_credit_note_line_fully_credited: "Vollständig korrigiert",
  finance_credit_note_line_amount: "Bruttobetrag",
  finance_credit_note_line_amount_hint: "Leer = gesamter offener Betrag der Position",
  finance_credit_note_vat_rate: "Steuersatz",
  finance_credit_note_vat_rate_option: "{rate} % – korrigierbar {amount}",
  finance_credit_note_amount: "Bruttobetrag",
  finance_credit_note_date: "Datum",
  finance_credit_note_reason: "Grund",
  finance_credit_note_portal_visible: "Im Patientenportal anzeigen",
  finance_credit_note_preview: "Netto {net} · MwSt. {vat} · Brutto {gross}",
  finance_credit_note_create: "Rechnungskorrektur erstellen",
  finance_credit_note_no_open_lines: "Alle Rechnungspositionen sind bereits korrigiert.",
  finance_credit_note_error_nothing_selected: "Wählen Sie mindestens eine Position.",
  finance_credit_note_error_invalid_amount: "Der Betrag muss größer als null sein.",
  finance_credit_note_error_line_exceeded: "Der Betrag übersteigt den offenen Betrag der Position.",
  finance_credit_note_error_vat_rate_missing: "Wählen Sie einen Steuersatz.",
  finance_credit_note_error_vat_rate_exceeded:
    "Der Betrag übersteigt den offenen Betrag dieses Steuersatzes.",
  finance_credit_note_empty: "Keine Rechnungskorrekturen.",
  finance_credit_note_visible_in_portal: "Im Portal sichtbar",
  finance_credit_note_staff_only: "Nur intern",
  finance_credit_note_reverse: "Stornieren",
  finance_credit_note_reversal_reason: "Stornogrund",
  finance_credit_note_reversal: "Storno",
  finance_credit_note_legacy: "Anteilig über die ganze Rechnung (vor positionsgenauen Korrekturen)",
  finance_credit_note_partial: "teilweise",
  finance_credit_note_passthrough: "Durchlaufkosten",
  finance_credit_note_vat_line: "{rate} %: netto {net}, MwSt. {vat}",
  finance_credit_note_pdf: "PDF",
  finance_credit_note_pdf_error: "Das Korrekturdokument konnte nicht geöffnet werden.",
  finance_credit_note_portal_title: "Rechnungskorrekturen",
  finance_accounting_category_patient_credit: "Patientenguthaben (kein Umsatz)",
};
