import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

export type PatientOrderOption = {
  id: string;
  order_number: string;
  phase: string;
  status: string;
};

/**
 * The patient's orders an appointment can be linked to. Cancelled orders are
 * left out; a completed one stays selectable so an existing link is still
 * shown while editing.
 */
export function usePatientOrderOptions(patientId: string) {
  const [orders, setOrders] = useState<PatientOrderOption[]>([]);

  useEffect(() => {
    if (!patientId) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    void apiFetch<PatientOrderOption[]>(`/patients/${patientId}/orders`)
      .then((rows) => {
        if (cancelled) return;
        setOrders(
          (Array.isArray(rows) ? rows : []).filter(
            (order) => order.status !== "cancelled",
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setOrders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  return orders;
}

/** The order a new appointment links to by default: the patient's only open one. */
export function defaultOrderIdFor(orders: PatientOrderOption[]) {
  const open = orders.filter((order) => order.status === "active");
  return open.length === 1 ? open[0].id : "";
}
