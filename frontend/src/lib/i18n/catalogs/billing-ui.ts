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
} as const satisfies Record<string, string>;

export const billingUiRu = {
  "api_billing_internal_note_too_long": "Внутренняя заметка — не более 4000 символов.",
  "api_billing_rebilling_waiver_reason_required": "Укажите причину от 3 до 1000 символов.",
  "api_billing_rebilling_waiver_nothing_to_waive":
    "По этому счёту поставщика не осталось суммы для перевыставления.",
  "api_billing_rebilling_waiver_not_possible":
    "Не перевыставлять можно только действующий счёт поставщика пациента.",
  "api_billing_rebilling_waiver_already_reversed": "Это решение уже отменено.",
} as const satisfies Record<keyof typeof billingUiDe, string>;
