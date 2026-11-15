import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { countValidityAttention, type DocumentValidity } from "../model/document-validity";

/**
 * How many current documents of a patient expire within 30 days or have
 * expired (owner 2026-11-15): the badge of the patient card's documents tab.
 * Reads the same list as the tab (`GET /patients/:id/documents`, the
 * server's access rules), cached for a minute; 0 while loading or on error.
 */
export function usePatientDocumentValidityCount(patientId: string | undefined, enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!patientId || !enabled) {
      setCount(0);
      return;
    }
    let cancelled = false;
    apiFetch<DocumentValidity[]>(`/patients/${patientId}/documents`, { cacheTtlMs: 60_000 })
      .then((documents) => {
        if (!cancelled) setCount(countValidityAttention(Array.isArray(documents) ? documents : []));
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, enabled]);
  return count;
}
