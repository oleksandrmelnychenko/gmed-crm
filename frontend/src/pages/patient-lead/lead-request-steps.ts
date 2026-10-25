import { HEALTH_CONSENT, INQUIRY_CONSENT, type LeadRequest } from "./lead-request-api";
import { isBillingField } from "./lead-request-billing-model";
import { followUpAnswered, followUpBeforeSubmit, followUpMissingAll, followUpShown } from "./lead-request-follow-up-model";
import { SUBMIT_FIELDS, changedSinceSubmit, consentGiven, identityDocumentsInStep } from "./lead-request-model";
import { isRecipientField } from "./lead-request-recipient-model";
import { representativeSubmitPart } from "./lead-request-representation-model";
import { disclosureDraft, disclosureProblem } from "./lead-trusted-persons-model";

// The lead cabinet as a stepper of short tabs (trigger flow 2026-10-07,
// contract section 6 and 13.3): each step shows what it still misses and a
// badge on its tab; the person moves freely back and forth. The server says
// which step a missing key belongs to (`progress.missing_by_step`); an older
// server does not, and the cabinet then maps the keys itself.

/**
 * The steps in their order. "follow_up" exists only while the server opened
 * blocks. "Who pays" is part of step 3 "Versicherung & Rechnung" since
 * 2026-10-11 (owner): the invoice recipient comes first and absorbs it.
 */
export const STEP_IDS = [
  "person",
  "contact",
  "identity",
  "billing",
  "declarations",
  "follow_up",
  "disclosure",
  "documents",
  "send",
] as const;

export type StepId = (typeof STEP_IDS)[number];

/**
 * Sections a box of another step can send the person to ("Please add in the
 * section …", owner report 2026-10-21): the element with this id is scrolled
 * into view once its step is open.
 */
export const SECTION_ANCHORS = {
  representatives: "lead-request-section-representatives",
  payer: "lead-request-section-payer",
  paymentRoute: "lead-request-section-payment-route",
  ownDocument: "lead-request-section-own-document",
} as const;

export type SectionAnchor = (typeof SECTION_ANCHORS)[keyof typeof SECTION_ANCHORS];

/** The steps whose missing keys the server lists in `missing_by_step` (contract 3.1). */
export const SERVER_STEPS = ["person", "contact", "identity", "billing", "declarations"] as const;

/** The steps a key of `missing_for_submit` can belong to (the follow-up has its own list). */
export type FormStep = Exclude<StepId, "follow_up" | "send">;

const PERSON_KEYS: ReadonlySet<string> = new Set([
  "name_latin",
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
  // An older server still names the details.
  "pep_self_details",
  "pep_related_details",
  "sanctions_links_details",
]);

/**
 * The step a key of `missing_for_submit` is answered in, for a server that
 * does not say so (or names a step the cabinet no longer has): the person
 * with the representation, contact and residence, the identity document,
 * insurance with the invoice recipient and who pays, the declarations, the
 * reason of the request. A key the cabinet does not know is shown in the
 * first step.
 */
export function stepOfField(field: string): FormStep {
  // A minor's parents upload their identity copies on step "Document" (QA 2026-10-22), like the server's `step_of`.
  const person = representativeSubmitPart(field);
  if (person?.part === "id_upload" && (person.slot === "rep1" || person.slot === "rep2")) return "identity";
  if (PERSON_KEYS.has(field) || person) return "person";
  if (CONTACT_KEYS.has(field)) return "contact";
  if (field === "id_document_upload" || field.startsWith("id_")) return "identity";
  if (
    field.startsWith("payer_") ||
    field === "payment_background" ||
    isRecipientField(field) ||
    field === "has_insurance" ||
    field.startsWith("insurance_") ||
    isBillingField(field)
  ) {
    return "billing";
  }
  if (DECLARATION_KEYS.has(field)) return "declarations";
  if (field === "request_reason") return "documents";
  return "person";
}

/** Legacy/server-only fields have no input in the base form. Keep them visible
 * in the sending summary without pointing to a step that cannot answer them. */
export function hasBaseFormInput(field: string): boolean {
  if (["former_names", "birth_place", "birth_country", "habitual_residence_country", "payment_background"].includes(field)) return false;
  if (DECLARATION_KEYS.has(field)) return false;
  if (field.startsWith("id_") && field !== "id_document_upload") return false;
  return PERSON_KEYS.has(field) || CONTACT_KEYS.has(field) || Boolean(representativeSubmitPart(field)) ||
    field === "id_document_upload" || field === "request_reason" ||
    field.startsWith("payer_") || isRecipientField(field) || isBillingField(field) ||
    field === "has_insurance" || field.startsWith("insurance_");
}

/** The steps shown for this request, in their order. */
export function visibleSteps(request: Pick<LeadRequest, "follow_up" | "submitted_at">): StepId[] {
  // "contact" is part of the first step (owner 2026-10-09): one tab with the consent and the person.
  // "declarations" moved to follow-up block L (owner 2026-10-09): only with the enhanced check.
  return STEP_IDS.filter(
    (step) => step !== "contact" && step !== "declarations" && (step !== "follow_up" || followUpShown(request)),
  );
}

const FORM_ORDER = new Map<string, number>((SUBMIT_FIELDS as readonly string[]).map((field, index) => [field, index]));

function byFormOrder(keys: string[]): string[] {
  return [...keys].sort((left, right) => (FORM_ORDER.get(left) ?? Infinity) - (FORM_ORDER.get(right) ?? Infinity));
}

/**
 * The upload keys of the persons whose only identity copies GMED could not use
 * (`follow_up.refused_identity_documents`, no current copy): `id_document_upload`
 * for the lead's own, `<slot>_id_upload` for a representative. The server lists
 * no missing key for them, yet the person has to upload a new copy (QA 2026-10-25,
 * F-V2: step "Ausweis" said "complete" next to the refused scan).
 */
export function refusedIdentityUploadKeys(
  request: Pick<LeadRequest, "follow_up"> & Partial<Pick<LeadRequest, "identity_documents" | "representation">>,
): string[] {
  if (!request.follow_up?.refused_identity_documents?.length) return [];
  const keys: string[] = [];
  if (identityDocumentsInStep(request, request.identity_documents ?? []).refused.length > 0) keys.push("id_document_upload");
  for (const person of request.representation?.representatives ?? []) {
    if (!person.slot) continue;
    if (identityDocumentsInStep(request, person.identity_documents ?? [], person.id).refused.length > 0) {
      keys.push(`${person.slot}_id_upload`);
    }
  }
  return keys;
}

/**
 * What every step still misses: the server's own map for the steps it knows,
 * any other key of `missing_for_submit` by `stepOfField` (an older server, or
 * the reason of the request), a new upload for an identity copy GMED refused
 * (`refusedIdentityUploadKeys`), and the follow-up's keys as `<block>:<key>`.
 */
export function missingByStep(
  request: Pick<LeadRequest, "progress" | "follow_up"> & Partial<Pick<LeadRequest, "identity_documents" | "representation">>,
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
  for (const key of [...request.progress.missing_for_submit, ...refusedIdentityUploadKeys(request)]) {
    if (placed.has(key)) continue;
    placed.add(key);
    result[stepOfField(key)].push(key);
  }
  // The contact keys are answered in the first step.
  result.person = [...result.person, ...result.contact];
  result.contact = [];
  for (const step of STEP_IDS) result[step] = byFormOrder(result[step]);
  result.follow_up = followUpMissingAll(request).map(({ block, key }) => `${block}:${key}`);
  return result;
}

/**
 * The consent to process the request data counts as missing in the first
 * step only while the request was never sent: sending needs it, and it is no
 * key of the server's lists. Once a request is sent (by the other parent, for
 * instance) the steps follow the server's lists alone (QA 2026-10-24); step
 * "send" still asks for the consent of a login that sends again.
 */
export function inquiryConsentMissing(request: Pick<LeadRequest, "consents"> & Partial<Pick<LeadRequest, "submitted_at">>): boolean {
  return !request.submitted_at && !consentGiven(request, INQUIRY_CONSENT);
}

/**
 * The count on a step's badge: its missing keys, and in the first step the
 * consent while the request was never sent (`inquiryConsentMissing`).
 */
export function stepMissingCount(
  request: Pick<LeadRequest, "progress" | "follow_up" | "consents"> & Partial<Pick<LeadRequest, "submitted_at">>,
  step: StepId,
  missing: Record<StepId, string[]> = missingByStep(request),
): number {
  const consent = step === "person" && inquiryConsentMissing(request) ? 1 : 0;
  return missing[step].length + consent;
}

/**
 * Whether step "documents" was touched: the server requires nothing there
 * before the contract (the consent, the reason and the files are voluntary),
 * so the step counts as filled in only once the person gave the health
 * consent, a reason or a file (QA 2026-10-24, A-1).
 */
export function documentsTouched(
  request: Pick<LeadRequest, "consents" | "documents"> & Partial<Pick<LeadRequest, "identification">>,
): boolean {
  return (
    consentGiven(request, HEALTH_CONSENT) ||
    Boolean(request.identification?.request_reason?.trim()) ||
    request.documents.length > 0
  );
}

/**
 * Whether a step is complete: nothing missing, and for "send" sent and
 * unchanged since. A step whose answer only defaults ("no information to
 * third parties" while nobody answered) or that asks for nothing is not
 * marked as filled in until the person touched it (QA 2026-10-24, A-1);
 * `firstIncompleteStep` and the sending do not depend on this.
 */
export function stepDone(
  request: Pick<LeadRequest, "progress" | "follow_up" | "consents" | "submitted_at" | "changed_since_submit" | "documents" | "disclosure" | "consent_form"> &
    Partial<Pick<LeadRequest, "identification">>,
  step: StepId,
  missing: Record<StepId, string[]> = missingByStep(request),
): boolean {
  if (step === "send") return Boolean(request.submitted_at) && !changedSinceSubmit(request);
  // Not answered counts as "no" (owner decision 2026-10-22) for the sending; the step is
  // "filled in" only with an own, valid decision.
  if (step === "disclosure") return Boolean(request.disclosure) && disclosureProblem(disclosureDraft(request)) === null;
  if (step === "follow_up") return followUpBeforeSubmit(request) ? followUpMissingAll(request).length === 0 : followUpAnswered(request);
  if (stepMissingCount(request, step, missing) > 0) return false;
  return step === "documents" ? documentsTouched(request) : true;
}

/** The first step that still misses something (not "send"); null when everything is there. */
export function firstIncompleteStep(
  request: Pick<LeadRequest, "progress" | "follow_up" | "consents" | "submitted_at">,
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
