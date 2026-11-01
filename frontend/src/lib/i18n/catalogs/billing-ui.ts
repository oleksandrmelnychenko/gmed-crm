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
  "api_billing_rebilling_waiver_settlement_closed":
    "Die Abrechnung des Auftrags ist abgeschlossen; die Ausnahme bleibt bestehen.",
  "api_billing_credit_note_rebilled":
    "Eine spätere Rechnung berechnet diese Positionen erneut. Bitte zuerst diese Rechnung stornieren oder korrigieren.",
  // Invoices and correction documents name GMED's tax registration (QA D2-09).
  "api_billing_issuer_tax_registration_missing":
    "Ausstellung nicht möglich: Steuernummer und USt-IdNr. der GMED fehlen. Bitte in den Systemeinstellungen eintragen lassen; es wurde nichts gebucht.",
  "api_billing_invoice_bills_cancelled_service":
    "Der Entwurf enthält stornierte Leistungen ({cancelled_services_label}). Bitte den Entwurf stornieren und eine neue Rechnung erstellen.",
  "api_billing_invoice_bills_above_actual_services":
    "Der Entwurf berechnet mehr, als tatsächlich erbracht wurde ({services_label}). Bitte den Entwurf stornieren und eine neue Rechnung erstellen.",
  "api_billing_advance_beside_final_invoice":
    "Dieses Angebot ist bereits mit einer Schlussrechnung abgerechnet. Bitte diesen Entwurf der Vorauszahlungsrechnung stornieren.",
  "api_billing_quote_behind_actual_services":
    "Die erbrachten Leistungen übersteigen dieses Angebot ({services_label}). Bitte ein neues Angebot mit den tatsächlichen Mengen erstellen.",
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
  "api_billing_rebilling_waiver_settlement_closed":
    "Расчёт по заказу закрыт, решение остаётся в силе.",
  "api_billing_credit_note_rebilled":
    "Эти позиции уже выставлены более поздним счётом. Сначала отмените или исправьте его.",
  "api_billing_issuer_tax_registration_missing":
    "Выпуск невозможен: не указаны Steuernummer и USt-IdNr. GMED. Их нужно заполнить в «Системных настройках»; ничего не проведено.",
  "api_billing_invoice_bills_cancelled_service":
    "В черновике есть отменённые услуги ({cancelled_services_label}). Отмените черновик и создайте новый счёт.",
  "api_billing_invoice_bills_above_actual_services":
    "Черновик выставляет больше, чем фактически оказано ({services_label}). Отмените черновик и создайте новый счёт.",
  "api_billing_advance_beside_final_invoice":
    "По этому предложению уже есть финальный счёт. Отмените этот черновик счёта на предоплату.",
  "api_billing_quote_behind_actual_services":
    "Оказанные услуги превышают это предложение ({services_label}). Создайте новое предложение с фактическими количествами.",
  "api_billing_advance_rest_already_closed": "У авансового счёта больше нет открытого остатка.",
  "api_billing_advance_not_settled_by_final_invoice": "Этот аванс ещё не закрыт выпущенным финальным счётом.",
} as const satisfies Record<keyof typeof billingUiDe, string>;
