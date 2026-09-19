export function invoiceCreationErrorMessage(error: unknown, lang: string, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const de = lang === "de";
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
