/** What changed since the accepted estimate was signed (server `load_estimate_outdated`). */
export type EstimateOutdatedReason = "lines" | "vat" | "prepayment" | "contracting_party";

export type EstimateOutdatedGate = {
  quote_number: string;
  quote_total_gross: string;
  order_total_gross: string | null;
  reasons?: EstimateOutdatedReason[] | null;
};

const REASON_TEXT: Record<EstimateOutdatedReason, { ru: string; de: string }> = {
  lines: {
    ru: "изменились позиции заказа, их количество или цены",
    de: "Positionen, Mengen oder Preise des Auftrags wurden geändert",
  },
  vat: {
    ru: "изменилась ставка НДС позиции",
    de: "der MwSt.-Satz einer Position wurde geändert",
  },
  prepayment: {
    ru: "изменились условия предоплаты",
    de: "die Vorauszahlungsbedingungen wurden geändert",
  },
  contracting_party: {
    ru: "сменилась сторона договора",
    de: "die Vertragspartei wurde geändert",
  },
};

function sameAmount(left: string, right: string | null): boolean {
  if (right === null) return true;
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) < 0.005 : left === right;
}

/**
 * The outdated-estimate blocker (QA 2026-11-11, B-17): names what changed
 * instead of only the two sums, which are equal when only the VAT split, the
 * prepayment or the contracting party changed. The order sum is shown only
 * when it differs from the estimate.
 */
export function estimateOutdatedMessage(
  gate: EstimateOutdatedGate,
  lang: "de" | "ru",
  formatMoney: (value: string) => string,
): string {
  const reasons = (gate.reasons ?? []).filter((reason) => reason in REASON_TEXT);
  const what = reasons.map((reason) => REASON_TEXT[reason][lang]).join("; ");
  const orderTotal =
    gate.order_total_gross && !sameAmount(gate.quote_total_gross, gate.order_total_gross)
      ? formatMoney(gate.order_total_gross)
      : null;
  const quote = `${gate.quote_number} (${formatMoney(gate.quote_total_gross)})`;
  if (lang === "de") {
    return `Der angenommene Kostenvoranschlag ${quote} entspricht nicht mehr dem Auftrag${what ? `: ${what}` : ""}${orderTotal ? ` (Auftragssumme jetzt ${orderTotal})` : ""}. Bitte ein neues Angebot erstellen und den neuen Kostenvoranschlag unterschreiben lassen.`;
  }
  return `Принятая смета ${quote} устарела: ${what || "она не совпадает с заказом"}${orderTotal ? ` (сумма заказа сейчас ${orderTotal})` : ""}. Создайте новое предложение и получите подпись новой сметы.`;
}
