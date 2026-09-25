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
    de: "Dieses Angebot ist bereits vollständig abgerechnet. Aktualisieren Sie die Auswahl.",
    ru: "По этому предложению уже выставлен весь объём. Обновите список предложений.",
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
  "A service cancelled by contract termination cannot be invoiced": {
    de: "Eine Leistung wurde mit der Vertragskündigung storniert und kann nicht abgerechnet werden. Entfernen Sie sie aus der Auswahl.",
    ru: "Услуга отменена при расторжении договора, по ней нельзя выставить счёт. Уберите её из выбора.",
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
    de: "Für eine genehmigte Paketüberschreitung fehlt der Abrechnungspreis. Ergänzen Sie ihn im Leistungspaket.",
    ru: "Для утверждённого превышения пакета не указана цена. Укажите её в пакете услуг.",
  },
  "At least one invoice line must be selected": CHECK_SELECTION,
  "Selected invoice line does not exist": CHECK_SELECTION,
  "Invalid invoice line quantity": CHECK_SELECTION,
  "Invoice line quantity must be greater than zero": CHECK_SELECTION,
  "Invoice line was selected more than once": CHECK_SELECTION,
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
