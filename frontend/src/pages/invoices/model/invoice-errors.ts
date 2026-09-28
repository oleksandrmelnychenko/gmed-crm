/**
 * Invoice actions answer with English server messages. Billing staff work in
 * Russian or German, so the messages they meet in daily work are translated;
 * anything unknown is shown as sent, which still names the reason.
 */

type Pair = [de: string, ru: string];

const EXACT: Record<string, Pair> = {
  "credit note was already reversed": [
    "Diese Gutschrift wurde bereits storniert.",
    "Эта кредит-нота уже сторнирована.",
  ],
  "credit transfer was already reversed": [
    "Diese Guthabenumbuchung wurde bereits storniert.",
    "Этот перенос переплаты уже сторнирован.",
  ],
  "the payer of a released invoice cannot change; cancel the invoice and issue a new one": [
    "Der Zahler einer ausgestellten Rechnung kann nicht geändert werden. Rechnung stornieren und neu ausstellen.",
    "Плательщика выпущенного счёта изменить нельзя. Отмените счёт и выпустите новый.",
  ],
  "the due date of a released invoice cannot change; a payment reminder sets a new deadline": [
    "Das Fälligkeitsdatum einer ausgestellten Rechnung ist fest. Eine neue Frist setzt die Zahlungserinnerung.",
    "Срок оплаты выпущенного счёта изменить нельзя. Новый срок задаёт напоминание об оплате.",
  ],
  "a released invoice cannot return to draft; cancel it and issue a new invoice": [
    "Eine ausgestellte Rechnung kann kein Entwurf mehr werden. Rechnung stornieren und neu ausstellen.",
    "Выпущенный счёт нельзя вернуть в черновик. Отмените его и выпустите новый.",
  ],
  "payments, prepayments and credit notes must be reversed or released before cancellation": [
    "Vor der Stornierung Zahlungen, Vorauszahlungen und Gutschriften stornieren bzw. freigeben.",
    "Перед отменой сторнируйте платежи и кредит-ноты и снимите зачтённые предоплаты.",
  ],
  "applied advance payment must be released before cancellation": [
    "Vor der Stornierung die angerechnete Vorauszahlung freigeben.",
    "Перед отменой снимите зачтённую предоплату.",
  ],
  "a draft invoice must be released before it can be settled": [
    "Ein Entwurf muss erst ausgestellt werden, bevor Zahlungen erfasst werden.",
    "Сначала выпустите черновик счёта, затем записывайте оплату.",
  ],
  "payments require an active released invoice": [
    "Zahlungen nur für eine ausgestellte, nicht stornierte Rechnung.",
    "Оплаты записываются только по выпущенному неотменённому счёту.",
  ],
  "credit notes require an active released invoice": [
    "Gutschriften nur zu einer ausgestellten, nicht stornierten Rechnung.",
    "Кредит-ноты оформляются только к выпущенному неотменённому счёту.",
  ],
  "credit-note date cannot precede the invoice date": [
    "Das Datum der Gutschrift darf nicht vor dem Rechnungsdatum liegen.",
    "Дата кредит-ноты не может быть раньше даты счёта.",
  ],
  "credit note violates invoice balance rules": [
    "Die Gutschrift übersteigt den korrigierbaren Betrag der Rechnung.",
    "Кредит-нота превышает сумму, которую можно скорректировать по счёту.",
  ],
  "recorded payments can only be reduced through reversals": [
    "Erfasste Zahlungen werden nur per Storno verringert.",
    "Записанные оплаты уменьшаются только сторнированием.",
  ],
  "prepayment exceeds the available advance or invoice balance": [
    "Die Vorauszahlung übersteigt das verfügbare Guthaben oder den offenen Betrag.",
    "Сумма предоплаты больше доступного аванса или остатка по счёту.",
  ],
  "transfer exceeds the credit balance of the invoice": [
    "Der Betrag übersteigt das Guthaben dieser Rechnung.",
    "Сумма больше переплаты по этому счёту.",
  ],
  "transfer exceeds the open balance of the target invoice": [
    "Der Betrag übersteigt den offenen Betrag der Zielrechnung.",
    "Сумма больше остатка к оплате по выбранному счёту.",
  ],
  "credit transfers require released invoices": [
    "Umbuchungen nur zwischen ausgestellten Rechnungen.",
    "Переносить переплату можно только между выпущенными счетами.",
  ],
  "invoice is not past its due date": [
    "Die Rechnung ist noch nicht fällig.",
    "Срок оплаты счёта ещё не истёк.",
  ],
  "invoice is not overdue yet": [
    "Die Rechnung ist noch nicht überfällig.",
    "Счёт ещё не просрочен.",
  ],
  "invoice status cannot move from the current status to the requested one": [
    "Dieser Statuswechsel ist für die Rechnung nicht möglich.",
    "Такой переход статуса для счёта невозможен.",
  ],
  "cancelled invoices cannot be reactivated": [
    "Stornierte Rechnungen können nicht reaktiviert werden.",
    "Отменённый счёт нельзя вернуть в работу.",
  ],
  "insufficient permissions": [
    "Keine Berechtigung für diese Aktion.",
    "Недостаточно прав для этого действия.",
  ],
};

const RELOAD_HINT = /reload( the [a-z ]+)? and try again\.?$/i;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.trim();
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message.trim();
  }
  return "";
}

export function localizeInvoiceError(error: unknown, lang: string, fallback: string) {
  const message = errorMessage(error);
  if (!message) return fallback;
  const exact = EXACT[message.toLowerCase()];
  if (exact) return lang === "de" ? exact[0] : exact[1];
  if (RELOAD_HINT.test(message)) {
    return lang === "de"
      ? "Die Daten wurden inzwischen geändert. Seite neu laden und erneut versuchen."
      : "Данные уже изменились. Обновите страницу и повторите действие.";
  }
  return message;
}
