import { useEffect } from "react";

import { useStaffNavigate } from "@/lib/use-staff-navigate";

/**
 * Opens the case workspace for the given case. The former embedded case sheet
 * was removed with the roster inline editor (single case UI); this component
 * keeps the modal-style API for callers and redirects to `/cases/{id}`.
 */
export function CaseWorkspaceModal({
  open,
  caseId,
  patientId,
  onOpenChange,
}: {
  open: boolean;
  caseId: string | null;
  patientId?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { staffGo } = useStaffNavigate();

  useEffect(() => {
    if (!open || !caseId) return;
    const params = new URLSearchParams();
    if (patientId) params.set("patient", patientId);
    const query = params.toString();
    staffGo(`/cases/${caseId}${query ? `?${query}` : ""}`);
    onOpenChange(false);
  }, [caseId, onOpenChange, open, patientId, staffGo]);

  return null;
}
