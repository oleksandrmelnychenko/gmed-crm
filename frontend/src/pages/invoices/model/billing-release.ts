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
  if (message === "All order services must be approved before invoice creation") {
    return de ? "Die ausgewählten Auftragsleistungen müssen vor der Rechnungserstellung genehmigt werden."
      : "Перед созданием счёта необходимо утвердить выбранные услуги в заказе.";
  }
  if (message === "Cannot invoice a rejected or expired quote") {
    return de ? "Für ein abgelehntes oder abgelaufenes Angebot kann keine Rechnung erstellt werden."
      : "Нельзя выставить счёт по отклонённому или просроченному предложению.";
  }
  if (message === "An active invoice already exists for this quote scope") {
    return de ? "Für diesen Angebotsumfang besteht bereits eine aktive Rechnung. Prüfen Sie die vorhandenen Rechnungen."
      : "Для этих позиций предложения уже существует действующий счёт. Проверьте список счетов.";
  }
  return message;
}
