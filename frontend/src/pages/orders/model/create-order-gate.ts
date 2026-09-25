import type { PatientOrderRecheck } from "./types";

/**
 * Why the "new order" dialog cannot be saved yet. `null` means Save is allowed
 * (the submit handler still validates required fields such as the patient).
 */
export type CreateOrderSubmitBlock =
  | { kind: "agency_service_loading" }
  | { kind: "agency_service_unavailable" }
  | { kind: "recheck_loading" }
  | { kind: "recheck_unavailable"; error: string | null }
  | { kind: "recheck_blocked"; reason: string | null };

export type CreateOrderSubmitGateInput = {
  patientId: string;
  requestedAgencyServiceId: string | null | undefined;
  agencyServicesLoaded: boolean;
  hasPendingAgencyService: boolean;
  recheck: Pick<
    PatientOrderRecheck,
    "requires_recheck" | "can_create_order" | "blocking_reasons"
  > | null;
  recheckLoading: boolean;
  recheckError: string | null;
};

export function resolveCreateOrderSubmitBlock(
  input: CreateOrderSubmitGateInput,
): CreateOrderSubmitBlock | null {
  if (input.requestedAgencyServiceId) {
    if (!input.agencyServicesLoaded) return { kind: "agency_service_loading" };
    if (!input.hasPendingAgencyService) {
      return { kind: "agency_service_unavailable" };
    }
  }
  if (input.recheckLoading) return { kind: "recheck_loading" };
  if (!input.patientId) return null;
  if (!input.recheck) {
    return { kind: "recheck_unavailable", error: input.recheckError };
  }
  if (input.recheck.requires_recheck && !input.recheck.can_create_order) {
    return {
      kind: "recheck_blocked",
      reason: input.recheck.blocking_reasons?.[0] ?? null,
    };
  }
  return null;
}

/**
 * Re-selecting the patient that is already selected must keep the loaded
 * re-check result: the reload effect only runs when the patient id changes,
 * so clearing it would leave Save disabled without a way to recover.
 */
export function isCreateOrderPatientChange(
  currentPatientId: string,
  nextPatientId: string,
) {
  return currentPatientId !== nextPatientId;
}
