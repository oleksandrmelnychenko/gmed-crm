/**
 * Billing work list of concierge services ready to bill (owner 2026-11-12,
 * decision 8): `GET /concierge-billing-queue`. Read only; Billing bills a
 * service from the patient's billing tab.
 */
export type ConciergeBillingQueueItem = {
  id: string;
  patient_id: string;
  patient_pid: string | null;
  patient_name: string;
  order_id: string | null;
  order_number: string | null;
  title: string;
  service_kind: string;
  status: string;
  service_date: string | null;
  completed_at: string | null;
  quantity: string;
  unit_price: string | null;
  /** quantity × unit price; null when the service has no sale price. */
  sale_price: string | null;
  currency: string;
};

export type ConciergeBillingQueue = {
  items: ConciergeBillingQueueItem[];
  total: number;
  truncated: boolean;
};

/** Roles the server answers (Billing, CEO, CEO assistant, PM for own patients). */
const QUEUE_ROLES = new Set(["billing", "ceo", "ceo_assistant", "patient_manager"]);

export function canReadConciergeBillingQueue(role: string | null | undefined): boolean {
  return Boolean(role && QUEUE_ROLES.has(role));
}

export function patientLabel(item: Pick<ConciergeBillingQueueItem, "patient_name" | "patient_pid">): string {
  const name = item.patient_name.trim();
  if (name && item.patient_pid) return `${name} · ${item.patient_pid}`;
  return name || item.patient_pid || "—";
}

/** The patients of the list for the filter, sorted by label, each once. */
export function conciergeQueuePatients(items: ConciergeBillingQueueItem[]): { id: string; label: string }[] {
  const byId = new Map<string, string>();
  for (const item of items) {
    if (!byId.has(item.patient_id)) byId.set(item.patient_id, patientLabel(item));
  }
  return [...byId.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "de"));
}

export function filterConciergeQueue(items: ConciergeBillingQueueItem[], patientId: string): ConciergeBillingQueueItem[] {
  return patientId ? items.filter((item) => item.patient_id === patientId) : items;
}

/** Where Billing bills the service: the patient's billing tab. */
export function patientBillingHref(patientId: string): string {
  return `/patients/${encodeURIComponent(patientId)}?tab=billing`;
}

/** Badge text of the tab: nothing for 0, «99+» above 99. */
export function conciergeQueueBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}
