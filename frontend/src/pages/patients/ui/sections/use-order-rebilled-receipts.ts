import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

import { rebilledOrderExpenses, type RebilledReceipt } from "./patient-billing-double-billing";

/**
 * Receipts of an order already re-billed to the patient, read from the
 * patient billing workspace while `enabled` (a transit line is being added
 * or billed). A refused or failed read yields none: the warning is advisory.
 */
export function useOrderRebilledReceipts({
  patientId,
  orderId,
  enabled,
}: {
  patientId: string | null | undefined;
  orderId: string | null | undefined;
  enabled: boolean;
}) {
  const [loaded, setLoaded] = useState<{ patientId: string; expenses: RebilledReceipt[] } | null>(null);
  const active = Boolean(enabled && patientId && orderId);

  useEffect(() => {
    if (!active || !patientId) return;
    const controller = new AbortController();
    apiFetch<{ expenses?: RebilledReceipt[] }>(`/patients/${patientId}/billing-workspace`, {
      forceFresh: true,
      signal: controller.signal,
    })
      .then((workspace) => {
        if (!controller.signal.aborted) setLoaded({ patientId, expenses: workspace.expenses ?? [] });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ patientId, expenses: [] });
      });
    return () => controller.abort();
  }, [active, patientId, orderId]);

  if (!active || !orderId || !loaded || loaded.patientId !== patientId) return [];
  return rebilledOrderExpenses(orderId, loaded.expenses, []);
}
