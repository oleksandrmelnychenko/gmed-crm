import type { InvoiceBillingRelease } from "./types";

export function canGrantInvoiceBillingRelease(role?: string) {
  return role === "billing" || role === "ceo";
}

export function hasInvoiceBillingRelease(release?: InvoiceBillingRelease | null) {
  // Package coverage permits other order operations, but not invoice creation.
  return release?.billing_release_status === "granted";
}

export function invoiceCreationErrorMessage(error: unknown, lang: string, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const de = lang === "de";
  if (message === "invoice_billing_release_unavailable") {
    return de ? "Die Abrechnungsfreigabe konnte nicht geprüft werden. Versuchen Sie es erneut."
      : "Не удалось проверить разрешение бухгалтерии. Повторите проверку.";
  }
  if (message === "Order requires billing release before invoice creation" ||
      message === "Order is package-covered and has no billing release for invoice creation") {
    return de
      ? "Für diesen Auftrag fehlt die Abrechnungsfreigabe. Buchhaltung oder Geschäftsführung müssen sie vor der Rechnungserstellung erteilen."
      : "Для этого заказа нет разрешения на выставление счёта. Его должен выдать бухгалтер или директор.";
  }
  if (message === "Cannot invoice a rejected or expired quote") {
    return de ? "Für ein abgelehntes oder abgelaufenes Angebot kann keine Rechnung erstellt werden."
      : "Нельзя выставить счёт по отклонённому или просроченному предложению.";
  }
  if (message === "An active invoice already exists for this quote scope") {
    return de ? "Für diesen Angebotsumfang besteht bereits eine aktive Rechnung. Prüfen Sie die vorhandenen Rechnungen."
      : "Для этих позиций предложения уже существует действующий счёт. Проверьте список счетов.";
  }
  if (message === "This quote has no remaining quantities to invoice") {
    return de ? "Dieses Angebot ist bereits vollständig abgerechnet. Aktualisieren Sie die Auswahl."
      : "По этому предложению уже выставлен весь объём. Обновите список предложений.";
  }
  if (message === "Selected quantity exceeds the remaining quote line quantity") {
    return de ? "Die verfügbare Menge hat sich geändert. Aktualisieren Sie das Angebot und prüfen Sie die Mengen."
      : "Доступный остаток изменился. Обновите предложение и проверьте количество.";
  }
  if (message === "A final invoice must include every remaining quote line quantity") {
    return de ? "Die Schlussrechnung muss alle verbleibenden Mengen enthalten. Verwenden Sie für eine Teilauswahl eine Zwischenrechnung."
      : "Финальный счёт должен включать весь остаток. Для части позиций выберите промежуточный счёт.";
  }
  if (message === "Quote has no invoiceable line items") {
    return de ? "Dieses Angebot enthält keine abrechenbaren Positionen. Prüfen Sie die Leistungen im Auftrag."
      : "В предложении нет позиций для выставления счёта. Проверьте услуги в заказе.";
  }
  return message;
}
