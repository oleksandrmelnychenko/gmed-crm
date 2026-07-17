import type { LeadDetail } from "@/lib/api/types";
import type {
  ClinicalMedication,
  ClinicalNarrative,
  ClinicalWarning,
} from "@/pages/patients/data/patient-clinical";

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
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return false;
  }
  let age = today.getFullYear() - year;
  const monthDelta = today.getMonth() + 1 - month;
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < day)) {
    age -= 1;
  }
  return age < 18;
}

function hasContact(draft: WizardDraft): boolean {
  return draft.email.trim().length > 0 || draft.phone.trim().length > 0;
}

export type WizardRequirement =
  | "first_name"
  | "last_name"
  | "date_of_birth"
  | "legal_sex"
  | "contact"
  | "primary_concern"
  | "specialty";

export function missingStepRequirements(
  step: WizardStepId,
  draft: WizardDraft,
): WizardRequirement[] {
  switch (step) {
    case "identity":
      return [
        ...(draft.firstName.trim() ? [] : (["first_name"] as const)),
        ...(draft.lastName.trim() ? [] : (["last_name"] as const)),
        ...(draft.dateOfBirth ? [] : (["date_of_birth"] as const)),
        ...((VALID_LEGAL_SEX as readonly string[]).includes(draft.legalSex)
          ? []
          : (["legal_sex"] as const)),
        ...(hasContact(draft) ? [] : (["contact"] as const)),
      ];
    case "eligibility":
      return draft.primaryConcernText.trim() ? [] : ["primary_concern"];
    case "specialties":
      return draft.requestedSpecialties.length > 0 ? [] : ["specialty"];
  }
}

export function stepIsComplete(step: WizardStepId, draft: WizardDraft): boolean {
  return missingStepRequirements(step, draft).length === 0;
}

export function completedSteps(draft: WizardDraft): WizardStepId[] {
  return PHASE_A_STEPS.filter((step) => stepIsComplete(step, draft));
}

/** All lead-capture steps must be complete before convert-then-comply begins. */
export function canConvert(draft: WizardDraft): boolean {
  return PHASE_A_STEPS.every((step) => stepIsComplete(step, draft));
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

export type WizardOrderResume = {
  orderId: string;
  patientId: string;
  patientPid: string;
  savedOrderLineKeys: string[];
  orderLines: WizardOrderLine[];
  guardian: GuardianDraft;
  clinicalIntake: ClinicalIntakeDraft;
  startContract: boolean;
  contractId: string | null;
};

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringFromUnknown(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function orderLinesFromUnknown(value: unknown): WizardOrderLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = recordFromUnknown(item);
    const description = stringFromUnknown(record["description"]);
    const quantity = stringFromUnknown(record["quantity"], "1");
    const unitPrice = stringFromUnknown(record["unitPrice"], "0");
    const vatRate = stringFromUnknown(record["vatRate"], "19");
    const clientKey =
      stringFromUnknown(record["clientKey"]).trim() ||
      `restored-${index}-${description.trim().toLowerCase()}-${quantity}-${unitPrice}-${vatRate}`;
    return [{ clientKey, description, quantity, unitPrice, vatRate }];
  });
}

function guardianFromUnknown(value: unknown): GuardianDraft {
  const record = recordFromUnknown(value);
  return {
    name: stringFromUnknown(record["name"]),
    phone: stringFromUnknown(record["phone"]),
  };
}

function clinicalIntakeFromUnknown(
  value: unknown,
  fallback: ClinicalIntakeDraft,
): ClinicalIntakeDraft {
  const record = recordFromUnknown(value);
  return Object.fromEntries(
    Object.entries(fallback).map(([key, fallbackValue]) => [
      key,
      stringFromUnknown(record[key], fallbackValue),
    ]),
  ) as ClinicalIntakeDraft;
}

export function orderResumeFromLead(lead: LeadDetail): WizardOrderResume | null {
  const state = lead.wizard_state;
  if (!state || state["phase"] !== "order") return null;
  const orderId = state["order_id"];
  const statePatientId = state["patient_id"];
  const patientId = lead.converted_patient_id;
  if (typeof orderId !== "string" || !orderId || !patientId) return null;
  if (typeof statePatientId === "string" && statePatientId !== patientId) return null;
  const leadDraft = draftFromLead(lead);
  const contractId = state["contract_id"];
  return {
    orderId,
    patientId,
    patientPid: stringFromUnknown(state["patient_pid"]),
    savedOrderLineKeys: stringArrayFromUnknown(state["saved_order_line_keys"]),
    orderLines: orderLinesFromUnknown(state["order_lines"]),
    guardian: guardianFromUnknown(state["guardian"]),
    clinicalIntake: clinicalIntakeFromUnknown(
      state["clinical_intake"],
      blankClinicalIntake(leadDraft),
    ),
    startContract: state["start_contract"] !== false,
    contractId: typeof contractId === "string" && contractId ? contractId : null,
  };
}

export type OrderResumeStateInput = {
  patientId: string;
  patientPid?: string;
  orderId: string;
  savedOrderLineKeys?: string[];
  orderLines: WizardOrderLine[];
  guardian: GuardianDraft;
  clinicalIntake: ClinicalIntakeDraft;
  startContract: boolean;
  contractId?: string | null;
};

export function orderResumeWizardState(
  draft: WizardDraft,
  currentStep: WizardStepId,
  input: OrderResumeStateInput,
): Record<string, unknown> {
  return {
    step: currentStep,
    completed: completedSteps(draft),
    phase: "order",
    patient_id: input.patientId,
    patient_pid: input.patientPid ?? "",
    order_id: input.orderId,
    saved_order_line_keys: input.savedOrderLineKeys ?? [],
    order_lines: input.orderLines,
    guardian: input.guardian,
    clinical_intake: input.clinicalIntake,
    start_contract: input.startContract,
    contract_id: input.contractId ?? null,
    contract_started: Boolean(input.contractId),
  };
}

/**
 * Phase B — after the lead is converted, the wizard forms the actual order (#8):
 * real Leistungen (line items) with a live Kostenschätzung. Kept as pure logic
 * so the money maths and validation are unit-testable.
 */
export type WizardOrderLine = {
  clientKey: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
};

let orderLineSequence = 0;

function nextOrderLineClientKey(): string {
  orderLineSequence += 1;
  return `wizard-line-${Date.now()}-${orderLineSequence}`;
}

export function blankOrderLine(clientKey = nextOrderLineClientKey()): WizardOrderLine {
  return { clientKey, description: "", quantity: "1", unitPrice: "0", vatRate: "19" };
}

function numberOrNull(value: string): number | null {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A line is billable once its description and monetary fields are valid. */
export function orderLineIsValid(line: WizardOrderLine): boolean {
  const quantity = numberOrNull(line.quantity);
  const unitPrice = numberOrNull(line.unitPrice);
  const vatRate = numberOrNull(line.vatRate);
  return (
    line.description.trim().length > 0 &&
    quantity !== null &&
    quantity > 0 &&
    unitPrice !== null &&
    unitPrice >= 0 &&
    vatRate !== null &&
    vatRate >= 0 &&
    vatRate <= 100
  );
}

export function orderLineIsBlank(line: WizardOrderLine): boolean {
  return (
    line.description.trim().length === 0 &&
    numberOrNull(line.quantity) === 1 &&
    numberOrNull(line.unitPrice) === 0 &&
    numberOrNull(line.vatRate) === 19
  );
}

/** At least one valid line is required; untouched extra rows are ignored. */
export function orderLinesAreReady(lines: WizardOrderLine[]): boolean {
  const enteredLines = lines.filter((line) => !orderLineIsBlank(line));
  return enteredLines.length > 0 && enteredLines.every(orderLineIsValid);
}

export type CostEstimate = { net: number; vat: number; gross: number };

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Kostenschätzung across the valid lines: net, VAT and gross totals. */
export function costEstimate(lines: WizardOrderLine[]): CostEstimate {
  let net = 0;
  let vat = 0;
  for (const line of lines) {
    if (!orderLineIsValid(line)) continue;
    const quantity = numberOrNull(line.quantity) ?? 0;
    const unitPrice = numberOrNull(line.unitPrice) ?? 0;
    const rate = numberOrNull(line.vatRate) ?? 0;
    const lineNet = quantity * unitPrice;
    net += lineNet;
    vat += (lineNet * rate) / 100;
  }
  net = roundMoney(net);
  vat = roundMoney(vat);
  return { net, vat, gross: roundMoney(net + vat) };
}

/** The `POST /orders/{id}/leistungen` payload for one line. */
export function orderLineClientReference(leadId: string, line: WizardOrderLine): string {
  return `lead-wizard:${leadId}:${line.clientKey}`;
}

export function orderLinePayload(
  line: WizardOrderLine,
  patientId?: string,
  clientReference?: string,
): Record<string, unknown> {
  return {
    ...(patientId ? { patient_id: patientId } : {}),
    description: line.description.trim(),
    quantity: numberOrNull(line.quantity) ?? 0,
    unit_price: numberOrNull(line.unitPrice) ?? 0,
    vat_rate: numberOrNull(line.vatRate) ?? 0,
    ...(clientReference ? { client_reference: clientReference } : {}),
  };
}

export function orderLineFingerprint(line: WizardOrderLine): string {
  return [
    line.description.trim().toLowerCase(),
    numberOrNull(line.quantity) ?? 0,
    numberOrNull(line.unitPrice) ?? 0,
    numberOrNull(line.vatRate) ?? 0,
  ].join("|");
}

/**
 * Guardian branch (#2/#11): a minor cannot hold a plan alone, so before the
 * wizard finishes it must capture the legal guardian, recorded as a
 * `guardian` patient relation. Pure logic so the gate is unit-testable.
 */
export type GuardianDraft = { name: string; phone: string };

export function blankGuardian(): GuardianDraft {
  return { name: "", phone: "" };
}

export function guardianIsComplete(guardian: GuardianDraft): boolean {
  return guardian.name.trim().length > 0;
}

/**
 * Whether the wizard may finish: an adult can always finish; a minor may only
 * finish once a guardian has been named (#2/#11).
 */
export function canFinishOrder(minor: boolean, guardian: GuardianDraft): boolean {
  return !minor || guardianIsComplete(guardian);
}

/** The `POST /patients/{id}/relations` payload for the captured guardian. */
export function guardianPayload(guardian: GuardianDraft): Record<string, unknown> {
  return {
    related_name: guardian.name.trim(),
    relation_type: "guardian",
    phone: guardian.phone.trim() || null,
    is_emergency_contact: true,
  };
}

export type ClinicalIntakeDraft = {
  currentComplaint: string;
  anamneseHistory: string;
  medicationName: string;
  medicationStrength: string;
  medicationForm: string;
  medicationRoute: string;
  medicationDose: string;
  medicationReason: string;
  medicationNotes: string;
  allergyLabel: string;
  allergyReaction: string;
  allergySeverity: string;
  allergyNotes: string;
  caveLabel: string;
  caveNotes: string;
};

export function blankClinicalIntake(
  draft?: Pick<WizardDraft, "primaryConcernText" | "additionalConcerns">,
): ClinicalIntakeDraft {
  return {
    currentComplaint: draft?.primaryConcernText ?? "",
    anamneseHistory: draft?.additionalConcerns ?? "",
    medicationName: "",
    medicationStrength: "",
    medicationForm: "TABL",
    medicationRoute: "Oral",
    medicationDose: "",
    medicationReason: "",
    medicationNotes: "",
    allergyLabel: "",
    allergyReaction: "",
    allergySeverity: "",
    allergyNotes: "",
    caveLabel: "",
    caveNotes: "",
  };
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function clinicalIntakeHasNarrative(intake: ClinicalIntakeDraft): boolean {
  return Boolean(
    trimOrNull(intake.currentComplaint) || trimOrNull(intake.anamneseHistory),
  );
}

export function clinicalIntakeHasMedication(intake: ClinicalIntakeDraft): boolean {
  return Boolean(trimOrNull(intake.medicationName));
}

export function clinicalIntakeHasAllergy(intake: ClinicalIntakeDraft): boolean {
  return Boolean(trimOrNull(intake.allergyLabel));
}

export function clinicalIntakeHasCave(intake: ClinicalIntakeDraft): boolean {
  return Boolean(trimOrNull(intake.caveLabel));
}

export function clinicalNarrativePayload(
  intake: ClinicalIntakeDraft,
  existing: Partial<ClinicalNarrative> | null = null,
): ClinicalNarrative {
  return {
    id: existing?.id ?? null,
    anamnese_aktuelle:
      trimOrNull(intake.currentComplaint) ?? existing?.anamnese_aktuelle ?? null,
    anamnese_vorgeschichte:
      trimOrNull(intake.anamneseHistory) ?? existing?.anamnese_vorgeschichte ?? null,
    anamnese_vegetative: existing?.anamnese_vegetative ?? null,
    anamnese_sozial: existing?.anamnese_sozial ?? null,
    beurteilung: existing?.beurteilung ?? null,
    anamnese_at: existing?.anamnese_at ?? new Date().toISOString(),
    is_active: true,
  };
}

export function clinicalMedicationPayload(
  intake: ClinicalIntakeDraft,
): ClinicalMedication | null {
  const wirkstoff = trimOrNull(intake.medicationName);
  if (!wirkstoff) return null;
  return {
    provider_id: null,
    provider_name: null,
    doctor_id: null,
    doctor_name: null,
    doctor_title: null,
    doctor_fachbereich: null,
    category: "dauer",
    wirkstoff,
    handelsname: "",
    staerke: trimOrNull(intake.medicationStrength),
    form: trimOrNull(intake.medicationForm) ?? "TABL",
    einnahmeform: trimOrNull(intake.medicationRoute) ?? "Oral",
    dose_morgens: trimOrNull(intake.medicationDose),
    dose_mittags: null,
    dose_abends: null,
    dose_nachts: null,
    einheit: null,
    hinweis: trimOrNull(intake.medicationNotes),
    grund: trimOrNull(intake.medicationReason),
    verordnet_am: null,
    einnahme_von: null,
    einnahme_bis: null,
    status: "aktiv",
    apothekenpflichtig: false,
    rezeptpflichtig: false,
    btm: false,
    aut_idem_sperre: false,
    abgabebeschraenkung: false,
    sonstige_vermerke: null,
    on_hold: false,
    hold_from: null,
    hold_until: null,
    hold_note: null,
  };
}

function normalizedFingerprint(parts: Array<string | null | undefined>): string {
  return parts.map((part) => part?.trim().toLowerCase() ?? "").join("|");
}

export function clinicalMedicationFingerprint(item: ClinicalMedicationLike): string {
  return normalizedFingerprint([
    item.wirkstoff,
    item.handelsname,
    item.staerke,
    item.form,
    item.einnahmeform,
    item.dose_morgens,
    item.grund,
    item.hinweis,
  ]);
}

type ClinicalMedicationLike = Pick<
  ClinicalMedication,
  | "wirkstoff"
  | "handelsname"
  | "staerke"
  | "form"
  | "einnahmeform"
  | "dose_morgens"
  | "grund"
  | "hinweis"
>;

type ClinicalWarningLike = Pick<
  ClinicalWarning,
  "kind" | "label" | "reaction" | "severity" | "note"
>;

export function clinicalWarningPayload(
  intake: ClinicalIntakeDraft,
  kind: "allergie" | "cave",
): ClinicalWarning | null {
  const label =
    kind === "allergie" ? trimOrNull(intake.allergyLabel) : trimOrNull(intake.caveLabel);
  if (!label) return null;
  return {
    kind,
    label,
    reaction: kind === "allergie" ? trimOrNull(intake.allergyReaction) : null,
    severity: kind === "allergie" ? trimOrNull(intake.allergySeverity) : null,
    note: kind === "allergie" ? trimOrNull(intake.allergyNotes) : trimOrNull(intake.caveNotes),
  };
}

export function clinicalWarningFingerprint(item: ClinicalWarningLike): string {
  return normalizedFingerprint([
    item.kind,
    item.label,
    item.reaction,
    item.severity,
    item.note,
  ]);
}
