import { INQUIRY_CONSENT, type LeadRequest } from "./lead-request-api";
import { isBillingField } from "./lead-request-billing-model";
import { followUpAnswered, followUpMissingAll, followUpShown } from "./lead-request-follow-up-model";
import { SUBMIT_FIELDS, changedSinceSubmit, consentGiven } from "./lead-request-model";
import { representativeSubmitPart } from "./lead-request-representation-model";

// The lead cabinet as a stepper of short tabs (trigger flow 2026-10-07,
// contract section 6 and 13.3): each step shows what it still misses and a
// badge on its tab; the person moves freely back and forth. The server says
// which step a missing key belongs to (`progress.missing_by_step`); an older
// server does not, and the cabinet then maps the keys itself.

/** The steps in their order. "follow_up" exists only while the server opened blocks. */
export const STEP_IDS = [
  "person",
  "contact",
  "identity",
  "payer",
  "billing",
  "declarations",
  "follow_up",
  "documents",
  "send",
] as const;

export type StepId = (typeof STEP_IDS)[number];

/** The steps whose missing keys the server lists in `missing_by_step` (contract 3.1). */
export const SERVER_STEPS = ["person", "contact", "identity", "payer", "billing", "declarations"] as const;

/** The steps a key of `missing_for_submit` can belong to (the follow-up has its own list). */
export type FormStep = Exclude<StepId, "follow_up" | "send">;

const PERSON_KEYS: ReadonlySet<string> = new Set([
  "salutation",
  "first_name",
  "last_name",
  "middle_name",
  "former_names",
  "date_of_birth",
  "birth_place",
  "birth_country",
  "legal_sex",
  "citizenships",
  "has_representative",
  "under_guardianship",
  "custody",
]);

const CONTACT_KEYS: ReadonlySet<string> = new Set([
  "street_address",
  "zip_code",
  "city",
  "country",
  "habitual_residence_country",
  "phone",
  "primary_language",
  "contact_channels",
]);

const DECLARATION_KEYS: ReadonlySet<string> = new Set([
  "pep_self",
  "pep_related",
  "sanctions_links",
  // An older server still names the details and the high-risk question.
  "pep_self_details",
  "pep_related_details",
  "high_risk_country",
  "high_risk_country_code",
  "sanctions_links_details",
]);

/**
 * The step a key of `missing_for_submit` is answered in, for a server that
 * does not say so: the person with the representation, contact and
 * residence, the identity document, who pays, insurance and invoice, the
 * declarations, the reason of the request. A key the cabinet does not know
 * is shown in the first step.
 */
export function stepOfField(field: string): FormStep {
  if (PERSON_KEYS.has(field) || representativeSubmitPart(field)) return "person";
  if (CONTACT_KEYS.has(field)) return "contact";
  if (field === "id_document_upload" || field.startsWith("id_")) return "identity";
  if (field.startsWith("payer_") || field === "payment_background") return "payer";
  if (field === "has_insurance" || field.startsWith("insurance_") || isBillingField(field)) return "billing";
  if (DECLARATION_KEYS.has(field)) return "declarations";
  if (field === "request_reason") return "documents";
  return "person";
}

/** The steps shown for this request, in their order. */
export function visibleSteps(request: Pick<LeadRequest, "follow_up">): StepId[] {
  return STEP_IDS.filter((step) => step !== "follow_up" || followUpShown(request));
}

const FORM_ORDER = new Map<string, number>((SUBMIT_FIELDS as readonly string[]).map((field, index) => [field, index]));

function byFormOrder(keys: string[]): string[] {
  return [...keys].sort((left, right) => (FORM_ORDER.get(left) ?? Infinity) - (FORM_ORDER.get(right) ?? Infinity));
}

/**
 * What every step still misses: the server's own map for the steps it knows,
 * any other key of `missing_for_submit` by `stepOfField` (an older server, or
 * the reason of the request), and the follow-up's keys as `<block>:<key>`.
 */
export function missingByStep(
  request: Pick<LeadRequest, "progress" | "follow_up">,
): Record<StepId, string[]> {
  const result = Object.fromEntries(STEP_IDS.map((step) => [step, [] as string[]])) as Record<StepId, string[]>;
  const server = request.progress.missing_by_step;
  const placed = new Set<string>();
  if (server) {
    for (const step of STEP_IDS) {
      if (step === "follow_up" || step === "send") continue;
      for (const key of server[step] ?? []) {
        if (placed.has(key)) continue;
        placed.add(key);
        result[step].push(key);
      }
    }
  }
  for (const key of request.progress.missing_for_submit) {
    if (placed.has(key)) continue;
    placed.add(key);
    result[stepOfField(key)].push(key);
  }
  for (const step of STEP_IDS) result[step] = byFormOrder(result[step]);
  result.follow_up = followUpMissingAll(request).map(({ block, key }) => `${block}:${key}`);
  return result;
}

/**
 * The count on a step's badge: its missing keys, and in the first step the
 * consent to process the request data (needed to send, not a key of the list).
 */
export function stepMissingCount(
  request: Pick<LeadRequest, "progress" | "follow_up" | "consents">,
  step: StepId,
  missing: Record<StepId, string[]> = missingByStep(request),
): number {
  const consent = step === "person" && !consentGiven(request, INQUIRY_CONSENT) ? 1 : 0;
  return missing[step].length + consent;
}

/** Whether a step is complete: nothing missing, and for "send" sent and unchanged since. */
export function stepDone(
  request: Pick<LeadRequest, "progress" | "follow_up" | "consents" | "submitted_at" | "changed_since_submit" | "documents">,
  step: StepId,
  missing: Record<StepId, string[]> = missingByStep(request),
): boolean {
  if (step === "send") return Boolean(request.submitted_at) && !changedSinceSubmit(request);
  if (step === "follow_up") return followUpAnswered(request);
  return stepMissingCount(request, step, missing) === 0;
}

/** The first step that still misses something (not "send"); null when everything is there. */
export function firstIncompleteStep(
  request: Pick<LeadRequest, "progress" | "follow_up" | "consents">,
): StepId | null {
  const missing = missingByStep(request);
  return visibleSteps(request).find((step) => step !== "send" && stepMissingCount(request, step, missing) > 0) ?? null;
}

/**
 * The step a request opens with: the first one while it is not sent; the
 * follow-up while GMED waits for its answers; else the summary.
 */
export function initialStep(request: Pick<LeadRequest, "submitted_at" | "follow_up">): StepId {
  if (!request.submitted_at) return "person";
  if (followUpShown(request) && !followUpAnswered(request)) return "follow_up";
  return "send";
}
