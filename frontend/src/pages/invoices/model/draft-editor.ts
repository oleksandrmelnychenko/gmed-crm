/**
 * The editor of a draft invoice (owner 2026-11-14): due date and printed
 * remark always; the lines when the draft was made from quote positions
 * (quantities within what the quote still has open, the draft's own
 * quantities included); the split of a prepayment advance over the quote's
 * VAT groups (own services first by default, or by hand). The server
 * (`PUT /invoices/{id}/draft`) checks everything again.
 */

import { moneyFinalLinePartAmounts, moneyLineAmounts, moneyLinePartAmounts, normalizeMoneyInput, parseMoneyInput, roundCents, sameCents, toCents } from "@/lib/money";

import {
  receivedPaymentFormFrom,
  receivedPaymentPayload,
  samePeriod,
  sameReceivedPayment,
  servicePeriodPayload,
  type ReceivedPaymentForm,
  type ReceivedPaymentPayload,
  type ServicePeriodForm,
  type ServicePeriodPayload,
} from "./document-terms";

export type DraftEditorQuoteLine = {
  line_index: number;
  description: string;
  unit: string | null;
  unit_price: string | null;
  vat_rate: string | null;
  /** Discount in percent of the quote line (owner 2026-11-18). */
  discount_percent?: string | null;
  is_cost_passthrough: boolean;
  quoted_quantity: string;
  open_quantity: string;
  /** What other invoices bill of the line already (quantity, net, gross). */
  billed_quantity?: string;
  billed_net?: string;
  billed_gross?: string;
  /** The whole quote line's net and gross. */
  line_net?: string;
  line_gross?: string;
  selected_quantity: string | null;
  comment: string | null;
  /** False on a final invoice: it bills the delivered quantity, above the quote too (owner 2026-11-17). */
  quantity_capped?: boolean;
  delivery_basis?: "actual" | "estimate";
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
  /** Days a release without a due date adds to the invoice date. */
  payment_term_days?: number;
  /** Money noted as received before the invoice. */
  payment_received?: ReceivedPaymentPayload | null;
  /** Service period set by staff; null = the default below. */
  service_period?: ServicePeriodPayload | null;
  /** The period of the lines and the order. */
  service_period_default?: { from: string; to: string } | null;
  quote_lines: DraftEditorQuoteLine[];
  /** Final drafts: delivered services outside the quote (kept unless sent). */
  order_service_lines?: {
    order_leistung_id: string;
    selected_quantity: string | null;
    discount_percent?: string | null;
    description?: string;
    unit_price?: string;
    vat_rate?: string;
    is_cost_passthrough?: boolean;
    unit?: string | null;
    quote_line_index?: number | null;
    comment?: string | null;
  }[];
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
  receivedPayment: ReceivedPaymentForm;
  servicePeriod: ServicePeriodForm;
  /** Final drafts: remarks of the kept services outside the estimate, by order service id. */
  serviceComments?: Record<string, string>;
};

function storedPeriod(payload: DraftEditorPayload): ServicePeriodForm {
  return { from: payload.service_period?.from ?? "", to: payload.service_period?.to ?? "" };
}

/** The period the release prints without one set by staff. */
export function draftPeriodDefault(payload: DraftEditorPayload): ServicePeriodForm {
  return { from: payload.service_period_default?.from ?? "", to: payload.service_period_default?.to ?? "" };
}

/** The period shown: the one set by staff, else the default. */
function shownPeriod(payload: DraftEditorPayload): ServicePeriodForm {
  return payload.service_period ? storedPeriod(payload) : draftPeriodDefault(payload);
}

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
    receivedPayment: receivedPaymentFormFrom(payload.payment_received),
    servicePeriod: shownPeriod(payload),
    serviceComments: Object.fromEntries((payload.order_service_lines ?? []).map((service) => [service.order_leistung_id, service.comment ?? ""])),
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
  const keptServices = (payload.order_service_lines ?? []).some((line) => line.selected_quantity !== null);
  if (chosen.length === 0 && !keptServices) return "no_line";
  for (const line of chosen) {
    const quantity = readQuantity(form.lines[line.line_index]?.quantity ?? "");
    if (!Number.isFinite(quantity) || quantity <= 0) return "quantity_invalid";
    if (line.quantity_capped !== false && toCents(quantity) > toCents(Number(line.open_quantity))) return "quantity_over_open";
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

/**
 * One part of a quote line the way the server bills it
 * (`money::line_part_amounts`): the part completing the line takes exactly
 * what is left of the line total; any other part is rounded on its own,
 * never above that rest (QA 2026-11-15, A-1).
 */
export function linePartAmounts(line: DraftEditorQuoteLine, quantity: number): SplitRow {
  return (line.quantity_capped === false ? moneyFinalLinePartAmounts : moneyLinePartAmounts)({
    quantity,
    unitPriceNet: Number(line.unit_price ?? 0),
    vatRatePercent: Number(line.vat_rate ?? 0),
    discountPercent: Number(line.discount_percent ?? 0),
    lineQuantity: Number(line.quoted_quantity),
    billedQuantity: Number(line.billed_quantity ?? 0),
    lineNet: Number(line.line_net ?? Number.NaN),
    lineGross: Number(line.line_gross ?? Number.NaN),
    billedNet: Number(line.billed_net ?? 0),
    billedGross: Number(line.billed_gross ?? 0),
  });
}

/** Running net, VAT and gross of the chosen lines; null while a quantity cannot be read. */
export function draftLinesTotal(payload: DraftEditorPayload, form: DraftForm): SplitRow | null {
  if (payload.lines_mode !== "quote_positions") return null;
  let total: SplitRow = { net: 0, vat: 0, gross: 0 };
  for (const line of payload.quote_lines) {
    const entry = form.lines[line.line_index];
    if (!entry?.selected) continue;
    const quantity = readQuantity(entry.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    const part = linePartAmounts(line, roundCents(quantity));
    total = {
      net: roundCents(total.net + part.net),
      vat: roundCents(total.vat + part.vat),
      gross: roundCents(total.gross + part.gross),
    };
  }
  // A final draft also bills the services outside the estimate it keeps
  // (verify2-A S3-2: the running total left them out).
  for (const service of draftKeptServices(payload)) {
    total = {
      net: roundCents(total.net + service.amounts.net),
      vat: roundCents(total.vat + service.amounts.vat),
      gross: roundCents(total.gross + service.amounts.gross),
    };
  }
  return total;
}

/** Final drafts: the services outside the estimate the draft bills, with their amounts (shown read-only). */
export function draftKeptServices(payload: DraftEditorPayload) {
  return (payload.order_service_lines ?? [])
    .filter((service) => service.selected_quantity !== null)
    .map((service) => ({
      ...service,
      quantity: Number(service.selected_quantity),
      amounts: moneyLineAmounts(Number(service.selected_quantity), Number(service.unit_price ?? 0), Number(service.vat_rate ?? 0), Number(service.discount_percent ?? 0)),
    }));
}

/** Own services of the draft (no pass-through costs): what the contract budget counts. */
export function draftOwnServicesTotal(payload: DraftEditorPayload, form: DraftForm): SplitRow | null {
  return draftLinesTotal({
    ...payload,
    quote_lines: payload.quote_lines.filter((line) => !line.is_cost_passthrough),
    order_service_lines: (payload.order_service_lines ?? []).filter((service) => !service.is_cost_passthrough),
  }, form);
}

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
  if (draftReceivedPaymentChanged(payload, form)) {
    body.payment_received = receivedPaymentPayload(form.receivedPayment);
  }
  if (draftServiceCommentsChanged(payload, form)) {
    // The kept services outside the estimate with their remarks (quantities unchanged).
    body.order_services = (payload.order_service_lines ?? [])
      .filter((service) => service.selected_quantity !== null)
      .map((service) => ({
        order_leistung_id: service.order_leistung_id,
        quantity: service.selected_quantity,
        comment: (form.serviceComments?.[service.order_leistung_id] ?? "").trim() || null,
      }));
  }
  if (draftPeriodChanged(payload, form)) {
    // The default again = none set by staff.
    body.service_period = servicePeriodPayload(form.servicePeriod, draftPeriodDefault(payload));
  }
  return body;
}

export function draftReceivedPaymentChanged(payload: DraftEditorPayload, form: DraftForm): boolean {
  return !sameReceivedPayment(form.receivedPayment, receivedPaymentFormFrom(payload.payment_received));
}

/** Whether a remark of a kept service outside the estimate was changed. */
export function draftServiceCommentsChanged(payload: DraftEditorPayload, form: DraftForm): boolean {
  return (payload.order_service_lines ?? [])
    .filter((service) => service.selected_quantity !== null)
    .some((service) => (form.serviceComments?.[service.order_leistung_id] ?? "").trim() !== (service.comment ?? "").trim());
}

export function draftPeriodChanged(payload: DraftEditorPayload, form: DraftForm): boolean {
  return !samePeriod(form.servicePeriod, shownPeriod(payload));
}

/** Whether anything in the editor differs from the stored draft. */
export function draftFormDirty(payload: DraftEditorPayload, form: DraftForm): boolean {
  return (
    form.dueDate !== (payload.due_date ?? "") ||
    form.notes.trim() !== (payload.notes ?? "").trim() ||
    draftLinesChanged(payload, form) ||
    advanceSplitChanged(payload, form.split) ||
    draftReceivedPaymentChanged(payload, form) ||
    draftPeriodChanged(payload, form) ||
    draftServiceCommentsChanged(payload, form)
  );
}

/** A final invoice draft: it bills the delivered quantities (owner 2026-11-17). */
export function isFinalDraft(payload: DraftEditorPayload): boolean {
  return payload.invoice_type === "final" && payload.quote_lines.some((line) => line.quantity_capped === false);
}

function keptServiceQuantity(payload: DraftEditorPayload, lineIndex: number): number {
  return (payload.order_service_lines ?? [])
    .filter((service) => service.selected_quantity !== null && service.quote_line_index === lineIndex)
    .reduce((sum, service) => sum + Number(service.selected_quantity ?? 0), 0);
}

/** An estimate line against what the draft bills of it: «по смете X · фактически Y» and the difference. */
export function draftFinalLineComparison(payload: DraftEditorPayload, line: DraftEditorQuoteLine, form: DraftForm) {
  const entry = form.lines[line.line_index];
  const own = entry?.selected ? readQuantity(entry.quantity) : 0;
  const estimate = Number(line.quoted_quantity);
  const actual = roundCents(Number(line.billed_quantity ?? 0) + (Number.isFinite(own) ? own : 0) + keptServiceQuantity(payload, line.line_index));
  const difference = roundCents(actual - estimate);
  const unitGross = moneyLineAmounts(1, Number(line.unit_price ?? 0), line.is_cost_passthrough ? 0 : Number(line.vat_rate ?? 0), Number(line.discount_percent ?? 0)).gross;
  return {
    estimate,
    actual,
    difference,
    differenceGross: (difference < 0 ? -1 : 1) * roundCents(Math.abs(difference) * unitGross),
    recorded: line.delivery_basis !== "estimate",
    notDelivered: actual <= 0,
    aboveEstimate: toCents(actual) > toCents(estimate),
  };
}

/** «по смете X € · фактически Y €» of a final draft: estimate gross against billed before + this draft. */
export function draftFinalSummary(payload: DraftEditorPayload, form: DraftForm) {
  const estimate = roundCents(payload.quote_lines.reduce((sum, line) => sum + Number(line.line_gross ?? 0), 0));
  const billedBefore = roundCents(payload.quote_lines.reduce((sum, line) => sum + Number(line.billed_gross ?? 0), 0));
  // The draft's own total carries the services outside the estimate it keeps.
  const actual = roundCents(billedBefore + (draftLinesTotal(payload, form)?.gross ?? 0));
  return { estimate, actual, difference: roundCents(actual - estimate) };
}
