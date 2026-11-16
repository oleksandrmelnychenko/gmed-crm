import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { countValidityAttention, type DocumentValidity } from "../model/document-validity";

const VALIDITY_COUNT_EVENT = "gmed:patient-document-validity";

type ValidityCountDetail = { patientId: string; count: number };

/**
 * The patient card's documents tab loaded the list again (after an upload, a
 * date edit, a new version): the badge takes the new count at once instead
 * of waiting for its own cached read (QA 2026-11-16 S3-6).
 */
export function publishPatientDocumentValidity(
  patientId: string,
  documents: ReadonlyArray<DocumentValidity>,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ValidityCountDetail>(VALIDITY_COUNT_EVENT, {
      detail: { patientId, count: countValidityAttention(documents) },
    }),
  );
}

/**
 * How many current documents of a patient expire within 30 days or have
 * expired (owner 2026-11-15): the badge of the patient card's documents tab.
 * Reads the same list as the tab (`GET /patients/:id/documents`, the
 * server's access rules), cached for a minute; 0 while loading or on error.
 * Every reload of the tab's list updates it too.
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
    const onPublished = (event: Event) => {
      const detail = (event as CustomEvent<ValidityCountDetail>).detail;
      if (!cancelled && detail?.patientId === patientId) setCount(detail.count);
    };
    window.addEventListener(VALIDITY_COUNT_EVENT, onPublished);
    return () => {
      cancelled = true;
      window.removeEventListener(VALIDITY_COUNT_EVENT, onPublished);
    };
  }, [patientId, enabled]);
  return count;
}
