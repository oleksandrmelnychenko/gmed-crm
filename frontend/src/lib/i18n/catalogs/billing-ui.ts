/**
 * Texts of internal notes and re-billing waivers (owner 2026-10-12).
 * Merged into `uiText`; every key exists in German and Russian.
 */
export const billingUiDe = {
  // Server refusals (lib/billing-api-errors.ts)
  "api_billing_internal_note_too_long": "Die interne Notiz darf höchstens 4000 Zeichen haben.",
  "api_billing_rebilling_waiver_reason_required": "Bitte einen Grund mit 3 bis 1000 Zeichen angeben.",
  "api_billing_rebilling_waiver_nothing_to_waive":
    "Für diese Lieferantenrechnung ist nichts mehr offen, das weiterberechnet werden könnte.",
  "api_billing_rebilling_waiver_not_possible":
    "Nur eine aktive Lieferantenrechnung eines Patienten kann von der Weiterberechnung ausgenommen werden.",
  "api_billing_rebilling_waiver_already_reversed": "Diese Ausnahme wurde bereits zurückgenommen.",
  // Invoices and correction documents name GMED's tax registration (QA D2-09).
  "api_billing_issuer_tax_registration_missing":
    "Ausstellung nicht möglich: Steuernummer und USt-IdNr. der GMED fehlen. Bitte in den Systemeinstellungen eintragen lassen; es wurde nichts gebucht.",
  "api_billing_advance_rest_already_closed": "Die Anzahlungsrechnung hat keinen offenen Rest mehr.",
  "api_billing_advance_not_settled_by_final_invoice":
    "Noch keine ausgestellte Schlussrechnung rechnet diese Anzahlung ab.",
} as const satisfies Record<string, string>;

export const billingUiRu = {
  "api_billing_internal_note_too_long": "Внутренняя заметка — не более 4000 символов.",
  "api_billing_rebilling_waiver_reason_required": "Укажите причину от 3 до 1000 символов.",
  "api_billing_rebilling_waiver_nothing_to_waive":
    "По этому счёту поставщика не осталось суммы для перевыставления.",
  "api_billing_rebilling_waiver_not_possible":
    "Не перевыставлять можно только действующий счёт поставщика пациента.",
  "api_billing_rebilling_waiver_already_reversed": "Это решение уже отменено.",
  "api_billing_issuer_tax_registration_missing":
    "Выпуск невозможен: не указаны Steuernummer и USt-IdNr. GMED. Их нужно заполнить в «Системных настройках»; ничего не проведено.",
  "api_billing_advance_rest_already_closed": "У авансового счёта больше нет открытого остатка.",
  "api_billing_advance_not_settled_by_final_invoice": "Этот аванс ещё не закрыт выпущенным финальным счётом.",
} as const satisfies Record<keyof typeof billingUiDe, string>;
