import { apiFetch } from "@/lib/api";
import { formatAppDate } from "@/lib/app-time-zone";
import type { Lang } from "@/lib/i18n";
import { formatMoneyLabel, moneyLineAmounts, parseDiscountPercent, parseMoneyInput, roundCents } from "@/lib/money";

function moneyNumber(value: string | number | null | undefined): number {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * Contract budget of an order (owner decision 2026-11-17): the signed sum of
 * GMED's own services against what is planned or invoiced. Pass-through costs
 * never count. It only warns — nothing is blocked.
 *
 * The concierge receives the totals alone (contract sum, planned, remaining,
 * over-by, the concierge VAT rate): the fields marked optional are absent.
 */
export type OrderBudget = {
  order_id: string;
  currency: string;
  contract?: {
    source: "order_signature" | "quote";
    signed_at: string | null;
    document_id: string | null;
    quote_number: string | null;
    quotes: number;
    amendments: number;
  } | null;
  contract_own_services_net: string | null;
  contract_own_services_gross: string | null;
  planned_own_services_net: string;
  planned_own_services_gross: string;
  invoiced_own_services_net?: string;
  invoiced_own_services_gross?: string;
  remaining_net: string | null;
  remaining_gross: string | null;
  over_by_net: string | null;
  over_by_gross: string | null;
  free_visit_units?: number;
  visit_fee_net?: string | null;
  visit_fee_gross?: string | null;
  concierge_vat_rate: string;
};

export function fetchOrderBudget(orderId: string) {
  return apiFetch<OrderBudget>(`/orders/${orderId}/budget`);
}

/** What the figure is compared with: the plan, or what invoices billed. */
export type OrderBudgetBasis = "planned" | "invoiced";

export type OrderBudgetState =
  | { kind: "unset" }
  | {
      kind: "ok" | "near" | "over";
      basis: OrderBudgetBasis;
      currency: string;
      contract: number;
      /** Planned or invoiced now. */
      current: number;
      /** After the action shown (equal to `current` without one). */
      projected: number;
      remaining: number;
      overBy: number;
    };

/** Amber from this share of the contract sum on. */
export const ORDER_BUDGET_NEAR_SHARE = 0.9;

/**
 * The indicator's state for the order's budget, optionally after an action
 * that adds `deltaGross` of own services (or bills them, for `invoiced`).
 */
export function orderBudgetState(
  budget: OrderBudget,
  options: { basis?: OrderBudgetBasis; deltaGross?: number } = {},
): OrderBudgetState {
  if (budget.contract_own_services_gross == null) return { kind: "unset" };
  const basis = options.basis ?? "planned";
  const contract = moneyNumber(budget.contract_own_services_gross);
  const current = moneyNumber(
    basis === "invoiced" ? budget.invoiced_own_services_gross : budget.planned_own_services_gross,
  );
  const delta = Number.isFinite(options.deltaGross) ? options.deltaGross ?? 0 : 0;
  const projected = roundCents(current + delta);
  let remaining = roundCents(contract - projected);
  // Each invoice rounds its own VAT (owner rule): a line split over invoices
  // may pass the contract gross by a cent while the nets agree. That is no
  // overrun (QA3 A S3-4 / D S3-1): the nets decide, and a projection only
  // cents above the contract is rounding.
  if (remaining < 0 && remaining >= -0.05) {
    const rawCurrentNet = basis === "invoiced" ? budget.invoiced_own_services_net : budget.planned_own_services_net;
    const netsKnown = budget.contract_own_services_net != null && rawCurrentNet != null;
    const netsAgree = delta === 0 && netsKnown
      && moneyNumber(rawCurrentNet) <= moneyNumber(budget.contract_own_services_net);
    if (netsAgree || (delta !== 0 && remaining >= -0.02)) remaining = 0;
  }
  const kind = remaining < 0 ? "over" : projected > contract * ORDER_BUDGET_NEAR_SHARE ? "near" : "ok";
  return {
    kind,
    basis,
    currency: budget.currency,
    contract,
    current,
    projected,
    remaining,
    overBy: remaining < 0 ? -remaining : 0,
  };
}

/** The indicator line, e.g. «По договору 2.000,00 € · запланировано 1.850,00 € · остаток 150,00 €». */
export function orderBudgetText(state: OrderBudgetState, lang: Lang): string {
  const de = lang === "de";
  if (state.kind === "unset") return de ? "Vertragssumme nicht festgelegt" : "Договорная сумма не задана";
  const money = (value: number) => formatMoneyLabel(value, state.currency);
  const used =
    state.basis === "invoiced" ? (de ? "abgerechnet" : "выставлено") : de ? "geplant" : "запланировано";
  const amount =
    state.projected !== state.current ? `${money(state.current)} → ${money(state.projected)}` : money(state.current);
  const rest =
    state.kind === "over"
      ? de
        ? `Überschreitung um ${money(state.overBy)}`
        : `Превышение на ${money(state.overBy)}`
      : de
        ? `Rest ${money(state.remaining)}`
        : `остаток ${money(state.remaining)}`;
  return `${de ? "Laut Vertrag" : "По договору"} ${money(state.contract)} · ${used} ${amount} · ${rest}`;
}

/** Which signed version the contract sum comes from (tooltip). */
export function orderBudgetSourceText(budget: OrderBudget, lang: Lang): string | null {
  const contract = budget.contract;
  if (!contract) return null;
  const de = lang === "de";
  const date = contract.signed_at ? formatAppDate(contract.signed_at) : "";
  const base =
    contract.source === "quote"
      ? `${de ? "KV" : "Смета"} ${contract.quote_number ?? ""}`.trim()
      : de
        ? "Unterschriebener Auftrag"
        : "Подписанный заказ";
  const amendments = contract.amendments
    ? de
      ? ` + ${contract.amendments} Nachtrag/Nachträge`
      : ` + доп. соглашения: ${contract.amendments}`
    : "";
  return `${base}${date ? ` ${date}` : ""}${amendments}`;
}

/** Gross of medical visits about to be created: those beyond free units add a fee. */
export function plannedVisitsDeltaGross(budget: OrderBudget, visits: number): number {
  const fee = moneyNumber(budget.visit_fee_gross);
  if (!fee || visits <= 0) return 0;
  return roundCents(Math.max(0, visits - Math.max(0, budget.free_visit_units ?? 0)) * fee);
}

/**
 * Own-service gross of a typed service line (quantity × unit price less the
 * line's discount, + VAT, per line like quotes, invoices and the order header:
 * `moneyLineAmounts`); 0 for a pass-through line or unreadable input.
 */
export function serviceLineDeltaGross(line: {
  quantity: string;
  unitPrice: string;
  vatRate: string;
  discountPercent?: string;
  isCostPassthrough?: boolean;
}): number {
  if (line.isCostPassthrough) return 0;
  const quantity = Number(line.quantity.replace(",", "."));
  const unitPrice = parseMoneyInput(line.unitPrice);
  const vatRate = Number(line.vatRate.replace(",", ".") || "0");
  const discount = parseDiscountPercent(line.discountPercent ?? "");
  if (![quantity, unitPrice, vatRate].every(Number.isFinite) || quantity <= 0 || unitPrice < 0 || discount === null) return 0;
  return moneyLineAmounts(quantity, unitPrice, vatRate, discount).gross;
}

/**
 * Own-service gross an invoice bills from the selected quote lines: lines
 * re-billed at cost do not count; a tariff overage is GMED's own.
 */
export function ownServicesGrossOfSelection(
  lines: readonly { is_cost_passthrough?: boolean | null }[],
  selectedLineIndexes: readonly number[],
  lineGrossByIndex: Readonly<Record<number, number>> | readonly number[],
  overageGross = 0,
): number {
  const gross = selectedLineIndexes.reduce((sum, index) => {
    if (lines[index]?.is_cost_passthrough) return sum;
    const value = (lineGrossByIndex as Record<number, number>)[index];
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  return roundCents(gross + (Number.isFinite(overageGross) ? overageGross : 0));
}

/** Gross of a concierge sale price (net) at GMED's default VAT. */
export function conciergeSaleGross(budget: OrderBudget, net: number): number {
  if (!Number.isFinite(net) || net <= 0) return 0;
  const rate = moneyNumber(budget.concierge_vat_rate);
  return roundCents(net + roundCents((net * rate) / 100));
}

const CHANGED_EVENT = "gmed:order-budget-changed";

/** Tells every indicator of the order to load its figures again. */
export function notifyOrderBudgetChanged(orderId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { orderId } }));
}

/** Subscribes to {@link notifyOrderBudgetChanged} for one order. */
export function onOrderBudgetChanged(orderId: string, listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ orderId?: string }>).detail;
    if (!detail?.orderId || detail.orderId === orderId) listener();
  };
  window.addEventListener(CHANGED_EVENT, handler);
  return () => window.removeEventListener(CHANGED_EVENT, handler);
}
