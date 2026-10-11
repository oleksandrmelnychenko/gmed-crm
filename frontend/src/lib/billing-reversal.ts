import { ApiRequestError } from "@/lib/api";
import { formatMoneyAmount } from "@/lib/money";

/**
 * Cancelling a service whose billing is in force (owner decision
 * 2026-09-29): an approved line no released invoice bills is cancelled; a
 * line on a released invoice is cancelled together with a credit note
 * (CEO / billing); a line on a draft invoice waits until the draft is
 * cancelled. The server answers what a cancellation would do with a preview.
 */

type Bilingual = (ru: string, de: string) => string;

export const BILLING_REVERSAL_REASON_MIN = 3;
export const BILLING_REVERSAL_REASON_MAX = 1000;

export type BillingReversalCreditPreview = {
  invoice_id: string;
  invoice_number: string | null;
  line_indexes: number[];
  amount_gross: string;
  currency: string;
};

export type BillingReversalBlockedReason =
  | "order_service_already_cancelled"
  | "order_service_on_draft_invoice"
  | "order_service_invoice_line_unknown";

export type BillingReversalPreview = {
  order_leistung_id: string;
  order_id: string;
  status: string;
  description: string;
  quantity: string;
  line_gross: string;
  currency: string;
  draft_invoice_ids: string[];
  requires_credit_note: boolean;
  credit_total_gross: string;
  /** Advance money credited into the invoice that the credit note releases (refundable). */
  prepayment_released_gross?: string;
  /** Re-billed supplier costs the credit note unbills. */
  supplier_cost_released_gross?: string;
  credit_notes: BillingReversalCreditPreview[];
  blocked_reason: BillingReversalBlockedReason | null;
  can_issue_credit_note?: boolean;
  order_number?: string | null;
  same_order?: boolean;
};

export type IssuedCreditNote = {
  credit_note_transaction_id: string;
  document_number: string;
  invoice_id: string;
  invoice_number: string | null;
  amount_gross: string;
  currency: string;
};

/** Counts characters like the server: Unicode scalars of the trimmed text. */
export function isValidBillingReversalReason(reason: string) {
  const length = Array.from(reason.trim()).length;
  return length >= BILLING_REVERSAL_REASON_MIN && length <= BILLING_REVERSAL_REASON_MAX;
}

export function billingReversalReasonHint(tx: Bilingual) {
  return tx(
    `Укажите причину (${BILLING_REVERSAL_REASON_MIN}–${BILLING_REVERSAL_REASON_MAX} символов).`,
    `Bitte einen Grund angeben (${BILLING_REVERSAL_REASON_MIN}–${BILLING_REVERSAL_REASON_MAX} Zeichen).`,
  );
}

function invoiceNumbers(preview: Pick<BillingReversalPreview, "credit_notes">) {
  return preview.credit_notes
    .map((credit) => credit.invoice_number?.trim())
    .filter(Boolean)
    .join(", ");
}

/** Why the service cannot be cancelled now; `null` when it can. */
export function billingReversalBlockedMessage(
  preview: Pick<BillingReversalPreview, "blocked_reason">,
  tx: Bilingual,
): string | null {
  switch (preview.blocked_reason) {
    case "order_service_already_cancelled":
      return tx("Услуга уже отменена.", "Die Leistung ist bereits storniert.");
    case "order_service_on_draft_invoice":
      return tx(
        "Услуга входит в черновик счёта. Позиции черновика не редактируются: сначала отмените черновик, затем услугу.",
        "Die Leistung steht in einem Rechnungsentwurf. Entwurfspositionen sind nicht änderbar: zuerst den Entwurf stornieren, dann die Leistung.",
      );
    case "order_service_invoice_line_unknown":
      return tx(
        "Услуга выставлена в счёте, но строка счёта не указывает на неё. Исправьте счёт кредит-нотой на странице счетов.",
        "Die Leistung ist abgerechnet, aber keine Rechnungszeile verweist auf sie. Bitte die Rechnung auf der Rechnungsseite per Gutschrift korrigieren.",
      );
    default:
      return null;
  }
}

/** What confirming the cancellation does, for the confirm dialogs. */
export function billingReversalEffect(preview: BillingReversalPreview, tx: Bilingual): string {
  if (preview.requires_credit_note) {
    const amount = formatMoneyAmount(preview.credit_total_gross, preview.currency);
    const invoices = invoiceNumbers(preview) || "—";
    const base = tx(
      `Услуга уже в выпущенном счёте (${invoices}). Будет выставлена кредит-нота на ${amount}, затем услуга будет отменена. Выпущенный счёт не меняется.`,
      `Die Leistung steht in einer ausgestellten Rechnung (${invoices}). Es wird eine Gutschrift über ${amount} ausgestellt und die Leistung storniert. Die ausgestellte Rechnung bleibt unverändert.`,
    );
    // The patient prepaid more than the corrected invoice keeps (QA D-63).
    const released = Number(preview.prepayment_released_gross ?? 0);
    const prepaymentNote =
      released > 0
        ? ` ${tx(
            `Зачтённая предоплата уменьшится на ${formatMoneyAmount(released, preview.currency)}: эта сумма аванса будет закрыта кредит-нотой и станет переплатой пациента (к возврату).`,
            `Die angerechnete Vorauszahlung sinkt um ${formatMoneyAmount(released, preview.currency)}: Dieser Teil der Anzahlung wird per Gutschrift geschlossen und ist erstattbares Guthaben des Patienten.`,
          )}`
        : "";
    const supplier = Number(preview.supplier_cost_released_gross ?? 0);
    const supplierNote =
      supplier > 0
        ? ` ${tx(
            `Перевыставленные расходы на ${formatMoneyAmount(supplier, preview.currency)} снова станут невыставленными.`,
            `Weiterberechnete Kosten über ${formatMoneyAmount(supplier, preview.currency)} gelten wieder als nicht berechnet.`,
          )}`
        : "";
    return `${base}${prepaymentNote}${supplierNote}`;
  }
  return tx(
    "Счёт на услугу ещё не выпущен: утверждённая услуга будет отменена без кредит-ноты.",
    "Die Leistung ist noch nicht abgerechnet: Sie wird ohne Gutschrift storniert.",
  );
}

/** Only the CEO and billing issue credit notes. */
export function billingReversalNeedsFinanceRole(
  preview: Pick<BillingReversalPreview, "requires_credit_note">,
  canIssueCreditNote: boolean,
) {
  return preview.requires_credit_note && !canIssueCreditNote;
}

export function billingReversalFinanceHint(tx: Bilingual) {
  return tx(
    "Кредит-ноту выставляют только CEO и бухгалтерия (Billing).",
    "Gutschriften stellen nur CEO und Buchhaltung (Billing) aus.",
  );
}

/** "CN-2026-000012 (119,00 €)" for each credit note a cancellation issued. */
export function issuedCreditNotesText(creditNotes: readonly IssuedCreditNote[]) {
  return creditNotes
    .map(
      (credit) =>
        `${credit.document_number} (${formatMoneyAmount(credit.amount_gross, credit.currency)})`,
    )
    .join(", ");
}

export function billingReversalSuccessMessage(
  creditNotes: readonly IssuedCreditNote[],
  tx: Bilingual,
) {
  if (creditNotes.length === 0) {
    return tx("Услуга отменена.", "Leistung storniert.");
  }
  const text = issuedCreditNotesText(creditNotes);
  return tx(
    `Услуга отменена, выставлена кредит-нота ${text}.`,
    `Leistung storniert, Gutschrift ${text} ausgestellt.`,
  );
}

const LOCALIZED_TRANSPORT_CODES = new Set(["aborted", "network", "timeout", "rate_limited"]);

/** Localized refusals of a cancellation with billing reversal. */
export function billingReversalErrorMessage(error: unknown, tx: Bilingual): string {
  if (error instanceof ApiRequestError) {
    const code = typeof error.body?.code === "string" ? error.body.code : "";
    const blocked = billingReversalBlockedMessage(
      { blocked_reason: code as BillingReversalBlockedReason },
      tx,
    );
    if (blocked) return blocked;
    switch (code) {
      case "order_service_reversal_requires_finance":
        return billingReversalFinanceHint(tx);
      case "order_service_cancel_requires_credit_note":
        return tx(
          "Услуга в выпущенном счёте: подтвердите выставление кредит-ноты.",
          "Die Leistung ist abgerechnet: Bitte die Gutschrift bestätigen.",
        );
      case "concierge_service_not_billed":
        return tx(
          "Счёт на сервис не выставлен — отмените его обычным способом.",
          "Der Service ist nicht abgerechnet – bitte wie gewohnt stornieren.",
        );
      default:
        break;
    }
    // Refusals of the credit note itself carry their code in `error`.
    const creditCode = typeof error.body?.error === "string" ? error.body.error : "";
    if (creditCode === "credit_note_balance_rules") {
      return tx(
        "Кредит-нота превышает сумму, которую можно скорректировать по счёту. Обновите данные и проверьте счёт.",
        "Die Gutschrift übersteigt den korrigierbaren Betrag der Rechnung. Bitte neu laden und die Rechnung prüfen.",
      );
    }
    if (creditCode === "credit_note_below_applied_advance") {
      return tx(
        "Аванс уже зачтён в финальный счёт: сначала скорректируйте финальный счёт.",
        "Die Anzahlung ist in die Schlussrechnung eingerechnet: zuerst die Schlussrechnung korrigieren.",
      );
    }
    if (error.status === 422) return billingReversalReasonHint(tx);
    if (error.status === 403) {
      return tx("Недостаточно прав для этой отмены.", "Keine Berechtigung für diese Stornierung.");
    }
    if (error.code && LOCALIZED_TRANSPORT_CODES.has(error.code) && error.message.trim()) {
      return error.message;
    }
  }
  return tx("Не удалось выполнить отмену.", "Die Stornierung ist fehlgeschlagen.");
}
