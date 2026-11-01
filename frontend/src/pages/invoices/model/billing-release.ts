type LocalizedText = { de: string; ru: string };

const REFRESH_QUANTITIES: LocalizedText = {
  de: "Die verfügbare Menge hat sich geändert. Aktualisieren Sie das Angebot und prüfen Sie die Mengen.",
  ru: "Доступный остаток изменился. Обновите предложение и проверьте количество.",
};

const CHECK_SELECTION: LocalizedText = {
  de: "Prüfen Sie die ausgewählten Positionen und Mengen.",
  ru: "Проверьте выбранные позиции и количество.",
};

const CREATE_FAILED: LocalizedText = {
  de: "Die Rechnung konnte nicht erstellt werden. Versuchen Sie es erneut.",
  ru: "Не удалось создать счёт. Повторите попытку.",
};

/**
 * Only a line credited in full gives its quantity back to the quote; a credit
 * note on a part of a line only lowers the invoice (QA 2026-11-01, R3 BUG-2).
 */
const PARTLY_CREDITED_HINT: LocalizedText = {
  de: "Eine Gutschrift über einen Teil einer Position gibt keine Menge an das Angebot zurück. Um die Leistung erneut abzurechnen, stornieren Sie diese Gutschrift und erstellen eine Gutschrift über die ganze Position (dann Zwischenrechnung), oder erfassen Sie die Leistung neu im Auftrag und erstellen ein neues Angebot.",
  ru: "Кредит-нота на часть позиции не возвращает количество в предложение. Чтобы выставить услугу заново, сторнируйте эту кредит-ноту и оформите кредит-ноту на всю позицию (затем промежуточный счёт) или добавьте услугу в заказ и создайте новое предложение.",
};

export function partlyCreditedHint(lang: string) {
  return lang === "de" ? PARTLY_CREDITED_HINT.de : PARTLY_CREDITED_HINT.ru;
}

/** Messages of POST /quotes/{id}/invoices, keyed by the server's `error` text. */
const INVOICE_CREATION_ERRORS: Record<string, LocalizedText> = {
  "Cannot invoice a rejected or expired quote": {
    de: "Für ein abgelehntes oder abgelaufenes Angebot kann keine Rechnung erstellt werden.",
    ru: "Нельзя выставить счёт по отклонённому или просроченному предложению.",
  },
  "The order behind this quote is still a draft or was cancelled; confirm the order preparation before invoicing": {
    de: "Der Auftrag hinter diesem Angebot ist noch ein Entwurf oder wurde storniert. Schließen Sie die Auftragsvorbereitung ab, bevor Sie abrechnen.",
    ru: "Заказ по этому предложению ещё черновик или отменён. Завершите подготовку заказа, прежде чем выставлять счёт.",
  },
  "An active invoice already exists for this quote scope": {
    de: "Für diesen Angebotsumfang besteht bereits eine aktive Rechnung. Prüfen Sie die vorhandenen Rechnungen.",
    ru: "Для этих позиций предложения уже существует действующий счёт. Проверьте список счетов.",
  },
  "This quote has no remaining quantities to invoice": {
    de: `Dieses Angebot ist bereits vollständig abgerechnet. ${PARTLY_CREDITED_HINT.de}`,
    ru: `По этому предложению уже выставлен весь объём. ${PARTLY_CREDITED_HINT.ru}`,
  },
  "Selected quantity exceeds the remaining quote line quantity": REFRESH_QUANTITIES,
  "Invoice quantity changed; reload the quote and try again": REFRESH_QUANTITIES,
  "A selected quote line has already been fully invoiced": {
    de: "Eine ausgewählte Position ist inzwischen vollständig abgerechnet. Aktualisieren Sie das Angebot und passen Sie die Auswahl an.",
    ru: "Одна из выбранных позиций уже выставлена полностью. Обновите предложение и измените выбор.",
  },
  "Order services changed; reload and try again": {
    de: "Die Leistungen des Auftrags haben sich geändert. Aktualisieren Sie die Daten und versuchen Sie es erneut.",
    ru: "Услуги заказа изменились. Обновите данные и повторите попытку.",
  },
  "A final invoice must include every remaining quote line quantity": {
    de: "Die Schlussrechnung muss alle verbleibenden Mengen enthalten. Verwenden Sie für eine Teilauswahl eine Zwischenrechnung.",
    ru: "Финальный счёт должен включать весь остаток. Для части позиций выберите промежуточный счёт.",
  },
  "A cancelled service cannot be invoiced": {
    de: "Eine Leistung wurde storniert und kann nicht abgerechnet werden. Entfernen Sie sie aus der Auswahl.",
    ru: "Услуга отменена, по ней нельзя выставить счёт. Уберите её из выбора.",
  },
  "Quote has no invoiceable line items": {
    de: "Dieses Angebot enthält keine abrechenbaren Positionen. Prüfen Sie die Leistungen im Auftrag.",
    ru: "В предложении нет позиций для выставления счёта. Проверьте услуги в заказе.",
  },
  "Quote contains an invalid line quantity": {
    de: "Eine Position im Angebot hat keine gültige Menge. Korrigieren Sie das Angebot.",
    ru: "В предложении есть позиция с некорректным количеством. Исправьте предложение.",
  },
  "Quote contains invalid price or VAT data": {
    de: "Eine Position im Angebot hat einen ungültigen Preis oder Steuersatz. Korrigieren Sie das Angebot.",
    ru: "В предложении есть позиция с некорректной ценой или ставкой НДС. Исправьте предложение.",
  },
  "Approved package overage is missing a charge price": {
    de: "Für einen genehmigten Mehrverbrauch fehlt der Preis, er lässt sich nicht berechnen. Lehnen Sie ihn mit Begründung im Tarif des Patienten ab und erfassen Sie ihn nach der Preisangabe neu.",
    ru: "Для подтверждённого превышения не указана цена, его нельзя выставить. Отклоните его с причиной в тарифе пациента, а после указания цены запишите заново.",
  },
  "At least one invoice line must be selected": CHECK_SELECTION,
  "Selected invoice line does not exist": CHECK_SELECTION,
  "Invalid invoice line quantity": CHECK_SELECTION,
  "Invoice line quantity must be greater than zero": CHECK_SELECTION,
  "Invoice line was selected more than once": CHECK_SELECTION,
  "Invoice line comment is too long": {
    de: "Die Anmerkung zur Position ist zu lang (max. 300 Zeichen).",
    ru: "Примечание к позиции слишком длинное (не более 300 символов).",
  },
  "Invalid invoice type": {
    de: "Wählen Sie einen gültigen Rechnungstyp.",
    ru: "Выберите допустимый тип счёта.",
  },
  "Invalid date (YYYY-MM-DD)": {
    de: "Prüfen Sie das Fälligkeitsdatum.",
    ru: "Проверьте срок оплаты.",
  },
  "Quote not found": {
    de: "Das Angebot wurde nicht gefunden. Aktualisieren Sie die Angebotsliste.",
    ru: "Предложение не найдено. Обновите список предложений.",
  },
  "Insufficient permissions": {
    de: "Sie haben keine Berechtigung, Rechnungen zu erstellen.",
    ru: "Нет прав на создание счетов.",
  },
  "Failed to create invoice": CREATE_FAILED,
  "Failed to load quote": CREATE_FAILED,
  "Failed to validate patient access": CREATE_FAILED,
  "Failed to load remaining invoice quantities": CREATE_FAILED,
  "Failed to load approved package overages": CREATE_FAILED,
  "Failed to validate invoice duplication": CREATE_FAILED,
  "Failed to save invoice line allocation": CREATE_FAILED,
  "Failed to mark order services as invoiced": CREATE_FAILED,
  "Failed to link package consumption to invoice": CREATE_FAILED,
};

export function invoiceCreationErrorMessage(error: unknown, lang: string, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (!Object.hasOwn(INVOICE_CREATION_ERRORS, message)) return message;
  const localized = INVOICE_CREATION_ERRORS[message];
  return lang === "de" ? localized.de : localized.ru;
}
