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
  "payer name is too long (max 200)": [
    "Der Name des Einzahlers ist zu lang (max. 200 Zeichen).",
    "Имя плательщика слишком длинное (не более 200 символов).",
  ],
  "insufficient permissions": [
    "Keine Berechtigung für diese Aktion.",
    "Недостаточно прав для этого действия.",
  ],
};

/** Machine-readable error codes of the payer and release checks. */
const CODES: Record<string, Pair> = {
  recipient_address_incomplete: [
    "Für die Ausstellung fehlen Name oder vollständige Anschrift des Rechnungsempfängers (Straße, PLZ, Ort, Land).",
    "Для выпуска счёта нужны имя и полный адрес получателя счёта: улица, индекс, город и страна.",
  ],
  minor_patient_recipient: [
    "Die Rechnung ist an einen minderjährigen Patienten adressiert. Bitte einen Zahler (z. B. einen Elternteil) hinterlegen oder die Ausstellung bestätigen.",
    "Счёт адресован несовершеннолетнему пациенту. Укажите плательщика (например, родителя) или подтвердите выпуск.",
  ],
  recipient_not_contracting_party: [
    "Der Rechnungsempfänger ist nicht der Vertragspartner. Zahler als abweichenden Rechnungsempfänger (Kostenübernehmer) kennzeichnen oder die Ausstellung bestätigen.",
    "Получатель счёта не является стороной договора. Отметьте плательщика как стороннего получателя счёта (Kostenübernehmer) или подтвердите выпуск.",
  ],
  advance_recipient_mismatch: [
    "Anzahlungsrechnungen dieses Auftrags gingen an einen anderen Rechnungsempfänger. Verrechnet werden nur Anzahlungen desselben Empfängers – bitte bestätigen.",
    "Авансовые счета по этому заказу выставлены другому получателю. Зачитываются только авансы того же получателя — подтвердите выпуск.",
  ],
  credit_transfer_recipient_mismatch: [
    "Die Rechnungen haben unterschiedliche Rechnungsempfänger. Guthaben nur nach Bestätigung umbuchen.",
    "У счетов разные получатели. Перенести переплату можно только после подтверждения.",
  ],
  payer_email_invalid: [
    "Die E-Mail-Adresse des Zahlers ist ungültig.",
    "Некорректный e-mail плательщика.",
  ],
  payer_single_record: [
    "Zahler ist entweder ein Angehöriger oder ein anderer Patient, nicht beides.",
    "Плательщик — либо родственник, либо другой пациент, но не оба сразу.",
  ],
  payer_is_patient: [
    "Der Patient kann nicht sein eigener Zahler sein. Zahler leeren, dann erhält der Patient die Rechnung.",
    "Пациент не может быть собственным плательщиком. Очистите плательщика — тогда счёт получит пациент.",
  ],
  payer_relation_mismatch: [
    "Dieser Angehörige gehört nicht zum Patienten.",
    "Этот родственник не относится к пациенту.",
  ],
  payer_patient_not_found: [
    "Kein Patient mit dieser Patientennummer.",
    "Пациент с таким номером не найден.",
  ],
  payer_role_invalid: ["Ungültige Zahlerrolle.", "Недопустимая роль плательщика."],
  payer_field_too_long: [
    "Ein Feld des Zahlers ist zu lang.",
    "Одно из полей плательщика слишком длинное.",
  ],
};

/** Address parts named in `recipient_address_incomplete.missing`. */
const ADDRESS_PARTS: Record<string, Pair> = {
  name: ["Name", "имя"],
  street: ["Straße", "улица"],
  zip: ["PLZ", "индекс"],
  city: ["Ort", "город"],
  country: ["Land", "страна"],
};

const RELOAD_HINT = /reload( the [a-z ]+)? and try again\.?$/i;

function errorBody(error: unknown): Record<string, unknown> | null {
  if (error && typeof error === "object" && "body" in error) {
    const body = (error as { body?: unknown }).body;
    if (body && typeof body === "object") return body as Record<string, unknown>;
  }
  return null;
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  const code = errorBody(error)?.error;
  return typeof code === "string" ? code : "";
}

/** Text of a release check shown on a draft (`release_checks.warnings`). */
export function invoiceReleaseWarningText(
  warning: { code: string; missing?: string[] },
  lang: string,
) {
  return localizeInvoiceError(
    { code: warning.code, body: { error: warning.code, missing: warning.missing } },
    lang,
    warning.code,
  );
}

/**
 * The flag a warning answer asks to be confirmed with (e.g.
 * `confirm_minor_recipient`), or null for errors that cannot be confirmed.
 */
export function invoiceConfirmationField(error: unknown): string | null {
  const field = errorBody(error)?.confirm_field;
  return typeof field === "string" && /^confirm_[a-z_]+$/.test(field) ? field : null;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.trim();
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message.trim();
  }
  return "";
}

export function localizeInvoiceError(error: unknown, lang: string, fallback: string) {
  const coded = CODES[errorCode(error)];
  if (coded) {
    const text = lang === "de" ? coded[0] : coded[1];
    const missing = errorBody(error)?.missing;
    if (Array.isArray(missing) && missing.length > 0) {
      const parts = missing
        .map((part) => ADDRESS_PARTS[String(part)])
        .filter((pair): pair is Pair => Boolean(pair))
        .map((pair) => (lang === "de" ? pair[0] : pair[1]));
      if (parts.length > 0) {
        return `${text} ${lang === "de" ? "Es fehlt" : "Не хватает"}: ${parts.join(", ")}.`;
      }
    }
    return text;
  }
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
