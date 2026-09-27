import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

export type PatientOrderOption = {
  id: string;
  order_number: string;
  phase: string;
  status: string;
};

type PatientOrderOptionsState = {
  /** The patient the loaded orders belong to. */
  patientId: string;
  orders: PatientOrderOption[];
};

const NO_ORDERS: PatientOrderOption[] = [];

/**
 * The patient's orders an appointment can be linked to, and whether they are
 * loaded for exactly this patient yet. Cancelled orders are left out; a
 * completed one stays selectable so an existing link is still shown while
 * editing.
 */
export function usePatientOrderOptionsState(patientId: string) {
  const [state, setState] = useState<PatientOrderOptionsState>({
    patientId: "",
    orders: NO_ORDERS,
  });

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    void apiFetch<PatientOrderOption[]>(`/patients/${patientId}/orders`)
      .then((rows) => {
        if (cancelled) return;
        setState({
          patientId,
          orders: (Array.isArray(rows) ? rows : []).filter(
            (order) => order.status !== "cancelled",
          ),
        });
      })
      .catch(() => {
        if (!cancelled) setState({ patientId, orders: NO_ORDERS });
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (!patientId) return { orders: NO_ORDERS, loaded: true };
  const loaded = state.patientId === patientId;
  return { orders: loaded ? state.orders : NO_ORDERS, loaded };
}

export function usePatientOrderOptions(patientId: string) {
  return usePatientOrderOptionsState(patientId).orders;
}

/** The order a new appointment links to by default: the patient's only open one. */
export function defaultOrderIdFor(orders: PatientOrderOption[]) {
  const open = orders.filter((order) => order.status === "active");
  return open.length === 1 ? open[0].id : "";
}

/**
 * The order of a new appointment once the patient's orders are known: a
 * preselected order of this patient stays (e.g. when the appointment is
 * started from the order workspace); otherwise it falls back to the patient's
 * only open order. While the orders are still loading nothing changes, so a
 * preselected order is not dropped before the list arrives.
 */
export function reconcileCreateOrderId(
  orderId: string,
  orders: PatientOrderOption[],
  loaded: boolean,
) {
  if (!loaded) return orderId;
  if (orderId && orders.some((order) => order.id === orderId)) return orderId;
  return defaultOrderIdFor(orders);
}
