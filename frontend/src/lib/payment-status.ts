export function paymentStatusLabel(status: string, lang: "de" | "ru") {
  const labels: Record<string, [string, string]> = {
    not_required: ["Vorauszahlung nicht erforderlich", "Предоплата не требуется"],
    not_configured: ["Vorauszahlungsbetrag fehlt", "Не указана сумма предоплаты"],
    awaiting_invoice: ["Rechnung ausstehend", "Ожидается выставление счёта"],
    awaiting_payment: ["Zahlung ausstehend", "Ожидается оплата"],
    partially_paid: ["Teilweise bezahlt", "Частично оплачено"],
    paid: ["Bezahlt", "Оплачено"],
    due_soon: ["Zahlungsfrist innerhalb von 24 Stunden", "Срок оплаты в ближайшие 24 часа"],
    overdue: ["Zahlungsfrist überschritten", "Срок оплаты истёк"],
  };
  return labels[status]?.[lang === "de" ? 0 : 1] ?? status;
}
