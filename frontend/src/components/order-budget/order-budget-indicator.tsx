import { useEffect, useState } from "react";

import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  fetchOrderBudget,
  onOrderBudgetChanged,
  orderBudgetSourceText,
  orderBudgetState,
  orderBudgetText,
  type OrderBudget,
  type OrderBudgetBasis,
} from "./order-budget";

/**
 * The order's contract budget, loaded once per indicator and again when the
 * order's figures change ({@link notifyOrderBudgetChanged}), on `refreshKey`
 * or when the window regains focus. `null` while loading, without access
 * (403) or on an error: the indicator then shows nothing.
 */
export function useOrderBudget(orderId: string | null | undefined, refreshKey?: unknown): OrderBudget | null {
  const [loaded, setLoaded] = useState<{ orderId: string; budget: OrderBudget | null } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!orderId) return;
    const reload = () => setTick((value) => value + 1);
    const offChanged = onOrderBudgetChanged(orderId, reload);
    window.addEventListener("focus", reload);
    return () => {
      offChanged();
      window.removeEventListener("focus", reload);
    };
  }, [orderId]);
  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    fetchOrderBudget(orderId)
      .then((budget) => {
        if (!cancelled) setLoaded({ orderId, budget });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ orderId, budget: null });
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, refreshKey, tick]);
  return orderId && loaded?.orderId === orderId ? loaded.budget : null;
}

type ViewProps = {
  budget: OrderBudget | null;
  lang: Lang;
  basis?: OrderBudgetBasis;
  /**
   * Own services the pending action adds (gross), shown as «→ projected»;
   * a function gets the loaded budget (visit fee, concierge VAT).
   */
  deltaGross?: number | ((budget: OrderBudget) => number);
  className?: string;
  testId?: string;
};

/**
 * One line: «По договору 2.000,00 € · запланировано 1.850,00 € · остаток 150,00 €».
 * Amber above 90 % of the contract, red «Превышение на X €» when over, muted
 * «Договорная сумма не задана» without a signed contract. Never blocks.
 */
export function OrderBudgetLine({ budget, lang, basis, deltaGross, className, testId = "order-budget-indicator" }: ViewProps) {
  if (!budget) return null;
  const delta = typeof deltaGross === "function" ? deltaGross(budget) : deltaGross;
  const state = orderBudgetState(budget, { basis, deltaGross: delta });
  return (
    <div
      data-testid={testId}
      data-state={state.kind}
      role={state.kind === "over" ? "status" : undefined}
      title={orderBudgetSourceText(budget, lang) ?? undefined}
      className={cn(
        "text-xs leading-5 tabular-nums",
        state.kind === "unset" && "text-muted-foreground",
        state.kind === "ok" && "text-muted-foreground",
        state.kind === "near" && "text-amber-700 dark:text-amber-300",
        state.kind === "over" && "font-medium text-destructive",
        className,
      )}
    >
      {orderBudgetText(state, lang)}
    </div>
  );
}

type Props = Omit<ViewProps, "budget"> & {
  orderId: string | null | undefined;
  /** Load again when this changes (e.g. after a save in the same screen). */
  refreshKey?: unknown;
};

/** {@link OrderBudgetLine} that loads the order's budget itself. */
export function OrderBudgetIndicator({ orderId, refreshKey, ...view }: Props) {
  const budget = useOrderBudget(orderId, refreshKey);
  return <OrderBudgetLine budget={budget} {...view} />;
}
