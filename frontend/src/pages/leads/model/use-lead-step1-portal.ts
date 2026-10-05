import { useCallback, useEffect, useRef, useState } from "react";

import {
  setLeadStep1FillMode,
  type LeadRepresentation,
  type Step1FillMode,
} from "../data/lead-portal-intake-api";
import { useLeadPortalIntake } from "./lead-portal-intake";

/**
 * Whether a patient event changed what the wizard draft holds of the lead:
 * the step-1 fields, or the trusted contacts (a parent added the second
 * parent or corrected a name in the cabinet).
 */
export function patientEventChangesLeadData(change: unknown): boolean {
  return change === "personal_data" || change === "representation";
}

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

  const { intake, reload, setIntake } = useLeadPortalIntake(leadId, open && Boolean(leadId), (event) => {
    if (!patientEventChangesLeadData(event.payload?.change)) return;
    setPatientUpdatedAt(event.occurred_at ?? new Date().toISOString());
    onChangedRef.current?.();
  });

  /** Takes the answer of a staff change of the representation without waiting for the next load. */
  const applyRepresentation = useCallback(
    (representation: LeadRepresentation | null) => {
      if (!representation) {
        void reload();
        return;
      }
      setIntake((current) => (current && current.lead_id === leadId ? { ...current, representation } : current));
    },
    [leadId, reload, setIntake],
  );

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
    applyRepresentation,
    patientUpdatedAt,
    dismissPatientUpdate: useCallback(() => setPatientUpdatedAt(null), []),
  };
}
