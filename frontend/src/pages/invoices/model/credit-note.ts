import { roundCents, toCents } from "@/lib/money";

import type { InvoiceCreditableLine } from "./types";

/**
 * Credit-note form: staff credit selected invoice lines (each in full or with
 * a gross amount) or an amount within one VAT rate. VAT follows the credited
 * lines, so a 0 % pass-through line credits no VAT. Mirrors the server plan in
 * `crates/server/src/routes/invoices/credit_notes.rs`.
 */
export type CreditNoteMode = "lines" | "vat_rate";

export type CreditNoteLineDraft = {
  selected: boolean;
  /** Gross amount to credit; empty = what is left of the line. */
  amount: string;
};

export type CreditNoteSelectionDraft = {
  mode: CreditNoteMode;
  lines: Record<number, CreditNoteLineDraft>;
  vatRate: string;
  amountGross: string;
};

export type CreditNoteSelectionError =
  | "nothing_selected"
  | "invalid_amount"
  | "line_exceeded"
  | "vat_rate_missing"
  | "vat_rate_exceeded";

function amount(value: unknown): number {
  const numeric = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function remaining(line: InvoiceCreditableLine) {
  const value = amount(line.remaining_gross);
  return Number.isFinite(value) ? value : 0;
}

/** VAT rate as the server compares it ("19.00" → "19"). */
export function normalizeVatRate(value: unknown) {
  const numeric = amount(value);
  return Number.isFinite(numeric) ? String(roundCents(numeric)) : "";
}

export function openCreditableLines(lines: readonly InvoiceCreditableLine[] | undefined) {
  return (lines ?? []).filter((line) => toCents(remaining(line)) > 0);
}

/** Open VAT rates with what can still be credited in each, ascending. */
export function creditableVatRates(lines: readonly InvoiceCreditableLine[] | undefined) {
  const byRate = new Map<string, number>();
  for (const line of openCreditableLines(lines)) {
    const rate = normalizeVatRate(line.vat_rate);
    byRate.set(rate, roundCents((byRate.get(rate) ?? 0) + remaining(line)));
  }
  return [...byRate.entries()]
    .map(([rate, remainingGross]) => ({ rate, remainingGross }))
    .sort((left, right) => Number(left.rate) - Number(right.rate));
}

export function emptyCreditNoteSelection(
  lines: readonly InvoiceCreditableLine[] | undefined,
): CreditNoteSelectionDraft {
  const rates = creditableVatRates(lines);
  return {
    mode: "lines",
    lines: {},
    vatRate: rates.length === 1 ? rates[0].rate : "",
    amountGross: "",
  };
}

/** Gross amount a selected line credits: its entered amount or what is left. */
export function selectedLineAmount(line: InvoiceCreditableLine, draft: CreditNoteLineDraft) {
  return draft.amount.trim() === "" ? remaining(line) : amount(draft.amount);
}

function lineVatShare(line: InvoiceCreditableLine, gross: number) {
  const open = remaining(line);
  const openVat = amount(line.remaining_vat ?? line.line_vat);
  if (!Number.isFinite(openVat) || open <= 0) return 0;
  if (toCents(gross) === toCents(open)) return roundCents(openVat);
  return Math.min(roundCents((gross * openVat) / open), gross);
}

export type CreditNotePreview = {
  gross: number;
  vat: number;
  net: number;
  error: CreditNoteSelectionError | null;
};

/**
 * Totals the server will book for the draft, and why it cannot be sent yet.
 * VAT-rate credits are previewed with the rate's gross-to-VAT ratio; the
 * server spreads them over the rate's lines and may differ by a cent.
 */
export function previewCreditNote(
  lines: readonly InvoiceCreditableLine[] | undefined,
  draft: CreditNoteSelectionDraft,
): CreditNotePreview {
  const all = lines ?? [];
  if (draft.mode === "vat_rate") {
    const rate = creditableVatRates(all).find((entry) => entry.rate === draft.vatRate);
    const gross = amount(draft.amountGross);
    if (!rate) return { gross: 0, vat: 0, net: 0, error: "vat_rate_missing" };
    if (!Number.isFinite(gross) || toCents(gross) <= 0) {
      return { gross: 0, vat: 0, net: 0, error: "invalid_amount" };
    }
    const rateLines = openCreditableLines(all).filter(
      (line) => normalizeVatRate(line.vat_rate) === rate.rate,
    );
    const openVat = rateLines.reduce(
      (sum, line) => sum + amount(line.remaining_vat ?? line.line_vat),
      0,
    );
    const vat = rate.remainingGross > 0 ? roundCents((gross * openVat) / rate.remainingGross) : 0;
    return {
      gross: roundCents(gross),
      vat,
      net: roundCents(gross - vat),
      error: toCents(gross) > toCents(rate.remainingGross) ? "vat_rate_exceeded" : null,
    };
  }

  let gross = 0;
  let vat = 0;
  let selected = 0;
  let error: CreditNoteSelectionError | null = null;
  for (const line of all) {
    const lineDraft = draft.lines[line.line_index];
    if (!lineDraft?.selected) continue;
    selected += 1;
    const lineGross = selectedLineAmount(line, lineDraft);
    if (!Number.isFinite(lineGross) || toCents(lineGross) <= 0) {
      error ??= "invalid_amount";
      continue;
    }
    if (toCents(lineGross) > toCents(remaining(line))) {
      error ??= "line_exceeded";
      continue;
    }
    gross += lineGross;
    vat += lineVatShare(line, lineGross);
  }
  if (selected === 0) error = "nothing_selected";
  gross = roundCents(gross);
  vat = roundCents(vat);
  return { gross, vat, net: roundCents(gross - vat), error };
}

/** Request body fields selecting what to credit. */
export function creditNoteSelectionPayload(
  lines: readonly InvoiceCreditableLine[] | undefined,
  draft: CreditNoteSelectionDraft,
): Record<string, unknown> {
  if (draft.mode === "vat_rate") {
    return {
      vat_rate: draft.vatRate,
      amount_gross: roundCents(amount(draft.amountGross)).toFixed(2),
    };
  }
  return {
    lines: (lines ?? [])
      .filter((line) => draft.lines[line.line_index]?.selected)
      .map((line) => {
        const lineDraft = draft.lines[line.line_index];
        const gross = selectedLineAmount(line, lineDraft);
        // Crediting what is left of a line sends no amount, so the server
        // credits the line exactly (and prints its quantity when whole).
        return toCents(gross) === toCents(remaining(line))
          ? { line_index: line.line_index }
          : { line_index: line.line_index, amount_gross: roundCents(gross).toFixed(2) };
      }),
  };
}
