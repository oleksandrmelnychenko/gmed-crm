/**
 * Texts of the "add service" dialog of an order (QA 2026-11-10, D-07 and
 * D-08): each refusal names its own rule — a negative price is not "must be
 * a number" — and the server's English messages are shown in the UI language.
 */

import { parseMoneyInput } from "@/lib/money";

function tx(lang: string, ru: string, de: string) {
  return lang === "de" ? de : ru;
}

/** Why the typed unit price is refused, or null when it can be sent. */
export function leistungUnitPriceProblem(raw: string, lang: string): string | null {
  const typed = raw.trim().replace(/\s/gu, "");
  if (!typed) {
    return tx(lang, "Укажите цену за единицу.", "Bitte den Einzelpreis angeben.");
  }
  const negative = tx(
    lang,
    "Цена за единицу не может быть отрицательной.",
    "Der Einzelpreis darf nicht negativ sein.",
  );
  // What the money parser takes ("95", "333,33", "1.250,00") is a number.
  const price = parseMoneyInput(raw);
  if (Number.isFinite(price)) return price < 0 ? negative : null;
  if (/^-\d/u.test(typed)) return negative;
  if (/^\d+[.,]\d{3,}$/u.test(typed)) {
    return tx(
      lang,
      "Цена за единицу указывается не более чем с двумя знаками после запятой.",
      "Der Einzelpreis hat höchstens zwei Nachkommastellen.",
    );
  }
  return tx(lang, "Цена за единицу должна быть числом.", "Einzelpreis muss numerisch sein.");
}

/** Why the typed VAT rate is refused, or null when it can be sent. */
export function leistungVatRateProblem(raw: string, lang: string): string | null {
  const typed = raw.trim();
  const rate = Number(typed.replace(",", "."));
  if (!typed || !Number.isFinite(rate)) {
    return tx(lang, "Ставка НДС должна быть числом.", "Der USt.-Satz muss numerisch sein.");
  }
  if (rate < 0 || rate > 100) {
    return tx(
      lang,
      "Ставка НДС должна быть от 0 до 100 %.",
      "Der USt.-Satz muss zwischen 0 und 100 % liegen.",
    );
  }
  return null;
}

const SERVER_MESSAGES: Record<string, [ru: string, de: string]> = {
  "service quantity must be greater than zero": [
    "Количество должно быть больше нуля.",
    "Die Menge muss größer als null sein.",
  ],
  "service unit price cannot be negative": [
    "Цена за единицу не может быть отрицательной.",
    "Der Einzelpreis darf nicht negativ sein.",
  ],
  "service vat rate must be between 0 and 100": [
    "Ставка НДС должна быть от 0 до 100 %.",
    "Der USt.-Satz muss zwischen 0 und 100 % liegen.",
  ],
  "service quantity is below the supported precision": [
    "Количество слишком мало: допускается не более четырёх знаков после запятой.",
    "Die Menge ist zu klein: höchstens vier Nachkommastellen sind möglich.",
  ],
  "service quantity or price is outside the supported amount range": [
    "Количество или цена слишком велики: сумма позиции выходит за допустимый предел.",
    "Menge oder Preis sind zu groß: Der Betrag der Position liegt über dem zulässigen Höchstwert.",
  ],
};

/**
 * The server's refusal of a service line in the UI language; any other
 * message is shown as sent.
 */
export function localizeLeistungServerError(message: string, lang: string): string {
  const known = SERVER_MESSAGES[message.trim().replace(/\.$/u, "").toLowerCase()];
  return known ? tx(lang, known[0], known[1]) : message;
}
