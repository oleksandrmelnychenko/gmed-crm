import { useCallback, useEffect, useRef, useState } from "react";

import { setLeadStep1FillMode, type Step1FillMode } from "../data/lead-portal-intake-api";
import { useLeadPortalIntake } from "./lead-portal-intake";

/**
 * Wizard step 1 and the patient portal (owner decision 2026-10-03): who fills
 * in the personal data, what the patient did, and a notice when the patient
 * changes data while the wizard is open. The mode is kept in
 * `wizard_state.step1_fill_mode` through the server (so roles without access
 * to the medical wizard state can set it); a mode chosen before the lead
 * exists is stored right after it is created.
 */
export function useLeadStep1Portal({
  leadId,
  open,
  onPatientDataChanged,
}: {
  leadId: string | null | undefined;
  open: boolean;
  onPatientDataChanged?: () => void;
}) {
  const [mode, setModeState] = useState<Step1FillMode>("staff");
  const [patientUpdatedAt, setPatientUpdatedAt] = useState<string | null>(null);
  const pendingModeRef = useRef<Step1FillMode | null>(null);
  const onChangedRef = useRef(onPatientDataChanged);
  useEffect(() => {
    onChangedRef.current = onPatientDataChanged;
  }, [onPatientDataChanged]);

  const { intake, reload } = useLeadPortalIntake(leadId, open && Boolean(leadId), (event) => {
    if (event.payload?.change !== "personal_data") return;
    setPatientUpdatedAt(event.occurred_at ?? new Date().toISOString());
    onChangedRef.current?.();
  });

  // Another lead: forget the notice; the mode comes with its portal state.
  useEffect(() => {
    setPatientUpdatedAt(null);
    if (!pendingModeRef.current) setModeState("staff");
  }, [leadId]);

  useEffect(() => {
    if (intake && intake.lead_id === leadId && !pendingModeRef.current) setModeState(intake.fill_mode);
  }, [intake, leadId]);

  // The lead was created in "the patient fills it in" mode: keep the choice.
  useEffect(() => {
    const pending = pendingModeRef.current;
    if (!leadId || !pending) return;
    pendingModeRef.current = null;
    void setLeadStep1FillMode(leadId, pending)
      .then(() => reload())
      .catch(() => undefined);
  }, [leadId, reload]);

  const setMode = useCallback(
    (next: Step1FillMode) => {
      setModeState(next);
      if (!leadId) {
        pendingModeRef.current = next === "patient" ? next : null;
        return;
      }
      void setLeadStep1FillMode(leadId, next)
        .then(() => reload())
        .catch(() => undefined);
    },
    [leadId, reload],
  );

  return {
    mode,
    setMode,
    intake,
    reload,
    patientUpdatedAt,
    dismissPatientUpdate: useCallback(() => setPatientUpdatedAt(null), []),
  };
}
