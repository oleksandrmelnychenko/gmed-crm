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
  finance_credit_section_title: string;
  finance_credit_balance_description: string;
  finance_credit_balance_amount: string;
  finance_credit_transfer_target: string;
  finance_credit_transfer_target_option: string;
  finance_credit_transfer_amount: string;
  finance_credit_transfer_date: string;
  finance_credit_transfer_note: string;
  finance_credit_transfer_submit: string;
  finance_credit_transfer_no_targets: string;
  finance_credit_transfer_error_invalid_amount: string;
  finance_credit_transfer_error_exceeds_credit: string;
  finance_credit_transfer_error_exceeds_target: string;
  finance_credit_transfer_error_no_target: string;
  finance_credit_transfer_history_title: string;
  finance_credit_transfer_out: string;
  finance_credit_transfer_in: string;
  finance_credit_transfer_reverse: string;
  finance_credit_transfer_reversal_reason: string;
  finance_credit_transfer_reversed: string;
  finance_payment_overpayment_notice: string;
  finance_payment_method_credit_transfer: string;
  finance_payment_credit_transfer_from: string;
  finance_refund_credit_transfer_to: string;
  finance_order_patient_credit: string;
  finance_order_advance_available: string;
  finance_order_open_invoices: string;
  finance_order_held_hint: string;
  finance_invoice_advance_credit: string;
  finance_invoice_amount_to_pay: string;
  finance_statement_credit_balance: string;
  finance_statement_amount_to_pay: string;
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
  finance_credit_section_title: "Переплата и зачёты",
  finance_credit_balance_description:
    "Получено больше, чем требует счёт (переплата или кредит-нота после оплаты). Сумму можно вернуть пациенту в разделе «Возвраты» или зачесть в другой открытый счёт пациента.",
  finance_credit_balance_amount: "Кредит пациента",
  finance_credit_transfer_target: "Зачесть в счёт",
  finance_credit_transfer_target_option: "{number} · {order} · к оплате {amount}",
  finance_credit_transfer_amount: "Сумма зачёта",
  finance_credit_transfer_date: "Дата зачёта",
  finance_credit_transfer_note: "Комментарий",
  finance_credit_transfer_submit: "Зачесть переплату",
  finance_credit_transfer_no_targets:
    "Других открытых счетов у пациента нет — переплату можно вернуть в разделе «Возвраты».",
  finance_credit_transfer_error_invalid_amount: "Сумма должна быть больше нуля.",
  finance_credit_transfer_error_exceeds_credit: "Сумма больше кредита пациента.",
  finance_credit_transfer_error_exceeds_target: "Сумма больше остатка выбранного счёта.",
  finance_credit_transfer_error_no_target: "Выберите счёт.",
  finance_credit_transfer_history_title: "Зачёты переплаты",
  finance_credit_transfer_out: "Зачтено в счёт {number}",
  finance_credit_transfer_in: "Зачтено из счёта {number}",
  finance_credit_transfer_reverse: "Отменить зачёт",
  finance_credit_transfer_reversal_reason: "Причина отмены зачёта",
  finance_credit_transfer_reversed: "Отменён",
  finance_payment_overpayment_notice:
    "Поступление больше остатка на {amount}. Переплата останется кредитом пациента: её можно вернуть или зачесть в другой счёт.",
  finance_payment_method_credit_transfer: "Зачёт переплаты",
  finance_payment_credit_transfer_from: "Зачёт переплаты из счёта {number}",
  finance_refund_credit_transfer_to: "Зачтено в счёт {number}",
  finance_order_patient_credit: "Переплата пациента",
  finance_order_advance_available: "Аванс, ещё не зачтённый",
  finance_order_open_invoices: "Остаток по счетам",
  finance_order_held_hint:
    "«Осталось получить» уже учитывает оплаченный, но не зачтённый аванс ({advance}) и переплату ({credit}).",
  finance_invoice_advance_credit: "Будет покрыто авансом",
  finance_invoice_amount_to_pay: "К оплате с учётом аванса",
  finance_statement_credit_balance: "Переплата по счетам",
  finance_statement_amount_to_pay: "К оплате с учётом авансов и переплат",
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
  finance_credit_section_title: "Guthaben und Verrechnungen",
  finance_credit_balance_description:
    "Es ist mehr eingegangen, als die Rechnung verlangt (Überzahlung oder Rechnungskorrektur nach Zahlung). Der Betrag kann unter „Erstattungen“ an den Patienten zurückgezahlt oder mit einer anderen offenen Rechnung des Patienten verrechnet werden.",
  finance_credit_balance_amount: "Patientenguthaben",
  finance_credit_transfer_target: "Verrechnen mit Rechnung",
  finance_credit_transfer_target_option: "{number} · {order} · offen {amount}",
  finance_credit_transfer_amount: "Verrechnungsbetrag",
  finance_credit_transfer_date: "Verrechnungsdatum",
  finance_credit_transfer_note: "Kommentar",
  finance_credit_transfer_submit: "Guthaben verrechnen",
  finance_credit_transfer_no_targets:
    "Der Patient hat keine weiteren offenen Rechnungen – das Guthaben kann unter „Erstattungen“ zurückgezahlt werden.",
  finance_credit_transfer_error_invalid_amount: "Der Betrag muss größer als null sein.",
  finance_credit_transfer_error_exceeds_credit: "Der Betrag übersteigt das Patientenguthaben.",
  finance_credit_transfer_error_exceeds_target:
    "Der Betrag übersteigt den offenen Betrag der gewählten Rechnung.",
  finance_credit_transfer_error_no_target: "Wählen Sie eine Rechnung.",
  finance_credit_transfer_history_title: "Verrechnete Guthaben",
  finance_credit_transfer_out: "Verrechnet mit Rechnung {number}",
  finance_credit_transfer_in: "Guthaben aus Rechnung {number}",
  finance_credit_transfer_reverse: "Verrechnung stornieren",
  finance_credit_transfer_reversal_reason: "Stornogrund",
  finance_credit_transfer_reversed: "Storniert",
  finance_payment_overpayment_notice:
    "Der Zahlungseingang übersteigt den offenen Betrag um {amount}. Die Überzahlung bleibt als Patientenguthaben stehen und kann erstattet oder verrechnet werden.",
  finance_payment_method_credit_transfer: "Guthabenverrechnung",
  finance_payment_credit_transfer_from: "Guthaben aus Rechnung {number}",
  finance_refund_credit_transfer_to: "Verrechnet mit Rechnung {number}",
  finance_order_patient_credit: "Patientenguthaben",
  finance_order_advance_available: "Noch nicht verrechnete Anzahlung",
  finance_order_open_invoices: "Offene Rechnungsbeträge",
  finance_order_held_hint:
    "„Noch zu erhalten“ berücksichtigt bereits bezahlte, noch nicht verrechnete Anzahlungen ({advance}) und Guthaben ({credit}).",
  finance_invoice_advance_credit: "Durch Anzahlung gedeckt",
  finance_invoice_amount_to_pay: "Zu zahlen nach Anzahlung",
  finance_statement_credit_balance: "Guthaben aus Rechnungen",
  finance_statement_amount_to_pay: "Zu zahlen nach Anzahlungen und Guthaben",
};
