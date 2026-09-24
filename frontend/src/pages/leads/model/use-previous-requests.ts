import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type PreviousRequest = {
  id: string;
  created_at: string;
  concern: string | null;
  specialties: string[];
  order_number: string | null;
  date_from: string | null;
  date_to: string | null;
};

/** Completed earlier requests of a returning patient, newest first. */
export function usePreviousRequests(patientId: string | null, currentLeadId: string | null) {
  const [requests, setRequests] = useState<PreviousRequest[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setRequests([]);
    if (!patientId) return;
    let cancelled = false;
    const query = currentLeadId ? `?exclude_lead_id=${encodeURIComponent(currentLeadId)}` : "";
    setLoading(true);
    apiFetch<PreviousRequest[]>(`/patients/${encodeURIComponent(patientId)}/previous-requests${query}`)
      .then((rows) => { if (!cancelled) setRequests(Array.isArray(rows) ? rows : []); })
      // The list is only a convenience; the reason field works without it.
      .catch(() => { if (!cancelled) setRequests([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patientId, currentLeadId]);
  return { requests, loading };
}
