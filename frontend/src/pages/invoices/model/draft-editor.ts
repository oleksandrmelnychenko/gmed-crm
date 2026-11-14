/**
 * The editor of a draft invoice (owner 2026-11-14): due date and printed
 * remark always; the lines when the draft was made from quote positions
 * (quantities within what the quote still has open, the draft's own
 * quantities included); the split of a prepayment advance over the quote's
 * VAT groups (own services first by default, or by hand). The server
 * (`PUT /invoices/{id}/draft`) checks everything again.
 */

import { normalizeMoneyInput, parseMoneyInput, roundCents, sameCents, toCents } from "@/lib/money";

export type DraftEditorQuoteLine = {
  line_index: number;
  description: string;
  unit: string | null;
  unit_price: string | null;
  vat_rate: string | null;
  is_cost_passthrough: boolean;
  quoted_quantity: string;
  open_quantity: string;
  selected_quantity: string | null;
  comment: string | null;
};

export type DraftEditorAdvanceGroup = {
  is_cost_passthrough: boolean;
  vat_rate: string;
  open_gross: string;
  amount_gross: string;
};

export type DraftEditorPayload = {
  invoice_id: string;
  invoice_type: string;
  due_date: string | null;
  notes: string | null;
  lines_mode: "quote_positions" | "advance_split" | "locked";
  lines_locked_reason: string | null;
  quote_lines: DraftEditorQuoteLine[];
  advance: {
    amount_gross: string;
    allocation: "manual" | "own_services_first";
    default_split: string[];
    groups: DraftEditorAdvanceGroup[];
  } | null;
};

export type DraftLineForm = { selected: boolean; quantity: string; comment: string };

export type DraftForm = {
  dueDate: string;
  notes: string;
  lines: Record<number, DraftLineForm>;
  /** Gross per advance group, as typed ("119,00"), in the order of `advance.groups`. */
  split: string[];
};

function quantityText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const amount = Number(value);
  return Number.isFinite(amount) ? String(amount).replace(".", ",") : value;
}

function amountText(value: string | null | undefined): string {
  const amount = Number(value ?? "");
  return Number.isFinite(amount) ? amount.toFixed(2).replace(".", ",") : "";
}

export function draftFormFrom(payload: DraftEditorPayload): DraftForm {
  const lines: Record<number, DraftLineForm> = {};
  for (const line of payload.quote_lines) {
    lines[line.line_index] = {
      selected: line.selected_quantity !== null,
      quantity: quantityText(line.selected_quantity ?? line.open_quantity),
      comment: line.comment ?? "",
    };
  }
  return {
    dueDate: payload.due_date ?? "",
    notes: payload.notes ?? "",
    lines,
    split: (payload.advance?.groups ?? []).map((group) => amountText(group.amount_gross)),
  };
}

/** The default split (own services first) as typed amounts. */
export function defaultSplitForm(payload: DraftEditorPayload): string[] {
  return (payload.advance?.default_split ?? []).map((value) => amountText(value));
}

function readQuantity(value: string): number {
  return parseMoneyInput(value);
}

export type DraftLinesProblem = "no_line" | "quantity_invalid" | "quantity_over_open";

/** Why the chosen lines cannot be saved; null when they can. */
export function draftLinesProblem(payload: DraftEditorPayload, form: DraftForm): DraftLinesProblem | null {
  if (payload.lines_mode !== "quote_positions") return null;
  const chosen = payload.quote_lines.filter((line) => form.lines[line.line_index]?.selected);
  if (chosen.length === 0) return "no_line";
  for (const line of chosen) {
    const quantity = readQuantity(form.lines[line.line_index]?.quantity ?? "");
    if (!Number.isFinite(quantity) || quantity <= 0) return "quantity_invalid";
    if (toCents(quantity) > toCents(Number(line.open_quantity))) return "quantity_over_open";
  }
  return null;
}

/** Whether the chosen lines differ from what the draft bills now. */
export function draftLinesChanged(payload: DraftEditorPayload, form: DraftForm): boolean {
  if (payload.lines_mode !== "quote_positions") return false;
  return payload.quote_lines.some((line) => {
    const entry = form.lines[line.line_index];
    const wasSelected = line.selected_quantity !== null;
    if (!entry) return false;
    if (entry.selected !== wasSelected) return true;
    if (!entry.selected) return false;
    if (!sameCents(readQuantity(entry.quantity), Number(line.selected_quantity))) return true;
    return entry.comment.trim() !== (line.comment ?? "").trim();
  });
}

export type SplitRow = { net: number; vat: number; gross: number };

/** Net and VAT of a gross share, worked back like the server (`line_amounts_for_gross`). */
export function amountsForGross(gross: number, vatRatePercent: number): SplitRow {
  const rounded = roundCents(gross);
  const net = roundCents(rounded / (1 + vatRatePercent / 100));
  return { net, vat: roundCents(rounded - net), gross: rounded };
}

export type SplitPreview = { rows: SplitRow[]; total: SplitRow; difference: number };

/** Net, VAT and gross of every typed share, their sum and how far it is from the advance amount. */
export function advanceSplitPreview(payload: DraftEditorPayload, split: string[]): SplitPreview {
  const groups = payload.advance?.groups ?? [];
  const rows = groups.map((group, index) => {
    const gross = parseMoneyInput(split[index] ?? "");
    const rate = group.is_cost_passthrough ? 0 : Number(group.vat_rate);
    return amountsForGross(Number.isFinite(gross) ? gross : 0, rate);
  });
  const total = rows.reduce(
    (sum, row) => ({
      net: roundCents(sum.net + row.net),
      vat: roundCents(sum.vat + row.vat),
      gross: roundCents(sum.gross + row.gross),
    }),
    { net: 0, vat: 0, gross: 0 },
  );
  const amount = Number(payload.advance?.amount_gross ?? 0);
  return { rows, total, difference: roundCents(amount - total.gross) };
}

export type AdvanceSplitProblem = "unreadable" | "negative" | "over_open" | "sum_mismatch";

export function advanceSplitProblem(payload: DraftEditorPayload, split: string[]): AdvanceSplitProblem | null {
  if (payload.lines_mode !== "advance_split" || !payload.advance) return null;
  for (const [index, group] of payload.advance.groups.entries()) {
    const typed = split[index] ?? "";
    if (typed.trim() === "") continue;
    const gross = parseMoneyInput(typed);
    if (!Number.isFinite(gross)) return "unreadable";
    if (gross < 0) return "negative";
    if (toCents(gross) > toCents(Number(group.open_gross))) return "over_open";
  }
  return advanceSplitPreview(payload, split).difference === 0 ? null : "sum_mismatch";
}

export function advanceSplitChanged(payload: DraftEditorPayload, split: string[]): boolean {
  if (payload.lines_mode !== "advance_split" || !payload.advance) return false;
  return payload.advance.groups.some((group, index) => {
    const typed = parseMoneyInput(split[index] ?? "");
    return !sameCents(Number.isFinite(typed) ? typed : 0, Number(group.amount_gross));
  });
}

/** The body of `PUT /invoices/{id}/draft`: the header always, lines or split only when changed. */
export function draftUpdatePayload(payload: DraftEditorPayload, form: DraftForm): Record<string, unknown> {
  const body: Record<string, unknown> = {
    due_date: form.dueDate || null,
    notes: form.notes.trim() || null,
  };
  if (draftLinesChanged(payload, form)) {
    body.line_items = payload.quote_lines
      .filter((line) => form.lines[line.line_index]?.selected)
      .map((line) => {
        const entry = form.lines[line.line_index];
        return {
          line_index: line.line_index,
          quantity: normalizeMoneyInput(entry.quantity) ?? entry.quantity,
          comment: entry.comment.trim() || null,
        };
      });
  }
  if (advanceSplitChanged(payload, form.split) && payload.advance) {
    body.advance_split = payload.advance.groups.map((group, index) => ({
      is_cost_passthrough: group.is_cost_passthrough,
      vat_rate: group.vat_rate,
      amount_gross: normalizeMoneyInput(form.split[index] ?? "") ?? "0",
    }));
  }
  return body;
}

/** Whether anything in the editor differs from the stored draft. */
export function draftFormDirty(payload: DraftEditorPayload, form: DraftForm): boolean {
  return (
    form.dueDate !== (payload.due_date ?? "") ||
    form.notes.trim() !== (payload.notes ?? "").trim() ||
    draftLinesChanged(payload, form) ||
    advanceSplitChanged(payload, form.split)
  );
}
