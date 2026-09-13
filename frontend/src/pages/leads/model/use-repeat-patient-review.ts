import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fetchContracts } from "@/pages/contracts/data/contracts-api";
import type { ContractItem } from "@/pages/contracts/model/types";
import { fetchDocuments } from "@/pages/documents/data/document-api";
import type { DocumentItem } from "@/pages/documents/model/types";
import { fetchPatientOrderRecheck } from "@/pages/orders/data/order-api";
import type { PatientOrderRecheck } from "@/pages/orders/model/types";

export function useRepeatPatientReview(patientId: string | null) {
  const [readiness, setReadiness] = useState<PatientOrderRecheck | null>(null);
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!patientId) return;
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const [nextReadiness, nextContracts, nextDocuments] = await Promise.all([
        fetchPatientOrderRecheck(patientId, { forceFresh: true }),
        fetchContracts(`/framework-contracts?patient_id=${encodeURIComponent(patientId)}`),
        fetchDocuments(`/documents?patient_id=${encodeURIComponent(patientId)}`),
      ]);
      if (current !== generation.current) return;
      setReadiness(nextReadiness); setContracts(nextContracts); setDocuments(nextDocuments);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "Failed to load patient documents");
      throw cause;
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [patientId]);
  useEffect(() => {
    setReadiness(null); setContracts([]); setDocuments([]); setError("");
    if (patientId) void refresh().catch(() => undefined);
    return () => { generation.current++; };
  }, [patientId, refresh]);
  async function saveExpiry(expiry: string) {
    if (!patientId) return false;
    await apiFetch(`/patients/${patientId}/update`, { method: "POST", body: JSON.stringify({ passport_expiry: expiry }) });
    await refresh();
    return true;
  }
  return { readiness, contracts, documents, loading, error, refresh, saveExpiry };
}
