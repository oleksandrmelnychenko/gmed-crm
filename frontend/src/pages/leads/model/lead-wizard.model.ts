import type { LeadDetail } from "@/lib/api/types";

/**
 * Pure logic for the staff lead-processing wizard, Phase A (before conversion
 * to a patient). Kept free of React so it can be unit-tested and reused.
 * Phase B (clinical / order / contracts / compliance) runs against the patient
 * after {@link canConvert} is satisfied and the lead is wizard-converted.
 */

export type WizardStepId = "identity" | "eligibility" | "specialties";

export const PHASE_A_STEPS: readonly WizardStepId[] = [
  "identity",
  "eligibility",
  "specialties",
] as const;

export type LegalSex = "female" | "male" | "diverse" | "no_entry";

const VALID_LEGAL_SEX: readonly LegalSex[] = ["female", "male", "diverse", "no_entry"];

export type WizardDraft = {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD, or "" when unknown
  legalSex: LegalSex | "";
  email: string;
  phone: string;
  streetAddress: string;
  city: string;
  zipCode: string;
  primaryLanguage: string;
  needsInterpreter: boolean;
  primaryConcernText: string;
  additionalConcerns: string;
  selectedProgram: string;
  services: string[];
  requestedSpecialties: string[];
};

export function draftFromLead(lead: LeadDetail): WizardDraft {
  return {
    firstName: lead.first_name ?? "",
    lastName: lead.last_name ?? "",
    dateOfBirth: lead.date_of_birth ?? "",
    legalSex: (lead.legal_sex ?? "") as LegalSex | "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    streetAddress: lead.street_address ?? "",
    city: lead.city ?? "",
    zipCode: lead.zip_code ?? "",
    primaryLanguage: lead.primary_language ?? "",
    needsInterpreter: lead.needs_interpreter ?? false,
    primaryConcernText: lead.primary_concern_text ?? "",
    additionalConcerns: lead.additional_concerns ?? "",
    selectedProgram: lead.selected_program ?? "",
    services: lead.services ?? [],
    requestedSpecialties: lead.requested_specialties ?? [],
  };
}

/** True when the person is younger than 18 on `today` — i.e. a child (#2). */
export function isMinor(dateOfBirth: string, today: Date): boolean {
  if (!dateOfBirth) return false;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return false;
  let age = today.getFullYear() - dob.getFullYear();
  const monthDelta = today.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age >= 0 && age < 18;
}

function hasContact(draft: WizardDraft): boolean {
  return draft.email.trim().length > 0 || draft.phone.trim().length > 0;
}

export function stepIsComplete(step: WizardStepId, draft: WizardDraft): boolean {
  switch (step) {
    case "identity":
      return (
        draft.firstName.trim().length > 0 &&
        draft.lastName.trim().length > 0 &&
        draft.dateOfBirth.length > 0 &&
        (VALID_LEGAL_SEX as readonly string[]).includes(draft.legalSex) &&
        hasContact(draft)
      );
    case "eligibility":
      return draft.primaryConcernText.trim().length > 0;
    case "specialties":
      return draft.requestedSpecialties.length > 0;
  }
}

export function completedSteps(draft: WizardDraft): WizardStepId[] {
  return PHASE_A_STEPS.filter((step) => stepIsComplete(step, draft));
}

/**
 * Identity basics required to create the patient mid-wizard (D2 /
 * convert-then-comply): a date of birth, a valid legal sex, and at least one
 * contact channel. Compliance and qualification are handled later.
 */
export function canConvert(draft: WizardDraft): boolean {
  return (
    draft.dateOfBirth.length > 0 &&
    (VALID_LEGAL_SEX as readonly string[]).includes(draft.legalSex) &&
    hasContact(draft)
  );
}

export function nextStep(step: WizardStepId): WizardStepId | null {
  const index = PHASE_A_STEPS.indexOf(step);
  return index >= 0 && index < PHASE_A_STEPS.length - 1
    ? PHASE_A_STEPS[index + 1]
    : null;
}

export function prevStep(step: WizardStepId): WizardStepId | null {
  const index = PHASE_A_STEPS.indexOf(step);
  return index > 0 ? PHASE_A_STEPS[index - 1] : null;
}

/**
 * The payload for `POST /leads/{id}/update`. Only fields the backend would
 * reject when empty (name, legal sex, date of birth, contact, language,
 * program) are omitted while blank; free-text and array fields are always sent
 * so a cleared field actually clears. `requested_specialties` and `wizard_state`
 * (the resume marker) are always included.
 */
export function wizardUpdatePayload(
  draft: WizardDraft,
  currentStep: WizardStepId,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    requested_specialties: draft.requestedSpecialties,
    wizard_state: { step: currentStep, completed: completedSteps(draft) },
    street_address: draft.streetAddress.trim(),
    city: draft.city.trim(),
    zip_code: draft.zipCode.trim(),
    needs_interpreter: draft.needsInterpreter,
    primary_concern_text: draft.primaryConcernText.trim(),
    additional_concerns: draft.additionalConcerns.trim(),
    services: draft.services,
  };
  if (draft.firstName.trim()) payload.first_name = draft.firstName.trim();
  if (draft.lastName.trim()) payload.last_name = draft.lastName.trim();
  if (draft.dateOfBirth) payload.date_of_birth = draft.dateOfBirth;
  if (draft.legalSex) payload.legal_sex = draft.legalSex;
  if (draft.email.trim()) payload.email = draft.email.trim();
  if (draft.phone.trim()) payload.phone = draft.phone.trim();
  if (draft.primaryLanguage.trim()) payload.primary_language = draft.primaryLanguage.trim();
  if (draft.selectedProgram.trim()) payload.selected_program = draft.selectedProgram.trim();
  return payload;
}

/**
 * Compose the draft order's `needs_description` from the wizard's concern and
 * requested specialists — this is what makes "form the order" (#8) carry the
 * qualification the staff captured, rather than an empty order.
 */
export function orderNeedsDescription(draft: WizardDraft): string {
  const parts: string[] = [];
  if (draft.primaryConcernText.trim()) parts.push(draft.primaryConcernText.trim());
  if (draft.additionalConcerns.trim()) parts.push(draft.additionalConcerns.trim());
  if (draft.requestedSpecialties.length > 0) {
    parts.push(`Fachrichtungen: ${draft.requestedSpecialties.join(", ")}`);
  }
  return parts.join("\n");
}

export function resumeStep(lead: LeadDetail): WizardStepId {
  const raw = lead.wizard_state?.["step"];
  if (typeof raw === "string" && (PHASE_A_STEPS as readonly string[]).includes(raw)) {
    return raw as WizardStepId;
  }
  return "identity";
}
