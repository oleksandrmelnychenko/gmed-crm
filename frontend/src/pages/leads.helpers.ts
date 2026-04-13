import type { Lead } from "@/lib/api/types";

/**
 * Pure decision helper for the "Convert" button on the leads card.
 *
 * The business rules are:
 *
 * 1. Only users with the `canConvert` permission bit ever see the button.
 *    In practice this is the patient-manager role (and the CEO, who
 *    inherits it).
 * 2. The lead must be in the `qualified` state — sales has to flag it as
 *    conversion-ready before the PM can press Convert.
 * 3. The backend also enforces a readiness gate (DOB / legal_sex /
 *    consent / compliance). The `conversion_ready` boolean is lifted
 *    onto the list payload so the frontend can disable the button and
 *    show a tooltip instead of firing a POST that would 422 back.
 *
 * The helper returns three pieces of state:
 *
 * - `canConvertRole`  — should the button be *rendered at all*?
 * - `canConvert`      — should the button be *enabled*?
 * - `disabledReason`  — tooltip text shown when role passes but the
 *                       readiness gate fails. `null` when the button
 *                       is enabled or hidden.
 *
 * If the server is older and does not carry `conversion_ready`, the
 * helper falls back to allowing conversion so a mixed deploy does not
 * silently disable the feature.
 */
export interface LeadConversionGate {
  canConvertRole: boolean;
  canConvert: boolean;
  disabledReason: string | null;
}

export function computeLeadConversionGate(
  lead: Pick<Lead, "qualification_status" | "conversion_ready">,
  permissions: { canConvert: boolean },
): LeadConversionGate {
  const canConvertRole =
    permissions.canConvert && lead.qualification_status === "qualified";
  // `undefined` — older server build that does not ship the field. Treat
  // it as permissive so a half-upgraded cluster keeps the button usable.
  const conversionReady = lead.conversion_ready ?? true;
  const canConvert = canConvertRole && conversionReady;
  const disabledReason =
    canConvertRole && !conversionReady
      ? "Missing required data — open the lead to see what's blocking conversion."
      : null;
  return { canConvertRole, canConvert, disabledReason };
}
