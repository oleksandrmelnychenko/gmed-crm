import { CONSENT_RECIPIENT_RELATIONS, DISCLOSURE_VERSION, MAX_CONSENT_RECIPIENTS, type ConsentRecipient, type ConsentRecipientRelation, type LeadDisclosureInput, type LeadRequest } from "./lead-request-api";

export type RecipientDraft = { name: string; relation: ConsentRecipientRelation | ""; contact: string; scope: string };
export type DisclosureDraft = { allowDisclosure: boolean | null; consentGiven: boolean; persons: RecipientDraft[] };

export function recipientDrafts(saved: readonly ConsentRecipient[] | undefined): RecipientDraft[] {
  return (saved ?? []).map((person) => ({ name: person.name, relation: person.relation, contact: person.contact ?? "", scope: person.scope ?? "" }));
}

const normalizedName = (name: string) => name.trim().replace(/\s+/g, " ");
const typedPersons = (drafts: readonly RecipientDraft[]) => drafts.filter((person) => person.name.trim() || person.relation || person.contact.trim() || person.scope.trim());

/** Empty rows are not people; incomplete rows must pass validation before saving. */
export function recipientsToSend(drafts: readonly RecipientDraft[]): LeadDisclosureInput["persons"] {
  return typedPersons(drafts).map((person) => ({
    name: normalizedName(person.name), relation: person.relation as ConsentRecipientRelation, contact: person.contact.trim() || null, scope: person.scope.trim(),
  }));
}

export function trustedPersonsProblem(drafts: readonly RecipientDraft[]): "invalid" | null {
  const people = typedPersons(drafts);
  return people.length > MAX_CONSENT_RECIPIENTS || people.some((person) =>
    !normalizedName(person.name) || [...normalizedName(person.name)].length > 120 ||
    !CONSENT_RECIPIENT_RELATIONS.includes(person.relation as ConsentRecipientRelation) || [...person.contact.trim()].length > 120 ||
    !person.scope.trim() || [...person.scope.trim()].length > 240,
  ) ? "invalid" : null;
}

export function samePersons(left: readonly ConsentRecipient[], right: readonly ConsentRecipient[]): boolean {
  return left.length === right.length && left.every((person, index) =>
    person.name === right[index].name && person.relation === right[index].relation && (person.contact || null) === (right[index].contact || null) && (person.scope || null) === (right[index].scope || null),
  );
}

/** An explicitly empty stored list must never resurrect historical consent recipients. */
export function storedTrustedPersons(request: Pick<LeadRequest, "trusted_persons" | "consent_form">): ConsentRecipient[] {
  return request.trusted_persons ?? request.consent_form?.recipients ?? [];
}

export function trustedPersonsPath(leadId: string): string {
  // /request is also accepted in lead mode as the wizard's canonical deep link.
  return `/request?lead=${encodeURIComponent(leadId)}&step=disclosure`;
}

export function requestForLead(requests: readonly LeadRequest[], selected: string | null): LeadRequest | null {
  return requests.find((request) => request.lead_id === selected) ?? requests[0] ?? null;
}

export function disclosureDraft(request: Pick<LeadRequest, "disclosure" | "disclosure_company_name" | "trusted_persons" | "consent_form">, viewerId?: string): DisclosureDraft {
  return {
    allowDisclosure: request.disclosure?.allow_disclosure ?? null,
    consentGiven: request.disclosure?.allow_disclosure === true && request.disclosure.consent_given === true && request.disclosure.version === DISCLOSURE_VERSION &&
      (!viewerId || request.disclosure.chosen_by === viewerId) && (!request.disclosure_company_name || request.disclosure_company_name === request.disclosure.company_name),
    persons: recipientDrafts(storedTrustedPersons(request)),
  };
}

export function disclosureProblem(draft: DisclosureDraft): "decision" | "required" | "invalid" | "consent" | null {
  if (draft.allowDisclosure === null) return "decision";
  if (!draft.allowDisclosure) return null;
  if (trustedPersonsProblem(draft.persons)) return "invalid";
  if (recipientsToSend(draft.persons).length === 0) return "required";
  return draft.consentGiven ? null : "consent";
}

export function disclosureChanged(draft: DisclosureDraft, request: Pick<LeadRequest, "disclosure" | "disclosure_company_name" | "trusted_persons" | "consent_form">, viewerId?: string): boolean {
  const saved = disclosureDraft(request, viewerId);
  return draft.allowDisclosure !== saved.allowDisclosure || draft.consentGiven !== saved.consentGiven ||
    (draft.allowDisclosure !== false && !samePersons(recipientsToSend(draft.persons), recipientsToSend(saved.persons)));
}

export function disclosureToSend(draft: DisclosureDraft, language: LeadDisclosureInput["language"]): LeadDisclosureInput {
  if (disclosureProblem(draft)) throw new Error("Incomplete disclosure decision");
  return {
    persons: draft.allowDisclosure ? recipientsToSend(draft.persons) : [],
    allow_disclosure: draft.allowDisclosure === true,
    consent_given: draft.allowDisclosure === true && draft.consentGiven,
    version: DISCLOSURE_VERSION,
    language,
  };
}
