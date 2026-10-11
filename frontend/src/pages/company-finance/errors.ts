/**
 * The company finance endpoints answer with English messages (`error`) or
 * machine codes; the page shows them in the user's language. Unknown texts
 * are shown as sent.
 */

import { formatMoneyAmount } from "@/lib/money";

type Pair = [de: string, ru: string];

const MESSAGES: Record<string, Pair> = {
  "insufficient permissions": [
    "Keine Berechtigung: Ihre Rolle kann den Unternehmenssaldo nur ansehen.",
    "Недостаточно прав: ваша роль может только просматривать «Баланс компании».",
  ],
  "account name is required": ["Bitte eine Bezeichnung angeben.", "Укажите название счёта."],
  "account adjustment cannot be reversed": [
    "Diese Abstimmungsbuchung kann nicht storniert werden.",
    "Эту операцию сверки нельзя сторнировать.",
  ],
  "account adjustment is invalid": [
    "Die Abstimmungsbuchung ist ungültig. Bitte Datum und Betrag prüfen.",
    "Операция сверки некорректна. Проверьте дату и сумму.",
  ],
  "account adjustment not found": [
    "Die Abstimmungsbuchung wurde nicht gefunden. Seite neu laden.",
    "Операция сверки не найдена. Обновите страницу.",
  ],
  "accounting entry not found": [
    "Die Geldbewegung wurde nicht gefunden. Seite neu laden.",
    "Денежная операция не найдена. Обновите страницу.",
  ],
  "adjustment date cannot be in the future": [
    "Das Datum darf nicht in der Zukunft liegen.",
    "Дата не может быть в будущем.",
  ],
  "adjustment reason is required": ["Bitte eine Begründung angeben.", "Укажите основание."],
  "amount must be greater than zero": [
    "Der Betrag muss größer als null sein.",
    "Сумма должна быть больше нуля.",
  ],
  "invalid amount": ["Bitte einen gültigen Betrag eingeben.", "Введите корректную сумму."],
  "choose another default account instead of removing the current default": [
    "Bitte zuerst ein anderes Konto als Standard festlegen.",
    "Сначала сделайте основным другой счёт.",
  ],
  "default account must remain active": [
    "Das Standardkonto muss aktiv bleiben.",
    "Счёт по умолчанию должен оставаться активным.",
  ],
  "financial account already exists or is invalid": [
    "Ein Konto mit diesen Daten existiert bereits oder die Angaben sind ungültig.",
    "Такой счёт уже есть или данные некорректны.",
  ],
  "financial account must be active and use the movement currency": [
    "Das Konto muss aktiv sein und die Währung der Bewegung haben.",
    "Счёт должен быть активным и в валюте операции.",
  ],
  "financial account not found": [
    "Das Konto wurde nicht gefunden. Seite neu laden.",
    "Счёт не найден. Обновите страницу.",
  ],
  "financial account update conflicts with existing data": [
    "Die Änderung widerspricht vorhandenen Buchungen.",
    "Изменение противоречит уже записанным операциям.",
  ],
  "internal transfer accounts must be active": [
    "Beide Konten müssen aktiv sein.",
    "Оба счёта должны быть активными.",
  ],
  "internal transfer cannot be reversed": [
    "Diese Umbuchung kann nicht (mehr) storniert werden.",
    "Этот перевод нельзя сторнировать (возможно, он уже сторнирован).",
  ],
  "internal transfer is invalid": [
    "Die Umbuchung ist ungültig. Bitte Konten, Datum und Betrag prüfen.",
    "Перевод некорректен. Проверьте счета, дату и сумму.",
  ],
  "internal transfer not found": [
    "Die Umbuchung wurde nicht gefunden. Seite neu laden.",
    "Перевод не найден. Обновите страницу.",
  ],
  "internal transfer reversal reason is required": [
    "Bitte einen Stornogrund angeben.",
    "Укажите причину сторно.",
  ],
  "internal transfers require matching currencies": [
    "Umbuchungen nur zwischen Konten derselben Währung.",
    "Переводить можно только между счетами в одной валюте.",
  ],
  "invalid account type": ["Ungültiger Kontotyp.", "Недопустимый тип счёта."],
  "unknown account type": ["Ungültiger Kontotyp.", "Недопустимый тип счёта."],
  "opening balance date cannot be in the future": [
    "Das Datum des Anfangsbestands darf nicht in der Zukunft liegen.",
    "Дата начального остатка не может быть в будущем.",
  ],
  "reversal cannot precede the transfer date": [
    "Das Storno darf nicht vor dem Datum der Umbuchung liegen.",
    "Сторно не может быть раньше даты перевода.",
  ],
  "reversal date cannot be in the future": [
    "Das Stornodatum darf nicht in der Zukunft liegen.",
    "Дата сторно не может быть в будущем.",
  ],
  "reversal reason is required": ["Bitte einen Stornogrund angeben.", "Укажите причину сторно."],
  "reverse and rebook the payment to correct its financial account": [
    "Das Konto einer stornierten Zahlung ist fest. Zahlung stornieren und neu erfassen.",
    "Счёт сторнированной оплаты изменить нельзя. Сторнируйте оплату и запишите заново.",
  ],
  "source and target accounts must differ": [
    "Quell- und Zielkonto müssen verschieden sein.",
    "Счета списания и зачисления должны различаться.",
  ],
  "this account already has movements; deactivate it instead of deleting": [
    "Das Konto hat bereits Buchungen. Bitte in der Bearbeitung deaktivieren statt löschen.",
    "По счёту уже есть операции. Отключите его в редактировании вместо удаления.",
  ],
  "transfer cannot precede an account opening date": [
    "Die Umbuchung darf nicht vor dem Anfangsdatum eines der Konten liegen.",
    "Перевод не может быть раньше даты начального остатка счёта.",
  ],
  "transfer date cannot be in the future": [
    "Das Datum der Umbuchung darf nicht in der Zukunft liegen.",
    "Дата перевода не может быть в будущем.",
  ],
  "value is too long": ["Ein Eingabewert ist zu lang.", "Одно из значений слишком длинное."],
};

function errorBody(error: unknown): Record<string, unknown> | null {
  if (error && typeof error === "object" && "body" in error) {
    const body = (error as { body?: unknown }).body;
    if (body && typeof body === "object") return body as Record<string, unknown>;
  }
  return null;
}

/** Machine code of an error answer (`error` field), lower case. */
export function companyFinanceErrorCode(error: unknown): string {
  const body = errorBody(error);
  const code = body?.error;
  return typeof code === "string" ? code : "";
}

/** The account balance an error answer names, as a number. */
export function companyFinanceErrorBalance(
  error: unknown,
  field: "available_balance" | "balance_after" = "available_balance",
): number | null {
  const value = errorBody(error)?.[field];
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function localizeCompanyFinanceError(
  error: unknown,
  lang: string,
  fallback: string,
  currency = "EUR",
): string {
  const de = lang === "de";
  const code = companyFinanceErrorCode(error);
  if (code === "cash_account_insufficient_balance") {
    const available = companyFinanceErrorBalance(error);
    const amount = available === null ? "" : ` ${formatMoneyAmount(available, currency)}`;
    return de
      ? `Eine Kasse kann nicht ins Minus gehen. Verfügbar:${amount || " –"}.`
      : `Касса не может уйти в минус. Доступно:${amount || " –"}.`;
  }
  if (code === "account_negative_balance_confirmation_required") {
    const after = companyFinanceErrorBalance(error, "balance_after");
    const amount = after === null ? "" : ` (${formatMoneyAmount(after, currency)})`;
    return de
      ? `Das Konto geht damit ins Minus${amount}. Bitte bestätigen.`
      : `После перевода счёт уйдёт в минус${amount}. Подтвердите перевод.`;
  }
  const status = error && typeof error === "object" && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
  const message = (error instanceof Error ? error.message : code).trim();
  const known = MESSAGES[message.toLowerCase()] ?? (status === 403 ? MESSAGES["insufficient permissions"] : undefined);
  if (known) return de ? known[0] : known[1];
  return message || fallback;
}
