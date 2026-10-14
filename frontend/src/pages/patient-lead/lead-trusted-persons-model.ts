import { CONSENT_RECIPIENT_RELATIONS, MAX_CONSENT_RECIPIENTS, type ConsentRecipient, type ConsentRecipientRelation, type LeadRequest } from "./lead-request-api";

export type RecipientDraft = { name: string; relation: ConsentRecipientRelation | ""; contact: string };

export function recipientDrafts(saved: readonly ConsentRecipient[] | undefined): RecipientDraft[] {
  return (saved ?? []).map((person) => ({ name: person.name, relation: person.relation, contact: person.contact ?? "" }));
}

const normalizedName = (name: string) => name.trim().replace(/\s+/g, " ");
const typedPersons = (drafts: readonly RecipientDraft[]) => drafts.filter((person) => person.name.trim() || person.relation || person.contact.trim());

/** Empty rows are not people; incomplete rows must pass validation before saving. */
export function recipientsToSend(drafts: readonly RecipientDraft[]): ConsentRecipient[] {
  return typedPersons(drafts).map((person) => ({
    name: normalizedName(person.name), relation: person.relation as ConsentRecipientRelation, contact: person.contact.trim() || null,
  }));
}

export function trustedPersonsProblem(drafts: readonly RecipientDraft[]): "invalid" | null {
  const people = typedPersons(drafts);
  return people.length > MAX_CONSENT_RECIPIENTS || people.some((person) =>
    !normalizedName(person.name) || [...normalizedName(person.name)].length > 120 ||
    !CONSENT_RECIPIENT_RELATIONS.includes(person.relation as ConsentRecipientRelation) || [...person.contact.trim()].length > 120,
  ) ? "invalid" : null;
}

export function samePersons(left: readonly ConsentRecipient[], right: readonly ConsentRecipient[]): boolean {
  return left.length === right.length && left.every((person, index) =>
    person.name === right[index].name && person.relation === right[index].relation && (person.contact || null) === (right[index].contact || null),
  );
}

/** An explicitly empty stored list must never resurrect historical consent recipients. */
export function storedTrustedPersons(request: Pick<LeadRequest, "trusted_persons" | "consent_form">): ConsentRecipient[] {
  return request.trusted_persons ?? request.consent_form?.recipients ?? [];
}

export function trustedPersonsPath(leadId: string): string {
  return `/trusted-persons?lead=${encodeURIComponent(leadId)}`;
}

export function requestForLead(requests: readonly LeadRequest[], selected: string | null): LeadRequest | null {
  return requests.find((request) => request.lead_id === selected) ?? requests[0] ?? null;
}
