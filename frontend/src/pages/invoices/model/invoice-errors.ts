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
  "the positions of a released invoice cannot change; cancel the invoice and issue a new one": [
    "Die Positionen einer ausgestellten Rechnung können nicht geändert werden. Rechnung stornieren und neu ausstellen.",
    "Позиции выпущенного счёта изменить нельзя. Отмените счёт и выпустите новый.",
  ],
  "invoice line comment is too long": [
    "Die Anmerkung zur Position ist zu lang (max. 300 Zeichen).",
    "Примечание к позиции слишком длинное (не более 300 символов).",
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
    "Der Name des Zahlers ist zu lang (max. 200 Zeichen).",
    "Имя плательщика слишком длинное (не более 200 символов).",
  ],
  "insufficient permissions": [
    "Keine Berechtigung für diese Aktion.",
    "Недостаточно прав для этого действия.",
  ],
  // Payments, refunds, corrections (QA 2026-10-11: no raw English 409/422).
  "payment exceeds invoice balance": [
    "Der Betrag übersteigt den offenen Betrag der Rechnung. Den Überschuss als Guthaben bestätigen.",
    "Сумма больше остатка по счёту. Подтвердите излишек как переплату пациента.",
  ],
  "payment was already reversed": [
    "Diese Zahlung wurde bereits storniert.",
    "Этот платёж уже сторнирован.",
  ],
  "refund was already reversed": [
    "Diese Erstattung wurde bereits storniert.",
    "Этот возврат уже сторнирован.",
  ],
  "only a payment can be corrected": [
    "Nur ein Zahlungseingang kann korrigiert werden.",
    "Исправить можно только поступление оплаты.",
  ],
  "only a payment can be reversed": [
    "Nur ein Zahlungseingang kann storniert werden.",
    "Сторнировать можно только поступление оплаты.",
  ],
  "only a refund can be reversed": [
    "Nur eine Erstattung kann storniert werden.",
    "Сторнировать можно только возврат.",
  ],
  "only a credit note can be reversed": [
    "Nur eine Gutschrift kann storniert werden.",
    "Сторнировать можно только кредит-ноту.",
  ],
  "correction does not change the payment": [
    "Die Korrektur ändert nichts an der Zahlung.",
    "Исправление ничего не меняет в платеже.",
  ],
  "correction reason is required": [
    "Bitte den Grund der Korrektur angeben.",
    "Укажите причину исправления.",
  ],
  "imported opening balances cannot be corrected; reverse them instead": [
    "Importierte Anfangsbestände werden nicht korrigiert, sondern storniert.",
    "Импортированный начальный остаток не исправляется — сторнируйте его.",
  ],
  "a credit transfer is corrected by reversing the transfer": [
    "Eine Guthabenumbuchung wird durch Storno der Umbuchung korrigiert.",
    "Перенос переплаты исправляется сторнированием переноса.",
  ],
  "this receipt is a credit transfer; reverse the transfer instead": [
    "Dieser Eingang ist eine Guthabenumbuchung – bitte die Umbuchung stornieren.",
    "Это поступление — перенос переплаты: сторнируйте перенос.",
  ],
  "this refund is a credit transfer; reverse the transfer instead": [
    "Diese Erstattung ist eine Guthabenumbuchung – bitte die Umbuchung stornieren.",
    "Этот возврат — перенос переплаты: сторнируйте перенос.",
  ],
  "applied advances must be released before this payment can be corrected": [
    "Vor der Korrektur die angerechneten Vorauszahlungen dieser Anzahlung freigeben.",
    "Перед исправлением снимите зачёт этого аванса в других счетах.",
  ],
  "refunds and applied advances must be reversed or released before this payment can be reduced": [
    "Vor dem Verringern Erstattungen stornieren und angerechnete Vorauszahlungen freigeben.",
    "Перед уменьшением платежа сторнируйте возвраты и снимите зачёт аванса.",
  ],
  "refunds and applied advances must be reversed or released before this payment can be reversed": [
    "Vor dem Storno Erstattungen stornieren und angerechnete Vorauszahlungen freigeben.",
    "Перед сторно платежа сторнируйте возвраты и снимите зачёт аванса.",
  ],
  "refunds and applied advances of the target invoice must be reversed first": [
    "Zuerst Erstattungen und angerechnete Vorauszahlungen der Zielrechnung zurücknehmen.",
    "Сначала сторнируйте возвраты и снимите зачёт аванса по целевому счёту.",
  ],
  "refund exceeds the refundable cash credit": [
    "Die Erstattung übersteigt das erstattbare Guthaben.",
    "Сумма возврата больше доступной к возврату переплаты.",
  ],
  "refunds require an active released invoice": [
    "Erstattungen nur für eine ausgestellte, nicht stornierte Rechnung.",
    "Возвраты записываются только по выпущенному неотменённому счёту.",
  ],
  "refund reason is required": ["Bitte den Grund der Erstattung angeben.", "Укажите причину возврата."],
  "refund reversal reason is required": [
    "Bitte den Grund für das Storno der Erstattung angeben.",
    "Укажите причину сторно возврата.",
  ],
  "reversal reason is required": ["Bitte den Grund für das Storno angeben.", "Укажите причину сторно."],
  "reversal date cannot precede the original payment": [
    "Das Storno darf nicht vor dem Zahlungseingang liegen.",
    "Дата сторно не может быть раньше даты платежа.",
  ],
  "reversal date cannot precede the refund date": [
    "Das Storno darf nicht vor der Erstattung liegen.",
    "Дата сторно не может быть раньше даты возврата.",
  ],
  "reversal date cannot precede the credit-note date": [
    "Das Storno darf nicht vor der Gutschrift liegen.",
    "Дата сторно не может быть раньше даты кредит-ноты.",
  ],
  "reversal date cannot precede the transfer": [
    "Das Storno darf nicht vor der Umbuchung liegen.",
    "Дата сторно не может быть раньше даты переноса.",
  ],
  "invalid payment amount": ["Ungültiger Betrag.", "Некорректная сумма."],
  "payment amount must be greater than zero": [
    "Der Betrag muss größer als null sein.",
    "Сумма должна быть больше нуля.",
  ],
  "invalid payment date": [
    "Ungültiges Eingangsdatum (nicht in der Zukunft).",
    "Некорректная дата поступления (не может быть в будущем).",
  ],
  "invalid payment method": ["Ungültige Zahlungsart.", "Недопустимый способ оплаты."],
  "invalid refund amount": ["Ungültiger Erstattungsbetrag.", "Некорректная сумма возврата."],
  "refund amount must be greater than zero": [
    "Der Erstattungsbetrag muss größer als null sein.",
    "Сумма возврата должна быть больше нуля.",
  ],
  "invalid refund date": [
    "Ungültiges Erstattungsdatum (nicht in der Zukunft).",
    "Некорректная дата возврата (не может быть в будущем).",
  ],
  "invalid refund method": ["Ungültige Erstattungsart.", "Недопустимый способ возврата."],
  "invalid reversal date": ["Ungültiges Stornodatum.", "Некорректная дата сторно."],
  "invalid transfer amount": ["Ungültiger Umbuchungsbetrag.", "Некорректная сумма переноса."],
  "transfer amount must be greater than zero": [
    "Der Umbuchungsbetrag muss größer als null sein.",
    "Сумма переноса должна быть больше нуля.",
  ],
  "credit can only be moved to another invoice": [
    "Guthaben kann nur auf eine andere Rechnung umgebucht werden.",
    "Переплату можно перенести только на другой счёт.",
  ],
  "credit can only be moved between invoices of the same patient and currency": [
    "Guthaben nur zwischen Rechnungen desselben Patienten und derselben Währung umbuchen.",
    "Переплату можно переносить только между счетами одного пациента в одной валюте.",
  ],
  "the moved credit is no longer on the target invoice": [
    "Das umgebuchte Guthaben ist auf der Zielrechnung nicht mehr vorhanden.",
    "Перенесённой переплаты на целевом счёте уже нет.",
  ],
  // Credit notes.
  "credit note exceeds invoice total": [
    "Die Gutschrift übersteigt den Rechnungsbetrag.",
    "Кредит-нота больше суммы счёта.",
  ],
  "credit-note reason is required": [
    "Bitte den Grund der Gutschrift angeben.",
    "Укажите причину кредит-ноты.",
  ],
  "invalid credit-note date": [
    "Ungültiges Datum der Gutschrift (nicht in der Zukunft).",
    "Некорректная дата кредит-ноты (не может быть в будущем).",
  ],
  "invalid credit-note amount": ["Ungültiger Betrag der Gutschrift.", "Некорректная сумма кредит-ноты."],
  "credit-note amount must be greater than zero": [
    "Der Betrag der Gutschrift muss größer als null sein.",
    "Сумма кредит-ноты должна быть больше нуля.",
  ],
  "select at least one invoice line to credit": [
    "Bitte mindestens eine Rechnungsposition auswählen.",
    "Выберите хотя бы одну позицию счёта.",
  ],
  "credit note exceeds the remaining amount of an invoice line": [
    "Die Gutschrift übersteigt den Restbetrag einer Position.",
    "Кредит-нота больше остатка позиции.",
  ],
  "credit note exceeds the remaining amount of this vat rate": [
    "Die Gutschrift übersteigt den Restbetrag dieses Steuersatzes.",
    "Кредит-нота больше остатка по этой ставке НДС.",
  ],
  "the invoice has several vat rates: select the credited lines or a vat rate": [
    "Die Rechnung hat mehrere Steuersätze: Positionen oder einen Steuersatz wählen.",
    "В счёте несколько ставок НДС: выберите позиции или ставку.",
  ],
  "the invoice is already fully credited": [
    "Die Rechnung ist bereits vollständig gutgeschrieben.",
    "Счёт уже полностью скорректирован кредит-нотами.",
  ],
  "credit-note request id was already used with different data": [
    "Diese Gutschrift wurde bereits mit anderen Angaben gesendet. Seite neu laden.",
    "Эта кредит-нота уже отправлена с другими данными. Обновите страницу.",
  ],
  // Prepayments.
  "prepayments can only be applied between released invoices": [
    "Vorauszahlungen nur zwischen ausgestellten Rechnungen anrechnen.",
    "Зачитывать предоплату можно только между выпущенными счетами.",
  ],
  "prepayments require an invoice linked to an order": [
    "Vorauszahlungen nur für Rechnungen mit Auftrag.",
    "Предоплата зачитывается только в счёт, привязанный к заказу.",
  ],
  "prepayment amount must be greater than zero": [
    "Der Betrag muss größer als null sein.",
    "Сумма должна быть больше нуля.",
  ],
  "invalid prepayment amount": ["Ungültiger Betrag.", "Некорректная сумма."],
  // Dunning and status.
  "dunning is already blocked": ["Die Mahnsperre ist bereits aktiv.", "Блокировка напоминаний уже установлена."],
  "dunning is not blocked": ["Es gibt keine aktive Mahnsperre.", "Активной блокировки напоминаний нет."],
  "dunning is blocked for this invoice; clear the dunning block first": [
    "Für diese Rechnung gilt eine Mahnsperre. Zuerst die Sperre aufheben.",
    "Напоминания по счёту заблокированы. Сначала снимите блокировку.",
  ],
  "this dunning level already exists for this invoice": [
    "Diese Mahnstufe gibt es für die Rechnung bereits.",
    "Это напоминание по счёту уже есть.",
  ],
  "invoice is not eligible for dunning": [
    "Für diese Rechnung ist keine Mahnung möglich.",
    "По этому счёту напоминание невозможно.",
  ],
  "invoice must be sent before dunning starts": [
    "Die Rechnung muss vor der ersten Mahnung ausgestellt sein.",
    "Сначала выпустите счёт, затем отправляйте напоминание.",
  ],
  "invoice due date is required for dunning": [
    "Für eine Mahnung braucht die Rechnung ein Fälligkeitsdatum.",
    "Для напоминания у счёта должен быть срок оплаты.",
  ],
  "a reason of 3 to 1000 characters is required": [
    "Bitte einen Grund mit 3 bis 1000 Zeichen angeben.",
    "Укажите причину (от 3 до 1000 символов).",
  ],
  "payment status is derived from payment transactions and prepayments": [
    "Der Zahlungsstatus ergibt sich aus Zahlungen und Vorauszahlungen und wird nicht manuell gesetzt.",
    "Статус оплаты определяется по платежам и предоплатам и вручную не ставится.",
  ],
  "recorded payments must be reversed before cancellation": [
    "Vor der Stornierung die erfassten Zahlungen stornieren.",
    "Перед отменой сторнируйте записанные оплаты.",
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
    "Anzahlungsrechnungen dieses Auftrags gingen an einen anderen Rechnungsempfänger. Mit der Bestätigung rechnet diese Schlussrechnung genau diese Anzahlungen ab: Gezahltes wird abgezogen, der offene Rest mit einer Gutschrift geschlossen. Spätere Anzahlungen anderer Empfänger bleiben unberührt.",
    "Авансовые счета по этому заказу выставлены другому получателю. При подтверждении этот финальный счёт закрывает именно эти авансы: оплаченное зачитывается, неоплаченный остаток закрывается кредит-нотой. Последующие авансы других получателей не затрагиваются.",
  ],
  credit_transfer_recipient_mismatch: [
    "Die Rechnungen haben unterschiedliche Rechnungsempfänger. Guthaben nur nach Bestätigung umbuchen.",
    "У счетов разные получатели. Перенести переплату можно только после подтверждения.",
  ],
  prepayment_recipient_mismatch: [
    "Die Anzahlungsrechnung ist an einen anderen Rechnungsempfänger adressiert. Das Geld eines Zahlers nur nach Bestätigung auf die Rechnung eines anderen anrechnen.",
    "Авансовый счёт выставлен другому получателю. Зачесть деньги одного плательщика в счёт другого можно только после подтверждения.",
  ],
  services_not_delivered: [
    "Die Rechnung enthält noch nicht erbrachte Leistungen. Auf der Rechnung steht dann „Leistung noch nicht erbracht (Abrechnung vor Leistungserbringung)“.",
    "В счёте есть ещё не оказанные услуги. В счёте будет указано «Leistung noch nicht erbracht (Abrechnung vor Leistungserbringung)» — услуги ещё не оказаны.",
  ],
  payment_exceeds_balance: [
    "Der Betrag übersteigt den offenen Betrag der Rechnung. Den Überschuss als Guthaben des Patienten bestätigen.",
    "Сумма больше остатка по счёту. Подтвердите излишек как переплату пациента.",
  ],
  credit_note_balance_rules: [
    "Die Gutschrift übersteigt den korrigierbaren Betrag der Rechnung.",
    "Кредит-нота превышает сумму, которую можно скорректировать по счёту.",
  ],
  credit_note_below_applied_advance: [
    "Diese Anzahlung ist in eine Schlussrechnung eingerechnet. Zuerst dort die angerechnete Vorauszahlung freigeben oder die Schlussrechnung per Gutschrift korrigieren.",
    "Этот аванс зачтён в финальный счёт. Сначала снимите зачёт в финальном счёте или скорректируйте финальный счёт кредит-нотой.",
  ],
  advance_not_settled_by_final_invoice: [
    "Noch keine ausgestellte Schlussrechnung rechnet diese Anzahlung ab.",
    "Этот аванс ещё не закрыт выпущенным финальным счётом.",
  ],
  advance_rest_already_closed: [
    "Die Anzahlungsrechnung hat keinen offenen Rest mehr.",
    "У авансового счёта больше нет открытого остатка.",
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
