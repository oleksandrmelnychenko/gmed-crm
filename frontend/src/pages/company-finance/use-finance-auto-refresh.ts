import { useCallback, useEffect, useRef } from "react";
import { useDebouncedRealtimeSubscription, useRealtimeConnectionStatus } from "@/lib/realtime";

export const COMPANY_FINANCE_REALTIME_EVENTS = [
  "realtime.connected", "realtime.resync_required",
  "patient.balance_adjustment_created", "patient.balance_adjustment_reversed",
  "invoice.created", "invoice.status_changed", "invoice.payer_changed", "invoice.overdue_marked",
  "invoice.payment_recorded", "invoice.payment_reversed", "invoice.refund_recorded", "invoice.refund_reversed",
  "invoice.credit_note_created", "invoice.credit_note_reversed", "invoice.prepayment_applied", "invoice.prepayment_released",
  "order.external_invoice_created", "order.external_invoice_updated", "order.external_invoice_overdue",
  "order.external_invoice_allocation_created", "order.external_invoice_allocation_reversed",
  "order.leistung_added", "order.leistung_planned_cost_updated", "order.leistung_approved",
  "concierge_expense.submitted", "concierge_expense.posted", "concierge_expense.rejected", "concierge_expense.reversed",
  "company_financial_account.created", "company_financial_account.updated",
  "company_financial_account.adjustment_created", "company_financial_account.adjustment_reversed",
  "company_financial_account.transfer_created", "company_financial_account.transfer_reversed",
  "accounting_entry.financial_account_assigned", "provider_payment.recorded", "provider_payment.reversed",
] as const;

// Callers expose their loading/mutation state so events arriving during a
// request produce one follow-up refresh instead of cancelling slow requests.
export function useFinanceAutoRefresh(
  refresh: () => void,
  busy: boolean,
  enabled = true,
  eventTypes: readonly string[] = COMPANY_FINANCE_REALTIME_EVENTS,
) {
  const { status } = useRealtimeConnectionStatus();
  const refreshRef = useRef(refresh);
  const busyRef = useRef(busy);
  const enabledRef = useRef(enabled);
  const queuedRef = useRef(false);
  const lastRefreshRef = useRef(Date.now());
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => { enabledRef.current = enabled; if (!enabled) queuedRef.current = false; }, [enabled]);

  const requestRefresh = useCallback(() => {
    if (!enabledRef.current || document.visibilityState !== "visible" || !navigator.onLine) return;
    if (busyRef.current) { queuedRef.current = true; return; }
    busyRef.current = true;
    queuedRef.current = false;
    lastRefreshRef.current = Date.now();
    refreshRef.current();
  }, []);

  useEffect(() => {
    busyRef.current = busy;
    if (!busy) {
      lastRefreshRef.current = Date.now();
      if (queuedRef.current) requestRefresh();
    }
  }, [busy, requestRefresh]);

  useDebouncedRealtimeSubscription(eventTypes, requestRefresh, 200);
  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => {
      const delay = status === "connected" ? 30_000 : 5_000;
      if (Date.now() - lastRefreshRef.current >= delay) requestRefresh();
    }, 1_000);
    if (status === "connected") requestRefresh();
    window.addEventListener("focus", requestRefresh);
    window.addEventListener("online", requestRefresh);
    document.addEventListener("visibilitychange", requestRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", requestRefresh);
      window.removeEventListener("online", requestRefresh);
      document.removeEventListener("visibilitychange", requestRefresh);
    };
  }, [enabled, status, requestRefresh]);
}
